// fake-picapport.js - a stand-in for Picapport for tests away from the Pi: a small library of
// photos in folders, RunQuery with result ids (vid) per session cookie, GetMetaData, and lp images
// (generated PNGs in a colour per photo; browsers show them whatever the file name says).
// Behaviour copied from the real one (docs/architecture.md "Slideshow layer", M0.2): a vid only
// works with its session's cookie; without it GetMetaData says ACCESSDENIED and lp answers 205.
const http = require("http");
const zlib = require("zlib");

const ROOT = "/mnt/photos/PHOTOS";
function makeLibrary() {
    const photos = [];
    const add = (folder, file, date, w, h, extra = {}) => photos.push({ folder: `${ROOT}/${folder}`, file, date, w, h, ...extra });
    // Noosa: 12 photos; a burst of three (n01 to n03, 1 s apart), one upright
    for (let i = 1; i <= 12; i++) {
        const sec = i <= 3 ? i : i * 60;
        add("2021.05 - Noosa", `n${String(i).padStart(2, "0")}.jpg`, `2021-05-03T09:${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`,
            i === 5 ? 1080 : 1920, i === 5 ? 1920 : 1080);
    }
    // Honeymoon: two sub-events
    for (let i = 1; i <= 10; i++) add("2026.09 - 2026.10 - Honeymoon/01 Singapore", `s${String(i).padStart(2, "0")}.jpg`, `2026-09-${10 + i}T10:00:00`, 1920, 1080);
    for (let i = 1; i <= 8; i++) add("2026.09 - 2026.10 - Honeymoon/02 Cinque Terre", `c${String(i).padStart(2, "0")}.jpg`, `2026-09-${20 + i}T12:00:00`, i % 2 ? 1920 : 1080, i % 2 ? 1080 : 1920);
    // Friends: no dates on two
    for (let i = 1; i <= 5; i++) add("_Friends", `f${i}.jpg`, i < 4 ? `2018-10-0${i}T20:00:00` : null, 1600, 1200, { rating: i === 1 ? 5 : 0 });
    // A photo the catalogue has but Picapport has not indexed
    add("_Friends", "f9.jpg", "2018-10-09T20:00:00", 1600, 1200, { notIndexed: true });
    return photos;
}

const pathOf = (ph) => `${ph.folder}/${ph.file}`;

