// screen.js - monitor on/off with wlr-randr (the Wayland desktop; vcgencmd has no effect there,
// tested 2026-11-16, backlog B28).
//
// The desired state is kept in screen.json ({ off, offUntil }) so it survives a restart or reboot.
// Launching Chromium switches a disabled output back on (tested 2026-11-16, with wlr-randr and with
// wlopm alike), so while the screen should be off the API re-checks every 10 seconds and switches
// it off again. A timed "off" turns the screen on when it expires.
const { execFile } = require("child_process");
const config = require("./config");
const { readJson, writeJson } = require("./state");

const ENFORCE_MS = Number(process.env.SCREEN_ENFORCE_MS || 10000);
let timer = null;
let enforcer = null;
let logger = console;

function wlr(args) {
    return new Promise((resolve, reject) => {
        execFile(config.wlrRandrBin, args, { env: { ...process.env, ...config.waylandEnv }, timeout: 15000 },
            (err, stdout, stderr) => (err ? reject(new Error((stderr || "").trim() || err.message)) : resolve(stdout)));
    });
}

async function output() {
    if (config.screenOutput) return config.screenOutput;
    const out = await wlr([]);
    const first = out.split("\n").find((l) => l && !/^\s/.test(l));
    if (!first) throw new Error("wlr-randr lists no output");
    return first.split(" ")[0];
}

async function isOn() {
    const out = await wlr([]);
    const m = out.match(/Enabled:\s*(yes|no)/);
    if (!m) throw new Error("cannot read the screen state from wlr-randr");
    return m[1] === "yes";
}

function desired() {
    const s = readJson(config.files.screen, {});
    // Older form had only offUntil.
    return { off: s.off === true || (s.off === undefined && !!s.offUntil), offUntil: s.offUntil || null };
}

async function set(on) {
    await wlr(["--output", await output(), on ? "--on" : "--off"]);
}

function stopTimers() {
    if (timer) clearTimeout(timer);
    if (enforcer) clearInterval(enforcer);
    timer = null;
    enforcer = null;
}

// Keep the screen off while it should be off; turn it on when a timed "off" expires.
function watch() {
    stopTimers();
    const { off, offUntil } = desired();
    if (!off) return;
    enforcer = setInterval(async () => {
        try {
            const d = desired();
            if (!d.off) return stopTimers();
            if (d.offUntil && new Date(d.offUntil).getTime() <= Date.now()) return await turnOn("timer");
            if (await isOn()) {
                await set(false);
                logger.info("Screen was switched on by something else while it should be off; switched off again");
            }
        } catch (err) {
            logger.warn(`Screen check failed: ${err.message}`);
        }
    }, ENFORCE_MS);
    if (offUntil) {
        const ms = new Date(offUntil).getTime() - Date.now();
        timer = setTimeout(() => turnOn("timer").catch((e) => logger.error(`Screen timer: ${e.message}`)),
            Math.max(0, Math.min(ms, 24 * 3600 * 1000))); // longer waits are caught by the 10 s check
    }
}

async function turnOff(offUntil) {
    writeJson(config.files.screen, { off: true, offUntil: offUntil || null, changedAt: new Date().toISOString() });
    await set(false);
    watch();
    logger.info(`Screen off${offUntil ? ` until ${offUntil}` : ""}`);
}

async function turnOn(reason = "request") {
    writeJson(config.files.screen, { off: false, offUntil: null, changedAt: new Date().toISOString() });
    stopTimers();
    await set(true);
    logger.info(`Screen on (${reason})`);
}

async function status() {
    const d = desired();
    let on = null;
    let error;
    try {
        on = await isOn();
    } catch (err) {
        error = err.message;
    }
    return { on, wantedOff: d.off, offUntil: d.off ? d.offUntil : null, ...(error ? { error } : {}) };
}

// At start (for example after a reboot, when the desktop may still be starting): keep a wanted
// "off" (re-applied by the 10 s check, which also waits for the desktop), or turn the screen on if
// the timer expired while the API was not running.
function restore(log) {
    logger = log;
    const d = desired();
    if (!d.off) return;
    if (d.offUntil && new Date(d.offUntil).getTime() <= Date.now()) {
        turnOn("timer expired while the API was not running").catch((e) => logger.warn(`Screen: ${e.message}`));
        return;
    }
    logger.info(`Screen should be off${d.offUntil ? ` until ${d.offUntil}` : ""}; keeping it off`);
    set(false).catch(() => {}); // the desktop may not be ready yet; the check retries
    watch();
}

module.exports = { status, turnOff, turnOn, isOn, restore };
