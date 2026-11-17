// dev.js - development tools for the slideshow layer (kept as tools, not used by viewers):
// open a page of this API in the kiosk browser, and collect measurements a test page reports.
// Used for the motion test (docs/slideshow-layer-build.md, M0.3) and the release checks.
const express = require("express");
const browser = require("./browser");
const config = require("./config");
const picapport = require("./picapport");

const reports = [];

function router(logger) {
    const r = express.Router();
    // Open http://localhost:<port><path> in the kiosk browser. Only paths of this API.
    r.post("/kiosk", async (req, res, next) => {
        try {
            const p = String((req.body || {}).path || "");
            if (!/^\/[A-Za-z0-9/_.?=&%,+-]*$/.test(p)) return res.status(400).json({ error: "path must start with / and be a plain path" });
            const flags = [].concat((req.body || {}).flags || []).map(String);
            if (flags.some((f) => !/^--[a-z0-9-]+(=[A-Za-z0-9,_.:-]+)?$/.test(f))) return res.status(400).json({ error: "flags must look like --name or --name=value" });
            await browser.open(`http://localhost:${config.port}${p}`, logger, flags);
            res.json({ opened: p });
        } catch (e) { next(e); }
    });
    r.post("/report", (req, res) => {
        reports.push({ at: new Date().toISOString(), ...(req.body || {}) });
        while (reports.length > 200) reports.shift();
        res.json({ ok: true });
    });
    r.get("/report", (req, res) => res.json({ reports }));
    // Sample images straight from Picapport (only for test pages): /api/dev/sample/<n>?q=<query>
    let sample = { q: null, vid: null };
    r.get("/sample/:n", async (req, res, next) => {
        try {
            const q = String(req.query.q || "honeymoon");
            if (picapport.validateQuery(q)) return res.status(400).json({ error: picapport.validateQuery(q) });
            if (sample.q !== q) sample = { q, ...(await picapport.runQuery(q, picapport.STABLE_SORT)) };
            const buf = await picapport.image(sample.vid, Number(req.params.n) % sample.count, 1920, 1080);
            res.type("image/jpeg").set("cache-control", "max-age=3600").send(buf);
        } catch (e) { sample = { q: null }; next(e); }
    });
    return r;
}

module.exports = { router };
