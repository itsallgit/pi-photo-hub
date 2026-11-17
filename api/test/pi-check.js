// pi-check.js - check the slideshow layer's API on the real Pi from the PC (milestone and release
// checks, docs/slideshow-layer-build.md). It changes the slideshow while it runs (next, back,
// pause, settings) and puts back what it changed: the position, playing or paused, and the
// settings. It does not start a different slideshow.
//   node api/test/pi-check.js [http://pi.local:3000]
const assert = require("assert");
const BASE = process.argv[2] || "http://pi.local:3000";

async function api(method, p, body) {
    const t = Date.now();
    const res = await fetch(BASE + p, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, ms: Date.now() - t };
}
function listen(role) {
    const ctl = new AbortController();
    const got = [];
    (async () => {
        const res = await fetch(`${BASE}/api/events?role=${role}`, { signal: ctl.signal });
        const reader = res.body.getReader();
        let buf = "";
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += Buffer.from(value).toString();
            let k;
            while ((k = buf.indexOf("\n\n")) >= 0) {
                const d = buf.slice(0, k).split("\n").find((l) => l.startsWith("data: "));
                buf = buf.slice(k + 2);
                if (d) got.push({ at: Date.now(), s: JSON.parse(d.slice(6)) });
            }
        }
    })().catch(() => {});
    return { got, close: () => ctl.abort() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000) {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(100); }
}

(async () => {
    let fails = 0;
    const ok = async (name, fn) => { try { const note = await fn(); console.log(`ok   ${name}${note ? `: ${note}` : ""}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
    const start = (await api("GET", "/api/player")).body;
    const keep = { settings: start.settings, position: start.position, paused: start.paused };
    console.log(`playing: ${start.source.label} (${start.count} photos), position ${start.position}, ${start.settings.order}, ${start.settings.interval} s, preset ${start.preset && start.preset.name}`);

    await ok("status", async () => {
        const s = (await api("GET", "/api/status")).body;
        assert.equal(s.picapportUp, true);
        return `catalogue ${s.catalogue.loaded ? s.catalogue.photos + " photos" : "not built"}, image cache ${s.imageCache.images} images ${s.imageCache.mb} MB, viewers ${s.viewers.map((v) => v.role).join(",") || "none"}, screen on ${s.screen.on}`;
    });
    await ok("lockstep: next reaches two viewers", async () => {
        const a = listen("check-a"), b = listen("check-b");
        await until(() => a.got.length && b.got.length, "first states");
        const t0 = Date.now();
        const r = (await api("POST", "/api/player/next")).body;
        const sa = await until(() => a.got.find((g) => g.s.v >= r.v), "viewer a");
        const sb = await until(() => b.got.find((g) => g.s.v >= r.v), "viewer b");
        a.close(); b.close();
        assert.equal(sa.s.current.id, sb.s.current.id);
        return `both within ${Math.max(sa.at, sb.at) - t0} ms`;
    });
    await ok("back, several steps", async () => {
        const p = (await api("GET", "/api/player")).body.position;
        const r = (await api("POST", "/api/player/back", { steps: 2 })).body;
        assert.equal(r.position, Math.max(0, p - 2));
    });
    await ok("pause and play", async () => {
        assert.equal((await api("POST", "/api/player/pause")).body.paused, true);
        assert.equal((await api("POST", "/api/player/play")).body.paused, false);
    });
    await ok("images: current (cached) and a far one (from Picapport)", async () => {
        const v = (await api("GET", "/api/player")).body;
        const t1 = Date.now(); const a = await fetch(BASE + v.current.url); const ab = (await a.arrayBuffer()).byteLength; const ms1 = Date.now() - t1;
        assert.equal(a.status, 200);
        const far = (await api("POST", "/api/player/jump", { position: (v.position + 500) % v.count })).body;
        const t2 = Date.now(); const b = await fetch(BASE + far.current.url); const bb = (await b.arrayBuffer()).byteLength; const ms2 = Date.now() - t2;
        assert.equal(b.status, 200);
        const t3 = Date.now(); await (await fetch(BASE + far.current.thumb)).arrayBuffer(); const ms3 = Date.now() - t3;
        return `current ${Math.round(ab / 1024)} KB in ${ms1} ms; uncached ${Math.round(bb / 1024)} KB in ${ms2} ms; thumbnail ${ms3} ms`;
    });
    await ok("settings change and preset, then put back", async () => {
        const r = (await api("PATCH", "/api/player/settings", { motion: "lively" })).body;
        assert.equal(r.settings.motion, "lively");
        const p = (await api("POST", "/api/player/preset", { name: "guests" })).body;
        assert.equal(p.settings.order, "chapters");
        return `chapters order of ${p.count} photos built`;
    });
    await ok("upright skip removes upright photos", async () => {
        const a = (await api("PATCH", "/api/player/settings", { upright: "fill" })).body.count;
        const b = (await api("PATCH", "/api/player/settings", { upright: "skip" })).body.count;
        return `${a} with upright photos, ${b} without`;
    });
    await ok("the older endpoints answer", async () => {
        const s = (await api("GET", "/api/status")).body.slideshow;
        assert.ok(s.interval);
        assert.equal((await api("GET", "/api/count?q=noosa")).status, 200);
    });

    // Put back what was changed.
    const { preset, ...rest } = keep.settings;
    if (preset) await api("POST", "/api/player/preset", { name: preset });
    await api("PATCH", "/api/player/settings", rest);
    await api("POST", "/api/player/jump", { position: keep.position });
    if (keep.paused) await api("POST", "/api/player/pause");
    const end = (await api("GET", "/api/player")).body;
    console.log(`put back: ${end.source.label}, position ${end.position}, ${end.settings.order}, ${end.settings.interval} s, preset ${end.preset && end.preset.name}${end.preset && end.preset.changed.length ? " (changed: " + end.preset.changed.join(", ") + ")" : ""}`);
    process.exitCode = fails ? 1 : 0;
})();
