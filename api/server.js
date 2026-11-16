// photo-api - the control layer of Pi Photo Hub (principle 12, layer 2). Every client (the
// slideshow-control skill, the boot launcher, later the buttons) starts and changes the slideshow
// through this API. The API reference is in docs/architecture.md ("Photo API").
const express = require("express");
const fs = require("fs");
const winston = require("winston");
require("winston-daily-rotate-file");

const config = require("./lib/config");
const { readJson, writeJson, writeText } = require("./lib/state");
const picapport = require("./lib/picapport");
const browser = require("./lib/browser");
const screen = require("./lib/screen");

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
// The saved slideshow
// -----------------------------
// slideshow.json holds the settings; slideshow_url.txt is still written so that an older version
// (after a rollback) replays the same slideshow.
function loadSlideshow() {
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

function saveSlideshow(s) {
    const value = { query: s.query, label: s.label || null, sort: s.sort, interval: s.interval, startedAt: new Date().toISOString() };
    try {
        writeJson(config.files.slideshow, value);
        writeText(config.files.slideshowUrl, picapport.slideshowUrl(value));
    } catch (err) {
        // A failure to save must not stop the slideshow playing.
        logger.warn(`Could not save the slideshow: ${err.message}`);
    }
    return value;
}

// Check and normalise settings. Returns an error message or null.
function checkSettings(s) {
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

async function play(s) {
    const saved = saveSlideshow(s);
    await browser.open(picapport.slideshowUrl(saved), logger);
    return saved;
}

// Starting or changing a slideshow turns the screen on (and cancels an "off" timer).
async function ensureScreenOn() {
    try {
        if ((await screen.isOn()) === false) {
            await screen.turnOn("slideshow started");
            return true;
        }
    } catch (err) {
        logger.warn(`Could not check or turn on the screen: ${err.message}`);
    }
    return false;
}

async function screenStatus() {
    return screen.status();
}

// -----------------------------
// Routes
// -----------------------------
const app = express();
app.use(express.json({ limit: "256kb" }));

const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => {
        logger.error(`${req.method} ${req.path}: ${err.stack || err.message}`);
        res.status(502).json({ error: err.message });
    });

app.get("/api/test", (req, res) => {
    logger.info("Accessed /api/test");
    res.status(200).send("Testing");
});

app.get("/api/home", wrap(async (req, res) => {
    logger.info("Accessed /api/home");
    await browser.open(`${config.picapportUrl}/picapport`, logger);
    res.status(200).send("Picapport homepage opened");
}));

// What is playing, the screen, and whether the parts are up.
app.get("/api/status", wrap(async (req, res) => {
    const [browserRunning, picapportUp, scr] = await Promise.all([browser.isRunning(), picapport.isUp(), screenStatus()]);
    res.json({ slideshow: loadSlideshow(), screen: scr, browserRunning, picapportUp, sorts: config.sorts });
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

// Play a new slideshow. Body: { query, label?, sort?, interval?, restart? }. Settings not given are
// kept from the current slideshow. Nothing is played when the query matches no photo.
app.post("/api/slideshow", wrap(async (req, res) => {
    const b = req.body || {};
    if (b.query === undefined) return res.status(400).json({ error: "query is required (use PATCH to change only settings)" });
    const current = loadSlideshow();
    const next = {
        query: String(b.query).trim(),
        label: b.label === undefined ? null : b.label,
        sort: b.sort === undefined ? current.sort : b.sort,
        interval: b.interval === undefined ? current.interval : b.interval,
    };
    const err = checkSettings(next);
    if (err) return res.status(400).json({ error: err });
    const count = await picapport.count(next.query, next.sort);
    if (count === 0) {
        logger.info(`Not played (no photos): ${next.query}`);
        return res.status(422).json({ played: false, count: 0, error: "no photos match this query", slideshow: current });
    }
    const same = current.query === next.query && current.sort === next.sort && Number(current.interval) === next.interval;
    let relaunched = false;
    let saved;
    if (same && !b.restart && (await browser.isRunning())) {
        saved = saveSlideshow({ ...next, label: next.label || current.label });
        logger.info(`Already playing, not relaunched (no reshuffle): ${next.query}`);
    } else {
        saved = await play(next);
        relaunched = true;
        logger.info(`Playing: ${next.query} (${count} photos, ${next.sort}, ${next.interval} s)`);
    }
    const screenTurnedOn = await ensureScreenOn();
    res.json({ played: true, relaunched, count, slideshow: saved, screenTurnedOn });
}));

// Change settings of the current slideshow and keep the rest. Body: { interval?, sort?, label? }
app.patch("/api/slideshow", wrap(async (req, res) => {
    const b = req.body || {};
    if (b.query !== undefined) return res.status(400).json({ error: "to change what is shown, use POST /api/slideshow" });
    const current = loadSlideshow();
    const next = {
        query: current.query,
        label: b.label === undefined ? current.label : b.label,
        sort: b.sort === undefined ? current.sort : b.sort,
        interval: b.interval === undefined ? current.interval : b.interval,
    };
    const err = checkSettings(next);
    if (err) return res.status(400).json({ error: err });
    const changed = next.sort !== current.sort || next.interval !== Number(current.interval);
    let saved;
    if (changed) {
        saved = await play(next);
        logger.info(`Settings changed: ${next.sort}, ${next.interval} s (relaunched)`);
    } else {
        saved = saveSlideshow(next);
    }
    const screenTurnedOn = await ensureScreenOn();
    res.json({ relaunched: changed, slideshow: saved, screenTurnedOn });
}));

// Older form, kept for the boot launcher and curl: no parameters replays the saved slideshow;
// q=, interval=, sort= change those settings and keep the others (B17).
app.get("/api/slideshow", wrap(async (req, res) => {
    const current = loadSlideshow();
    const next = { ...current };
    if (req.query.q !== undefined) { next.query = String(req.query.q); next.label = null; }
    if (req.query.interval !== undefined) next.interval = req.query.interval;
    if (req.query.sort !== undefined) next.sort = req.query.sort;
    const err = checkSettings(next);
    if (err) return res.status(400).send(`Not played: ${err}`);
    const saved = await play(next);
    await ensureScreenOn();
    const url = picapport.slideshowUrl(saved);
    logger.info(`Playing slideshow (GET): ${url}`);
    res.status(200).send(`Playing slideshow with URL: ${url}`);
}));

// Screen. GET: state. POST { on: false, minutes?, until? } or { on: true }.
app.get("/api/screen", wrap(async (req, res) => res.json(await screenStatus())));

app.post("/api/screen", wrap(async (req, res) => {
    const b = req.body || {};
    if (typeof b.on !== "boolean") return res.status(400).json({ error: "on must be true or false" });
    if (b.on) {
        await screen.turnOn("request");
        return res.json(await screenStatus());
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
    res.json(await screenStatus());
}));

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

app.use((req, res) => res.status(404).json({ error: `no route ${req.method} ${req.path}` }));

// -----------------------------
// Start
// -----------------------------
app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
    try {
        ensureWords();
    } catch (err) {
        logger.warn(`Could not create the word list: ${err.message}`);
    }
    screen.restore(logger);
});
