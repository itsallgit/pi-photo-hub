// run.js - headless browser tests of the slideshow page (/show), dev-only, on the PC. Starts the
// fake Picapport and the photo API (temporary state), then drives the PC's Chrome (or Edge) with
// puppeteer-core. Screenshots go to tools/browser-test/shots/ for review.
//   cd tools/browser-test && npm install && node run.js [--only <text>] [--headful]
// Against the real Pi instead (a second viewer in lockstep with the shelf): node run.js --pi http://pi.local:3000
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const assert = require("assert");
const puppeteer = require("puppeteer-core");
const fake = require("../../api/test/fake-picapport");

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const piUrl = args.includes("--pi") ? args[args.indexOf("--pi") + 1] : null;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const PIC_PORT = 18081, API_PORT = 13001;
const BASE = piUrl || `http://localhost:${API_PORT}`;
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 10000) {
    const end = Date.now() + ms;
    for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(100); }
}
async function api(method, p, body) {
    const r = await fetch(BASE + p, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
}

let apiProc, pic, state, out = "";
async function startStack() {
    pic = await fake.start(PIC_PORT);
    state = fs.mkdtempSync(path.join(os.tmpdir(), "photo-api-browser-"));
    fs.writeFileSync(path.join(state, "catalogue.json"), JSON.stringify(fake.catalogue(pic.library)));
    // start with the honeymoon folder, 20 s, as a saved slideshow
    fs.writeFileSync(path.join(state, "slideshow.json"), JSON.stringify({ query: "honeymoon", label: "Honeymoon", sort: "random", interval: 20 }));
    const node = JSON.stringify(process.execPath);
    apiProc = spawn(process.execPath, [path.join(__dirname, "..", "..", "api", "server.js")], {
        env: { ...process.env, PORT: String(API_PORT), STATE_DIRECTORY: state, CACHE_DIRECTORY: path.join(state, "cache"), PHOTO_API_LOG_DIR: path.join(state, "log"),
            PICAPPORT_URL: `http://localhost:${PIC_PORT}`, CHROMIUM_BIN: process.execPath, BROWSER_CHECK_CMD: `${node} -e "process.exit(0)"`, BROWSER_KILL_CMD: `${node} -e "0"`,
            WLR_RANDR_BIN: path.join(state, "none"), CHROMIUM_FLAGS_EXTRA: "" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    apiProc.stdout.on("data", (d) => (out += d));
    apiProc.stderr.on("data", (d) => (out += d));
    await until(async () => { try { return (await api("GET", "/api/player")).status === "playing"; } catch { return false; } }, "the API playing");
}

async function main() {
    if (!CHROME) throw new Error("no Chrome or Edge found");
    if (!piUrl) await startStack();
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: !args.includes("--headful"), args: ["--autoplay-policy=no-user-gesture-required"] });
    const errors = [];
    async function open(url, viewport, name) {
        const page = await browser.newPage();
        await page.setViewport(viewport);
        page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
        page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
        await page.goto(BASE + url, { waitUntil: "load" });
        return page;
    }
    const shownId = (page) => page.evaluate(() => { const s = document.querySelector("#stage .slide:last-child"); return s ? s.dataset.id : null; });
    const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    let fails = 0;
    const ok = async (name, fn) => {
        if (only && !name.includes(only)) return;
        try { await fn(); console.log(`ok   ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); }
    };

    if (piUrl) {
        // A second viewer against the real Pi: the same photo as the Pi's player, in step.
        await ok("pi: a second viewer shows the Pi's current photo and follows next", async () => {
            const page = await open("/show", { width: 1280, height: 720 }, "pi-viewer");
            await until(async () => (await shownId(page)) === (await api("GET", "/api/player")).current.id, "the current photo", 20000);
            const r = await api("POST", "/api/player/next");
            const t0 = Date.now();
            await until(async () => (await shownId(page)) === r.current.id, "the next photo", 20000);
            console.log(`     next photo on the second viewer after ${Date.now() - t0} ms`);
            await sleep(2000);
            await shot(page, "pi-second-viewer");
        });
        await browser.close();
        process.exit(fails ? 1 : 0);
    }

    const shelf = await open("/show?kiosk=1", { width: 1920, height: 1080 }, "shelf");
    await ok("the shelf page shows the current photo", async () => {
        const v = await api("GET", "/api/player");
        await until(async () => (await shownId(shelf)) === v.current.id, "the current photo on the shelf");
        await sleep(1700);
        await shot(shelf, "shelf-first");
    });
    const phone = await open("/show", { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 }, "phone");
    await ok("lockstep: next reaches the shelf and the phone", async () => {
        await until(async () => (await shownId(phone)) === (await shownId(shelf)), "the phone on the same photo");
        const r = await api("POST", "/api/player/next");
        const t0 = Date.now();
        await until(async () => (await shownId(shelf)) === r.current.id && (await shownId(phone)) === r.current.id, "both on the next photo", 5000);
        console.log(`     both viewers on the next photo after ${Date.now() - t0} ms`);
    });
    await ok("upright photos get the blurred fill; 16:9 photos do not", async () => {
        await api("POST", "/api/player/source", { source: { query: "cinque", label: "Cinque Terre" }, settings: { order: "date-asc", titleCards: false } });
        await until(async () => (await api("GET", "/api/player")).source.label === "Cinque Terre", "the new slideshow");
        await api("POST", "/api/player/jump", { position: 0 }); // c01: landscape 16:9
        await until(async () => (await shownId(shelf)) === (await api("GET", "/api/player")).current.id, "c01");
        await sleep(1700);
        assert.equal(await shelf.evaluate(() => document.querySelectorAll("#stage .slide:last-child .fill").length), 0);
        const r = await api("POST", "/api/player/next"); // c02: upright
        await until(async () => (await shownId(shelf)) === r.current.id, "c02");
        await sleep(1700);
        assert.equal(await shelf.evaluate(() => document.querySelectorAll("#stage .slide:last-child .fill").length), 1);
        await shot(shelf, "shelf-upright-fill");
    });
    await ok("overlay: relative date and place, then each style", async () => {
        await api("PATCH", "/api/player/settings", { overlay: { date: "relative", place: true, event: true, people: false }, overlayStyle: 0 });
        await until(async () => /ago/.test(await shelf.evaluate(() => document.getElementById("overlay").textContent)), "a relative date");
        const txt = await shelf.evaluate(() => document.getElementById("overlay").innerText);
        assert.match(txt, /Vernazza, Italy/);
        assert.match(txt, /Honeymoon › Cinque Terre/);
        for (let i = 0; i < 5; i++) {
            await api("PATCH", "/api/player/settings", { overlayStyle: i });
            await sleep(300);
            const cls = await shelf.evaluate(() => document.getElementById("overlay").className);
            if (i === 4) assert.match(cls, /hidden/); else assert.doesNotMatch(cls, /hidden/);
            await shot(shelf, `shelf-overlay-style-${i}`);
        }
        await api("PATCH", "/api/player/settings", { overlay: { date: "absolute" }, overlayStyle: 1 });
        await until(async () => /September 2026/.test(await shelf.evaluate(() => document.getElementById("overlay").textContent)), "an absolute date");
    });
    await ok("title card at the start of an event (Present preset)", async () => {
        await api("POST", "/api/player/preset", { name: "present" });
        await api("POST", "/api/player/jump", { position: 0 });
        await until(async () => shelf.evaluate(() => !document.getElementById("card").classList.contains("hidden")), "the card");
        const t = await shelf.evaluate(() => document.querySelector("#card .card-title").textContent);
        assert.equal(t, "Honeymoon › Cinque Terre");
        await sleep(400);
        await shot(shelf, "shelf-title-card");
        await until(async () => shelf.evaluate(() => document.getElementById("card").classList.contains("hidden")), "the card to go", 8000);
        await shot(shelf, "shelf-present");
    });
    await ok("clock and night look", async () => {
        await api("PATCH", "/api/player/settings", { clock: true, night: true });
        await until(async () => shelf.evaluate(() => document.body.classList.contains("night") && !document.getElementById("clock").classList.contains("hidden")), "night and clock");
        await sleep(2200);
        await shot(shelf, "shelf-night-clock");
        await api("PATCH", "/api/player/settings", { clock: false, night: false });
    });
    await ok("motion runs, placed by the elapsed time; paused motion stops", async () => {
        await api("POST", "/api/player/preset", { name: "guests" });
        await api("POST", "/api/player/next");
        await sleep(2500);
        const a = await shelf.evaluate(() => { const s = document.querySelector("#stage .slide:last-child"); return s._anim ? [s._anim.playState, s._anim.currentTime] : null; });
        assert.ok(a && a[0] === "running" && a[1] > 1000);
        await api("POST", "/api/player/pause");
        await sleep(500);
        const b = await shelf.evaluate(() => document.querySelector("#stage .slide:last-child")._anim.playState);
        assert.equal(b, "paused");
        assert.equal(await shelf.evaluate(() => !document.getElementById("pausemark").classList.contains("hidden")), true);
        await api("POST", "/api/player/play");
    });
    await ok("each transition", async () => {
        await shelf.bringToFront();
        for (const tr of ["slide", "zoom", "dip", "fade"]) {
            await api("PATCH", "/api/player/settings", { transition: tr });
            const r = await api("POST", "/api/player/next");
            await until(async () => (await shownId(shelf)) === r.current.id, `next with ${tr}`);
            await sleep(500);
            await shot(shelf, `shelf-transition-${tr}`);
            await sleep(1500);
            const n = await shelf.evaluate(() => document.querySelectorAll("#stage .slide").length);
            assert.equal(n, 1, `${tr}: ${n} slides 2 s after the move`);
        }
    });
    await ok("a viewer that joins late is in step (motion placed by elapsed time)", async () => {
        await api("PATCH", "/api/player/settings", { motion: "subtle" });
        await sleep(3000);
        const late = await open("/show?kiosk=1", { width: 960, height: 540 }, "late");
        await until(async () => (await shownId(late)) === (await shownId(shelf)), "the late viewer on the same photo");
        await sleep(300);
        const [ta, tb] = await Promise.all([shelf, late].map((p) => p.evaluate(() => document.querySelector("#stage .slide:last-child")._anim.currentTime)));
        assert.ok(Math.abs(ta - tb) < 1200, `motion times ${ta} and ${tb}`);
        await late.close();
    });
    await ok("preparing a slideshow shows progress; the old one keeps playing", async () => {
        pic.delayMs = 0;
        await api("POST", "/api/player/source", { source: { query: "noosa" } });
        await until(async () => (await api("GET", "/api/player")).source.query === "noosa", "noosa");
        await shot(shelf, "shelf-after-new-source");
    });
    await ok("no errors in the page consoles", async () => {
        assert.deepEqual(errors, []);
    });

    await browser.close();
    apiProc.kill();
    pic.close();
    if (fails) console.log(out.split("\n").slice(-30).join("\n"));
    fs.rmSync(state, { recursive: true, force: true });
    process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); try { apiProc && apiProc.kill(); } catch { /* */ } process.exit(1); });
