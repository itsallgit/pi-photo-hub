// player.js - the one slideshow (R1 to R8, R12, R19). The Pi holds the now-playing state: the
// source (what plays), the settings, the order of photos (made here from a saved seed), the
// position, playing or paused, and when the current photo started. Every viewer follows it through
// the event stream (events.js); every control goes through the photo API (principle 12).
//
// State files (principle 5): /var/lib/photo-api/player.json (small, written on every change) and
// playlist.json (the source's photos and the order; written when a slideshow starts or the order
// changes). A restart resumes the same order at the same photo (R2).
const config = require("./config");
const { readJson, writeJson } = require("./state");
const catalogue = require("./catalogue");
const library = require("./library");
const settingsLib = require("./settings");
const order = require("./order");
const history = require("./history");

const CARD_MS = 4000; // a title card shows this long before the event's first photo
const LOOK_AHEAD = 2;
const MAX_WAIT_MS = 20000; // the longest an automatic move waits for the next image

let logger = console;
let onChange = () => {};

let s = null; // persisted state (player.json)
let paths = []; // the source's photos (playlist.json)
let items = []; // the order: [{ p, c? }] (playlist.json)
let timer = null;
let buildSeq = 0;
let moveSeq = 0;
let toast = null; // the latest short message for the screens: { id (server time, ms), text }

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------
function saveState() {
    try {
        writeJson(config.files.player, s);
    } catch (err) {
        logger.warn(`Could not save the player state: ${err.message}`);
    }
}

function savePlaylist() {
    try {
        writeJson(config.files.playlist, { id: s.playlistId, source: s.source, seed: s.seed, paths, items });
    } catch (err) {
        logger.warn(`Could not save the playlist: ${err.message}`);
    }
}

function changed(what) {
    s.version = (s.version || 0) + 1;
    saveState();
    onChange(what);
}

// ---------------------------------------------------------------------------------------------
// Sources: what plays
// ---------------------------------------------------------------------------------------------
// source: { query?, places?: [key], years?: [yyyy], onThisDay?: true, notSeenDays?: n, box?: [4 numbers], label? }
// All given parts must match (AND). Without a query, the catalogue's photos are the base.
function checkSource(src) {
    if (!src || typeof src !== "object") return "source must be an object";
    const picapport = require("./picapport");
    const has = ["query", "places", "years", "onThisDay", "notSeenDays", "box", "favourites", "skipped"].some((k) => src[k] !== undefined && src[k] !== null);
    if (!has) return "source needs at least one of: query, places, years, onThisDay, notSeenDays, box, favourites, skipped";
    if (src.query !== undefined && src.query !== null) {
        const err = picapport.validateQuery(src.query);
        if (err) return err;
    }
    if (src.places !== undefined && (!Array.isArray(src.places) || !src.places.length || src.places.some((p) => typeof p !== "string" || p.length > 120))) return "places must be a list of place keys (from /api/vocabulary)";
    if (src.years !== undefined && (!Array.isArray(src.years) || !src.years.length || src.years.some((y) => !Number.isInteger(y) || y < 1900 || y > 2100))) return "years must be a list of years";
    if (src.onThisDay !== undefined && typeof src.onThisDay !== "boolean") return "onThisDay must be true or false";
    if (src.notSeenDays !== undefined && (!Number.isInteger(src.notSeenDays) || src.notSeenDays < 1 || src.notSeenDays > 3650)) return "notSeenDays must be 1 to 3650";
    if (src.box !== undefined && (!Array.isArray(src.box) || src.box.length !== 4 || src.box.some((n) => typeof n !== "number" || !Number.isFinite(n)))) return "box must be [minLat, minLon, maxLat, maxLon]";
    for (const k of ["favourites", "skipped"]) if (src[k] !== undefined && typeof src[k] !== "boolean") return `${k} must be true or false`;
    if (src.favourites && src.skipped) return "a photo cannot be both a favourite and skipped";
    if (src.label !== undefined && src.label !== null && (typeof src.label !== "string" || src.label.length > 200)) return "label must be text of at most 200 characters";
    return null;
}

