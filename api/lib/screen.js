// screen.js - monitor on/off with wlr-randr (the Wayland desktop; vcgencmd has no effect there,
// tested 2026-11-16, backlog B28). A timed "off" is kept in screen.json so it survives a restart.
const { execFile } = require("child_process");
const config = require("./config");
const { readJson, writeJson } = require("./state");

let timer = null;
let logger = console;

function wlr(args) {
    return new Promise((resolve, reject) => {
        execFile(config.wlrRandrBin, args, { env: { ...process.env, ...config.waylandEnv }, timeout: 15000 },
            (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout)));
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

function saved() {
    return readJson(config.files.screen, { offUntil: null });
}

async function set(on) {
    await wlr(["--output", await output(), on ? "--on" : "--off"]);
}

function schedule(offUntil) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!offUntil) return;
    const ms = new Date(offUntil).getTime() - Date.now();
    // setTimeout cannot wait longer than about 24.8 days; re-check daily instead.
    const wait = Math.max(0, Math.min(ms, 24 * 3600 * 1000));
    timer = setTimeout(async () => {
        if (new Date(offUntil).getTime() > Date.now()) return schedule(offUntil);
        try {
            await turnOn("timer");
        } catch (err) {
            logger.error(`Screen timer could not turn the screen on: ${err.message}`);
            setTimeout(() => schedule(offUntil), 60000);
        }
    }, wait);
}

async function turnOff(offUntil) {
    await set(false);
    writeJson(config.files.screen, { offUntil: offUntil || null, changedAt: new Date().toISOString() });
    schedule(offUntil);
    logger.info(`Screen off${offUntil ? ` until ${offUntil}` : ""}`);
}

async function turnOn(reason = "request") {
    await set(true);
    writeJson(config.files.screen, { offUntil: null, changedAt: new Date().toISOString() });
    schedule(null);
    logger.info(`Screen on (${reason})`);
}

async function status() {
    const { offUntil } = saved();
    let on = null;
    let error;
    try {
        on = await isOn();
    } catch (err) {
        error = err.message;
    }
    return { on, offUntil: on === false ? offUntil || null : null, ...(error ? { error } : {}) };
}

// At start (for example after a reboot, when the desktop may still be starting): re-apply a
// timed "off" that has not expired, or turn the screen on if it has. Retries for 3 minutes.
function restore(log) {
    logger = log;
    const { offUntil } = saved();
    if (!offUntil) return;
    let tries = 0;
    const attempt = async () => {
        tries += 1;
        try {
            if (new Date(offUntil).getTime() > Date.now()) await turnOff(offUntil);
            else await turnOn("timer expired while the API was not running");
        } catch (err) {
            if (tries < 18) setTimeout(attempt, 10000);
            else logger.error(`Could not restore the screen state: ${err.message}`);
        }
    };
    attempt();
}

module.exports = { status, turnOff, turnOn, isOn, restore };
