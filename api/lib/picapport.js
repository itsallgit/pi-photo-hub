// picapport.js - the only place that knows Picapport (principle 12: swap the index by
// replacing this adapter). Facts: docs/architecture.md "Picapport queries" and "Picapport as the
// slideshow layer's source", docs/image-metadata.md.
const config = require("./config");

// Picapport answers HTTP 500 for a query with '*' (tested 2026-11-16), the same server error seen in
// the old slideshow failures (B03), so such queries never reach it.
function validateQuery(q) {
    if (typeof q !== "string" || !q.trim()) return "query is empty";
    if (q.length > 500) return "query is longer than 500 characters";
    if (q.includes("*")) return "'*' is not supported by Picapport (it fails with a server error)";
    if (/[\u0000-\u001f]/.test(q)) return "query contains control characters";
    return null;
}

// One Picapport web session (cookie). A result (vid) belongs to the session that ran the query:
// without the cookie GetMetaData answers ACCESSDENIED (tested 2026-11-18, M0.2). A vid stayed valid
// after 60 further queries in the same session.
let cookie = "";

async function call(path, { timeout = 120000, raw = false } = {}) {
    const res = await fetch(`${config.picapportUrl}${path}`, {
        headers: cookie ? { cookie } : {},
        signal: AbortSignal.timeout(timeout),
    });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    if (raw) return res;
    if (!res.ok) throw new Error(`Picapport answered HTTP ${res.status}`);
    return res.json();
}

class SessionLost extends Error {}
function lost(msg) { cookie = ""; return new SessionLost(msg); } // the next call starts a new session
function session() { return cookie; }

// Run a query; returns { vid, count }. count 0 for no result.
async function runQuery(query, sort = "random") {
    const json = await call(`/picapport_json?cmd=RunQuery&query=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}`);
    if (json.status === "NORESULT") return { vid: json.vid ?? null, count: 0 };
    if (json.status !== "OK") throw new Error(`Picapport status ${json.status} for query "${query}"`);
    return { vid: json.vid, count: Number(json.numPhotos) || 0 };
}

async function count(query, sort = "random") {
    return (await runQuery(query, sort)).count;
}

// One result's metadata: { fileName, creationDate, width, height, rating, textSearch, ... }.
async function metadata(vid, index) {
    const json = await call(`/picapport_json?cmd=GetMetaData&vid=${vid}&index=${index}`, { timeout: 30000 });
    if (json.status === "ACCESSDENIED") throw lost("Picapport session lost");
    if (json.status !== "OK") throw new Error(`GetMetaData status ${json.status}`);
    return json;
}

// File paths of a whole result, in result order. About 36 s for 11,807 results with 8 parallel
// requests on the Pi (M0.2). onProgress(done, total) is called now and then.
async function filePaths(vid, total, { concurrency = 8, onProgress } = {}) {
    const out = new Array(total);
    let next = 0;
    let done = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, async () => {
        while (next < total) {
            const i = next++;
            out[i] = (await metadata(vid, i)).fileName;
            done++;
            if (onProgress && done % 500 === 0) onProgress(done, total);
        }
    }));
    return out;
}

// A resized JPEG of one result, with the EXIF rotation already applied to the pixels (upright
// photos come back taller than wide; tested 2026-11-18). Returns a Buffer.
async function image(vid, index, cx, cy) {
    const res = await call(`/lp?vid=${vid}&index=${index}&cx=${cx}&cy=${cy}`, { raw: true, timeout: 60000 });
    if (res.status === 205 || res.status === 403) throw lost("Picapport session lost");
    if (!res.ok) throw new Error(`Picapport image HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw lost("Picapport returned no image");
    return buf;
}

async function isUp() {
    try {
        const res = await fetch(`${config.picapportUrl}/picapport`, { signal: AbortSignal.timeout(10000) });
        return res.ok;
    } catch {
        return false;
    }
}

function slideshowUrl({ query, sort, interval }) {
    return `${config.picapportUrl}/picapport#slideshow?sort=${encodeURIComponent(sort)}&autostart=true` +
        `&viewtime=${encodeURIComponent(interval)}&query=${encodeURIComponent(query)}`;
}

// Read settings back from a slideshow URL (the format older versions saved).
function parseSlideshowUrl(url) {
    const hash = String(url).split("#slideshow?")[1];
    if (!hash) return null;
    const p = new URLSearchParams(hash);
    return { query: p.get("query"), sort: p.get("sort"), interval: Number(p.get("viewtime")) };
}

// Picapport's own sort used to list a result in a fixed order (deterministic, M0.2).
const STABLE_SORT = "nameascending";

module.exports = {
    validateQuery, runQuery, count, metadata, filePaths, image, isUp, slideshowUrl, parseSlideshowUrl,
    SessionLost, STABLE_SORT, session,
};
