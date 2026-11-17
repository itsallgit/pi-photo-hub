// photo-api - the control layer of Pi Photo Hub (principle 12, layer 2). Every client (the
// slideshow page and its viewers, the phone page, the buttons, the slideshow-control skill, the
// boot launcher) plays and changes the slideshow through this API. Since the slideshow layer (B32)
// the API holds the one slideshow itself (lib/player.js) and serves the page that shows it (/show).
// The API reference is in docs/architecture.md ("Photo API", "Slideshow layer").
const express = require("express");
const fs = require("fs");
const path = require("path");
const winston = require("winston");
require("winston-daily-rotate-file");

const config = require("./lib/config");
const { readJson, writeJson, writeText } = require("./lib/state");
const picapport = require("./lib/picapport");
const browser = require("./lib/browser");
const screen = require("./lib/screen");
const dev = require("./lib/dev");
const player = require("./lib/player");
const events = require("./lib/events");
const library = require("./lib/library");
const catalogue = require("./lib/catalogue");
const settingsLib = require("./lib/settings");
const marks = require("./lib/marks");
const history = require("./lib/history");
const schedule = require("./lib/schedule");

// -----------------------------
// Logging
// -----------------------------
fs.mkdirSync(config.logDir, { recursive: true });
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.DailyRotateFile({
            filename: "server-%DATE%.log",
            dirname: config.logDir,
            datePattern: "YYYY-MM-DD",
            maxSize: "10m",
            maxFiles: "7d",
            zippedArchive: true,
        }),
    ],
});

// -----------------------------
// The saved slideshow of the older API (slideshow.json, slideshow_url.txt). Still written, so that
// an older version (after a rollback) replays the same slideshow, and read once to start the
// player the first time.
// -----------------------------
function loadLegacy() {
    const saved = readJson(config.files.slideshow, null);
    if (saved && saved.query) return { ...config.defaults, label: null, ...saved };
    try {
        const fromUrl = picapport.parseSlideshowUrl(fs.readFileSync(config.files.slideshowUrl, "utf8").trim());
        if (fromUrl && fromUrl.query) {
            return {
                ...config.defaults,
                label: null,
                ...Object.fromEntries(Object.entries(fromUrl).filter(([, v]) => v !== null && v !== "" && !Number.isNaN(v))),
            };
        }
    } catch (err) {
        if (err.code !== "ENOENT") logger.warn(`Could not read ${config.files.slideshowUrl}: ${err.message}`);
    }
    return { ...config.defaults, label: null };
}

// The player's slideshow in the older shape: { query, label, sort, interval, startedAt }.
function legacyView() {
    const v = player.view();
    const src = v.source || {};
    return {
        query: src.query || null,
        label: src.label || (src.query ? null : v.source.label || null),
        sort: settingsLib.ORDER_TO_SORT[v.settings.order] || "random",
        interval: v.settings.interval,
        startedAt: legacyStartedAt,
    };
}
let legacyStartedAt = null;

function saveLegacy() {
    const l = legacyView();
    if (!l.query) return; // only query slideshows can be replayed by an older version
    try {
        writeJson(config.files.slideshow, l);
        writeText(config.files.slideshowUrl, picapport.slideshowUrl(l));
    } catch (err) {
        logger.warn(`Could not save the slideshow for older versions: ${err.message}`);
    }
}

// -----------------------------
// The kiosk browser on the shelf screen
// -----------------------------
// The viewer setting (R21) chooses our page or Picapport's own slideshow page (the old behaviour).
function kioskUrl() {
    const st = player.settings();
    const src = player.source() || {};
    if (st.viewer === "picapport" && src.query) {
        return picapport.slideshowUrl({ query: src.query, sort: settingsLib.ORDER_TO_SORT[st.order] || "random", interval: st.interval });
    }
    return `http://localhost:${config.port}/show?kiosk=1`;
}
let kioskShowing = null;
async function openKiosk() {
    const url = kioskUrl();
    await browser.open(url, logger);
    kioskShowing = url;
}
async function ensureKiosk() {
    if (kioskShowing !== kioskUrl() || !(await browser.isRunning())) await openKiosk();
}

