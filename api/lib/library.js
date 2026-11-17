// library.js - photos by file path on top of the Picapport adapter: list a query's photos, find a
// photo's place in a Picapport result, and serve resized images from a disk cache.
// Method decided in M0.2 (docs/architecture.md, "Slideshow layer"): a query is listed in Picapport's
// stable order (nameascending), index by index (GetMetaData, about 3 ms a photo); a photo's image
// is fetched with lp?vid=&index= after checking that index still holds that file.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const picapport = require("./picapport");

let logger = console;
function setLogger(l) { logger = l; }

const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
const photoId = (p) => sha(p).slice(0, 20);

// path -> { vid, index, session } learned from listings; valid only in the same Picapport session.
const located = new Map();
const ids = new Map(); // photo id -> path (every path the API has handed out)
function register(p) { const id = photoId(p); ids.set(id, p); return id; }
function pathOf(id) { return ids.get(id) || null; }

// ---------------------------------------------------------------------------------------------
// Listing a query: { query, count, paths } (paths in Picapport's stable order)
// ---------------------------------------------------------------------------------------------
const resultsDir = () => path.join(config.cacheDir, "results");
const listing = new Map(); // query -> promise (one listing per query at a time)

async function listQuery(query, { onProgress } = {}) {
    if (listing.has(query)) return listing.get(query);
    const job = (async () => {
        const { vid, count } = await picapport.runQuery(query, picapport.STABLE_SORT);
        if (!count) return { query, count: 0, paths: [] };
        const session = picapport.session();
        const file = path.join(resultsDir(), `${sha(query)}.json`);
        // A cached listing is reused when the count matches and a few spot checks still match.
        try {
            const cached = JSON.parse(fs.readFileSync(file, "utf8"));
            if (cached.query === query && cached.count === count && cached.paths.length === count) {
                const probes = [0, Math.floor(count / 2), count - 1];
                let same = true;
                for (const i of probes) if ((await picapport.metadata(vid, i)).fileName !== cached.paths[i]) same = false;
                if (same) {
                    cached.paths.forEach((p, index) => located.set(p, { vid, index, session }));
                    logger.info(`Listing reused from the cache: ${count} photos for ${query}`);
                    return cached;
                }
            }
        } catch { /* no usable cache */ }
        const t = Date.now();
        const paths = await picapport.filePaths(vid, count, { onProgress });
        paths.forEach((p, index) => located.set(p, { vid, index, session }));
        const result = { query, count, paths, listedAt: new Date().toISOString() };
        try {
            fs.mkdirSync(resultsDir(), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(result));
        } catch (err) {
            logger.warn(`Could not cache the listing: ${err.message}`);
        }
        logger.info(`Listed ${count} photos in ${Math.round((Date.now() - t) / 1000)} s for ${query}`);
        return result;
    })();
    listing.set(query, job);
    try {
        return await job;
    } finally {
        listing.delete(query);
    }
}

// ---------------------------------------------------------------------------------------------
// Finding a photo in Picapport (for its image)
// ---------------------------------------------------------------------------------------------
const folderJobs = new Map();

// List the photo's own folder (dir:"<folder>", usually a few hundred photos) to learn its index.
async function locateByFolder(p) {
    const folder = path.posix.dirname(p);
    if (!folderJobs.has(folder)) {
        folderJobs.set(folder, (async () => {
            const { vid, count } = await picapport.runQuery(`dir:"${folder}"`, picapport.STABLE_SORT);
            const session = picapport.session();
            if (count) (await picapport.filePaths(vid, count)).forEach((fp, index) => located.set(fp, { vid, index, session }));
        })().finally(() => folderJobs.delete(folder)));
    }
    await folderJobs.get(folder);
}

class NotInIndex extends Error {}

// Returns { vid, index, meta } for a path, checked against Picapport.
async function locate(p) {
    for (let attempt = 0; attempt < 2; attempt++) {
        let loc = located.get(p);
        if (!loc || loc.session !== picapport.session()) {
            await locateByFolder(p);
            loc = located.get(p);
        }
        if (!loc || loc.session !== picapport.session()) throw new NotInIndex(`not in Picapport's index: ${p}`);
        try {
            const meta = await picapport.metadata(loc.vid, loc.index);
            if (meta.fileName === p) return { ...loc, meta };
        } catch (err) {
            if (!(err instanceof picapport.SessionLost)) throw err;
        }
        located.delete(p); // stale: list the folder again
    }
    throw new NotInIndex(`could not find ${p} in Picapport's index`);
}

