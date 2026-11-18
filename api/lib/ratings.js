// ratings.js - asks the project's one metadata writer (scripts/photo-metadata.py) to change a photo's
// rating, one photo at a time. The rating lives in the photo (principle 11); nothing is queued for
// later or kept here: a change either is verified in the file or is reported as not saved.
const { execFile } = require("child_process");
const config = require("./config");

let tail = Promise.resolve();
const working = new Set();
let cached = null;

function run(args) {
    const [cmd, ...base] = config.photoMetadata.command;
    return new Promise((resolve) => {
        // No time limit here: the writer limits its own tools, and must never be stopped mid-swap.
        execFile(cmd, [...base, ...args], { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            try {
                resolve(JSON.parse(String(stdout).trim().split("\n").pop()));
            } catch {
                resolve({ ok: false, code: "writer-failed", message: `The metadata writer did not answer${err ? ` (${String(stderr || err.message).trim().slice(0, 160)})` : ""}.` });
            }
        });
    });
}

async function status() {
    if (cached && Date.now() - cached.at < config.photoMetadata.statusTtlMs) return cached.value;
    const r = await run(["status"]);
    const value = r.ok ? { writable: r.writable, code: r.code, reason: r.reason } : { writable: false, code: r.code, reason: r.message };
    cached = value.writable ? { at: Date.now(), value } : null; // a refusal is looked at again next time
    return value;
}

function busy(p) { return working.has(p); }

function set(p, rating) {
    working.add(p);
    cached = null;
    const job = tail.then(() => run(["set-rating", p, String(rating)]));
    tail = job.catch(() => {});
    return job.finally(() => working.delete(p));
}

module.exports = { status, busy, set };
