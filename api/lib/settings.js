// settings.js - slideshow settings and presets (R4, B41). Defaults, built-in presets and the catalog
// of choices live in the repo (config/slideshow-presets.json); the current values in
// /var/lib/photo-api/player.json; the presets the owner saves in /var/lib/photo-api/presets.json.
const fs = require("fs");
const config = require("./config");
const { readJson, writeJson } = require("./state");

let file = null;
function presetsFile() {
    if (!file) file = JSON.parse(fs.readFileSync(config.presetsFile, "utf8"));
    return file;
}
const catalog = () => presetsFile().catalog;
const names = (list) => list.map((x) => x.name);

const ORDERS = ["random", "chapters", "date-asc", "date-desc"];
const TRANSITIONS = names(catalog().transitions);
const ENUMS = {
    order: ORDERS,
    upright: ["fill", "skip"],
    motion: ["off", "subtle", "lively"],
    transition: TRANSITIONS,
    viewer: ["layer", "picapport"],
    overlayMode: ["styles", "custom"],
};
const BOOLS = ["autoplay", "bursts", "highlights", "titleCards", "clock", "night"];
const OVERLAY_DATE = ["off", "absolute", "relative"];
const MAX_CAPTIONS = 12;
// Not part of what a built-in preset decides: they stay as they are when one is applied.
const CARRIED = ["clock", "clockStyle", "captions", "surpriseSkip"];

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

// ---------- the owner's presets ----------
let rev = 1;
const presetsRev = () => rev;
function store() {
    const s = readJson(config.files.presets, null) || {};
    return { custom: s.custom || {}, order: s.order || [], hidden: s.hidden || [] };
}
function saveStore(s) { writeJson(config.files.presets, { version: 1, ...s }); rev++; }

function presets({ all = false } = {}) {
    const f = presetsFile(), s = store();
    const list = [
        ...Object.entries(f.presets).map(([name, p]) => ({ name, label: p.label, about: p.about, settings: p.settings, custom: false })),
        ...Object.entries(s.custom).map(([name, p]) => ({ name, label: p.label, about: p.about || "", settings: p.settings, custom: true })),
    ].map((p) => ({ ...p, hidden: s.hidden.includes(p.name) }));
    const rank = (p) => { const k = s.order.indexOf(p.name); return k < 0 ? s.order.length + list.indexOf(p) : k; };
    return [...list].sort((a, b) => rank(a) - rank(b)).filter((p) => all || !p.hidden);
}

function cleanLabel(v) {
    const t = String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim();
    if (!t) return { error: "a preset needs a name" };
    if (t.length > 40) return { error: "a preset's name can have at most 40 characters" };
    return { value: t };
}
function cleanAbout(v) { return String(v === undefined || v === null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 120); }
function snapshot(current) {
    const { preset, viewer, ...rest } = structuredClone(current); // viewer is a fallback switch, not a look
    return rest;
}
function savePreset(current, label, about) {
    const l = cleanLabel(label);
    if (l.error) return l;
    const s = store();
    if (presets({ all: true }).some((p) => p.label.toLowerCase() === l.value.toLowerCase())) return { error: `there is already a preset called ${l.value}`, status: 409 };
    if (Object.keys(s.custom).length >= 40) return { error: "that is 40 presets: delete one first", status: 409 };
    const base = l.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "preset";
    let name = `my-${base}`;
    for (let k = 2; s.custom[name]; k++) name = `my-${base}-${k}`;
    s.custom[name] = { label: l.value, about: cleanAbout(about), settings: snapshot(current), createdAt: new Date().toISOString() };
    saveStore(s);
    return { value: { name, label: l.value } };
}
function updatePreset(name, change, current) {
    const s = store();
    const all = presets({ all: true });
    const p = all.find((x) => x.name === name);
    if (!p) return { error: `unknown preset ${name}`, status: 404 };
    if (change.label !== undefined || change.about !== undefined || change.capture) {
        if (!p.custom) return { error: "the built-in presets stay as they are: save your own version instead", status: 409 };
        const c = s.custom[name];
        if (change.label !== undefined) {
            const l = cleanLabel(change.label);
            if (l.error) return l;
            if (all.some((x) => x.name !== name && x.label.toLowerCase() === l.value.toLowerCase())) return { error: `there is already a preset called ${l.value}`, status: 409 };
            c.label = l.value;
        }
        if (change.about !== undefined) c.about = cleanAbout(change.about);
        if (change.capture) c.settings = snapshot(current);
    }
    if (change.hidden !== undefined) {
        s.hidden = s.hidden.filter((x) => x !== name);
        if (change.hidden) s.hidden.push(name);
    }
    if (change.move) {
        const order = all.map((x) => x.name), k = order.indexOf(name), to = k + Math.sign(Number(change.move));
        if (to >= 0 && to < order.length) { order.splice(k, 1); order.splice(to, 0, name); s.order = order; }
    }
    saveStore(s);
    return { value: { name } };
}
function deletePreset(name) {
    const s = store();
    if (presetsFile().presets[name]) return { error: "a built-in preset cannot be deleted, but it can be hidden", status: 409 };
    if (!s.custom[name]) return { error: `unknown preset ${name}`, status: 404 };
    delete s.custom[name];
    s.order = s.order.filter((x) => x !== name);
    s.hidden = s.hidden.filter((x) => x !== name);
    saveStore(s);
    return { value: { name } };
}