// Starting or changing a slideshow turns the screen on (and cancels an "off" timer).
async function ensureScreenOn() {
    try {
        const s = await screen.status();
        if (s.wantedOff || s.on === false) {
            await screen.turnOn("slideshow started");
            return true;
        }
    } catch (err) {
        logger.warn(`Could not check or turn on the screen: ${err.message}`);
    }
    return false;
}

// -----------------------------
// Routes
// -----------------------------
const app = express();
app.use(express.json({ limit: "256kb" }));

const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => {
        const status = err.status || 502;
        if (status >= 500) logger.error(`${req.method} ${req.path}: ${err.stack || err.message}`);
        res.status(status).json({ error: err.message });
    });

app.get("/api/test", (req, res) => {
    logger.info("Accessed /api/test");
    res.status(200).send("Testing");
});

app.get("/api/home", wrap(async (req, res) => {
    logger.info("Accessed /api/home");
    await browser.open(`${config.picapportUrl}/picapport`, logger);
    kioskShowing = null;
    res.status(200).send("Picapport homepage opened");
}));

// What is playing, the screen, and whether the parts are up.
app.get("/api/status", wrap(async (req, res) => {
    const [browserRunning, picapportUp, scr] = await Promise.all([browser.isRunning(), picapport.isUp(), screen.status()]);
    const v = player.view();
    res.json({
        slideshow: legacyView(),
        player: { status: v.status, preparing: v.preparing, error: v.error, playing: v.playing, paused: v.paused, position: v.position, count: v.count,
            source: v.source, preset: v.preset, current: v.current && v.current.info },
        settings: v.settings,
        screen: scr,
        schedule: schedule.get(),
        viewers: events.viewers(),
        browserRunning,
        picapportUp,
        catalogue: catalogue.summary(),
        imageCache: library.cacheStats(),
        sorts: config.sorts,
    });
}));

// Count photos for one or more queries without changing the screen: /api/count?q=a&q=b
app.get("/api/count", wrap(async (req, res) => {
    const qs = [].concat(req.query.q || []);
    if (!qs.length) return res.status(400).json({ error: "give at least one q=<query>" });
    const results = [];
    for (const q of qs) {
        const err = picapport.validateQuery(q);
        results.push(err ? { query: q, error: err } : { query: q, count: await picapport.count(q) });
    }
    res.json({ results });
}));

// Older settings check: query, sort (Picapport's names), interval, label.
function checkLegacy(s) {
    const qErr = picapport.validateQuery(s.query);
    if (qErr) return qErr;
    if (!config.sorts.includes(s.sort)) return `sort must be one of: ${config.sorts.join(", ")}`;
    const n = Number(s.interval);
    if (!Number.isInteger(n) || n < config.interval.min || n > config.interval.max) {
        return `interval must be a whole number of seconds from ${config.interval.min} to ${config.interval.max}`;
    }
    s.interval = n;
    if (s.label !== null && s.label !== undefined && (typeof s.label !== "string" || s.label.length > 200)) {
        return "label must be text of at most 200 characters";
    }
    return null;
}

// Start a slideshow from a source; returns quickly while the order is prepared in the background.
async function startSource(src, opts) {
    const job = player.setSource(src, opts);
    job.catch((e) => logger.error(`Slideshow not started: ${e.message}`));
    // Validation errors come back at once; listing a big result takes a while (about 3 ms a photo).
    const early = await Promise.race([job.then((r) => ({ done: r })), new Promise((r) => setTimeout(() => r(null), 1500))]);
    legacyStartedAt = new Date().toISOString();
    return early ? early.done : { preparing: true };
}

