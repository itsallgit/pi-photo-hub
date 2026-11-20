// smoke.js - test the photo API away from the Pi: a fake Picapport (test/fake-picapport.js), stub
// browser commands, a temporary state and cache directory. Run: node api/test/smoke.js (after
// npm install in api/). Runs the unit tests (test/unit.js) first.
// It tests the API logic only; the screen (wlr-randr), Chromium and real Picapport are tested on the
// Pi, the page in a browser by test/browser.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const assert = require("assert");
require("./unit");
const fake = require("./fake-picapport");

const PIC_PORT = 18080;
const API_PORT = 13000;
const queries = [];

const state = fs.mkdtempSync(path.join(os.tmpdir(), "photo-api-test-"));
const cache = path.join(state, "cache");
const launches = path.join(state, "launches.log");
const metadata = path.join(state, "fake-metadata");
fs.mkdirSync(metadata);
const node = JSON.stringify(process.execPath);
const env = {
    ...process.env,
    PORT: String(API_PORT),
    STATE_DIRECTORY: state,
    CACHE_DIRECTORY: cache,
    PHOTO_API_LOG_DIR: path.join(state, "log"),
    PICAPPORT_URL: `http://localhost:${PIC_PORT}`,
    CHROMIUM_BIN: process.execPath, // "launches" node with the URL as an argument: harmless
    BROWSER_CHECK_CMD: `${node} -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" ${JSON.stringify(launches)}`,
    BROWSER_KILL_CMD: `${node} -e "require('fs').appendFileSync(process.argv[1],'launch\\n')" ${JSON.stringify(launches)}`,
    WLR_RANDR_BIN: path.join(state, "no-wlr-randr"), // screen calls fail and are reported, not fatal
    CHROMIUM_FLAGS_EXTRA: "",
    PHOTO_METADATA_CMD: JSON.stringify([process.execPath, path.join(__dirname, "fake-metadata-writer.js")]),
    PHOTO_METADATA_STATUS_TTL_MS: "0",
    FAKE_METADATA_DIR: metadata,
};

async function api(method, p, body) {
    const res = await fetch(`http://localhost:${API_PORT}${p}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
}
const launchCount = () => (fs.existsSync(launches) ? fs.readFileSync(launches, "utf8").split("\n").filter(Boolean).length : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await sleep(50);
    }
}
const player = async () => (await api("GET", "/api/player")).body;
const playlist = () => JSON.parse(fs.readFileSync(path.join(state, "playlist.json"), "utf8"));
const ready = (n, label) => until(async () => { const v = await player(); return v.status === "playing" && !v.preparing && v.count === n && (!label || v.source.label === label) ? v : null; }, `${n} photos playing${label ? ` (${label})` : ""}`);

// A minimal Server-Sent Events reader.
function listen(role) {
    const ctl = new AbortController();
    const got = [];
    const done = (async () => {
        const res = await fetch(`http://localhost:${API_PORT}/api/events?role=${role}`, { signal: ctl.signal });
        const reader = res.body.getReader();
        let buf = "";
        for (;;) {
            const { value, done: end } = await reader.read();
            if (end) break;
            buf += Buffer.from(value).toString();
            let k;
            while ((k = buf.indexOf("\n\n")) >= 0) {
                const block = buf.slice(0, k);
                buf = buf.slice(k + 2);
                const data = block.split("\n").find((l) => l.startsWith("data: "));
                if (data) got.push({ at: Date.now(), state: JSON.parse(data.slice(6)) });
            }
        }
    })().catch(() => {});
    return { got, close: () => ctl.abort(), done };
}

let server;
let out = "";
function startApi() {
    server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (d) => (out += d));
    server.stderr.on("data", (d) => (out += d));
    return until(async () => { try { return (await api("GET", "/api/test")).status === 200; } catch { return false; } }, "the API to start");
}
async function stopApi() {
    const exited = new Promise((r) => server.on("exit", r));
    server.kill("SIGTERM");
    await exited;
}