function describeSource(src) {
    if (src.label) return src.label;
    const parts = [];
    if (src.query) parts.push(src.query);
    if (src.places) parts.push(src.places.map((k) => k.split("/").pop()).join(" or "));
    if (src.years) parts.push(src.years.join(" or "));
    if (src.onThisDay) parts.push("this week in past years");
    if (src.notSeenDays) parts.push(`not seen in ${src.notSeenDays} days`);
    if (src.box) parts.push("an area on the map");
    if (src.favourites) parts.push("favourites");
    if (src.skipped) parts.push("skipped photos");
    return parts.join(", ");
}

async function resolveSource(src, onProgress) {
    let list = null;
    const and = (more) => {
        if (list === null) { list = more; return; }
        const set = new Set(more);
        list = list.filter((p) => set.has(p));
    };
    if (src.query) and((await library.listQuery(src.query, { onProgress })).paths);
    if (src.places) and(catalogue.pathsInPlaces(src.places));
    if (src.years) {
        const ys = new Set(src.years.map(String));
        and(catalogue.paths((r, c) => r[c.f.date] && ys.has(r[c.f.date].slice(0, 4))));
    }
    if (src.onThisDay) and(catalogue.pathsOnThisDay());
    if (src.box) and(catalogue.pathsInBox(src.box));
    if (src.favourites) and(catalogue.pathsWithRating(order.FAVOURITE));
    if (src.skipped) and(catalogue.pathsWithRating(order.SKIPPED));
    if (list === null) list = catalogue.paths();
    if (src.notSeenDays) list = history.notSeen(list, src.notSeenDays);
    return list;
}

// ---------------------------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------------------------
const ORDER_KEYS = ["order", "upright", "bursts", "highlights", "chapterLength", "recentDays"];

function info(p) {
    const i = catalogue.info(p);
    if (!i.date) {
        const m = library.metaCache.get(p);
        if (m && m.date) i.date = m.date.slice(0, 19);
    }
    return i;
}

function makeOrder(seed) {
    const src = s.source || {};
    return order.build(paths, s.settings, { seed, info, lastShown: history.lastShown, includeSkipped: !!src.skipped, showAll: !!(src.skipped || src.favourites) });
}

function durationMs(i) {
    const it = items[i];
    if (!it) return s.settings.interval * 1000;
    let ms = s.settings.interval * 1000;
    if (s.settings.highlights && info(it.p).rating === order.FAVOURITE) ms *= 1.5;
    if (s.settings.titleCards && it.c) ms += CARD_MS;
    return Math.round(ms);
}

// ---------------------------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------------------------
function clearTimer() { if (timer) clearTimeout(timer); timer = null; }

function schedule() {
    clearTimer();
    if (!s.playing || !s.settings.autoplay || !items.length || s.status !== "playing") return;
    const due = s.startedAt + durationMs(s.position) - Date.now();
    timer = setTimeout(() => step(1, { auto: true }).catch((e) => logger.error(`Advance failed: ${e.message}`)), Math.max(0, due));
}

function lookAhead() {
    const want = [];
    for (let k = 1; k <= LOOK_AHEAD; k++) if (items.length) want.push((s.position + k) % items.length);
    if (s.position > 0) want.push(s.position - 1);
    for (const i of want) {
        const it = items[i];
        if (!it) continue;
        library.image(it.p, "screen").catch((err) => {
            if (err instanceof library.NotInIndex) dropMissing(it.p);
            else logger.warn(`Look-ahead image failed: ${err.message}`);
        });
    }
}

// A photo Picapport does not have (not indexed, or deleted) is taken out of the order.
function dropMissing(p) {
    const cur = items[s.position];
    const before = items.length;
    items = items.filter((it) => it.p !== p);
    paths = paths.filter((x) => x !== p);
    if (items.length === before) return;
    logger.warn(`Photo not in Picapport's index, skipped: ${p}`);
    const k = items.indexOf(cur);
    s.position = k >= 0 ? k : Math.min(s.position, Math.max(0, items.length - 1));
    s.count = items.length;
    savePlaylist();
    changed("order");
}

