// smoke.js - test the photo API away from the Pi: a fake Picapport, stub browser commands, a
// temporary state directory. Run: node api/test/smoke.js (after npm install in api/).
// It tests the API logic only; the screen (wlr-randr), Chromium and real Picapport are tested on the Pi.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const assert = require("assert");

const PIC_PORT = 18080;
const API_PORT = 13000;
const counts = { noosa: 1916, honeymoon: 11807, "noosa OR croatia": 4400 };
const seen = [];

const fake = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/picapport") return res.end("ok");
    if (u.pathname === "/picapport_json" && u.searchParams.get("cmd") === "RunQuery") {
        const q = u.searchParams.get("query");
        seen.push(q);
        if (q.includes("*")) { res.statusCode = 500; return res.end("error"); }
        const n = counts[q] || 0;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify(n ? { status: "OK", numPhotos: n, vid: 1 } : { status: "NORESULT", numPhotos: 0 }));
    }
    res.statusCode = 404;
    res.end();
});

const state = fs.mkdtempSync(path.join(os.tmpdir(), "photo-api-test-"));
const launches = path.join(state, "launches.log");
const node = JSON.stringify(process.execPath);
const env = {
    ...process.env,
    PORT: String(API_PORT),
    STATE_DIRECTORY: state,
    PHOTO_API_LOG_DIR: path.join(state, "log"),
    PICAPPORT_URL: `http://localhost:${PIC_PORT}`,
    CHROMIUM_BIN: process.execPath, // "launches" node with the URL as an argument: harmless
    BROWSER_CHECK_CMD: `${node} -e "process.exit(require('fs').existsSync(process.argv[1])?0:1)" ${JSON.stringify(launches)}`,
    BROWSER_KILL_CMD: `${node} -e "require('fs').appendFileSync(process.argv[1],'launch\\n')" ${JSON.stringify(launches)}`,
    WLR_RANDR_BIN: path.join(state, "no-wlr-randr"), // screen calls fail and are reported, not fatal
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

async function main() {
    await new Promise((r) => fake.listen(PIC_PORT, r));
    // An old-format saved slideshow, as on the Pi before this version.
    fs.writeFileSync(path.join(state, "slideshow_url.txt"),
        "http://localhost:8080/picapport#slideshow?sort=random&autostart=true&viewtime=20&query=honeymoon");
    const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    server.stdout.on("data", (d) => (out += d));
    server.stderr.on("data", (d) => (out += d));
    for (let i = 0; i < 50; i++) {
        try { await api("GET", "/api/test"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const ok = (name, fn) => fn().then(() => console.log(`ok   ${name}`)).catch((e) => { console.log(`FAIL ${name}: ${e.message}`); process.exitCode = 1; });

    await ok("status reads the old saved slideshow", async () => {
        const r = await api("GET", "/api/status");
        assert.equal(r.status, 200);
        assert.deepEqual([r.body.slideshow.query, r.body.slideshow.sort, r.body.slideshow.interval], ["honeymoon", "random", 20]);
        assert.equal(r.body.picapportUp, true);
    });
    await ok("count several queries", async () => {
        const r = await api("GET", `/api/count?q=noosa&q=${encodeURIComponent("noosa OR croatia")}&q=zzz`);
        assert.deepEqual(r.body.results.map((x) => x.count), [1916, 4400, 0]);
    });
    await ok("'*' is refused before Picapport", async () => {
        const before = seen.length;
        const r = await api("GET", "/api/count?q=wed*");
        assert.match(r.body.results[0].error, /not supported/);
        assert.equal(seen.length, before);
    });
    await ok("POST with no matches does not play", async () => {
        const n = launchCount();
        const r = await api("POST", "/api/slideshow", { query: "zzz" });
        assert.equal(r.status, 422);
        assert.equal(launchCount(), n);
    });
    await ok("POST plays, keeps interval, saves both files", async () => {
        const r = await api("POST", "/api/slideshow", { query: "noosa", label: "Noosa" });
        assert.equal(r.status, 200);
        assert.equal(r.body.relaunched, true);
        assert.equal(r.body.count, 1916);
        assert.equal(r.body.slideshow.interval, 20);
        const saved = JSON.parse(fs.readFileSync(path.join(state, "slideshow.json"), "utf8"));
        assert.equal(saved.query, "noosa");
        assert.match(fs.readFileSync(path.join(state, "slideshow_url.txt"), "utf8"), /query=noosa/);
    });
    await ok("same slideshow while running is not relaunched", async () => {
        const n = launchCount();
        const r = await api("POST", "/api/slideshow", { query: "noosa" });
        assert.equal(r.body.relaunched, false);
        assert.equal(launchCount(), n);
    });
    await ok("restart:true relaunches", async () => {
        const n = launchCount();
        await api("POST", "/api/slideshow", { query: "noosa", restart: true });
        assert.equal(launchCount(), n + 1);
    });
    await ok("PATCH changes only the interval", async () => {
        const r = await api("PATCH", "/api/slideshow", { interval: 30 });
        assert.equal(r.status, 200);
        assert.deepEqual([r.body.slideshow.query, r.body.slideshow.interval, r.body.slideshow.sort], ["noosa", 30, "random"]);
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
    await ok("old GET without parameters replays", async () => {
        const n = launchCount();
        const r = await api("GET", "/api/slideshow");
        assert.match(r.body, /query=noosa/);
        assert.equal(launchCount(), n + 1);
    });
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
    await ok("unknown route is JSON 404", async () => {
        assert.equal((await api("GET", "/api/nope")).status, 404);
    });

    server.kill();
    fake.close();
    if (process.exitCode) console.log(out.split("\n").slice(-30).join("\n"));
    fs.rmSync(state, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