function overlayStyles() { return presetsFile().overlayStyles; }

// ---------- checking ----------
function oneOf(value, list, what) { return list.includes(value) ? null : `${what} must be one of: ${list.join(", ")}`; }

function checkClockStyle(v) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "clockStyle must be an object" };
    const c = catalog(), out = {};
    const lists = { face: names(c.clockFaces), position: names(c.clockPositions), size: names(c.clockSizes), tone: names(c.tones), backing: names(c.looks).filter((x) => x !== "strip"), scrim: names(c.clockScrims) };
    for (const [k, val] of Object.entries(v)) {
        if (lists[k]) { const e = oneOf(val, lists[k], `clockStyle.${k}`); if (e) return { error: e }; out[k] = val; }
        else if (k === "opacity") {
            const n = Number(val);
            if (!Number.isInteger(n) || n < 10 || n > 100) return { error: "clockStyle.opacity must be 10 to 100" };
            out.opacity = n;
        } else if (k === "hour12" || k === "date") {
            if (typeof val !== "boolean") return { error: `clockStyle.${k} must be true or false` };
            out[k] = val;
        } else return { error: `unknown clockStyle field ${k}` };
    }
    return { value: out };
}

function checkCaptions(v) {
    if (v === null) return { value: null };
    if (!v || typeof v !== "object" || !Array.isArray(v.items)) return { error: "captions must have a list of items" };
    if (v.items.length > MAX_CAPTIONS) return { error: `at most ${MAX_CAPTIONS} captions` };
    const c = catalog(), corners = names(c.captionCorners), items = [], groups = {};
    for (const it of v.items) {
        if (!it || typeof it !== "object") return { error: "each caption must be an object" };
        const field = c.captionFields.find((f) => f.name === it.field);
        if (!field) return { error: `caption field must be one of: ${names(c.captionFields).join(", ")}` };
        const e = oneOf(it.format, names(field.formats), `${it.field} format`) || oneOf(it.corner, corners, "caption corner")
            || oneOf(it.size, names(c.captionSizes), "caption size") || oneOf(it.font, names(c.captionFonts), "caption font");
        if (e) return { error: e };
        if (typeof it.id !== "string" || !/^[\w-]{1,24}$/.test(it.id)) return { error: "each caption needs a short id" };
        items.push({ id: it.id, field: it.field, format: it.format, corner: it.corner, size: it.size, font: it.font });
    }
    for (const [corner, g] of Object.entries(v.groups || {})) {
        const e = oneOf(corner, corners, "caption corner") || oneOf(g && g.look, names(c.looks), "caption look") || oneOf(g && g.tone, names(c.tones), "caption colour");
        if (e) return { error: e };
        groups[corner] = { look: g.look, tone: g.tone };
    }
    return { value: { items, groups } };
}

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
        } else if (k === "surpriseSkip") {
            // The transitions "Surprise me" leaves out; at least one has to stay in.
            const real = TRANSITIONS.filter((t) => t !== "random");
            if (!Array.isArray(v) || v.some((t) => !real.includes(t))) return { error: `surpriseSkip must be a list of: ${real.join(", ")}` };
            const skip = real.filter((t) => v.includes(t));
            if (skip.length === real.length) return { error: "Surprise me needs at least one transition" };
            out.surpriseSkip = skip;
        } else if (k === "clockStyle" || k === "captions") {
            const r = k === "clockStyle" ? checkClockStyle(v) : checkCaptions(v);
            if (r.error) return r;
            out[k] = r.value;
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

// Merge a checked change into current settings (overlay and clock style merged field by field).
// Asking for a classic overlay or style (the knob, Paseo) switches back to the classic overlay.
function merge(current, change) {
    const next = { ...current, ...change };
    if (change.overlay) next.overlay = { ...current.overlay, ...change.overlay };
    if (change.clockStyle) next.clockStyle = { ...current.clockStyle, ...change.clockStyle };
    if ((change.overlay || change.overlayStyle !== undefined) && change.overlayMode === undefined) next.overlayMode = "styles";
    return next;
}

// Settings after applying a preset: the defaults, then the preset, remembering its name. The clock
// and the owner's caption layout are kept unless the preset has its own (a saved preset does).
function applyPreset(name, current) {
    const f = presetsFile();
    const p = f.presets[name] || store().custom[name];
    if (!p) return { error: `unknown preset ${name}; presets: ${presets({ all: true }).map((x) => x.name).join(", ")}` };
    const checked = check(p.settings);
    if (checked.error) return { error: `preset ${name} cannot be used: ${checked.error}` };
    const value = { ...merge(defaults(), checked.value), preset: name };
    if (current) for (const k of CARRIED) if (p.settings[k] === undefined && current[k] !== undefined) value[k] = current[k];
    return { value };
}

// Which settings differ from the preset they started from (for "Ambient (changed)").
function changedFromPreset(s) {
    if (!s.preset) return [];
    const ref = applyPreset(s.preset, s).value;
    if (!ref) return [];
    return Object.keys(ref).filter((k) => k !== "preset" && k !== "viewer" && JSON.stringify(ref[k]) !== JSON.stringify(s[k]));
}

module.exports = { defaults, presets, presetsRev, savePreset, updatePreset, deletePreset, overlayStyles, catalog, check, merge, applyPreset, changedFromPreset, ORDERS, TRANSITIONS, SORT_TO_ORDER, ORDER_TO_SORT };
