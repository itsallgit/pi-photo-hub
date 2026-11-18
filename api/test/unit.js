// unit.js - tests of the pure parts of the slideshow layer (order, settings, schedule, names).
// Run: node api/test/unit.js (smoke.js runs it first).
const assert = require("assert");
const path = require("path");
process.env.PRESETS_FILE = path.join(__dirname, "..", "..", "config", "slideshow-presets.json");
const order = require("../lib/order");
const settings = require("../lib/settings");
const schedule = require("../lib/schedule");
const { cleanFolderName } = require("../lib/catalogue");

let failed = 0;
function t(name, fn) {
    try { fn(); console.log(`ok   unit: ${name}`); } catch (e) { failed++; console.log(`FAIL unit: ${name}: ${e.message}`); }
}

// A small library: folder A (a burst of 3 + 3 more), folder B (4), C (2 undated), one rated, two upright.
const lib = {};
const add = (p, folder, date, extra = {}) => { lib[p] = { folder, date, event: folder.split("/").pop(), rating: 0, upright: false, ...extra }; };
add("A/1", "A", "2020-01-01T10:00:00"); add("A/2", "A", "2020-01-01T10:00:02"); add("A/3", "A", "2020-01-01T10:00:04");
add("A/4", "A", "2020-01-02T10:00:00"); add("A/5", "A", "2020-01-03T10:00:00", { upright: true }); add("A/6", "A", "2020-01-04T10:00:00");
add("B/1", "B", "2019-05-01T08:00:00"); add("B/2", "B", "2019-05-02T08:00:00", { rating: 5 }); add("B/3", "B", "2019-05-03T08:00:00", { upright: true });
add("B/4", "B", "2019-05-04T08:00:00");
add("C/1", "C", null); add("C/2", "C", null);
const info = (p) => lib[p];
const all = Object.keys(lib);
const base = { order: "random", bursts: false, highlights: false, upright: "fill", chapterLength: 3, recentDays: 14 };
const ps = (items) => items.map((x) => x.p);