// Play a new slideshow (older form, used by the slideshow-control skill). Body: { query, label?,
// sort?, interval?, restart? }. Settings not given are kept. Nothing is played when the query matches
// no photo. The same query, sort and interval is not restarted (no reshuffle) unless restart: true.
app.post("/api/slideshow", wrap(async (req, res) => {
    const b = req.body || {};
    if (b.query === undefined) return res.status(400).json({ error: "query is required (use PATCH to change only settings)" });
    const current = legacyView();
    const next = {
        query: String(b.query).trim(),
        label: b.label === undefined ? null : b.label,
        sort: b.sort === undefined ? current.sort : b.sort,
        interval: b.interval === undefined ? current.interval : b.interval,
    };
    const err = checkLegacy(next);
    if (err) return res.status(400).json({ error: err });
    const count = await picapport.count(next.query);
    if (count === 0) {
        logger.info(`Not played (no photos): ${next.query}`);
        return res.status(422).json({ played: false, count: 0, error: "no photos match this query", slideshow: current });
    }
    const src = player.source() || {};
    const plainQuery = src.query === next.query && !src.places && !src.years && !src.onThisDay && !src.notSeenDays && !src.box;
    const same = plainQuery && current.sort === next.sort && Number(current.interval) === next.interval;
    let result = null;
    if (same && !b.restart) {
        if (next.label && next.label !== src.label) player.setSourceLabel(next.label);
        logger.info(`Already playing, not restarted (no reshuffle): ${next.query}`);
    } else {
        result = await startSource({ query: next.query, ...(next.label ? { label: next.label } : {}) },
            { settings: { order: settingsLib.SORT_TO_ORDER[next.sort], interval: next.interval } });
        logger.info(`Playing: ${next.query} (${count} photos, ${next.sort}, ${next.interval} s)`);
    }
    await ensureKiosk();
    const screenTurnedOn = await ensureScreenOn();
    res.json({ played: true, relaunched: !same || !!b.restart, preparing: !!(result && result.preparing), count,
        slideshow: { ...next, startedAt: legacyStartedAt }, screenTurnedOn });
}));

// Change settings of the current slideshow and keep the rest. Body: { interval?, sort?, label? }.
// The current photo stays; no relaunch and no reshuffle any more.
app.patch("/api/slideshow", wrap(async (req, res) => {
    const b = req.body || {};
    if (b.query !== undefined) return res.status(400).json({ error: "to change what is shown, use POST /api/slideshow" });
    const current = legacyView();
    const next = {
        query: current.query || "x",
        label: b.label === undefined ? current.label : b.label,
        sort: b.sort === undefined ? current.sort : b.sort,
        interval: b.interval === undefined ? current.interval : b.interval,
    };
    const err = checkLegacy(next);
    if (err) return res.status(400).json({ error: err });
    const change = {};
    if (b.sort !== undefined) change.order = settingsLib.SORT_TO_ORDER[next.sort];
    if (b.interval !== undefined) change.interval = next.interval;
    if (Object.keys(change).length) player.setSettings(change);
    if (b.label !== undefined) player.setSourceLabel(next.label);
    await ensureKiosk();
    const screenTurnedOn = await ensureScreenOn();
    res.json({ relaunched: false, slideshow: legacyView(), screenTurnedOn });
}));

// Older form, used by the boot launcher (picapport-chromium.service) and curl. No parameters: show
// the slideshow on the shelf screen (it resumes where it was, R2); the screen is left as it is, so an
// "off until tomorrow" survives a reboot. q=, interval=, sort= change those settings (B17) and turn
// the screen on.
app.get("/api/slideshow", wrap(async (req, res) => {
    const current = legacyView();
    const next = { ...current, query: current.query || "x" };
    if (req.query.q !== undefined) { next.query = String(req.query.q); next.label = null; }
    if (req.query.interval !== undefined) next.interval = req.query.interval;
    if (req.query.sort !== undefined) next.sort = req.query.sort;
    const err = checkLegacy(next);
    if (err) return res.status(400).send(`Not played: ${err}`);
    const changed = ["q", "interval", "sort"].some((k) => req.query[k] !== undefined);
    if (req.query.q !== undefined && next.query !== current.query) {
        await startSource({ query: next.query }, { settings: { order: settingsLib.SORT_TO_ORDER[next.sort], interval: next.interval } });
    } else if (changed) {
        player.setSettings({ order: settingsLib.SORT_TO_ORDER[next.sort], interval: next.interval });
    }
    await openKiosk();
    if (changed) await ensureScreenOn();
    logger.info(`Showing the slideshow on the screen (GET /api/slideshow): ${kioskShowing}`);
    res.status(200).send(`Playing slideshow with URL: ${kioskShowing}`);
}));

