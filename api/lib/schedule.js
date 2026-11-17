// schedule.js - the daily screen schedule (R18, backlog L9): switch the screen off at one time and
// on at another, every day. Off by default (the owner's example: off 00:00, on 06:00). Kept in
// /var/lib/photo-api/schedule.json, so it survives restarts and reboots.
//
// It works through the one-off timer the screen already has (B28): at the "off" time it switches
// the screen off until the next "on" time; screen.js keeps that timer across restarts and turns the
// screen on when it expires. So turning the screen on by hand in the night is respected until the
// next night, and a longer one-off "off" (for example "off until tomorrow 9:00") is not shortened.
const config = require("./config");
const { readJson, writeJson } = require("./state");

const DEFAULT = { enabled: false, off: "00:00", on: "06:00" };
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
let logger = console;
let screen = null;
let tick = null;

function get() {
    return { ...DEFAULT, ...readJson(config.files.schedule, {}) };
}

function set(change) {
    const cur = get();
    const next = { ...cur };
    if (change.enabled !== undefined) {
        if (typeof change.enabled !== "boolean") throw Object.assign(new Error("enabled must be true or false"), { status: 400 });
        next.enabled = change.enabled;
    }
    for (const k of ["off", "on"]) {
        if (change[k] !== undefined) {
            if (!HHMM.test(change[k])) throw Object.assign(new Error(`${k} must be a time HH:MM (24 hours)`), { status: 400 });
            next[k] = change[k];
        }
    }
    if (next.off === next.on) throw Object.assign(new Error("off and on must be different times"), { status: 400 });
    next.updatedAt = new Date().toISOString();
    writeJson(config.files.schedule, next);
    logger.info(`Screen schedule: ${next.enabled ? `off ${next.off}, on ${next.on}` : "disabled"}`);
    return next;
}

const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// The next time (Date) after `from` at which the clock shows hh:mm.
function nextAt(hhmm, from) {
    const d = new Date(from);
    d.setSeconds(0, 0);
    d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
    if (d <= from) d.setDate(d.getDate() + 1);
    return d;
}

// Is `now` inside the off period [off, on)?
function inOffPeriod(sch, now) {
    const m = now.getHours() * 60 + now.getMinutes();
    const a = minutes(sch.off), b = minutes(sch.on);
    return a < b ? m >= a && m < b : m >= a || m < b;
}

// The start (Date) of the off period that contains `now`.
function periodStart(sch, now) {
    const d = new Date(now);
    d.setSeconds(0, 0);
    d.setHours(Number(sch.off.slice(0, 2)), Number(sch.off.slice(3, 5)));
    if (d > now) d.setDate(d.getDate() - 1);
    return d;
}

async function check(now = new Date()) {
    const sch = get();
    if (!sch.enabled || !inOffPeriod(sch, now)) return null;
    const start = periodStart(sch, now).toISOString();
    if (sch.lastOff === start) return null; // already done for this night
    const until = nextAt(sch.on, now);
    const st = await screen.status();
    if (st.wantedOff && (!st.offUntil || new Date(st.offUntil) >= until)) {
        logger.info("Screen schedule: the screen is already off for longer; left as it is");
    } else {
        await screen.turnOff(until.toISOString());
        logger.info(`Screen schedule: off until ${until.toISOString()}`);
    }
    writeJson(config.files.schedule, { ...sch, lastOff: start });
    return until;
}

function start(log, screenModule) {
    logger = log || logger;
    screen = screenModule;
    if (tick) clearInterval(tick);
    tick = setInterval(() => check().catch((e) => logger.warn(`Screen schedule: ${e.message}`)), 30000);
    tick.unref();
    // After a restart inside the off period, catch up unless this night was already handled.
    setTimeout(() => check().catch((e) => logger.warn(`Screen schedule: ${e.message}`)), 5000).unref();
}

module.exports = { get, set, start, check, inOffPeriod, nextAt };
