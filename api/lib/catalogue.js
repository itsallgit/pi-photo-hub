// catalogue.js - what the photo API knows about each photo, keyed by file path: date, orientation,
// place, rating, people, event (folder). Built nightly from the photos by
// scripts/refresh-vocabulary.sh (build-vocabulary.py --catalogue); derived and disposable
// (principle 11). Reloaded when the file changes. Without it the slideshow still plays (no place,
// no "skip upright", dates only from Picapport).
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { writeText } = require("./state");

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
        cat = { raw, mtimeMs: st.mtimeMs, byPath, rows: raw.photos, folders: raw.folders, places: raw.places || [],
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

// A photo's rating was changed and verified in the file: keep this rebuildable index in step until
// the nightly scan reads it from the photo again.
function setRating(filePath, rating) {
    const c = load();
    const r = c && c.byPath.get(filePath);
    if (!r) return false;
    r[c.f.rating] = rating;
    writeText(config.files.catalogue, JSON.stringify(c.raw));
    c.mtimeMs = fs.statSync(config.files.catalogue).mtimeMs;
    return true;
}

function pathsWithRating(rating) { return paths((r, c) => r[c.f.rating] === rating); }

// A photo to stand for each group on the phone's Browse pages (a year, a country, a person, a
// folder...). The same choice all day, a new one tomorrow; wide photos preferred, skipped ones never.
let coverCache = null;
function covers(day) {
    const c = load();
    if (!c) return {};
    if (coverCache && coverCache.day === day && coverCache.mtimeMs === c.mtimeMs) return coverCache.value;
    const f = c.f, best = new Map();
    const score = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
    const offer = (key, p, n) => { const b = best.get(key); if (!b || n < b.n) best.set(key, { n, p }); };
    const root = c.root || "/mnt/photos/PHOTOS";
    for (const [p, r] of c.byPath) {
        const rating = r[f.rating];
        if (rating === 1) { offer("skipped", p, score(day + p)); continue; }
        const turned = [5, 6, 7, 8].includes(r[f.orientation]);
        const wide = r[f.width] && r[f.height] && (turned ? r[f.height] > r[f.width] : r[f.width] > r[f.height]);
        const n = score(day + p) + (wide ? 0 : 2 ** 32); // every wide photo ranks before every upright one
        const own = (k) => score(k + day + p) + (wide ? 0 : 2 ** 32); // the home tiles should not all pick one photo
        offer("all", p, own("all"));
        if (rating === 5) offer("favourites", p, n);
        if (r[f.date]) offer(`y:${r[f.date].slice(0, 4)}`, p, n);
        const city = c.places[r[f.city]];
        if (city) { offer("places", p, own("places")); offer(`c:${city.cc}`, p, n); offer(`t:${city.cc}/${city.name}`, p, n); }
        for (const i of r[f.people] || []) { offer("people", p, own("people")); if (c.people[i]) offer(`p:${c.people[i]}`, p, n); }
        const dir = path.posix.dirname(p);
        if (dir.startsWith(root + "/")) {
            let sofar = "";
            for (const part of dir.slice(root.length + 1).split("/")) { sofar = sofar ? `${sofar}/${part}` : part; offer(`f:${sofar}`, p, n); }
        }
    }
    const value = Object.fromEntries([...best].map(([k, v]) => [k, v.p]));
    coverCache = { day, mtimeMs: c.mtimeMs, value };
    return value;
}

function summary() {
    const c = load();
    if (!c) return { loaded: false };
    return { loaded: true, photos: c.byPath.size, places: c.places.length, generatedAt: c.generatedAt };
}

module.exports = { load, info, paths, pathsInPlaces, pathsOnThisDay, pathsInBox, mapPoints, eventName, cleanFolderName, summary, setLogger, setRating, pathsWithRating, covers };