// ---------- The player (slideshow layer) ----------
app.get("/api/events", events.handler(() => player.view()));
app.get("/api/player", (req, res) => res.json(player.view()));

const steps = (b) => {
    const n = b && b.steps !== undefined ? Number(b.steps) : 1;
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw Object.assign(new Error("steps must be 1 to 1000"), { status: 400 });
    return n;
};
app.post("/api/player/next", wrap(async (req, res) => res.json(await player.step(steps(req.body)))));
app.post("/api/player/back", wrap(async (req, res) => res.json(await player.step(-steps(req.body)))));
app.post("/api/player/pause", wrap(async (req, res) => res.json(player.pause())));
app.post("/api/player/play", wrap(async (req, res) => res.json(player.play())));
app.post("/api/player/toggle", wrap(async (req, res) => res.json(player.toggle())));
app.post("/api/player/jump", wrap(async (req, res) => {
    const b = req.body || {};
    if (b.year !== undefined) {
        if (!Number.isInteger(b.year)) return res.status(400).json({ error: "year must be a year" });
        return res.json(player.jump({ year: b.year }));
    }
    const n = Number(b.position);
    if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: "position must be a whole number from 0, or give year" });
    res.json(player.jump({ position: n }));
}));

// Start a slideshow. Body: { source: { query?, places?, years?, onThisDay?, notSeenDays?, box?, label? },
// settings?, preset? }. The old slideshow plays until the new one is ready.
app.post("/api/player/source", wrap(async (req, res) => {
    const b = req.body || {};
    const src = b.source || {};
    const err = player.checkSource(src);
    if (err) return res.status(400).json({ error: err });
    if (src.query) {
        const count = await picapport.count(src.query);
        if (!count) return res.status(422).json({ played: false, count: 0, error: "no photos match this query" });
    }
    const r = await startSource(src, { settings: b.settings, preset: b.preset });
    if (r && r.count === 0) return res.status(422).json({ played: false, count: 0, error: "nothing to play for this choice" });
    await ensureKiosk();
    const screenTurnedOn = await ensureScreenOn();
    res.json({ played: true, preparing: !!(r && r.preparing), count: r && r.count, screenTurnedOn, player: player.view() });
}));

app.patch("/api/player/settings", wrap(async (req, res) => {
    res.json(player.setSettings(req.body || {})); // a changed viewer reopens the kiosk (notify below)
}));
app.post("/api/player/preset", wrap(async (req, res) => res.json(player.applyPreset(String((req.body || {}).name || "")))));

// Step a setting by an amount or to the next value (buttons and the knob): { setting, by? }.
app.post("/api/player/nudge", wrap(async (req, res) => {
    const b = req.body || {};
    const st = player.settings();
    if (b.setting === "interval") {
        const by = Number(b.by || 5);
        const steps = [3, 5, 8, 10, 12, 15, 20, 25, 30, 40, 60, 90, 120, 180, 300];
        const cur = st.interval;
        let next = by > 0 ? steps.find((x) => x > cur) : [...steps].reverse().find((x) => x < cur);
        if (next === undefined) next = cur;
        return res.json(player.setSettings({ interval: next }));
    }
    if (b.setting === "overlayStyle") {
        const n = settingsLib.overlayStyles().length;
        return res.json(player.setSettings({ overlayStyle: (st.overlayStyle + (Number(b.by) || 1) + n) % n }));
    }
    const cycles = { motion: ["off", "subtle", "lively"], transition: ["fade", "slide", "zoom", "dip"], order: settingsLib.ORDERS };
    if (cycles[b.setting]) {
        const list = cycles[b.setting];
        return res.json(player.setSettings({ [b.setting]: list[(list.indexOf(st[b.setting]) + 1) % list.length] }));
    }
    if (["clock", "night", "bursts", "titleCards", "highlights", "autoplay"].includes(b.setting)) {
        return res.json(player.setSettings({ [b.setting]: !st[b.setting] }));
    }
    res.status(400).json({ error: "setting must be interval, overlayStyle, motion, transition, order, clock, night, bursts, titleCards, highlights or autoplay" });
}));

