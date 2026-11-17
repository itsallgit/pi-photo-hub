// order.js - turn a slideshow's photos into the order they play (R5 to R8, R12). Pure functions:
// the same photos, settings, seed and history always give the same order, so a slideshow can be
// rebuilt exactly; the player also saves the order it made (R2).
//
// build(paths, settings, { seed, info, lastShown, now }) -> [{ p, c? }]
//   p: file path; c: { t: title, d: dates } when an event (chapter) starts there (title cards, R12)

// Small, fast, seeded random numbers (mulberry32).
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const secs = (iso) => (iso ? Date.parse(iso + "Z") / 1000 : null); // local time as if UTC: only differences matter

// Bursts: photos in one folder taken at most gap seconds after the previous one. Keep the middle
// one of each burst (usually the steadiest), or a rated one if there is one.
function thinBursts(paths, info, gap = 5) {
    const byFolder = new Map();
    for (const p of paths) {
        const i = info(p);
        const t = secs(i.date);
        if (t === null) continue;
        if (!byFolder.has(i.folder)) byFolder.set(i.folder, []);
        byFolder.get(i.folder).push({ p, t, rating: i.rating });
    }
    const drop = new Set();
    for (const list of byFolder.values()) {
        list.sort((a, b) => a.t - b.t || (a.p < b.p ? -1 : 1));
        let start = 0;
        for (let k = 1; k <= list.length; k++) {
            if (k < list.length && list[k].t - list[k - 1].t <= gap) continue;
            const burst = list.slice(start, k);
            if (burst.length > 1) {
                const keep = burst.find((x) => x.rating > 0) || burst[Math.floor((burst.length - 1) / 2)];
                for (const x of burst) if (x !== keep) drop.add(x.p);
            }
            start = k;
        }
    }
    return paths.filter((p) => !drop.has(p));
}

function byDate(info, desc) {
    return (a, b) => {
        const da = info(a).date, db = info(b).date;
        if (da && db && da !== db) return desc ? (da < db ? 1 : -1) : (da < db ? -1 : 1);
        if (!da !== !db) return da ? -1 : 1; // undated last
        return a < b ? -1 : a > b ? 1 : 0;
    };
}

function fmtMonth(iso) {
    if (!iso) return null;
    const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1];
    return `${m} ${iso.slice(0, 4)}`;
}

function dateRange(paths, info) {
    const ds = paths.map((p) => info(p).date).filter(Boolean).sort();
    if (!ds.length) return null;
    const a = fmtMonth(ds[0]), b = fmtMonth(ds[ds.length - 1]);
    return a === b ? a : `${a} to ${b}`;
}

// Mark where a new event (folder) starts, with its name and dates.
function markEvents(items, info) {
    let prev = null;
    const groups = [];
    for (const it of items) {
        const f = info(it.p).folder;
        if (f !== prev) groups.push([]);
        groups[groups.length - 1].push(it);
        prev = f;
    }
    for (const g of groups) {
        const ev = info(g[0].p).event;
        if (ev) g[0].c = { t: ev, d: dateRange(g.map((x) => x.p), info) };
    }
    return items;
}

// Chapters: short runs of consecutive photos from one event, events shuffled, never the same event twice in a row if avoidable.
function chapters(paths, info, rnd, len) {
    const byFolder = new Map();
    for (const p of paths) {
        const f = info(p).folder;
        if (!byFolder.has(f)) byFolder.set(f, []);
        byFolder.get(f).push(p);
    }
    const runs = [];
    for (const [folder, list] of byFolder) {
        list.sort(byDate(info, false));
        for (let i = 0; i < list.length; i += len) runs.push({ folder, paths: list.slice(i, i + len) });
    }
    const shuffled = shuffle(runs, rnd);
    const out = [];
    const pending = shuffled;
    let last = null;
    while (pending.length) {
        let k = pending.findIndex((r) => r.folder !== last);
        if (k < 0) k = 0;
        const [run] = pending.splice(k, 1);
        out.push(run);
        last = run.folder;
    }
    const items = [];
    for (const run of out) {
        const ev = info(run.paths[0]).event;
        run.paths.forEach((p, i) => items.push(i === 0 && ev ? { p, c: { t: ev, d: dateRange(run.paths, info) } } : { p }));
    }
    return items;
}

// Photos shown in the last recentDays play last (oldest shown first), keeping the order otherwise.
function pushBackRecent(items, lastShown, recentDays, now) {
    if (!lastShown || !recentDays) return items;
    const cutoff = now - recentDays * 86400000;
    const fresh = [], recent = [];
    for (const it of items) {
        const t = lastShown(it.p);
        if (t && t > cutoff) recent.push({ it, t }); else fresh.push(it);
    }
    if (!recent.length || !fresh.length) return items;
    recent.sort((a, b) => a.t - b.t);
    return fresh.concat(recent.map((x) => x.it));
}

function build(paths, settings, { seed = 1, info, lastShown = null, now = Date.now() }) {
    const rnd = rng(seed);
    let list = [...new Set(paths)];
    if (settings.upright === "skip") list = list.filter((p) => info(p).upright !== true);
    if (settings.bursts) list = thinBursts(list, info);
    let items;
    switch (settings.order) {
        case "date-asc":
        case "date-desc":
            items = markEvents(list.sort(byDate(info, settings.order === "date-desc")).map((p) => ({ p })), info);
            break;
        case "chapters":
            items = pushBackChapters(chapters(list, info, rnd, settings.chapterLength || 6), lastShown, settings.recentDays, now);
            break;
        default: {
            let pool = list;
            if (settings.highlights) pool = pool.concat(list.filter((p) => info(p).rating > 0)); // rated photos come twice as often
            items = pushBackRecent(shuffle(pool, rnd).map((p) => ({ p })), lastShown, settings.recentDays, now);
            // never the same photo twice in a row (highlights)
            for (let i = 1; i < items.length; i++) {
                if (items[i].p === items[i - 1].p) {
                    const j = items.findIndex((x, k) => k > i + 1 && x.p !== items[i].p);
                    if (j > 0) [items[i], items[j]] = [items[j], items[i]];
                }
            }
        }
    }
    return items;
}

// For chapters, a run counts as recent if most of its photos were shown recently.
function pushBackChapters(items, lastShown, recentDays, now) {
    if (!lastShown || !recentDays) return items;
    const cutoff = now - recentDays * 86400000;
    const runs = [];
    for (const it of items) {
        if (it.c || !runs.length) runs.push([]);
        runs[runs.length - 1].push(it);
    }
    const fresh = [], recent = [];
    for (const r of runs) {
        const n = r.filter((it) => (lastShown(it.p) || 0) > cutoff).length;
        (n * 2 > r.length ? recent : fresh).push(r);
    }
    return fresh.concat(recent).flat();
}

module.exports = { build, rng, shuffle, thinBursts, chapters, pushBackRecent, dateRange, fmtMonth };
