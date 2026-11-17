// browser.js - Chromium in kiosk mode. It runs inside photo-api.service's cgroup, so restarting
// the service closes it (backlog B20).
const { promisify } = require("util");
const { spawn } = require("child_process");
const exec = promisify(require("child_process").exec);
const config = require("./config");

async function isRunning() {
    try {
        await exec(config.browserCheckCmd);
        return true;
    } catch {
        return false;
    }
}

// extraFlags: more Chromium flags (the dev kiosk route uses it for experiments; checked there).
async function open(url, logger, extraFlags = []) {
    logger.info("Closing any running Chromium instances...");
    await exec(config.browserKillCmd);
    const flags = ["--no-first-run", "--disable-restore-session-state", "--disable-session-crashed-bubble",
        "--disable-infobars", "--start-fullscreen", "--kiosk", ...config.chromiumFlags, ...extraFlags];
    const env = {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":0",
        XAUTHORITY: process.env.XAUTHORITY || "/home/pi/.Xauthority",
        HOME: "/home/pi",
        USER: "pi",
        ...(config.cursorTheme ? { XCURSOR_THEME: config.cursorTheme } : {}),
    };
    logger.info(`Spawning Chromium at: ${url}`);
    const child = spawn(config.chromiumBin, [...flags, url], { detached: true, stdio: "ignore", env });
    child.on("error", (err) => logger.error(`Chromium failed to start: ${err.message}`));
    child.unref();
}

module.exports = { isRunning, open };
