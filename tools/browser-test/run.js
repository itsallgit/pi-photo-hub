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
    fs.writeFileSync(path.join(state, "vocabulary.json"), JSON.stringify({
        keywords: [{ word: "Cooking", photos: 3, searchable: true }], people: [{ word: "Alex", photos: 1, searchable: true }],
        folders: ["2021.05 - Noosa", "2026.09 - 2026.10 - Honeymoon", "2026.09 - 2026.10 - Honeymoon/01 Singapore", "2026.09 - 2026.10 - Honeymoon/02 Cinque Terre", "_Friends"]
            .map((f) => ({ path: f, query: `dirall:"${fake.ROOT}/${f}"`, photos: 5 })),
        places: [{ country: "Italy", cc: "IT", key: "IT", photos: 8, cities: [{ city: "La Spezia", key: "IT/La Spezia", photos: 8 }] },
            { country: "Australia", cc: "AU", key: "AU", photos: 12, cities: [{ city: "Noosa Heads", key: "AU/Noosa Heads", photos: 12 }] }],
        years: { 2018: 4, 2021: 12, 2026: 18 } }));
    // start with the honeymoon folder, 20 s, as a saved slideshow
    fs.writeFileSync(path.join(state, "slideshow.json"), JSON.stringify({ query: "honeymoon", label: "Honeymoon", sort: "random", interval: 20 }));
    const node = JSON.stringify(process.execPath);
    apiProc = spawn(process.execPath, [path.join(__dirname, "..", "..", "api", "server.js")], {
        env: { ...process.env, PORT: String(API_PORT), STATE_DIRECTORY: state, CACHE_DIRECTORY: path.join(state, "cache"), PHOTO_API_LOG_DIR: path.join(state, "log"),
            PICAPPORT_URL: `http://localhost:${PIC_PORT}`, CHROMIUM_BIN: process.execPath, BROWSER_CHECK_CMD: `${node} -e "process.exit(0)"`, BROWSER_KILL_CMD: `${node} -e "0"`,
            WLR_RANDR_BIN: path.join(state, "none"), CHROMIUM_FLAGS_EXTRA: "", PHOTO_METADATA_STATUS_TTL_MS: "0", FAKE_METADATA_DIR: state,
            PHOTO_METADATA_CMD: JSON.stringify([process.execPath, path.join(__dirname, "..", "..", "api", "test", "fake-metadata-writer.js")]) },
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
    const notFound = [];
    async function open(url, viewport, name) {
        const page = await browser.newPage();
        await page.setViewport(viewport);
        page.on("console", (m) => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); if (process.env.DEBUG_PAGE) console.log(`[${name}] ${m.text()}`); });
        page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
        page.on("response", (r) => { if (r.status() >= 400) notFound.push(`${name}: ${r.status()} ${r.url()}`); });
        await page.goto(BASE + url, { waitUntil: "load" });
        return page;
    }
    const shownId = (page) => page.evaluate(() => { const s = document.querySelector("#stage .slide:last-child"); return s ? s.dataset.id : null; });
    const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    let fails = 0;
    const ok = async (name, fn) => {
        if (only && !name.includes(only) && !name.includes("shelf page")) return;
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
        await ok("pi: the phone page: tap, full screen, next from the phone moves the shelf, map loads (tiles stubbed)", async () => {
            const phone = await open("/show", { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 }, "pi-phone");
            await phone.setRequestInterception(true);
            phone.on("request", (r) => (r.url().includes("tile.openstreetmap.org") ? r.respond({ status: 200, contentType: "image/png", body: fake.png(8, 8, [200, 210, 220]) }) : r.continue()));
            await until(async () => (await shownId(phone)) === (await api("GET", "/api/player")).current.id, "the phone on the current photo", 20000);
            await phone.mouse.click(206, 300);
            await until(() => phone.evaluate(() => !document.getElementById("controls").classList.contains("hidden")), "controls");
            assert.equal(await phone.evaluate(() => !!document.fullscreenElement), true);
            const p0 = (await api("GET", "/api/player")).position;
            await phone.evaluate(() => document.querySelector('#controls button[aria-label="Next"]').click());
            const v = await until(async () => { const x = await api("GET", "/api/player"); return x.position !== p0 ? x : null; }, "the Pi moved on");
            await until(async () => (await shownId(phone)) === v.current.id, "the phone on the new photo", 20000);
            const status = await api("GET", "/api/status");
            assert.ok(status.viewers.some((x) => x.role === "shelf"), "the shelf viewer is connected");
            await sleep(1500);
            await shot(phone, "pi-phone-controls");
            await phone.evaluate(() => [...document.querySelectorAll("#controls button")].find((b) => b.getAttribute("aria-label") === "Browse").click());
            await until(() => phone.evaluate(() => document.querySelectorAll("#controls .list button").length > 10), "the browse list from the real vocabulary", 15000);
            await shot(phone, "pi-phone-browse");
            await phone.evaluate(() => [...document.querySelectorAll("#controls .tabs button")].find((b) => b.textContent === "Map").click());
            await until(() => phone.evaluate(() => !!window.L && /photos here/.test((document.querySelector("#controls .play-row .count") || {}).textContent || "")), "the map", 20000);
            await sleep(800);
            await shot(phone, "pi-phone-map");
            console.log(`     map: ${await phone.evaluate(() => document.querySelector("#controls .play-row .count").textContent)}`);
            await phone.close();
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
    const slideCount = (page) => page.evaluate(() => document.querySelectorAll("#stage .slide").length);
    await ok("next and back snap with no transition, on the shelf and the phone", async () => {
        await shelf.bringToFront();
        await api("PATCH", "/api/player/settings", { transition: "fade", interval: 60 });
        await sleep(1700);
        for (const move of ["next", "back"]) {
            const r = await api("POST", `/api/player/${move}`);
            assert.equal(r.manualMove, true);
            for (const page of [shelf, phone]) {
                await until(async () => (await shownId(page)) === r.current.id, `${move} on the viewer`);
                assert.equal(await slideCount(page), 1, `${move}: the old photo is gone at once`);
            }
            assert.equal((await api("GET", "/api/player")).playing, true, "autoplay keeps running");
        }
    });
    await ok("autoplay still uses each transition, also straight after a manual move", async () => {
        await shelf.bringToFront();
        await api("PATCH", "/api/player/settings", { interval: 3 });
        for (const tr of ["slide", "zoom", "dip", "fade"]) {
            await api("PATCH", "/api/player/settings", { transition: tr });
            const manual = await api("POST", "/api/player/next");
            await until(async () => (await shownId(shelf)) === manual.current.id, `next before ${tr}`);
            const auto = await until(async () => { const v = await api("GET", "/api/player"); return v.position !== manual.position ? v : null; }, `autoplay with ${tr}`);
            assert.equal(auto.manualMove, false);
            await until(async () => (await shownId(shelf)) === auto.current.id, `the photo after ${tr}`);
            assert.equal(await slideCount(shelf), 2, `${tr}: both photos during the transition`);
            await sleep(500);
            await shot(shelf, `shelf-transition-${tr}`);
            await until(async () => (await slideCount(shelf)) === 1, `${tr} to finish`, 2500);
        }
        await api("PATCH", "/api/player/settings", { interval: 40, transition: "fade" });
        await api("POST", "/api/player/next"); // a photo's motion is timed when it appears (backlog B39)
    });
    await ok("toast: the knob's speed and a star from a button; other controls show none", async () => {
        const toast = (page) => page.evaluate(() => { const t = document.getElementById("toast"); return t.classList.contains("show") ? t.textContent : null; });
        await until(async () => (await toast(shelf)) === null, "no toast yet", 4000);
        await api("POST", "/api/player/nudge", { setting: "interval", by: 1 });
        await until(async () => (await toast(shelf)) === "Slower: 60 seconds per photo", "the slower toast", 3000);
        await until(async () => (await toast(phone)) === "Slower: 60 seconds per photo", "the toast on the phone", 3000);
        await sleep(300);
        await shot(shelf, "shelf-toast");
        await api("POST", "/api/player/nudge", { setting: "interval", by: -1 });
        await until(async () => (await toast(shelf)) === "Faster: 40 seconds per photo", "the faster toast", 3000);
        await until(async () => (await toast(shelf)) === null, "the toast to go", 4000);
        await api("POST", "/api/player/toggle");
        await api("POST", "/api/player/toggle");
        await api("POST", "/api/player/nudge", { setting: "overlayStyle" });
        await sleep(300);
        assert.equal(await toast(shelf), null, "pause and overlay style show no toast");
        const star = () => shelf.evaluate(() => { const s = document.getElementById("starmark"); return !s.classList.contains("hidden") && getComputedStyle(s).opacity !== "0"; });
        assert.equal(await star(), false);
        await api("POST", "/api/photo/toggle", { what: "favourite" });
        await until(async () => (await toast(shelf)) === "★ Starred", "the star toast", 3000);
        await until(async () => (await toast(shelf)) === null, "the star toast to go", 4000);
        await until(star, "the gold star on the starred photo", 1500);
        await shot(shelf, "shelf-starred");
        await api("POST", "/api/photo/toggle", { what: "favourite" });
        await until(async () => (await toast(shelf)) === "☆ Star removed", "the unstar toast", 3000);
        await until(async () => !(await shelf.evaluate(() => !document.getElementById("starmark").classList.contains("hidden"))), "the gold star to go", 1500);
        await until(async () => (await toast(shelf)) === null, "the unstar toast to go", 4000);
        const later = await open("/show?kiosk=1", { width: 960, height: 540 }, "later-toast");
        await until(async () => (await shownId(later)) === (await shownId(shelf)), "the later viewer");
        assert.equal(await toast(later), null, "a viewer that connects later shows no old toast");
        await later.close();
        await shelf.bringToFront(); // closing a tab can leave the shelf in the background, where its motion stops
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
    // ---------- the phone page (M4) ----------
    await phone.bringToFront();
    const tapCentre = async (page) => { const v = page.viewport(); await page.mouse.click(v.width / 2, v.height / 3); };
    const visibleControls = (page) => page.evaluate(() => !document.getElementById("controls").classList.contains("hidden"));
    const showControls = async (page) => { if (!(await visibleControls(page))) await tapCentre(page); await until(() => visibleControls(page), "the controls"); };
    const clickText = (page, sel, re) => page.evaluate((sel, src) => { const r = new RegExp(src); const all = [...document.querySelectorAll(sel)]; const b = all.find((x) => r.test(x.textContent)); if (!b) throw new Error(`no ${src} in ${sel}: ${all.map((x) => x.textContent).join(" | ").slice(0, 400)}`); b.click(); }, sel, re.source);
    const clickLabel = (page, label) => page.evaluate((l) => { const b = [...document.querySelectorAll("#controls button")].find((x) => x.getAttribute("aria-label") === l || x.textContent.trim() === l); if (!b) throw new Error(`no button ${l}`); b.click(); }, label);
    await ok("phone: a tap shows the controls and asks for full screen", async () => {
        await api("POST", "/api/player/source", { source: { query: "honeymoon", label: "Honeymoon" }, preset: "ambient" });
        await until(async () => (await api("GET", "/api/player")).source.label === "Honeymoon", "honeymoon");
        assert.equal(await visibleControls(phone), false);
        await tapCentre(phone);
        await until(() => visibleControls(phone), "the controls");
        assert.equal(await phone.evaluate(() => !!document.fullscreenElement), true);
        await sleep(800);
        await shot(phone, "phone-controls");
    });
    await ok("phone: swipe left is next, swipe right is back", async () => {
        await phone.evaluate(() => { window.SHOW_DEBUG = 1; });
        const before = (await api("GET", "/api/player")).position;
        const swipe = async (from, to) => { const t = phone.touchscreen; await t.touchStart(from, 400); await t.touchMove((from + to) / 2, 405); await t.touchMove(to, 410); await t.touchEnd(); };
        await swipe(350, 60);
        await until(async () => (await api("GET", "/api/player")).position === before + 1, "next after a swipe");
        await swipe(60, 350);
        await until(async () => (await api("GET", "/api/player")).position === before, "back after a swipe");
    });
    await ok("phone: pause, next and back buttons", async () => {
        await showControls(phone);
        await clickLabel(phone, "Pause");
        await until(async () => (await api("GET", "/api/player")).paused, "paused");
        await clickLabel(phone, "Play");
        await until(async () => !(await api("GET", "/api/player")).paused, "playing");
        const p = (await api("GET", "/api/player")).position;
        await clickLabel(phone, "Next");
        await until(async () => (await api("GET", "/api/player")).position === p + 1, "next");
    });
    await ok("phone: search: pick two words with OR, see the count, play", async () => {
        await showControls(phone);
        await clickLabel(phone, "Search");
        await phone.waitForSelector("#controls input[type=search]");
        await phone.type("#controls input[type=search]", "in cinq");
        await until(() => phone.evaluate(() => document.querySelectorAll("#controls .suggest button").length > 0), "suggestions");
        await phone.evaluate(() => document.querySelector("#controls .suggest button").click());
        await phone.type("#controls input[type=search]", "noosa");
        await until(() => phone.evaluate(() => [...document.querySelectorAll("#controls .suggest button")].some((b) => /folder/.test(b.textContent))), "suggestions 2");
        await phone.evaluate(() => [...document.querySelectorAll("#controls .suggest button")].find((b) => /folder/.test(b.textContent)).click());
        await phone.evaluate(() => document.querySelector("#controls .picked .op").click()); // and -> or
        await until(() => phone.evaluate(() => /photos/.test(document.querySelector("#controls .play-row .count").textContent)), "a count");
        await shot(phone, "phone-search");
        const count = await phone.evaluate(() => document.querySelector("#controls .play-row .count").textContent);
        assert.equal(count, "20 photos");
        await clickLabel(phone, "Play");
        const v = await until(async () => { const x = await api("GET", "/api/player"); return x.source.label === "02 Cinque Terre or 2021.05 - Noosa" ? x : null; }, "the picked slideshow");
        assert.match(v.source.query, /dirall:".*Cinque Terre" OR dirall:".*Noosa"/);
    });
    await ok("phone: browse places: country, then city, play", async () => {
        await showControls(phone);
        await clickLabel(phone, "Browse");
        await until(() => phone.evaluate(() => document.querySelectorAll("#controls .list button").length > 3), "the browse list");
        await clickText(phone, "#controls .list button", /Italy/);
        await clickText(phone, "#controls .list .sub button", /La Spezia/);
        await until(async () => (await api("GET", "/api/player")).source.label === "La Spezia", "La Spezia playing");
    });
    await ok("phone: browse folders and years", async () => {
        await showControls(phone);
        await clickLabel(phone, "Browse");
        await until(() => phone.evaluate(() => document.querySelectorAll("#controls .list button").length > 3), "the browse list");
        await clickText(phone, "#controls .list button", /Honeymoon/);
        await shot(phone, "phone-browse");
        await clickText(phone, "#controls .list .sub button", /Singapore/);
        await until(async () => (await api("GET", "/api/player")).source.label === "01 Singapore", "Singapore playing");
        await showControls(phone);
        await clickLabel(phone, "Browse");
        await until(() => phone.evaluate(() => document.querySelectorAll("#controls .list button").length > 3), "the browse list");
        await clickText(phone, "#controls .years button", /2018/);
        await until(async () => (await api("GET", "/api/player")).source.label === "2018", "2018 playing");
    });
    await ok("phone: settings: a preset and a setting", async () => {
        await showControls(phone);
        await clickLabel(phone, "Settings");
        await clickLabel(phone, "Present");
        await until(async () => (await api("GET", "/api/player")).settings.preset === "present", "present");
        await phone.evaluate(() => [...document.querySelectorAll("#controls .row")].find((r) => /Motion/.test(r.textContent)).querySelectorAll("button")[2].click());
        await until(async () => (await api("GET", "/api/player")).settings.motion === "lively", "lively");
        await shot(phone, "phone-settings");
        await clickLabel(phone, "Close");
    });
    await ok("phone: star a photo and remove the star", async () => {
        await api("POST", "/api/player/source", { source: { query: "honeymoon", label: "Honeymoon" }, preset: "ambient" });
        await until(async () => (await api("GET", "/api/player")).source.label === "Honeymoon", "honeymoon");
        await until(async () => (await shownId(phone)) === (await api("GET", "/api/player")).current.id, "the phone on the photo");
        await showControls(phone);
        const lit = () => phone.evaluate(() => document.querySelector("#controls button[aria-label=Star]").classList.contains("on"));
        assert.equal(await lit(), false);
        await clickLabel(phone, "Star");
        await until(lit, "the star lit");
        assert.equal((await api("GET", "/api/player")).current.info.favourite, true);
        await showControls(phone);
        await clickLabel(phone, "Star");
        await until(async () => !(await lit()), "the star off");
    });
    await ok("phone: skip a photo, find it under Skipped photos, bring it back", async () => {
        await api("PATCH", "/api/player/settings", { interval: 60 });
        await showControls(phone);
        const v = await api("GET", "/api/player");
        await clickLabel(phone, "Skip this photo");
        await until(async () => (await api("GET", "/api/ratings")).skipped === 1, "the photo skipped");
        const after = await api("GET", "/api/player");
        assert.notEqual(after.current.id, v.current.id);
        assert.equal(after.count, v.count - 1);
        await showControls(phone);
        await clickLabel(phone, "Browse");
        await until(() => phone.evaluate(() => /Skipped photos\s*1/.test(document.querySelector("#controls .list").innerText)), "the Skipped count");
        await shot(phone, "phone-your-choices");
        await clickText(phone, "#controls .list button", /Skipped photos/);
        await until(async () => (await api("GET", "/api/player")).source.label === "Skipped photos", "the Skipped slideshow");
        await until(async () => (await shownId(phone)) === v.current.id, "the skipped photo on the phone");
        await showControls(phone);
        await clickLabel(phone, "Skip this photo");
        await until(async () => (await api("GET", "/api/ratings")).skipped === 0, "the photo restored");
        await api("POST", "/api/player/source", { source: { query: "honeymoon", label: "Honeymoon" }, preset: "ambient" });
        await until(async () => (await api("GET", "/api/player")).source.label === "Honeymoon", "honeymoon again");
    });
    await ok("phone in landscape (mirrored to the TV): the photo fills, controls hide by themselves", async () => {
        await phone.setViewport({ width: 915, height: 412, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
        await showControls(phone);
        await sleep(600);
        await shot(phone, "phone-landscape-controls");
        await until(async () => !(await visibleControls(phone)), "the controls to hide", 9000);
        await sleep(1700);
        await shot(phone, "phone-landscape");
    });
    await ok("phone: map: points from the catalogue, play the area shown (tiles stubbed: the test stays offline)", async () => {
        await phone.setRequestInterception(true);
        phone.on("request", (r) => (r.url().includes("tile.openstreetmap.org") ? r.respond({ status: 200, contentType: "image/png", body: fake.png(8, 8, [200, 210, 220]) }) : r.continue()));
        await phone.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
        await showControls(phone);
        await clickLabel(phone, "Browse");
        await clickLabel(phone, "Map");
        await until(() => phone.evaluate(() => !!window.L && /photos here/.test(document.querySelector("#controls .play-row .count").textContent)), "the map", 15000);
        const n = await phone.evaluate(() => document.querySelector("#controls .play-row .count").textContent);
        assert.match(n, /About 20 photos here/);
        await sleep(500);
        await shot(phone, "phone-map");
        await clickLabel(phone, "Play this area");
        await until(async () => (await api("GET", "/api/player")).source.label === "Map area", "the map area playing");
        assert.equal((await api("GET", "/api/player")).count, 18); // 12 Noosa (bursts: 10) + 8 Cinque Terre
    });
    await ok("the shelf never shows the controls", async () => {
        assert.equal(await shelf.evaluate(() => document.getElementById("controls").classList.contains("hidden") && document.getElementById("controls").children.length === 0), true);
    });

    await ok("no errors in the page consoles (404s only for the photo Picapport has not indexed)", async () => {
        const f9 = require("crypto").createHash("sha1").update(`${fake.ROOT}/_Friends/f9.jpg`).digest("hex").slice(0, 20);
        const other404 = notFound.filter((x) => !x.includes(`/api/photo/${f9}`));
        const otherErrors = errors.filter((x) => !/Failed to load resource: the server responded with a status of 404/.test(x));
        assert.deepEqual([...other404, ...otherErrors], []);
        assert.equal(errors.length - otherErrors.length, notFound.length);
    });

    await browser.close();
    apiProc.kill();
    pic.close();
    if (fails) console.log(out.split("\n").slice(-30).join("\n"));
    fs.rmSync(state, { recursive: true, force: true });
    process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); try { apiProc && apiProc.kill(); } catch { /* */ } process.exit(1); });
