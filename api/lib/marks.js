// marks.js - "mark this photo" (R20): a star or "bad photo" from the phone or a button goes into a
// review list on the SD card (/var/lib/photo-api/marks.json). Nothing here writes to a photo (hard
// rule 1): the owner's pipeline (L7) applies the marks to the photo files later, and the lasting
// result lives in the photo (principle 11). The list is temporary.
const config = require("./config");
const { readJson, writeJson } = require("./state");

const KINDS = ["star", "bad"];

function list() {
    return readJson(config.files.marks, { marks: [] }).marks;
}

// Add (or replace) a mark for a photo. Returns the list.
function add(p, kind, by = null) {
    if (!KINDS.includes(kind)) throw new Error(`mark must be one of: ${KINDS.join(", ")}`);
    const marks = list().filter((m) => !(m.path === p && m.mark === kind));
    marks.push({ path: p, mark: kind, at: new Date().toISOString(), by });
    writeJson(config.files.marks, { about: "Review list (R20): photos to star or remove, for the owner's pipeline. Never applied to photos by the slideshow.", marks });
    return marks;
}

function remove(p, kind) {
    const marks = list().filter((m) => !(m.path === p && (!kind || m.mark === kind)));
    writeJson(config.files.marks, { about: "Review list (R20): photos to star or remove, for the owner's pipeline. Never applied to photos by the slideshow.", marks });
    return marks;
}

function of(p) {
    return list().filter((m) => m.path === p).map((m) => m.mark);
}

module.exports = { list, add, remove, of, KINDS };
