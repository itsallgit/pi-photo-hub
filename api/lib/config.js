// config.js - every path and command the API uses. Defaults are right on the Pi; each can be
// overridden by an environment variable so the API can be tested away from it (docs/architecture.md).
const path = require("path");

// systemd may pass several directories, separated like PATH (":" on Linux).
const stateDir = (process.env.STATE_DIRECTORY || "/var/lib/photo-api").split(path.delimiter)[0];
// Disposable cache (resized images, listed query results): CacheDirectory=photo-api in the unit.
const cacheDir = (process.env.CACHE_DIRECTORY || "/var/cache/photo-api").split(path.delimiter)[0];

module.exports = {
    port: Number(process.env.PORT || 3000),
    stateDir,
    cacheDir,
    // Image cache size cap in MB (resized photos on the SD card; oldest removed first).
    imageCacheMb: Number(process.env.IMAGE_CACHE_MB || 2000),
    // Screen-sized images are fetched from Picapport at this box (it rotates upright photos).
    screenBox: [1920, 1080],
    thumbBox: [480, 480],
    logDir: process.env.PHOTO_API_LOG_DIR || "/var/log/photo-api",
    picapportUrl: process.env.PICAPPORT_URL || "http://localhost:8080",
    chromiumBin: process.env.CHROMIUM_BIN || "/usr/bin/chromium-browser",
    // Extra Chromium flags, space-separated (CHROMIUM_FLAGS_EXTRA). Default: native Wayland, which
    // the motion test showed is needed for smooth pan and zoom (about 59 fps against 33 to 40 fps
    // through XWayland; 2026-11-18, docs/architecture.md "Slideshow layer").
    chromiumFlags: (process.env.CHROMIUM_FLAGS_EXTRA ?? "--ozone-platform=wayland").split(" ").filter(Boolean),
    browserCheckCmd: process.env.BROWSER_CHECK_CMD || "pgrep chromium",
    browserKillCmd: process.env.BROWSER_KILL_CMD || "pkill -9 chromium || true",
    // Pointer theme for Chromium: the blank theme hides the mouse pointer on the slideshow
    // (scripts/install-hidden-cursor.sh). CURSOR_THEME= (empty) leaves the normal pointer.
    cursorTheme: process.env.CURSOR_THEME ?? "pi-photo-hub-blank",
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
        catalogue: path.join(stateDir, "catalogue.json"),
        player: path.join(stateDir, "player.json"), // now playing: source, settings, position
        playlist: path.join(stateDir, "playlist.json"), // the current order of photos
        history: path.join(stateDir, "history.json"), // photos and slideshows shown (R19)
        schedule: path.join(stateDir, "schedule.json"), // daily screen off/on (R18)
    },
    // The one writer of photo metadata (scripts/photo-metadata.py, hard rule 1).
    photoMetadata: {
        command: process.env.PHOTO_METADATA_CMD ? JSON.parse(process.env.PHOTO_METADATA_CMD)
            : ["python3", path.join(__dirname, "..", "..", "scripts", "photo-metadata.py")],
        statusTtlMs: Number(process.env.PHOTO_METADATA_STATUS_TTL_MS ?? 30000),
    },
    presetsFile: process.env.PRESETS_FILE || path.join(__dirname, "..", "..", "config", "slideshow-presets.json"),
    buttonsFile: process.env.BUTTONS_FILE || path.join(__dirname, "..", "..", "config", "buttons.json"),
    wordsTemplate: process.env.WORDS_TEMPLATE || path.join(__dirname, "..", "..", "config", "words.example.json"),
    defaults: { query: "noimagesfound", sort: "random", interval: 20 },
    sorts: ["random", "randomsmart", "datetimeascending", "datetimedescending", "importdatetimedescending",
        "newestwithupdate", "nameascending", "namedescending", "titleascending", "titledescending"],
    interval: { min: 3, max: 3600 },
};