// Does a photo belong in what is playing, going by its rating?
function belongs(p) {
    const r = info(p).rating, src = s.source || {};
    if (src.skipped) return r === order.SKIPPED;
    if (r === order.SKIPPED) return false;
    return !src.favourites || r === order.FAVOURITE;
}

// A photo's rating changed: take it out of the slideshow if it no longer belongs.
function ratingChanged(p) {
    if (!s || !items.some((it) => it.p === p) || belongs(p)) return;
    const cur = items[s.position];
    const wasCurrent = cur && cur.p === p;
    moveSeq++;
    items = items.filter((it) => it.p !== p);
    paths = paths.filter((x) => x !== p);
    const k = items.indexOf(cur);
    s.position = k >= 0 ? k : Math.min(s.position, Math.max(0, items.length - 1));
    s.count = items.length;
    if (wasCurrent) {
        s.moveKind = "manual";
        s.startedAt = Date.now();
        s.elapsedAtPause = 0;
        showing();
    }
    savePlaylist();
    changed("order");
    schedule();
}

function showing() {
    const it = items[s.position];
    if (it) history.noteShown(it.p);
    lookAhead();
}

async function waitForImage(p) {
    try {
        await Promise.race([library.image(p, "screen"), new Promise((r) => setTimeout(r, MAX_WAIT_MS))]);
        return true;
    } catch (err) {
        if (err instanceof library.NotInIndex) { dropMissing(p); return false; }
        return true; // other errors: move on; the viewer will try the image itself
    }
}

// Move by `steps` (negative = back). Automatic moves wait (bounded) for the next image.
async function step(steps, { auto = false } = {}) {
    if (!items.length) return view();
    const mine = ++moveSeq;
    let target = s.position + steps;
    if (target >= items.length) {
        // End of the order: a new round with a new seed (recently shown photos go last).
        s.seed = (s.seed * 1103515245 + 12345) >>> 0;
        items = makeOrder(s.seed);
        s.count = items.length;
        savePlaylist();
        target = 0;
        logger.info(`Slideshow wrapped: new order (seed ${s.seed})`);
    }
    if (target < 0) target = 0;
    if (auto) {
        clearTimer();
        for (let tries = 0; tries < 5 && items[target]; tries++) {
            const ok = await waitForImage(items[target].p);
            if (mine !== moveSeq) return view(); // someone moved meanwhile
            if (ok) break;
            if (target >= items.length) target = 0;
        }
    }
    return moveTo(target, { manual: !auto });
}

// A manual move (next, back, jump) snaps on every screen; only autoplay's moves use the transition.
function moveTo(target, { manual = true } = {}) {
    if (!items.length) return view();
    s.position = Math.max(0, Math.min(items.length - 1, target));
    s.moveKind = manual ? "manual" : "auto";
    s.startedAt = Date.now();
    s.elapsedAtPause = 0;
    showing();
    changed("move");
    schedule();
    return view();
}

function jump({ position, year }) {
    moveSeq++; // an automatic move still waiting for its image must not undo this
    if (year !== undefined) {
        const y = String(year);
        let k = items.findIndex((it) => (info(it.p).date || "").slice(0, 4) >= y && (info(it.p).date || "") !== "");
        if (k < 0) k = items.length - 1;
        return moveTo(k);
    }
    return moveTo(Number(position));
}

function pause() {
    if (!s.playing) return view();
    moveSeq++;
    s.playing = false;
    s.elapsedAtPause = Math.max(0, Date.now() - s.startedAt);
    clearTimer();
    changed("pause");
    return view();
}

function play() {
    if (s.playing && s.settings.autoplay) return view();
    s.playing = true;
    if (!s.settings.autoplay) {
        // "Play" while stepping by hand turns autoplay on.
        s.settings = { ...s.settings, autoplay: true };
    }
    s.startedAt = Date.now() - (s.elapsedAtPause || 0);
    s.elapsedAtPause = 0;
    changed("play");
    schedule();
    return view();
}

function toggle() { return s.playing && s.settings.autoplay ? pause() : play(); }

// A short message every screen shows for a moment. It goes out with the next state event.
function setToast(text) {
    toast = { id: Math.max(Date.now(), toast ? toast.id + 1 : 0), text };
}

