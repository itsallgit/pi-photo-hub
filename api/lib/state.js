// state.js - small JSON files in the state directory (outside the repo, principle 5).
const fs = require("fs");
const path = require("path");

function readJson(file, fallback) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
        if (err.code !== "ENOENT") throw new Error(`cannot read ${file}: ${err.message}`);
        return fallback;
    }
}

// Write atomically: a power cut mid-write must not leave a half file.
function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
}

function writeText(file, text) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJson, writeText };