async function main() {
    const pic = await fake.start(PIC_PORT, { log: queries });
    // An old-format saved slideshow, as on the Pi before this version, and a catalogue.
    fs.writeFileSync(path.join(state, "slideshow_url.txt"),
        "http://localhost:8080/picapport#slideshow?sort=random&autostart=true&viewtime=20&query=honeymoon");
    fs.writeFileSync(path.join(state, "catalogue.json"), JSON.stringify(fake.catalogue(pic.library)));
    await startApi();
    const ok = async (name, fn) => {
        try { await fn(); console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); process.exitCode = 1; }
    };

    // ---------- the older API (R21: it keeps working for the slideshow-control skill) ----------
    await ok("first start: the old saved slideshow becomes the player's (honeymoon, 18 photos)", async () => {
        const v = await ready(18);
        assert.equal(v.source.query, "honeymoon");
        assert.equal(v.settings.interval, 20);
        assert.equal(v.settings.preset, "ambient");
        const r = await api("GET", "/api/status");
        assert.deepEqual([r.body.slideshow.query, r.body.slideshow.sort, r.body.slideshow.interval], ["honeymoon", "random", 20]);
        assert.equal(r.body.picapportUp, true);
        assert.equal(r.body.catalogue.photos, pic.library.length);
    });
    await ok("count several queries", async () => {
        const r = await api("GET", `/api/count?q=noosa&q=${encodeURIComponent("noosa OR croatia")}&q=zzz`);
        assert.deepEqual(r.body.results.map((x) => x.count), [12, 12, 0]);
    });
    await ok("'*' is refused before Picapport", async () => {
        const before = queries.length;
        const r = await api("GET", "/api/count?q=wed*");
        assert.match(r.body.results[0].error, /not supported/);
        assert.equal(queries.length, before);
    });
    await ok("POST with no matches does not play", async () => {
        const r = await api("POST", "/api/slideshow", { query: "zzz" });
        assert.equal(r.status, 422);
        assert.equal((await player()).source.query, "honeymoon");
    });
    let noosaPlaylist;
    await ok("POST plays (bursts thinned: 12 photos, 10 play), keeps interval, saves the older files", async () => {
        const r = await api("POST", "/api/slideshow", { query: "noosa", label: "Noosa" });
        assert.equal(r.status, 200);
        assert.equal(r.body.relaunched, true);
        assert.equal(r.body.count, 12);
        assert.equal(r.body.slideshow.interval, 20);
        const v = await ready(10, "Noosa");
        noosaPlaylist = playlist().id;
        assert.equal(v.position, 0);
        await until(async () => fs.existsSync(path.join(state, "slideshow.json")) && JSON.parse(fs.readFileSync(path.join(state, "slideshow.json"), "utf8")).query === "noosa", "slideshow.json");
        assert.match(fs.readFileSync(path.join(state, "slideshow_url.txt"), "utf8"), /query=noosa/);
    });
    await ok("the same slideshow is not restarted (no reshuffle)", async () => {
        const r = await api("POST", "/api/slideshow", { query: "noosa" });
        assert.equal(r.body.relaunched, false);
        assert.equal(playlist().id, noosaPlaylist);
    });
    await ok("restart:true starts it again with a new order", async () => {
        const r = await api("POST", "/api/slideshow", { query: "noosa", label: "Noosa", restart: true });
        assert.equal(r.body.relaunched, true);
        await until(async () => playlist().id !== noosaPlaylist, "a new playlist");
        await ready(10, "Noosa");
    });
    await ok("PATCH changes only the interval; the current photo stays", async () => {
        const before = await player();
        const r = await api("PATCH", "/api/slideshow", { interval: 30 });
        assert.equal(r.status, 200);
        assert.deepEqual([r.body.slideshow.query, r.body.slideshow.interval, r.body.slideshow.sort], ["noosa", 30, "random"]);
        const after = await player();
        assert.equal(after.current.id, before.current.id);
        assert.equal(after.duration, 30000);
    });
    await ok("PATCH refuses a bad sort and bad interval", async () => {
        assert.equal((await api("PATCH", "/api/slideshow", { sort: "shuffle" })).status, 400);
        assert.equal((await api("PATCH", "/api/slideshow", { interval: 1 })).status, 400);
    });
    await ok("old GET with only interval keeps the query (B17)", async () => {
        const r = await api("GET", "/api/slideshow?interval=15");
        assert.equal(r.status, 200);
        const s = (await api("GET", "/api/status")).body.slideshow;
        assert.deepEqual([s.query, s.interval], ["noosa", 15]);
    });
    await ok("old GET without parameters (the boot launcher) opens the kiosk on /show and keeps the order", async () => {
        const n = launchCount();
        const id = playlist().id;
        const r = await api("GET", "/api/slideshow");
        assert.match(r.body, /\/show\?kiosk=1/);
        assert.equal(launchCount(), n + 1);
        assert.equal(playlist().id, id);
    });

    // ---------- the player: controls, lockstep, resume ----------
    await ok("next, back (one and several), back at the start stays, jump", async () => {
        await api("POST", "/api/player/jump", { position: 0 });
        assert.equal((await api("POST", "/api/player/next")).body.position, 1);
        assert.equal((await api("POST", "/api/player/next", { steps: 3 })).body.position, 4);
        assert.equal((await api("POST", "/api/player/back", { steps: 2 })).body.position, 2);
        assert.equal((await api("POST", "/api/player/back", { steps: 9 })).body.position, 0);
        assert.equal((await api("POST", "/api/player/jump", { position: 7 })).body.position, 7);
        assert.equal((await api("POST", "/api/player/next", { steps: 0 })).status, 400);
        assert.equal((await api("POST", "/api/player/jump", { position: -1 })).status, 400);
    });
    await ok("pause keeps the time already shown; play continues; toggle", async () => {
        const p = (await api("POST", "/api/player/pause")).body;
        assert.equal(p.paused, true);
        await sleep(300);
        const still = await player();
        assert.equal(still.elapsed, p.elapsed);
        const q = (await api("POST", "/api/player/play")).body;
        assert.equal(q.playing, true);
        assert.ok(q.elapsed >= p.elapsed && q.elapsed < p.elapsed + 200);
        assert.equal((await api("POST", "/api/player/toggle")).body.paused, true);
        assert.equal((await api("POST", "/api/player/toggle")).body.paused, false);
    });
    await ok("lockstep: two viewers get every change within a second, with the same photo", async () => {
        const a = listen("shelf"), b = listen("phone");
        await until(async () => a.got.length && b.got.length, "both viewers' first state");
        const t0 = Date.now();
        const r = (await api("POST", "/api/player/next")).body;
        const sa = await until(async () => a.got.find((g) => g.state.v === r.v), "viewer a");
        const sb = await until(async () => b.got.find((g) => g.state.v === r.v), "viewer b");
        assert.ok(sa.at - t0 < 1000 && sb.at - t0 < 1000);
        assert.equal(sa.state.current.id, sb.state.current.id);
        assert.equal(sa.state.current.id, r.current.id);
        assert.equal(sa.state.next.length, 2);
        const st = (await api("GET", "/api/status")).body;
        assert.deepEqual(st.viewers.map((x) => x.role).sort(), ["phone", "shelf"]);
        a.close(); b.close();
    });
    await ok("autoplay moves on by itself after the interval", async () => {
        await api("PATCH", "/api/player/settings", { interval: 3 });
        const before = (await api("POST", "/api/player/next")).body;
        assert.equal(before.manualMove, true, "a manual move is marked, so viewers snap");
        await until(async () => (await player()).position !== before.position, "an automatic move", 6000);
        assert.equal((await player()).manualMove, false, "an automatic move uses the transition");
        await api("PATCH", "/api/player/settings", { interval: 20 });
    });
    await ok("a jump wins over an automatic move still waiting for a slow image", async () => {
        await api("POST", "/api/player/source", { source: { query: "cinque", label: "Slow" }, settings: { order: "date-asc", interval: 3, titleCards: false } });
        await until(async () => (await player()).source.label === "Slow", "the slideshow");
        pic.delayMs = 5000;
        await api("POST", "/api/player/jump", { position: 5 }); // starts loading photo 6, slowly
        await sleep(3500); // autoplay is now waiting for photo 6
        await api("POST", "/api/player/jump", { position: 0 });
        await sleep(2000); // photo 6 has arrived; the next real move is still a second away
        pic.delayMs = 0;
        assert.equal((await player()).position, 0);
        await api("POST", "/api/player/source", { source: { query: "noosa", label: "Noosa" }, settings: { order: "random", interval: 20, titleCards: false } });
        await until(async () => (await player()).source.label === "Noosa", "back on Noosa");
    });
    await ok("resume after an API restart: same order, same photo (R2)", async () => {
        await api("POST", "/api/player/jump", { position: 6 });
        const before = await player();
        const id = playlist().id;
        await stopApi();
        await startApi();
        const after = await until(async () => { const v = await player(); return v.count ? v : null; }, "the resumed player");
        assert.equal(playlist().id, id);
        assert.equal(after.position, 6);
        assert.equal(after.current.id, before.current.id);
        assert.deepEqual(after.next.map((x) => x.id), before.next.map((x) => x.id));
    });

    // ---------- settings, presets, orders, sources ----------
    await ok("settings: bad values refused; skip upright takes upright photos out and keeps the current photo", async () => {
        assert.equal((await api("PATCH", "/api/player/settings", { motion: "wild" })).status, 400);
        await api("POST", "/api/player/source", { source: { query: "honeymoon" } });
        await ready(18);
        const cur = (await player()).current;
        const v = (await api("PATCH", "/api/player/settings", { upright: "skip" })).body;
        assert.equal(v.count, 14);
        if (!cur.info.upright) assert.equal(v.current.id, cur.id);
        await api("PATCH", "/api/player/settings", { upright: "fill" });
    });
    await ok("presets: Present (no autoplay, date order); a change afterwards is kept and reported", async () => {
        const v = (await api("POST", "/api/player/preset", { name: "present" })).body;
        assert.equal(v.settings.autoplay, false);
        assert.equal(v.playing, false);
        assert.equal(v.settings.order, "date-asc");
        const w = (await api("PATCH", "/api/player/settings", { interval: 7 })).body;
        assert.equal(w.preset.name, "present");
        assert.deepEqual(w.preset.changed, ["interval"]);
        assert.equal((await api("POST", "/api/player/preset", { name: "party" })).status, 400);
        const list = (await api("GET", "/api/presets")).body;
        assert.equal(list.presets.length, 4);
        assert.equal(list.overlayStyles.length, 5);
    });
    await ok("date order with title cards: events in time order, a card at each event", async () => {
        await api("POST", "/api/player/jump", { position: 0 });
        const v = await player();
        assert.equal(v.current.card.t, "Honeymoon › Singapore");
        assert.equal(v.current.info.file, "s01.jpg");
        assert.equal(v.duration, 7000 + v.cardMs);
        const items = playlist().items;
        assert.equal(items.findIndex((it) => it.c && it.c.t.includes("Cinque")), 10);
    });
    await ok("chapters: short runs from one event", async () => {
        await api("PATCH", "/api/player/settings", { order: "chapters", chapterLength: 4 });
        const items = playlist().items;
        assert.equal(items.length, 18);
        assert.ok(items[0].c);
        let run = 0;
        for (const it of items) { run = it.c ? 1 : run + 1; assert.ok(run <= 4); }
    });
    await ok("bursts on and off (Noosa: 12 photos, a burst of 3)", async () => {
        await api("POST", "/api/player/preset", { name: "ambient" });
        await api("POST", "/api/player/source", { source: { query: "noosa" } });
        await ready(10);
        assert.equal((await api("PATCH", "/api/player/settings", { bursts: false })).body.count, 12);
        assert.equal((await api("PATCH", "/api/player/settings", { bursts: true })).body.count, 10);
    });
    await ok("highlights: a rated photo plays twice as often and stays 1.5 times as long", async () => {
        await api("POST", "/api/player/source", { source: { query: "friends", label: "Friends" } });
        const v = await ready(6, "Friends");
        const items = playlist().items;
        assert.equal(items.filter((it) => it.p.endsWith("/f1.jpg")).length, 2);
        const k = items.findIndex((it) => it.p.endsWith("/f1.jpg"));
        const j = (await api("POST", "/api/player/jump", { position: k })).body;
        assert.equal(j.duration, v.settings.interval * 1500);
    });
    await ok("sources from the catalogue: places (a country, a city), years", async () => {
        await api("POST", "/api/player/source", { source: { places: ["IT"] } });
        await ready(8);
        await api("POST", "/api/player/source", { source: { places: ["AU/Noosa Heads"], label: "Noosa Heads" } });
        await ready(10, "Noosa Heads");
        await api("POST", "/api/player/source", { source: { years: [2026], query: "cinque" } });
        await ready(8);
        assert.equal((await api("POST", "/api/player/source", { source: { places: "IT" } })).status, 400);
        assert.equal((await api("POST", "/api/player/source", { source: {} })).status, 400);
    });
    await ok("a photo Picapport has not indexed is skipped ", async () => {
        // f1, f2, f3 and f9 from the catalogue; f9 is not in Picapport. Found when the look-ahead reaches it.
        await api("POST", "/api/player/source", { source: { years: [2018], label: "2018" }, settings: { highlights: false } });
        await until(async () => { const v = await player(); return v.source.label === "2018" && v.count >= 3; }, "the 2018 slideshow");
        for (let i = 0; i < 3; i++) await api("POST", "/api/player/next");
        await until(async () => !playlist().items.some((it) => it.p.endsWith("f9.jpg")), "f9 to be skipped");
        assert.equal((await player()).count, 3);
        await api("PATCH", "/api/player/settings", { highlights: true });
    });
    await ok("recently shown photos play last in a new slideshow", async () => {
        await api("POST", "/api/player/source", { source: { query: "singapore", label: "S1" } });
        const v = await ready(10, "S1");
        const seen = [v.current.id];
        for (let i = 0; i < 3; i++) seen.push((await api("POST", "/api/player/next")).body.current.id);
        await api("POST", "/api/player/source", { source: { query: "singapore", label: "S2" } });
        await ready(10, "S2");
        const tail = playlist().items.slice(-4).map((it) => require("crypto").createHash("sha1").update(it.p).digest("hex").slice(0, 20));
        assert.deepEqual([...tail].sort(), [...seen].sort());
    });
    await ok("nudge: interval steps up and down, overlay style cycles", async () => {
        await api("PATCH", "/api/player/settings", { interval: 20 });
        const slower = (await api("POST", "/api/player/nudge", { setting: "interval", by: 1 })).body;
        assert.equal(slower.settings.interval, 25);
        assert.equal(slower.toast.text, "Slower: 25 seconds per photo");
        const faster = (await api("POST", "/api/player/nudge", { setting: "interval", by: -1 })).body;
        assert.equal(faster.settings.interval, 20);
        assert.equal(faster.toast.text, "Faster: 20 seconds per photo");
        assert.ok(faster.toast.id > slower.toast.id);
        await api("PATCH", "/api/player/settings", { interval: 3 });
        assert.equal((await api("POST", "/api/player/nudge", { setting: "interval", by: -1 })).body.toast.text, "Fastest: 3 seconds per photo");
        await api("PATCH", "/api/player/settings", { interval: 180 });
        assert.equal((await api("POST", "/api/player/nudge", { setting: "interval", by: 1 })).body.toast.text, "Slower: 5 minutes per photo");
        assert.equal((await api("POST", "/api/player/nudge", { setting: "interval", by: 1 })).body.toast.text, "Slowest: 5 minutes per photo");
        await api("PATCH", "/api/player/settings", { interval: 20 });
        const s0 = (await player()).settings.overlayStyle;
        const styled = (await api("POST", "/api/player/nudge", { setting: "overlayStyle" })).body;
        assert.equal(styled.settings.overlayStyle, (s0 + 1) % 5);
        assert.equal(styled.toast.id, (await player()).toast.id, "the overlay style sends no new toast");
        assert.equal(styled.toast.text, "Slowest: 5 minutes per photo");
        assert.equal((await api("POST", "/api/player/nudge", { setting: "colour" })).status, 400);
    });

    // ---------- photos, marks ----------
    await ok("photo images: served, cached (Picapport asked once), thumbnails", async () => {
        const v = await player();
        const before = pic.imageRequests;
        const a = await fetch(`http://localhost:${API_PORT}${v.current.url}`);
        assert.equal(a.status, 200);
        assert.ok((await a.arrayBuffer()).byteLength > 100);
        const asked = pic.imageRequests - before;
        await fetch(`http://localhost:${API_PORT}${v.current.url}`).then((r) => r.arrayBuffer());
        assert.equal(pic.imageRequests - before, asked);
        assert.equal((await fetch(`http://localhost:${API_PORT}${v.current.thumb}`)).status, 200);
        assert.equal((await fetch(`http://localhost:${API_PORT}/api/photo/nope`)).status, 404);
        const info = (await api("GET", `/api/photo/${v.current.id}/info`)).body;
        assert.equal(info.event, "Honeymoon › Singapore");
    });
    await ok("a lost Picapport session is found again", async () => {
        pic.expireSessions();
        const v = (await api("POST", "/api/player/next", { steps: 2 })).body;
        const r = await fetch(`http://localhost:${API_PORT}${v.current.thumb}`);
        assert.equal(r.status, 200);
    });
    const photoPath = (folder, file) => `${fake.ROOT}/${folder}/${file}`;
    const writes = () => { const f = path.join(metadata, "writes.log"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n") : []; };
    const steer = (name, on) => { const f = path.join(metadata, name); if (on) fs.writeFileSync(f, ""); else fs.rmSync(f, { force: true }); };
    const toggle = (what, extra = {}) => api("POST", "/api/photo/toggle", { what, wait: true, ...extra });
    await ok("ratings: holding the key turns a favourite on and off, through the writer", async () => {
        await api("POST", "/api/player/source", { source: { query: "noosa", label: "Noosa" }, settings: { order: "date-asc" } });
        const v = await ready(10, "Noosa");
        const before = (await api("GET", "/api/ratings")).body;
        assert.deepEqual([before.favourites, before.skipped, before.writable], [1, 0, true]); // f1.jpg is rated 5 in its file
        const on = await toggle("favourite");
        assert.deepEqual([on.status, on.body.on, on.body.rating], [200, true, 5]);
        assert.equal((await player()).current.id, v.current.id, "a star does not move on");
        assert.equal((await player()).current.info.favourite, true);
        assert.equal((await player()).toast.text, "★ Starred");
        assert.equal(writes().at(-1), `5 ${on.body.path}`);
        const saved = JSON.parse(fs.readFileSync(path.join(state, "catalogue.json"), "utf8"));
        assert.equal(saved.photos.filter((r) => r[saved.fields.indexOf("rating")] === 5).length, 2, "the rebuildable index follows");
        const off = await toggle("favourite");
        assert.deepEqual([off.body.on, off.body.rating], [false, 0]);
        assert.equal((await player()).toast.text, "☆ Star removed");
        assert.equal((await player()).current.info.favourite, false);
    });
    await ok("ratings: skip moves on at once and the photo leaves every slideshow; restore from Skipped", async () => {
        await api("POST", "/api/player/jump", { position: 2 });
        const v = await player();
        const r = await toggle("skip");
        assert.deepEqual([r.status, r.body.on, r.body.rating], [200, true, 1]);
        const after = await player();
        assert.notEqual(after.current.id, v.current.id);
        assert.equal(after.count, 9);
        assert.equal(after.toast.text, "Skipped");
        assert.ok(!playlist().items.some((it) => it.p === r.body.path));
        await api("POST", "/api/player/source", { source: { query: "noosa", label: "Noosa again" } });
        await ready(9, "Noosa again");
        assert.ok(!playlist().items.some((it) => it.p === r.body.path), "a new slideshow leaves it out");
        await api("POST", "/api/player/source", { source: { skipped: true, label: "Skipped photos" } });
        const sk = await ready(1, "Skipped photos");
        assert.equal(sk.current.info.skipped, true);
        const back = await toggle("skip");
        assert.deepEqual([back.body.on, back.body.rating, back.body.path], [false, 0, r.body.path]);
        assert.equal((await player()).count, 0, "it leaves the Skipped slideshow");
        assert.equal((await player()).toast.text, "Back in your slideshows");
        assert.equal((await api("GET", "/api/ratings")).body.skipped, 0);
    });
    await ok("ratings: a skipped burst photo gives way to another of the burst; Favourites is a slideshow", async () => {
        await api("POST", "/api/player/source", { source: { query: "noosa", label: "N" }, settings: { bursts: true } });
        await ready(10, "N");
        const kept = playlist().items.map((it) => it.p).filter((p) => /n0[123]\.jpg$/.test(p));
        assert.equal(kept.length, 1);
        assert.equal((await api("POST", "/api/photo/rating", { path: kept[0], rating: 1 })).status, 200);
        await api("POST", "/api/player/source", { source: { query: "noosa", label: "N2" } });
        await ready(10, "N2");
        const replaced = playlist().items.map((it) => it.p).filter((p) => /n0[123]\.jpg$/.test(p));
        assert.equal(replaced.length, 1);
        assert.notEqual(replaced[0], kept[0]);
        await api("POST", "/api/photo/rating", { path: kept[0], rating: 0 });
        await api("POST", "/api/photo/rating", { path: photoPath("2021.05 - Noosa", "n05.jpg"), rating: 5 });
        await api("POST", "/api/player/source", { source: { favourites: true, label: "Favourites" } });
        const fav = await ready(2, "Favourites");
        assert.equal(fav.current.info.favourite, true);
        await api("POST", "/api/photo/rating", { path: photoPath("2021.05 - Noosa", "n05.jpg"), rating: 0 });
        assert.equal((await player()).count, 1, "an unstarred photo leaves Favourites");
        assert.equal((await api("POST", "/api/player/source", { source: { favourites: true, skipped: true } })).status, 400);
        assert.equal((await api("POST", "/api/player/source", { source: { favourites: "yes" } })).status, 400);
    });
    await ok("ratings: refusals and failures change nothing and say so", async () => {
        await api("POST", "/api/player/source", { source: { query: "noosa", label: "N3" } });
        const v = await ready(10, "N3");
        assert.equal((await api("POST", "/api/photo/toggle", { what: "nothing" })).status, 400);
        assert.equal((await api("POST", "/api/photo/rating", { rating: 3 })).status, 400);
        const n = writes().length;
        steer("off", true);
        const off = await toggle("skip");
        assert.deepEqual([off.status, off.body.code], [409, "switched-off"]);
        assert.equal((await player()).position, v.position, "a refused skip does not move on");
        assert.equal((await player()).toast.text, "Not saved: Saving to the photos is not switched on yet.");
        steer("off", false);
        steer("fail", true);
        const bad = await toggle("favourite");
        assert.deepEqual([bad.status, bad.body.ok, bad.body.code], [500, false, "verify-failed"]);
        assert.equal((await player()).current.info.favourite, false);
        assert.match((await player()).toast.text, /^Not saved: /);
        const skipped = await toggle("skip");
        assert.equal(skipped.status, 500);
        assert.equal((await player()).count, 10, "a skip that failed keeps the photo in the slideshow");
        steer("fail", false);
        assert.equal(writes().length, n);
        assert.equal((await api("GET", "/api/marks")).status, 404, "no list outside the photos");
        await api("POST", "/api/player/source", { source: { query: "singapore", label: "S2" } });
        await ready(10, "S2");
    });

    // ---------- schedule, history, suggestions, map ----------
    await ok("screen schedule: off by default, validated, saved", async () => {
        assert.equal((await api("GET", "/api/schedule")).body.enabled, false);
        assert.equal((await api("PUT", "/api/schedule", { off: "25:00" })).status, 400);
        assert.equal((await api("PUT", "/api/schedule", { enabled: "yes" })).status, 400);
        const r = await api("PUT", "/api/schedule", { enabled: true, off: "23:30", on: "06:15" });
        assert.deepEqual([r.body.enabled, r.body.off, r.body.on], [true, "23:30", "06:15"]);
        await api("PUT", "/api/schedule", { enabled: false });
    });
    await ok("history and suggestions", async () => {
        const h = (await api("GET", "/api/history")).body;
        assert.ok(h.photosShown > 5);
        assert.equal(h.slideshows[0].label, "S2");
        const s = (await api("GET", "/api/suggestions?days=30")).body;
        assert.ok(s.notSeen.photos < s.notSeen.of);
        await api("POST", "/api/player/source", { source: { notSeenDays: 30, label: "unseen" } });
        const v = await until(async () => { const x = await player(); return x.source.label === "unseen" && x.count ? x : null; }, "unseen photos");
        assert.ok(v.count <= s.notSeen.photos);
    });
    await ok("presets: save the current look, apply, rename, reorder, hide, delete; built-ins are protected", async () => {
        const clockStyle = { face: "flip", size: "xl", position: "bottom-right" };
        const captions = { items: [{ id: "a", field: "date", format: "long", corner: "top-left", size: "xl", font: "serif" }, { id: "b", field: "date", format: "ago", corner: "top-left", size: "s", font: "caps" }], groups: { "top-left": { look: "glass", tone: "auto" } } };
        assert.equal((await api("PATCH", "/api/player/settings", { clock: true, clockStyle, captions, overlayMode: "custom", transition: "random" })).status, 200);
        const saved = await api("POST", "/api/presets", { label: "Living room" });
        assert.equal(saved.status, 200);
        assert.equal(saved.body.preset.name, "my-living-room");
        assert.equal((await player()).settings.preset, "my-living-room");
        assert.equal((await api("POST", "/api/presets", { label: "living ROOM" })).status, 409, "the same name twice");
        assert.equal((await api("POST", "/api/presets", { label: "  " })).status, 400);
        await api("POST", "/api/player/preset", { name: "night" });
        let v = await player();
        assert.equal(v.settings.overlayMode, "styles", "a built-in preset uses the classic overlay");
        assert.equal(v.settings.clockStyle.face, "flip", "the clock is kept");
        assert.deepEqual(v.settings.captions, captions, "your layout is kept for later");
        assert.deepEqual(v.preset.changed, []);
        await api("PATCH", "/api/player/settings", { clock: false, captions: null });
        await api("POST", "/api/player/preset", { name: "my-living-room" });
        v = await player();
        assert.equal(v.settings.clock, true);
        assert.deepEqual(v.settings.captions, captions, "a saved preset brings everything back");
        assert.equal(v.settings.transition, "random");
        assert.deepEqual(v.preset.changed, []);
        assert.equal((await api("PUT", "/api/presets/my-living-room", { label: "Evenings", move: -1 })).status, 200);
        let all = (await api("GET", "/api/presets?all=1")).body.presets;
        assert.deepEqual(all.map((p) => p.label), ["Ambient", "Present", "Guests", "Evenings", "Night"]);
        assert.equal((await api("PUT", "/api/presets/night", { hidden: true })).status, 200);
        assert.ok(!(await api("GET", "/api/presets")).body.presets.some((p) => p.name === "night"), "hidden from the list");
        assert.ok((await api("GET", "/api/presets?all=1")).body.presets.some((p) => p.name === "night" && p.hidden));
        await api("PUT", "/api/presets/night", { hidden: false });
        assert.equal((await api("PUT", "/api/presets/night", { label: "Mine" })).status, 409, "a built-in cannot be renamed");
        assert.equal((await api("DELETE", "/api/presets/night")).status, 409, "a built-in cannot be deleted");
        assert.equal((await api("DELETE", "/api/presets/my-living-room")).status, 200);
        assert.equal((await player()).settings.preset, null, "the deleted preset is no longer in use");
        assert.equal((await api("DELETE", "/api/presets/my-living-room")).status, 404);
        await api("PATCH", "/api/player/settings", { clock: false, captions: null, overlayStyle: 0, transition: "fade" });
    });
    await ok("settings: clock and captions are checked against the catalog", async () => {
        for (const bad of [{ clockStyle: { face: "sundial" } }, { clockStyle: { opacity: 5 } }, { transition: "wipe" },
            { captions: { items: [{ id: "a", field: "mood", format: "x", corner: "top-left", size: "s", font: "sans" }] } },
            { captions: { items: [{ id: "a", field: "date", format: "ago", corner: "center", size: "s", font: "sans" }] } }]) {
            assert.equal((await api("PATCH", "/api/player/settings", bad)).status, 400, JSON.stringify(bad));
        }
    });
    await ok("settings: surpriseSkip is checked, keeps at least one, and survives a preset (B42)", async () => {
        const real = (await api("GET", "/api/presets")).body.catalog.transitions.map((t) => t.name).filter((t) => t !== "random");
        assert.ok(real.includes("shatter") && real.includes("cube") && real.length >= 18, "the showpiece transitions are in the catalog");
        for (const bad of [{ surpriseSkip: "glitch" }, { surpriseSkip: ["random"] }, { surpriseSkip: ["wipe"] }, { surpriseSkip: real }]) {
            assert.equal((await api("PATCH", "/api/player/settings", bad)).status, 400, JSON.stringify(bad));
        }
        assert.equal((await api("PATCH", "/api/player/settings", { surpriseSkip: ["glitch", "vortex", "glitch"] })).status, 200);
        assert.deepEqual((await player()).settings.surpriseSkip, ["vortex", "glitch"], "in catalog order, once each");
        assert.equal((await api("POST", "/api/player/preset", { name: "ambient" })).status, 200);
        assert.deepEqual((await player()).settings.surpriseSkip, ["vortex", "glitch"], "a preset keeps the owner's choice");
        await api("PATCH", "/api/player/settings", { surpriseSkip: [] });
    });
    await ok("the phone's galleries and covers: rated photos with thumbnails; every cover is a known photo", async () => {
        const counts = (await api("GET", "/api/ratings")).body;
        const fav = (await api("GET", "/api/ratings/photos?kind=favourites")).body;
        assert.equal(fav.total, counts.favourites);
        assert.equal(fav.photos.length, counts.favourites);
        if (fav.photos.length) assert.equal((await api("GET", fav.photos[0].thumb)).status, 200);
        assert.equal((await api("GET", "/api/ratings/photos?kind=everything")).status, 400);
        const covers = (await api("GET", "/api/browse/covers")).body.covers;
        assert.ok(covers.all && covers["y:2021"] && covers["c:IT"] && covers["f:2021.05 - Noosa"]);
        assert.ok((await player()).build, "the view says which page version is current");
    });
    await ok("map points from the catalogue", async () => {
        const m = (await api("GET", "/api/map/points")).body;
        assert.equal(m.points.reduce((a, p) => a + p[2], 0), 20); // Noosa 12 + Cinque Terre 8
        await api("POST", "/api/player/source", { source: { box: [44, 9, 45, 10], label: "map" } });
        await ready(8, "map");
    });

    // ---------- fallback (R21) ----------
    await ok("viewer picapport: the kiosk opens Picapport's own slideshow page, and back", async () => {
        await api("POST", "/api/slideshow", { query: "noosa", label: "Noosa", sort: "random", interval: 20 });
        await ready(10, "Noosa");
        const n = launchCount();
        await api("PATCH", "/api/player/settings", { viewer: "picapport" });
        await until(async () => launchCount() === n + 1, "the kiosk relaunch");
        await until(async () => /Spawning Chromium at: http:\/\/localhost:18080\/picapport#slideshow\?sort=random&autostart=true&viewtime=20&query=noosa/.test(out), "Picapport's URL in the log");
        await api("PATCH", "/api/player/settings", { viewer: "layer" });
        await until(async () => launchCount() === n + 2, "the kiosk back on /show");
    });

    // ---------- the rest of the older API ----------
    await ok("words: created from the template, validated, saved", async () => {
        const g = await api("GET", "/api/words");
        assert.deepEqual(g.body.words, {});
        assert.equal((await api("PUT", "/api/words", { words: { us: { query: "x" } } })).status, 400);
        assert.equal((await api("PUT", "/api/words", { words: { us: { means: "a", query: "a*" } } })).status, 400);
        const p = await api("PUT", "/api/words", { words: { us: { means: "the two of us", query: "alpha beta" } } });
        assert.equal(p.status, 200);
        assert.equal(p.body.words.us.query, "alpha beta");
    });
    await ok("vocabulary: 404 until built, then served", async () => {
        assert.equal((await api("GET", "/api/vocabulary")).status, 404);
        fs.writeFileSync(path.join(state, "vocabulary.json"), JSON.stringify({ keywords: [{ word: "cooking", photos: 297 }] }));
        assert.equal((await api("GET", "/api/vocabulary")).body.keywords[0].word, "cooking");
    });
    await ok("screen: errors are reported, not fatal", async () => {
        const r = await api("GET", "/api/screen");
        assert.equal(r.status, 200);
        assert.equal(r.body.on, null);
        assert.equal(r.body.wantedOff, false);
        assert.ok(r.body.error);
        assert.equal((await api("POST", "/api/screen", { on: "no" })).status, 400);
        assert.equal((await api("POST", "/api/screen", { on: false, minutes: 0 })).status, 400);
    });
    await ok("the page is served at /show", async () => {
        const r = await fetch(`http://localhost:${API_PORT}/show`);
        assert.equal(r.status, 200);
        assert.match(await r.text(), /<html/);
    });
    await ok("unknown route is JSON 404", async () => {
        assert.equal((await api("GET", "/api/nope")).status, 404);
    });

    await stopApi();
    pic.close();
    if (process.exitCode) console.log(out.split("\n").slice(-40).join("\n"));
    fs.rmSync(state, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
