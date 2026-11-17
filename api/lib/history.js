// history.js - what was shown and when (R19): each photo's last showing and count, and the
// slideshows played. Presentation history, not photo knowledge, so it lives on the SD card
// (/var/lib/photo-api/history.json) with a size cap. Written at most every few minutes (SD wear)
// and when the API stops.
const config = require("./config");
const { readJson, writeJson } = require("./state");

const MAX_PHOTOS = 40000;
const MAX_SLIDESHOWS = 300;
const SAVE_EVERY_MS = 5 * 60 * 1000;

let photos = new Map(); // path -> [lastShownMs, count]
let slideshows = []; // { label, source, startedAt, endedAt, shown }
let dirty = false;
let timer = null;
let logger = console;

function load(log) {
    logger = log || logger;
    const h = readJson(config.files.history, null);
    if (h) {
        photos = new Map(Object.entries(h.photos || {}));
        slideshows = h.slideshows || [];
    }
    if (!timer) timer = setInterval(() => save(), SAVE_EVERY_MS).unref();
}

function save() {
    if (!dirty) return;
    try {
        if (photos.size > MAX_PHOTOS) {
            const keep = [...photos].sort((a, b) => b[1][0] - a[1][0]).slice(0, MAX_PHOTOS);
            photos = new Map(keep);
        }
        if (slideshows.length > MAX_SLIDESHOWS) slideshows = slideshows.slice(-MAX_SLIDESHOWS);
        writeJson(config.files.history, { photos: Object.fromEntries(photos), slideshows, savedAt: new Date().toISOString() });
        dirty = false;
    } catch (err) {
        logger.warn(`Could not save the history: ${err.message}`);
    }
}

function noteShown(p, now = Date.now()) {
    const e = photos.get(p);
    photos.set(p, [now, (e ? e[1] : 0) + 1]);
    const cur = slideshows[slideshows.length - 1];
    if (cur && !cur.endedAt) cur.shown = (cur.shown || 0) + 1;
    dirty = true;
}

function lastShown(p) {
    const e = photos.get(p);
    return e ? e[0] : null;
}

function startSlideshow(label, source, now = Date.now()) {
    const cur = slideshows[slideshows.length - 1];
    if (cur && !cur.endedAt) cur.endedAt = new Date(now).toISOString();
    slideshows.push({ label: label || null, source, startedAt: new Date(now).toISOString(), endedAt: null, shown: 0 });
    dirty = true;
}

// Photos (from a list) not shown in the last `days` days, the longest unseen first.
function notSeen(paths, days, now = Date.now()) {
    const cutoff = now - days * 86400000;
    return paths.filter((p) => !(lastShown(p) > cutoff));
}

function summary(limit = 20) {
    return {
        photosShown: photos.size,
        slideshows: slideshows.slice(-limit).reverse(),
    };
}

module.exports = { load, save, noteShown, lastShown, startSlideshow, notSeen, summary };
