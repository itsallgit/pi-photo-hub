// fake-metadata-writer.js - stands in for scripts/photo-metadata.py in the API and browser tests,
// where the photos do not exist as files. Files in FAKE_METADATA_DIR steer it: "off" refuses all
// changes, "fail" makes a change fail. Every accepted change is added to "writes.log".
const fs = require("fs");
const path = require("path");
const dir = process.env.FAKE_METADATA_DIR;
const has = (f) => fs.existsSync(path.join(dir, f));
const say = (o) => { console.log(JSON.stringify(o)); process.exit(o.ok ? 0 : 1); };
const [cmd, p, value] = process.argv.slice(2);
if (cmd === "status") say({ ok: true, writable: !has("off"), code: has("off") ? "switched-off" : null, reason: has("off") ? "Saving to the photos is not switched on yet." : null });
if (cmd === "set-rating") {
    if (has("fail")) say({ ok: false, code: "verify-failed", message: "The new value did not read back, so it was discarded." });
    fs.appendFileSync(path.join(dir, "writes.log"), `${value} ${p}\n`);
    say({ ok: true, changed: true, path: p, rating: Number(value), seconds: 0.01 });
}
say({ ok: false, code: "usage", message: "unknown command" });
