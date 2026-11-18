// build.js - a short fingerprint of the page files (api/public). It goes out with every state event;
// a phone tab left open for days compares it and reloads itself when the app was updated, so nobody
// keeps running old page code without knowing.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

let value = null;
function walk(dir, hash) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, hash);
        else { hash.update(e.name); hash.update(fs.readFileSync(p)); }
    }
}
function id() {
    if (value === null) {
        const hash = crypto.createHash("sha1");
        try { walk(path.join(__dirname, "..", "public"), hash); value = hash.digest("hex").slice(0, 12); } catch { value = "unknown"; }
    }
    return value;
}
module.exports = { id };