function matches(ph, q) {
    q = q.trim();
    const ors = q.split(/\s+OR\s+/);
    if (ors.length > 1) return ors.some((x) => matches(ph, x));
    let m;
    if ((m = q.match(/^dir:"([^"]*)"$/))) return ph.folder === m[1];
    if ((m = q.match(/^dirall:"([^"]*)"$/))) return ph.folder === m[1] || ph.folder.startsWith(m[1] + "/");
    return q.toLowerCase().split(/\s+/).every((w) => pathOf(ph).toLowerCase().includes(w));
}

// A PNG of w x h in one colour with a darker band (so screenshots show the photo's shape).
function png(w, h, rgb) {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        const band = Math.abs(y - h / 2) < h / 10 ? 0.6 : 1;
        for (let x = 0; x < w; x++) {
            const o = y * (w * 3 + 1) + 1 + x * 3;
            const shade = band * (0.7 + 0.3 * (x / w));
            raw[o] = rgb[0] * shade; raw[o + 1] = rgb[1] * shade; raw[o + 2] = rgb[2] * shade;
        }
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function colour(i) {
    const h = (i * 47) % 360, s = 0.55, l = 0.55;
    const f = (n) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
}

function start(port, { library = makeLibrary(), log = [] } = {}) {
    let nextSession = 1;
    let nextVid = 1;
    const vids = new Map(); // vid -> { session, list }
    const pngCache = new Map();
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        const cookie = (req.headers.cookie || "").match(/JSESSIONID=(\w+)/);
        let session = cookie ? cookie[1] : null;
        if (!session || server.expired.has(session)) { session = `s${nextSession++}`; res.setHeader("set-cookie", `JSESSIONID=${session}; Path=/`); }
        if (u.pathname === "/picapport") return res.end("ok");
        if (u.pathname === "/picapport_json") {
            const cmd = u.searchParams.get("cmd");
            res.setHeader("content-type", "application/json");
            if (cmd === "RunQuery") {
                const q = u.searchParams.get("query");
                log.push(q);
                if (q.includes("*")) { res.statusCode = 500; return res.end("error"); }
                const list = library.filter((ph) => !ph.notIndexed && matches(ph, q)).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.folder < b.folder ? -1 : 1));
                const vid = nextVid++;
                vids.set(vid, { session, list });
                return res.end(JSON.stringify(list.length ? { status: "OK", numPhotos: list.length, vid } : { status: "NORESULT", numPhotos: 0, vid }));
            }
            if (cmd === "GetMetaData") {
                const v = vids.get(Number(u.searchParams.get("vid")));
                if (!v || v.session !== session) return res.end(JSON.stringify({ status: "ACCESSDENIED" }));
                const ph = v.list[Number(u.searchParams.get("index"))];
                if (!ph) return res.end(JSON.stringify({ status: "ERROR" }));
                return res.end(JSON.stringify({ status: "OK", fileName: pathOf(ph), creationDate: ph.date, width: ph.w, height: ph.h, rating: ph.rating || 0 }));
            }
        }
        if (u.pathname === "/lp") {
            const v = vids.get(Number(u.searchParams.get("vid")));
            if (!v || v.session !== session) { res.statusCode = 205; return res.end(); }
            const i = Number(u.searchParams.get("index"));
            const ph = v.list[i];
            if (!ph) { res.statusCode = 404; return res.end(); }
            server.imageRequests++;
            const k = library.indexOf(ph);
            const scale = Math.min(Number(u.searchParams.get("cx")) / ph.w, Number(u.searchParams.get("cy")) / ph.h, 1) / 4; // small, quick test images
            const key = `${k}|${scale}`;
            if (!pngCache.has(key)) pngCache.set(key, png(Math.max(8, Math.round(ph.w * scale)), Math.max(8, Math.round(ph.h * scale)), colour(k)));
            res.setHeader("content-type", "image/jpeg");
            return setTimeout(() => res.end(pngCache.get(key)), server.delayMs);
        }
        res.statusCode = 404;
        res.end();
    });
    server.expired = new Set();
    server.imageRequests = 0;
    server.delayMs = 0;
    server.library = library;
    server.expireSessions = () => { for (let i = 1; i < nextSession; i++) server.expired.add(`s${i}`); };
    return new Promise((r) => server.listen(port, () => r(server)));
}

// The catalogue build-vocabulary.py would make for this library (no places but two, for tests).
function catalogue(library = makeLibrary()) {
    const folders = [...new Set(library.map((p) => p.folder))];
    const places = [
        { name: "Noosa Heads", cc: "AU", country: "Australia", lat: -26.39, lon: 153.09, population: 3929 },
        { name: "Vernazza", cc: "IT", country: "Italy", lat: 44.13, lon: 9.68, population: 1000 },
        { name: "La Spezia", cc: "IT", country: "Italy", lat: 44.1, lon: 9.8, population: 93000 },
    ];
    return {
        version: 1, generatedAt: "2026-11-18T00:00:00+00:00", root: ROOT,
        fields: ["folder", "file", "date", "orientation", "width", "height", "lat", "lon", "locality", "city", "rating", "people"],
        folders, places, people: ["Alex"],
        photos: library.map((p) => {
            const noosa = p.folder.includes("Noosa"), ct = p.folder.includes("Cinque");
            return [folders.indexOf(p.folder), p.file, p.date, 1, p.w, p.h, noosa ? -26.39 : ct ? 44.13 : null, noosa ? 153.09 : ct ? 9.68 : null,
                noosa ? 0 : ct ? 1 : null, noosa ? 0 : ct ? 2 : null, p.rating || 0, p.file === "f1.jpg" ? [0] : []];
        }),
        attribution: "test",
    };
}

module.exports = { start, makeLibrary, catalogue, pathOf, ROOT, png };