// ---------------------------------------------------------------------------------------------
// Starting a slideshow, changing settings
// ---------------------------------------------------------------------------------------------
// Builds the new order in the background; the old slideshow keeps playing until it is ready.
async function setSource(src, { settings, preset } = {}) {
    const err = checkSource(src);
    if (err) throw Object.assign(new Error(err), { status: 400 });
    let nextSettings = s.settings;
    if (preset) {
        const r = settingsLib.applyPreset(preset);
        if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
        nextSettings = r.value;
    }
    if (settings) {
        const r = settingsLib.check(settings);
        if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
        nextSettings = settingsLib.merge(nextSettings, r.value);
    }
    const mine = ++buildSeq;
    const label = describeSource(src);
    s.preparing = { label, done: 0, total: null };
    changed("preparing");
    try {
        const list = await resolveSource(src, (done, total) => {
            if (mine !== buildSeq) return;
            s.preparing = { label, done, total };
            onChange("preparing");
        });
        if (mine !== buildSeq) return { superseded: true };
        if (!list.length) {
            s.preparing = null;
            s.lastError = `Nothing to play for ${label}`;
            changed("error");
            return { count: 0 };
        }
        moveSeq++;
        paths = list;
        s.source = src;
        s.settings = nextSettings;
        s.seed = (Math.random() * 2 ** 32) >>> 0;
        items = makeOrder(s.seed);
        s.playlistId = `${Date.now().toString(36)}`;
        s.count = items.length;
        s.position = 0;
        s.moveKind = "auto";
        s.playing = true;
        s.status = "playing";
        s.preparing = null;
        s.lastError = null;
        s.startedAt = Date.now();
        s.elapsedAtPause = 0;
        savePlaylist();
        library.setPrimaryQuery(src.query);
        history.startSlideshow(label, src);
        logger.info(`Playing ${label}: ${items.length} photos (${paths.length} in the source), ${s.settings.order}, ${s.settings.interval} s`);
        // wait briefly for the first image so viewers do not start on a blank
        await Promise.race([library.image(items[0].p, "screen").catch(() => {}), new Promise((r) => setTimeout(r, 8000))]);
        if (mine !== buildSeq) return { superseded: true };
        s.startedAt = Date.now();
        showing();
        changed("source");
        schedule();
        return { count: items.length };
    } catch (e) {
        if (mine === buildSeq) {
            s.preparing = null;
            s.lastError = e.message;
            changed("error");
        }
        throw e;
    }
}

function setSettings(change) {
    const r = settingsLib.check(change);
    if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
    applySettings(settingsLib.merge(s.settings, r.value), r.value);
    return view();
}

function applyPreset(name) {
    const r = settingsLib.applyPreset(name);
    if (r.error) throw Object.assign(new Error(r.error), { status: 400 });
    applySettings(r.value, r.value);
    return view();
}

function applySettings(next, change) {
    const prev = s.settings;
    s.settings = next;
    const reorder = ORDER_KEYS.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
    if (reorder && paths.length) {
        moveSeq++;
        const cur = items[s.position] && items[s.position].p;
        items = makeOrder(s.seed);
        s.count = items.length;
        const k = items.findIndex((it) => it.p === cur);
        s.position = k >= 0 ? k : 0;
        savePlaylist();
    }
    if (change.autoplay === true && !s.playing) {
        s.playing = true;
        s.startedAt = Date.now() - (s.elapsedAtPause || 0);
    }
    changed("settings");
    schedule();
}

// ---------------------------------------------------------------------------------------------
// The view every client gets
// ---------------------------------------------------------------------------------------------
function photoView(i) {
    const it = items[i];
    if (!it) return null;
    const id = library.register(it.p);
    const inf = info(it.p);
    return {
        index: i,
        id,
        url: `/api/photo/${id}`,
        thumb: `/api/photo/${id}?size=thumb`,
        info: {
            date: inf.date,
            place: inf.place ? `${inf.place.name}, ${inf.place.country}` : null,
            city: inf.city ? inf.city.name : null,
            country: inf.place ? inf.place.country : null,
            event: inf.event,
            people: inf.people,
            rating: inf.rating,
            favourite: inf.rating === order.FAVOURITE,
            skipped: inf.rating === order.SKIPPED,
            upright: inf.upright,
            file: it.p.split("/").pop(),
        },
        card: s.settings.titleCards && it.c ? it.c : null,
    };
}