app.get("/api/presets", (req, res) => res.json({ presets: settingsLib.presets(), overlayStyles: settingsLib.overlayStyles(), defaults: settingsLib.defaults(), orders: settingsLib.ORDERS }));

// ---------- Photos ----------
// The image of a photo, sized for a screen (1920x1080 box) or as a thumbnail; cached on the SD card.
app.get("/api/photo/:id", wrap(async (req, res) => {
    const p = library.pathOf(req.params.id);
    if (!p) return res.status(404).json({ error: "unknown photo id" });
    const size = req.query.size === "thumb" ? "thumb" : "screen";
    try {
        const file = await library.image(p, size);
        library.touch(file);
        res.set("cache-control", "private, max-age=86400");
        res.sendFile(file);
    } catch (err) {
        if (err instanceof library.NotInIndex) return res.status(404).json({ error: err.message });
        throw err;
    }
}));

app.get("/api/photo/:id/info", (req, res) => {
    const p = library.pathOf(req.params.id);
    if (!p) return res.status(404).json({ error: "unknown photo id" });
    res.json({ ...player.info(p), marks: marks.of(p) });
});

// ---------- Marks (R20): a review list, never written to a photo ----------
function markTarget(b) {
    if (b.id) return library.pathOf(b.id);
    if (b.path) return String(b.path);
    return player.current();
}
app.get("/api/marks", (req, res) => res.json({ marks: marks.list() }));
app.post("/api/marks", wrap(async (req, res) => {
    const b = req.body || {};
    const p = markTarget(b);
    if (!p) return res.status(404).json({ error: "no such photo" });
    if (!marks.KINDS.includes(b.mark)) return res.status(400).json({ error: `mark must be one of: ${marks.KINDS.join(", ")}` });
    marks.add(p, b.mark, b.by ? String(b.by).slice(0, 40) : null);
    logger.info(`Marked ${b.mark}: ${p}`);
    events.broadcast("state", player.view());
    res.json({ path: p, marks: marks.of(p) });
}));
app.delete("/api/marks", wrap(async (req, res) => {
    const b = req.body || {};
    const p = markTarget(b);
    if (!p) return res.status(404).json({ error: "no such photo" });
    marks.remove(p, b.mark);
    events.broadcast("state", player.view());
    res.json({ path: p, marks: marks.of(p) });
}));

// ---------- History and suggestions (R19) ----------
app.get("/api/history", (req, res) => res.json(history.summary(Math.min(Number(req.query.limit) || 20, 300))));
app.get("/api/suggestions", (req, res) => {
    const all = catalogue.paths();
    const days = Math.max(1, Math.min(Number(req.query.days) || 90, 3650));
    const notSeen = history.notSeen(all, days);
    const byEvent = new Map();
    for (const p of notSeen) {
        const ev = catalogue.eventName(p) || "(no folder)";
        byEvent.set(ev, (byEvent.get(ev) || 0) + 1);
    }
    const onThisDay = catalogue.pathsOnThisDay().length;
    res.json({
        notSeen: { days, photos: notSeen.length, of: all.length, source: { notSeenDays: days, label: `Not seen in ${days} days` } },
        onThisDay: { photos: onThisDay, source: { onThisDay: true, label: "This week in past years" } },
        eventsNotSeen: [...byEvent].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([event, photos]) => ({ event, photos })),
    });
});

// ---------- Map (R15) ----------
app.get("/api/map/points", (req, res) => res.json({ points: catalogue.mapPoints(2), attribution: "Places: GeoNames (CC BY 4.0). Map: OpenStreetMap contributors." }));

// ---------- Screen ----------
app.get("/api/screen", wrap(async (req, res) => res.json(await screen.status())));

app.post("/api/screen", wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.on !== "boolean") return res.status(400).json({ error: "on must be true or false" });
    if (b.on) {
        await screen.turnOn("request");
        return res.json(await screen.status());
    }
    let offUntil = null;
    if (b.minutes !== undefined) {
        const m = Number(b.minutes);
        if (!(m > 0 && m <= 60 * 24 * 31)) return res.status(400).json({ error: "minutes must be between 1 and 44640" });
        offUntil = new Date(Date.now() + m * 60000).toISOString();
    } else if (b.until !== undefined) {
        const t = new Date(b.until);
        if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) return res.status(400).json({ error: "until must be a future date and time (ISO 8601)" });
        offUntil = t.toISOString();
    }
    await screen.turnOff(offUntil);
    res.json(await screen.status());
}));

