// config.js - every path and command the API uses. Defaults are right on the Pi; each can be
// overridden by an environment variable so the API can be tested away from it (docs/architecture.md).
const path = require("path");

// systemd may pass several directories, separated like PATH (":" on Linux).
const stateDir = (process.env.STATE_DIRECTORY || "/var/lib/photo-api").split(path.delimiter)[0];

module.exports = {
    port: Number(process.env.PORT || 3000),
    stateDir,
    logDir: process.env.PHOTO_API_LOG_DIR || "/var/log/photo-api",
    picapportUrl: process.env.PICAPPORT_URL || "http://localhost:8080",
    chromiumBin: process.env.CHROMIUM_BIN || "/usr/bin/chromium-browser",
    browserCheckCmd: process.env.BROWSER_CHECK_CMD || "pgrep chromium",
    browserKillCmd: process.env.BROWSER_KILL_CMD || "pkill -9 chromium || true",
    wlrRandrBin: process.env.WLR_RANDR_BIN || "wlr-randr",
    screenOutput: process.env.SCREEN_OUTPUT || "", // empty: the first output wlr-randr lists
    waylandEnv: {
        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/run/user/1000",
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "wayland-0",
    },
    files: {
        slideshow: path.join(stateDir, "slideshow.json"),
        slideshowUrl: path.join(stateDir, "slideshow_url.txt"), // older versions read this (rollback)
        screen: path.join(stateDir, "screen.json"),
        words: path.join(stateDir, "words.json"),
        vocabulary: path.join(stateDir, "vocabulary.json"),
    },
    wordsTemplate: process.env.WORDS_TEMPLATE || path.join(__dirname, "..", "..", "config", "words.example.json"),
    defaults: { query: "noimagesfound", sort: "random", interval: 20 },
    sorts: ["random", "randomsmart", "datetimeascending", "datetimedescending", "importdatetimedescending",
        "newestwithupdate", "nameascending", "namedescending", "titleascending", "titledescending"],
    interval: { min: 3, max: 3600 },
};