function view() {
    const now = Date.now();
    const i = s.position;
    const next = [];
    for (let k = 1; k <= LOOK_AHEAD && k < items.length; k++) next.push(photoView((i + k) % items.length));
    return {
        v: s.version,
        serverTime: now,
        status: items.length ? s.status : (s.preparing ? "preparing" : "empty"),
        preparing: s.preparing,
        error: s.lastError || null,
        playing: s.playing && s.settings.autoplay,
        paused: !s.playing,
        position: i,
        count: items.length,
        manualMove: s.moveKind === "manual",
        toast,
        startedAt: s.startedAt,
        elapsed: s.playing ? now - s.startedAt : s.elapsedAtPause,
        duration: durationMs(i),
        cardMs: CARD_MS,
        current: photoView(i),
        next,
        prev: i > 0 ? photoView(i - 1) : null,
        source: { ...s.source, label: describeSource(s.source || {}) },
        settings: s.settings,
        preset: s.settings.preset ? { name: s.settings.preset, changed: settingsLib.changedFromPreset(s.settings) } : null,
    };
}

function setSourceLabel(label) {
    if (!s.source) return view();
    s.source = { ...s.source, label: label || undefined };
    if (!label) delete s.source.label;
    savePlaylist();
    changed("settings");
    return view();
}

function current() { return items[s.position] ? items[s.position].p : null; }
function source() { return s.source; }
function settings() { return s.settings; }
function itemsCount() { return items.length; }

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------
// legacy: the saved slideshow of the older API ({ query, label, sort, interval }), used when no
// player state exists yet (first start after the update).
async function start({ log, notify, legacy }) {
    logger = log || logger;
    onChange = notify || onChange;
    history.load(logger);
    catalogue.setLogger(logger);
    library.setLogger(logger);
    catalogue.load();
    const saved = readJson(config.files.player, null);
    const pl = readJson(config.files.playlist, null);
    if (saved && pl && pl.id === saved.playlistId && Array.isArray(pl.items)) {
        s = saved;
        s.settings = { ...settingsLib.defaults(), ...s.settings, preset: s.settings.preset ?? null };
        paths = pl.paths || pl.items.map((it) => it.p);
        items = pl.items;
        s.preparing = null;
        s.status = items.length ? "playing" : "empty";
        s.position = Math.min(s.position || 0, Math.max(0, items.length - 1));
        library.setPrimaryQuery(s.source && s.source.query);
        // Resume: the same order, the same photo, restarted from its beginning (R2).
        s.startedAt = Date.now();
        if (!s.playing) s.elapsedAtPause = 0;
        logger.info(`Resumed ${describeSource(s.source)} at photo ${s.position + 1} of ${items.length} (no reshuffle)`);
        showing();
        changed("resume");
        schedule();
        return;
    }
    const base = settingsLib.applyPreset("ambient").value;
    s = { version: 0, source: null, settings: base, seed: 1, position: 0, playing: true, startedAt: Date.now(), elapsedAtPause: 0, status: "empty", count: 0 };
    if (legacy && legacy.query && legacy.query !== config.defaults.query) {
        const change = { interval: Number(legacy.interval) || base.interval, order: settingsLib.SORT_TO_ORDER[legacy.sort] || "random" };
        logger.info(`No player state yet: starting from the saved slideshow ${legacy.label || legacy.query}`);
        setSource({ query: legacy.query, label: legacy.label || undefined }, { settings: change }).catch((e) => logger.error(`Could not start the saved slideshow: ${e.message}`));
    } else {
        changed("empty");
    }
}

function stop() {
    clearTimer();
    history.save();
    saveState();
}

module.exports = {
    start, stop, view, step, jump, pause, play, toggle, setToast, ratingChanged, setSource, setSettings, applyPreset, checkSource, describeSource,
    current, source, settings, itemsCount, info, setSourceLabel,
};
