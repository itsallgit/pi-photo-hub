// settings.js - slideshow settings and presets (R4). Defaults and presets live in the repo
// (config/slideshow-presets.json); the current values in /var/lib/photo-api/player.json.
const fs = require("fs");
const config = require("./config");

let file = null;
function presetsFile() {
    if (!file) file = JSON.parse(fs.readFileSync(config.presetsFile, "utf8"));
    return file;
}

const ORDERS = ["random", "chapters", "date-asc", "date-desc"];
const ENUMS = {
    order: ORDERS,
    upright: ["fill", "skip"],
    motion: ["off", "subtle", "lively"],
    transition: ["fade", "slide", "zoom", "dip"],
    viewer: ["layer", "picapport"],
};
const BOOLS = ["autoplay", "bursts", "highlights", "titleCards", "clock", "night"];
const OVERLAY_DATE = ["off", "absolute", "relative"];

// Picapport's sort names (the older API and the slideshow-control skill) mapped onto our orders.
const SORT_TO_ORDER = {
    random: "random", randomsmart: "chapters", datetimeascending: "date-asc", datetimedescending: "date-desc",
    importdatetimedescending: "date-desc", newestwithupdate: "date-desc", nameascending: "date-asc",
    namedescending: "date-desc", titleascending: "date-asc", titledescending: "date-desc",
};
const ORDER_TO_SORT = { random: "random", chapters: "randomsmart", "date-asc": "datetimeascending", "date-desc": "datetimedescending" };

function defaults() {
    return structuredClone({ ...presetsFile().defaults, preset: null });
}

function presets() {
    const f = presetsFile();
    return Object.entries(f.presets).map(([name, p]) => ({ name, label: p.label, about: p.about, settings: p.settings }));
}

function overlayStyles() { return presetsFile().overlayStyles; }

// Check a partial settings change; returns { value } (normalised) or { error }.
function check(partial) {
    if (!partial || typeof partial !== "object" || Array.isArray(partial)) return { error: "settings must be an object" };
    const out = {};
    for (const [k, v] of Object.entries(partial)) {
        if (k === "interval") {
            const n = Number(v);
            if (!Number.isInteger(n) || n < config.interval.min || n > config.interval.max) {
                return { error: `interval must be a whole number of seconds from ${config.interval.min} to ${config.interval.max}` };
            }
            out.interval = n;
        } else if (k === "chapterLength") {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 2 || n > 50) return { error: "chapterLength must be 2 to 50" };
            out.chapterLength = n;
        } else if (k === "recentDays") {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 0 || n > 3650) return { error: "recentDays must be 0 to 3650" };
            out.recentDays = n;
        } else if (k === "overlayStyle") {
            const n = Number(v);
            if (!Number.isInteger(n) || n < 0 || n >= overlayStyles().length) return { error: `overlayStyle must be 0 to ${overlayStyles().length - 1}` };
            out.overlayStyle = n;
        } else if (ENUMS[k]) {
            if (!ENUMS[k].includes(v)) return { error: `${k} must be one of: ${ENUMS[k].join(", ")}` };
            out[k] = v;
        } else if (BOOLS.includes(k)) {
            if (typeof v !== "boolean") return { error: `${k} must be true or false` };
            out[k] = v;
        } else if (k === "overlay") {
            if (!v || typeof v !== "object") return { error: "overlay must be an object" };
            const o = {};
            for (const [ok, ov] of Object.entries(v)) {
                if (ok === "date") {
                    if (!OVERLAY_DATE.includes(ov)) return { error: `overlay.date must be one of: ${OVERLAY_DATE.join(", ")}` };
                } else if (["place", "event", "people"].includes(ok)) {
                    if (typeof ov !== "boolean") return { error: `overlay.${ok} must be true or false` };
                } else return { error: `unknown overlay field ${ok}` };
                o[ok] = ov;
            }
            out.overlay = o;
        } else if (k === "preset") {
            continue; // set only by applying a preset
        } else {
            return { error: `unknown setting ${k}` };
        }
    }
    return { value: out };
}

// Merge a checked change into current settings (overlay merged field by field).
function merge(current, change) {
    const next = { ...current, ...change };
    if (change.overlay) next.overlay = { ...current.overlay, ...change.overlay };
    return next;
}

// Settings after applying a preset: the defaults, then the preset, remembering its name.
function applyPreset(name) {
    const f = presetsFile();
    const p = f.presets[name];
    if (!p) return { error: `unknown preset ${name}; presets: ${Object.keys(f.presets).join(", ")}` };
    const base = defaults();
    return { value: { ...merge(base, p.settings), preset: name } };
}

// Which settings differ from the preset they started from (for "Ambient (changed)").
function changedFromPreset(s) {
    if (!s.preset) return [];
    const ref = applyPreset(s.preset).value;
    if (!ref) return [];
    return Object.keys(ref).filter((k) => k !== "preset" && JSON.stringify(ref[k]) !== JSON.stringify(s[k]));
}

module.exports = { defaults, presets, overlayStyles, check, merge, applyPreset, changedFromPreset, ORDERS, SORT_TO_ORDER, ORDER_TO_SORT };