// Toggle (long press of a button): off if on, on if off.
app.post("/api/screen/toggle", wrap(async (req, res) => {
    const st = await screen.status();
    if (st.wantedOff || st.on === false) await screen.turnOn("toggle");
    else await screen.turnOff(null);
    res.json(await screen.status());
}));

// Daily screen schedule (R18): { enabled, off: "HH:MM", on: "HH:MM" }; off by default.
app.get("/api/schedule", (req, res) => res.json(schedule.get()));
app.put("/api/schedule", wrap(async (req, res) => res.json(schedule.set(req.body || {}))));

// Searchable words built from the photos (scripts/refresh-vocabulary.sh, nightly).
app.get("/api/vocabulary", (req, res) => {
    const v = readJson(config.files.vocabulary, null);
    if (!v) return res.status(404).json({ error: "not built yet: run scripts/refresh-vocabulary.sh on the Pi (it runs nightly)" });
    res.json(v);
});

// Private word list ("us", "home", ...). Lives only on the Pi; created from config/words.example.json.
function ensureWords() {
    if (!fs.existsSync(config.files.words)) {
        writeJson(config.files.words, readJson(config.wordsTemplate, { words: {} }));
        logger.info(`Created ${config.files.words} from ${config.wordsTemplate}`);
    }
}

function checkWords(doc) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return "body must be a JSON object";
    if (!doc.words || typeof doc.words !== "object" || Array.isArray(doc.words)) return "body.words must be an object";
    for (const [term, entry] of Object.entries(doc.words)) {
        if (!entry || typeof entry !== "object" || typeof entry.means !== "string" || !entry.means.trim()) {
            return `words["${term}"].means must be non-empty text`;
        }
        if (entry.query !== undefined) {
            const err = picapport.validateQuery(entry.query);
            if (err) return `words["${term}"].query: ${err}`;
        }
    }
    return null;
}

app.get("/api/words", wrap(async (req, res) => {
    ensureWords();
    res.json(readJson(config.files.words, { words: {} }));
}));

app.put("/api/words", wrap(async (req, res) => {
    const err = checkWords(req.body);
    if (err) return res.status(400).json({ error: err });
    writeJson(config.files.words, { ...req.body, updatedAt: new Date().toISOString() });
    logger.info(`Word list updated (${Object.keys(req.body.words).length} entries)`);
    res.json(readJson(config.files.words, { words: {} }));
}));

// Development tools (motion test, kiosk on a page of this API, test reports): lib/dev.js.
app.use("/api/dev", dev.router(logger));
// The slideshow page (/show) and its assets.
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"], maxAge: 0 }));

app.use((req, res) => res.status(404).json({ error: `no route ${req.method} ${req.path}` }));

// -----------------------------
// Start
// -----------------------------
let lastQuerySaved = null;
const server = app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
    try {
        ensureWords();
    } catch (err) {
        logger.warn(`Could not create the word list: ${err.message}`);
    }
    screen.restore(logger);
    schedule.start(logger, screen);
    const legacy = loadLegacy();
    legacyStartedAt = legacy.startedAt || null;
    player.start({
        log: logger,
        legacy,
        notify: (what) => {
            events.broadcast("state", player.view());
            if (["source", "settings", "resume"].includes(what)) {
                const key = JSON.stringify(legacyView());
                if (key !== lastQuerySaved) { lastQuerySaved = key; saveLegacy(); }
            }
            if (what === "settings" && kioskShowing && kioskShowing !== kioskUrl()) openKiosk().catch((e) => logger.warn(`Kiosk: ${e.message}`));
        },
    }).catch((e) => logger.error(`Player start failed: ${e.stack || e.message}`));
});

function shutdown() {
    logger.info("Stopping: saving the player state and history");
    try { player.stop(); } catch (e) { logger.warn(e.message); }
    server.close();
    process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
