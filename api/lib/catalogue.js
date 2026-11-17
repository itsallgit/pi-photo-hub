// catalogue.js - what the photo API knows about each photo, keyed by file path: date, orientation,
// place, rating, people, event (folder). Built nightly from the photos by
// scripts/refresh-vocabulary.sh (build-vocabulary.py --catalogue); derived and disposable
// (principle 11). Reloaded when the file changes. Without it the slideshow still plays (no place,
// no "skip upright", dates only from Picapport).
const fs = require("fs");
const path = require("path");
const config = require("./config");

let cat = null; // { mtimeMs, byPath: Map(path -> row), rows, folders, places, people, fields }
let logger = console;

function setLogger(l) { logger = l; }

function load() {
    const file = config.files.catalogue;
    let st;
    try {
        st = fs.statSync(file);
    } catch {
        if (cat) logger.warn("Catalogue file is gone; keeping the one in memory");
        return cat;
    }
    if (cat && cat.mtimeMs === st.mtimeMs) return cat;
    try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        const f = Object.fromEntries(raw.fields.map((name, i) => [name, i]));
        const byPath = new Map();
        for (const r of raw.photos) byPath.set(`${raw.folders[r[f.folder]]}/${r[f.file]}`, r);
        cat = { mtimeMs: st.mtimeMs, byPath, rows: raw.photos, folders: raw.folders, places: raw.places || [],
            people: raw.people || [], f, generatedAt: raw.generatedAt, root: raw.root };
        logger.info(`Catalogue loaded: ${byPath.size} photos (built ${raw.generatedAt})`);
    } catch (err) {
        logger.warn(`Could not read the catalogue ${file}: ${err.message}`);
    }
    return cat;
}

// "2021.05 - Noosa" -> "Noosa"; "01 Singapore - Round 1" -> "Singapore - Round 1"; "_Friends" -> "Friends".
function cleanFolderName(name) {
    let n = String(name).trim();
    n = n.replace(/^\d{4}(\.\d{1,2})?(\.\d{1,2})?(\s*-\s*\d{4}(\.\d{1,2})?(\.\d{1,2})?)?\s*-\s*/, "");
    n = n.replace(/^\d{1,3}[\s._-]+(?=\D)/, "");
    n = n.replace(/^[_\s]+/, "");
    return n || String(name);
}

// The event a photo belongs to, from its folder: "Honeymoon › Singapore - Round 1".
function eventName(filePath) {
    const c = load();
    const root = (c && c.root) || "/mnt/photos/PHOTOS";
    const dir = path.posix.dirname(filePath);
    const rel = dir.startsWith(root + "/") ? dir.slice(root.length + 1) : path.posix.basename(dir);
    const parts = rel.split("/").filter(Boolean).map(cleanFolderName);
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : `${parts[0]} › ${parts[parts.length - 1]}`;
}

function placeOf(c, idx) {
    if (idx === null || idx === undefined || !c.places[idx]) return null;
    const p = c.places[idx];
    return { name: p.name, country: p.country, cc: p.cc };
}

// Everything the overlay and the player need about one photo. Unknown fields are null.
function info(filePath) {
    const c = load();
    const r = c && c.byPath.get(filePath);
    const base = { path: filePath, event: eventName(filePath), folder: path.posix.dirname(filePath) };
    if (!r) return { ...base, known: false, date: null, upright: null, place: null, city: null, rating: 0, people: [], lat: null, lon: null };
    const f = c.f;
    const w = r[f.width], h = r[f.height], o = r[f.orientation];
    const turned = [5, 6, 7, 8].includes(o);
    return {
        ...base,
        known: true,
        date: r[f.date] || null,
        upright: w && h ? (turned ? w > h : h > w) : null,
        place: placeOf(c, r[f.locality]) || placeOf(c, r[f.city]),
        city: placeOf(c, r[f.city]),
        rating: r[f.rating] || 0,
        people: (r[f.people] || []).map((i) => c.people[i]).filter(Boolean),
        lat: r[f.lat], lon: r[f.lon],
    };
}

// All photo paths, optionally filtered by a test on info-like rows (fast path for sources).
function paths(filter) {
    const c = load();
    if (!c) return [];
    const out = [];
    for (const [p, r] of c.byPath) if (!filter || filter(r, c)) out.push(p);
    return out;
}

// Paths in places: keys "<cc>" (a country) or "<cc>/<city name>" (a city, as in the vocabulary).
function pathsInPlaces(keys) {
    const want = new Set(keys);
    return paths((r, c) => {
        const city = c.places[r[c.f.city]];
        if (!city) return false;
        return want.has(city.cc) || want.has(`${city.cc}/${city.name}`);
    });
}

// "This week in past years": photos taken within +-days of today's month and day, before this year.
function pathsOnThisDay(now = new Date(), days = 3) {
    const year = now.getFullYear();
    return paths((r, c) => {
        const d = r[c.f.date];
        if (!d) return false;
        const y = Number(d.slice(0, 4));
        if (y >= year) return false;
        const then = new Date(year, Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
        const diff = Math.abs(then - new Date(year, now.getMonth(), now.getDate())) / 86400000;
        return diff <= days || diff >= 365 - days;
    });
}

// Photos with GPS inside a box [minLat, minLon, maxLat, maxLon] (the map, R15).
function pathsInBox([a, b, c2, d]) {
    return paths((r, c) => {
        const lat = r[c.f.lat], lon = r[c.f.lon];
        return lat !== null && lon !== null && lat >= a && lat <= c2 && lon >= b && lon <= d;
    });
}

// Points for the map: [[lat, lon, count]] rounded to a grid so the phone gets a small list.
function mapPoints(precision = 2) {
    const c = load();
    if (!c) return [];
    const m = new Map();
    const k = 10 ** precision;
    for (const r of c.rows) {
        const lat = r[c.f.lat], lon = r[c.f.lon];
        if (lat === null || lon === null || (lat === 0 && lon === 0)) continue;
        const key = `${Math.round(lat * k) / k},${Math.round(lon * k) / k}`;
        m.set(key, (m.get(key) || 0) + 1);
    }
    return [...m].map(([key, n]) => [...key.split(",").map(Number), n]);
}

function summary() {
    const c = load();
    if (!c) return { loaded: false };
    return { loaded: true, photos: c.byPath.size, places: c.places.length, generatedAt: c.generatedAt };
}

module.exports = { load, info, paths, pathsInPlaces, pathsOnThisDay, pathsInBox, mapPoints, eventName, cleanFolderName, summary, setLogger };