t("random: same seed, same order; another seed, another order", () => {
    const a = ps(order.build(all, base, { seed: 7, info }));
    assert.deepEqual(ps(order.build(all, base, { seed: 7, info })), a);
    assert.notDeepEqual(ps(order.build(all, base, { seed: 8, info })), a);
    assert.deepEqual([...a].sort(), [...all].sort());
});
t("bursts: one photo per burst (the middle one)", () => {
    const r = ps(order.build(all, { ...base, bursts: true }, { seed: 1, info }));
    assert.equal(r.length, all.length - 2);
    assert.ok(r.includes("A/2") && !r.includes("A/1") && !r.includes("A/3"));
    assert.ok(r.includes("C/1") && r.includes("C/2")); // undated photos are never thinned
});
t("skip upright", () => {
    const r = ps(order.build(all, { ...base, upright: "skip" }, { seed: 1, info }));
    assert.ok(!r.includes("A/5") && !r.includes("B/3"));
    assert.equal(r.length, all.length - 2);
});
t("date ascending and descending; undated last; an event card at each folder change", () => {
    const asc = order.build(all, { ...base, order: "date-asc" }, { seed: 1, info });
    assert.deepEqual(ps(asc).slice(0, 4), ["B/1", "B/2", "B/3", "B/4"]);
    assert.deepEqual(ps(asc).slice(-2), ["C/1", "C/2"]);
    assert.equal(asc[0].c.t, "B");
    assert.equal(asc[0].c.d, "May 2019");
    assert.equal(asc[4].c.t, "A");
    assert.ok(!asc[1].c);
    const desc = ps(order.build(all, { ...base, order: "date-desc" }, { seed: 1, info }));
    assert.equal(desc[0], "A/6");
});
t("chapters: runs of at most chapterLength from one event, each starting with a card, not the same event twice in a row", () => {
    const items = order.build(all, { ...base, order: "chapters" }, { seed: 3, info });
    assert.equal(items.length, all.length);
    const runs = [];
    for (const it of items) { if (it.c) runs.push([]); runs[runs.length - 1].push(it.p); }
    assert.ok(runs.every((r) => r.length <= 3 && new Set(r.map((p) => p[0])).size === 1));
    for (let i = 1; i < runs.length; i++) if (runs[i][0][0] === runs[i - 1][0][0]) {
        // allowed only when no other event was left
        assert.ok(runs.slice(i).every((r) => r[0][0] === runs[i][0][0]));
    }
});
t("skipped photos are left out unless asked for; Favourites and Skipped show everything they hold", () => {
    const rated = (p) => ({ ...info(p), rating: p === "B/1" ? 1 : info(p).rating });
    assert.ok(!ps(order.build(all, base, { seed: 5, info: rated })).includes("B/1"));
    assert.ok(ps(order.build(all, base, { seed: 5, info: rated, includeSkipped: true })).includes("B/1"));
    const twice = ps(order.build(["B/2", "B/3"], { ...base, highlights: true, upright: "skip" }, { seed: 5, info, showAll: true }));
    assert.deepEqual([...twice].sort(), ["B/2", "B/3"]);
});
t("highlights: rated photos come twice, never twice in a row", () => {
    const r = ps(order.build(all, { ...base, highlights: true }, { seed: 5, info }));
    assert.equal(r.filter((p) => p === "B/2").length, 2);
    for (let i = 1; i < r.length; i++) assert.notEqual(r[i], r[i - 1]);
});
t("recently shown photos play last, the longest ago first", () => {
    const now = Date.parse("2026-11-18T00:00:00Z");
    const shown = { "A/4": now - 3600e3, "B/1": now - 7200e3, "C/1": now - 30 * 86400e3 };
    const r = ps(order.build(all, base, { seed: 9, info, lastShown: (p) => shown[p] || null, now }));
    assert.deepEqual(r.slice(-2), ["B/1", "A/4"]);
    assert.ok(r.indexOf("C/1") < all.length - 2); // shown a month ago: not recent
});
t("settings: checks values and merges the overlay", () => {
    assert.ok(settings.check({ interval: 2 }).error);
    assert.ok(settings.check({ order: "shuffle" }).error);
    assert.ok(settings.check({ overlay: { date: "sometimes" } }).error);
    assert.ok(settings.check({ nonsense: 1 }).error);
    const c = settings.check({ interval: "30", overlay: { place: false } }).value;
    assert.equal(c.interval, 30);
    const m = settings.merge(settings.defaults(), c);
    assert.equal(m.overlay.place, false);
    assert.equal(m.overlay.date, settings.defaults().overlay.date);
});
t("presets: applying one, then changing a setting keeps the change and says what changed", () => {
    const p = settings.applyPreset("present").value;
    assert.equal(p.autoplay, false);
    assert.equal(p.preset, "present");
    assert.deepEqual(settings.changedFromPreset(p), []);
    const m = settings.merge(p, { interval: 7 });
    assert.deepEqual(settings.changedFromPreset(m), ["interval"]);
    assert.ok(settings.applyPreset("party").error);
    assert.deepEqual(settings.presets().map((x) => x.name), ["ambient", "present", "guests", "night"]);
});
t("Picapport sort names map onto orders", () => {
    assert.equal(settings.SORT_TO_ORDER.randomsmart, "chapters");
    assert.equal(settings.ORDER_TO_SORT["date-asc"], "datetimeascending");
});
t("schedule: off period across midnight and within a day", () => {
    const s1 = { off: "00:00", on: "06:00" };
    assert.equal(schedule.inOffPeriod(s1, new Date(2026, 10, 18, 3, 0)), true);
    assert.equal(schedule.inOffPeriod(s1, new Date(2026, 10, 18, 6, 0)), false);
    const s2 = { off: "22:30", on: "07:00" };
    assert.equal(schedule.inOffPeriod(s2, new Date(2026, 10, 18, 23, 0)), true);
    assert.equal(schedule.inOffPeriod(s2, new Date(2026, 10, 18, 6, 59)), true);
    assert.equal(schedule.inOffPeriod(s2, new Date(2026, 10, 18, 12, 0)), false);
    const n = schedule.nextAt("06:00", new Date(2026, 10, 18, 7, 0));
    assert.equal(n.getDate(), 19);
    assert.equal(n.getHours(), 6);
});
t("folder names become event names", () => {
    assert.equal(cleanFolderName("2021.05 - Noosa"), "Noosa");
    assert.equal(cleanFolderName("2026.09 - 2026.10 - Honeymoon"), "Honeymoon");
    assert.equal(cleanFolderName("01 Singapore - Round 1"), "Singapore - Round 1");
    assert.equal(cleanFolderName("_Friends"), "Friends");
    assert.equal(cleanFolderName("2016 - Europe"), "Europe");
    assert.equal(cleanFolderName("2019"), "2019");
});

if (failed) process.exitCode = 1;
module.exports = { failed: () => failed };