// ---------------------------------------------------------------------------------------------
// Image cache
// ---------------------------------------------------------------------------------------------
const imagesDir = () => path.join(config.cacheDir, "images");
const SIZES = { screen: () => config.screenBox, thumb: () => config.thumbBox };
const inflight = new Map();
let imageSlots = 2; // Picapport resizes at most this many at once
const waiting = [];
async function slot(fn) {
    if (imageSlots === 0) await new Promise((r) => waiting.push(r));
    imageSlots--;
    try { return await fn(); } finally { imageSlots++; const next = waiting.shift(); if (next) next(); }
}
const metaCache = new Map(); // path -> { date, width, height } from Picapport (when not in the catalogue)

function cacheFile(p, size) { return path.join(imagesDir(), `${photoId(p)}-${size}.jpg`); }

function cached(p, size) { return fs.existsSync(cacheFile(p, size)); }

// Returns the cache file of a resized image, fetching it from Picapport if needed.
async function image(p, size = "screen") {
    if (!SIZES[size]) throw new Error(`unknown size ${size}`);
    const file = cacheFile(p, size);
    if (fs.existsSync(file)) return file;
    const key = `${p}|${size}`;
    if (!inflight.has(key)) {
        inflight.set(key, slot(async () => {
            const { vid, index, meta } = await locate(p);
            metaCache.set(p, { date: meta.creationDate || null, width: meta.width, height: meta.height });
            if (metaCache.size > 5000) metaCache.delete(metaCache.keys().next().value);
            const [cx, cy] = SIZES[size]();
            let buf;
            try {
                buf = await picapport.image(vid, index, cx, cy);
            } catch (err) {
                if (!(err instanceof picapport.SessionLost)) throw err;
                located.delete(p);
                const again = await locate(p);
                buf = await picapport.image(again.vid, again.index, cx, cy);
            }
            fs.mkdirSync(imagesDir(), { recursive: true });
            const tmp = `${file}.tmp-${process.pid}`;
            fs.writeFileSync(tmp, buf);
            fs.renameSync(tmp, file);
            noteWritten(buf.length);
            return file;
        }).finally(() => inflight.delete(key)));
    }
    return inflight.get(key);
}

// Keep the cache under its cap: remove the least recently used files (by access time we set).
let writtenSincePrune = Infinity;
function noteWritten(bytes) {
    writtenSincePrune += bytes;
    if (writtenSincePrune > 50 * 1024 * 1024) { writtenSincePrune = 0; setImmediate(prune); }
}
function touch(file) { const t = new Date(); try { fs.utimesSync(file, t, t); } catch { /* gone */ } }
function prune() {
    try {
        const dir = imagesDir();
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).map((f) => {
            const st = fs.statSync(path.join(dir, f));
            return { f, size: st.size, t: st.mtimeMs };
        });
        let total = files.reduce((a, x) => a + x.size, 0);
        const cap = config.imageCacheMb * 1024 * 1024;
        if (total <= cap) return;
        files.sort((a, b) => a.t - b.t);
        let removed = 0;
        for (const x of files) {
            if (total <= cap * 0.9) break;
            fs.rmSync(path.join(dir, x.f), { force: true });
            total -= x.size;
            removed++;
        }
        logger.info(`Image cache: removed ${removed} old images (cap ${config.imageCacheMb} MB)`);
    } catch (err) {
        logger.warn(`Image cache prune failed: ${err.message}`);
    }
}
writtenSincePrune = 0;

function cacheStats() {
    try {
        const files = fs.readdirSync(imagesDir()).filter((f) => f.endsWith(".jpg"));
        const bytes = files.reduce((a, f) => a + fs.statSync(path.join(imagesDir(), f)).size, 0);
        return { images: files.length, mb: Math.round(bytes / 1048576), capMb: config.imageCacheMb };
    } catch {
        return { images: 0, mb: 0, capMb: config.imageCacheMb };
    }
}

module.exports = {
    setLogger, listQuery, locate, image, cached, touch, register, pathOf, photoId, metaCache, cacheStats, prune, NotInIndex,
};
