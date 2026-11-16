// picapport.js - the only place that knows Picapport (principle 12: swap the index by
// replacing this adapter). Facts: docs/architecture.md "Picapport queries", docs/image-metadata.md.
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

async function count(query, sort = "random") {
    const url = `${config.picapportUrl}/picapport_json?cmd=RunQuery&query=${encodeURIComponent(query)}&sort=${encodeURIComponent(sort)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Picapport answered HTTP ${res.status} for query "${query}"`);
    const json = await res.json();
    if (json.status === "NORESULT") return 0;
    if (json.status !== "OK") throw new Error(`Picapport status ${json.status} for query "${query}"`);
    return Number(json.numPhotos) || 0;
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

module.exports = { validateQuery, count, isUp, slideshowUrl, parseSlideshowUrl };
