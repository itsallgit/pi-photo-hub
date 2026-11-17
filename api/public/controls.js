// controls.js - the phone controls layer (R14, R20 UI). The same page as the shelf; on a phone a tap
// shows the controls (and asks for full screen), a swipe steps back or forward. Everything goes
// through the photo API, so the shelf, the phone and Paseo always show the same slideshow.
// Not shown on the shelf screen (kiosk).
"use strict";
(function () {
  const Show = window.Show;
  if (!Show || Show.kiosk) return;
  const root = document.getElementById("controls");
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === "class") e.className = v;
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : String(kid));
    return e;
  };
  const api = Show.api;
  let st = null, presets = null, vocab = null, words = null;
  let sheet = null; // "search" | "browse" | "settings" | "map" | null
  let hideTimer = null;

  // ---------- messages ----------
  let msgTimer = null;
  function say(text) {
    let m = root.querySelector(".msg");
    if (!m) { m = h("div", { class: "msg" }); root.append(m); }
    m.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => m.remove(), 2600);
  }
  async function act(fn, done) {
    try { const r = await fn(); if (done) say(typeof done === "function" ? done(r) : done); return r; } catch (e) { say(e.message); }
  }

  // ---------- showing and hiding ----------
  function visible() { return !root.classList.contains("hidden"); }
  // While the controls show, the on-photo words step aside (the controls show the same and more).
  function show() { root.classList.remove("hidden"); document.body.classList.add("controls-on"); poke(); }
  function hide() { if (sheet) return; root.classList.add("hidden"); document.body.classList.remove("controls-on"); }
  function poke() { clearTimeout(hideTimer); if (!sheet) hideTimer = setTimeout(hide, 6000); }
  async function fullscreen() {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* the browser said no; the page still works */ }
  }

  // Tap: full screen and the controls. Swipe left/right: next/back.
  let touch = null;
  document.getElementById("stage").parentElement.addEventListener("pointerdown", (e) => {
    if (window.SHOW_DEBUG) console.log("pointerdown", e.target.id || e.target.className, e.clientX);
    if (root.contains(e.target) && e.target !== root) return;
    touch = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  window.addEventListener("pointercancel", (e) => { if (window.SHOW_DEBUG) console.log("pointercancel"); });
  window.addEventListener("pointerup", (e) => {
    if (!touch) return;
    if (window.SHOW_DEBUG) console.log("pointerup", e.clientX, touch.x, e.clientY, touch.y);
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      act(() => api("POST", dx < 0 ? "/api/player/next" : "/api/player/back"));
      return;
    }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      fullscreen();
      if (sheet) { closeSheet(); return; }
      if (visible()) hide(); else show();
    }
  });
  document.addEventListener("keydown", (e) => { // a keyboard (PC, TV browser) works too
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight") act(() => api("POST", "/api/player/next"));
    else if (e.key === "ArrowLeft") act(() => api("POST", "/api/player/back"));
    else if (e.key === " ") act(() => api("POST", "/api/player/toggle"));
  });

  // ---------- now playing ----------
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function renderBars() {
    const cur = st.current;
    const i = (cur && cur.info) || {};
    const marked = (k) => (i.marks || []).includes(k);
    const top = h("div", { class: "bar top" },
      h("div", { class: "title" },
        h("div", { class: "t1" }, st.source && st.source.label ? st.source.label : "Slideshow"),
        h("div", { class: "t2" }, st.count ? `${st.position + 1} of ${st.count}` : "", st.preset ? ` · ${presetLabel(st.preset.name)}${st.preset.changed.length ? " (changed)" : ""}` : "",
          st.preparing ? ` · getting ${st.preparing.label} ready${st.preparing.total ? ` ${Math.round((100 * st.preparing.done) / st.preparing.total)}%` : ""}` : "")),
      h("button", { "aria-label": "Search", on: { click: () => openSheet("search") } }, "🔍"),
      h("button", { "aria-label": "Browse", on: { click: () => openSheet("browse") } }, "☰"),
      h("button", { "aria-label": "Settings", on: { click: () => openSheet("settings") } }, "⚙"));
    const info = h("div", { class: "info" },
      i.date ? h("div", { class: "when" }, `${Number(i.date.slice(8, 10))} ${MONTHS[Number(i.date.slice(5, 7)) - 1]} ${i.date.slice(0, 4)}`, h("span", { class: "muted" }, ` · ${Show.relDate(i.date)}`)) : null,
      i.place ? h("div", {}, i.place) : null,
      i.event ? h("div", { class: "muted" }, i.event) : null,
      i.people && i.people.length ? h("div", { class: "muted" }, i.people.join(", ")) : null);
    const bottom = h("div", { class: "bar bottom" }, info,
      h("div", { class: "buttons" },
        h("button", { class: `big${marked("star") ? " on" : ""}`, "aria-label": "Star", on: { click: () => mark("star") } }, "★"),
        h("button", { class: "big", "aria-label": "Back", on: { click: () => act(() => api("POST", "/api/player/back")) } }, "⏮"),
        h("button", { class: "big", "aria-label": st.playing ? "Pause" : "Play", on: { click: () => act(() => api("POST", "/api/player/toggle")) } }, st.playing ? "❚❚" : "▶"),
        h("button", { class: "big", "aria-label": "Next", on: { click: () => act(() => api("POST", "/api/player/next")) } }, "⏭"),
        h("button", { class: `big bad${marked("bad") ? " on" : ""}`, "aria-label": "Bad photo", on: { click: () => mark("bad") } }, "⚑")));
    return [top, bottom];
  }
  async function mark(kind) {
    const cur = st.current;
    if (!cur) return;
    const has = (cur.info.marks || []).includes(kind);
    await act(() => api(has ? "DELETE" : "POST", "/api/marks", { id: cur.id, mark: kind, by: "phone" }),
      has ? "Mark removed" : kind === "star" ? "Starred: on the review list for your pipeline" : "Marked as a bad photo: on the review list");
  }
  const presetLabel = (n) => (presets && (presets.presets.find((p) => p.name === n) || {}).label) || n;

  // ---------- the sheet ----------
  function openSheet(name) { sheet = name; clearTimeout(hideTimer); render(); }
  function closeSheet() { sheet = null; render(); poke(); }
  function renderSheet() {
    const tab = (name, label) => h("button", { class: sheet === name ? "on" : "", on: { click: () => openSheet(name) } }, label);
    const panes = { search: searchPane, browse: browsePane, settings: settingsPane, map: mapPane };
    return h("div", { class: "sheet", on: { pointerdown: (e) => e.stopPropagation(), pointerup: (e) => e.stopPropagation() } },
      h("div", { class: "tabs" }, tab("search", "Search"), tab("browse", "Browse"), window.ShowMap ? tab("map", "Map") : null, tab("settings", "Settings"),
        h("span", { class: "spacer" }), h("button", { "aria-label": "Close", on: { click: closeSheet } }, "✕")),
      h("div", { class: "pane" }, (panes[sheet] || searchPane)()));
  }

  // ---------- search: type a word, pick it, AND or OR, the next ----------
  const STOP = new Set(["in", "of", "the", "and", "at", "on", "from", "to", "with", "a", "an", "for", "photos", "pictures"]);
  let picked = []; // { kind, label, query?, place?, year?, op }
  let typed = "";
  let countText = "";
  async function loadVocab() {
    if (!vocab) vocab = await api("GET", "/api/vocabulary").catch(() => ({ keywords: [], people: [], folders: [], places: [], years: {} }));
    if (!words) words = await api("GET", "/api/words").catch(() => ({ words: {} }));
  }
  function folderName(p) { const parts = p.split("/"); return parts[parts.length - 1]; }
  function candidates() {
    const out = [];
    for (const [term, e] of Object.entries(words.words || {})) if (e.query) out.push({ kind: "your word", label: term, query: e.query, n: null, about: e.means });
    for (const k of vocab.keywords || []) if (k.searchable) out.push({ kind: "keyword", label: k.word, query: k.word, n: k.photos });
    for (const p of vocab.people || []) if (p.searchable) out.push({ kind: "person", label: p.word, query: p.word, n: p.photos });
    for (const c of vocab.places || []) {
      out.push({ kind: "country", label: c.country, place: c.key, n: c.photos });
      for (const city of c.cities) out.push({ kind: `place, ${c.country}`, label: city.city, place: city.key, n: city.photos });
    }
    for (const f of vocab.folders || []) out.push({ kind: "folder", label: folderName(f.path), query: f.query, n: f.photos, about: f.path });
    for (const [y, n] of Object.entries(vocab.years || {})) out.push({ kind: "year", label: y, year: Number(y), n });
    return out;
  }
  function suggestions() {
    const tokens = typed.toLowerCase().split(/\s+/).filter((w) => w && !STOP.has(w));
    if (!tokens.length) return [];
    const scored = [];
    for (const c of candidates()) {
      const l = c.label.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (l === t) score += 3; else if (l.startsWith(t) || l.includes(` ${t}`)) score += 2; else if (l.includes(t)) score += 1; else { score = 0; break; }
      }
      if (score) scored.push([score + Math.log10((c.n || 1) + 1) / 10, c]);
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, 12).map((x) => x[1]);
  }
  function buildSource() {
    const q = [];
    const places = [], years = [];
    picked.forEach((c, k) => {
      if (c.query) {
        const part = /\s/.test(c.query) && !/^dirall:/.test(c.query) && c.kind !== "your word" ? c.query : c.query;
        if (q.length) q.push(c.op === "OR" ? "OR" : "");
        q.push(part);
      } else if (c.place) places.push(c.place);
      else if (c.year) years.push(c.year);
    });
    const query = q.filter(Boolean).join(" ").trim();
    const label = picked.map((c, k) => (k ? (c.op === "OR" ? " or " : " + ") : "") + c.label).join("");
    const src = { label };
    if (query) src.query = query;
    if (places.length) src.places = places;
    if (years.length) src.years = years;
    return src;
  }
  async function updateCount() {
    const src = buildSource();
    countText = "";
    if (src.query && !src.places && !src.years) {
      try { const r = await api("GET", `/api/count?q=${encodeURIComponent(src.query)}`); countText = `${r.results[0].count} photos`; } catch (e) { countText = e.message; }
    } else if (picked.length) countText = "";
    if (sheet === "search") render();
  }
  function searchPane() {
    if (!vocab) { loadVocab().then(render); return h("div", {}, "Loading the words…"); }
    const input = h("input", { type: "search", placeholder: "Type a word: a place, a person, a trip, a year…", value: typed, autocomplete: "off",
      on: { input: (e) => { typed = e.target.value; const s = root.querySelector(".suggest"); if (s) s.replaceWith(suggestBox()); } } });
    setTimeout(() => { if (sheet === "search" && document.activeElement !== input && !picked.length) input.focus(); }, 50);
    return h("div", {}, input, suggestBox(),
      h("div", { class: "picked" }, picked.map((c, k) => [
        k ? h("button", { class: "op", on: { click: () => { c.op = c.op === "OR" ? "AND" : "OR"; updateCount(); render(); } } }, c.op === "OR" ? "or" : "and") : null,
        h("span", { class: "chip" }, c.label, h("button", { class: "x", "aria-label": `Remove ${c.label}`, on: { click: () => { picked.splice(k, 1); updateCount(); render(); } } }, "✕"))])),
      picked.length ? h("div", { class: "play-row" }, h("span", { class: "count" }, countText),
        h("button", { on: { click: () => { picked = []; countText = ""; render(); } } }, "Clear"),
        h("button", { class: "on", on: { click: playPicked } }, "Play")) : h("p", { class: "muted" }, "Pick words to combine them: \"and\" needs both, tap it to make it \"or\" (any of them)."));
  }
  function suggestBox() {
    return h("div", { class: "suggest" }, suggestions().map((c) => h("button", { on: { click: () => {
      picked.push({ ...c, op: "AND" }); typed = ""; updateCount(); render();
    } } }, h("span", {}, c.label), h("span", { class: "kind" }, `${c.kind}${c.n ? ` · ${c.n}` : ""}`))));
  }
  async function playPicked() {
    const src = buildSource();
    closeSheet(); // at once: the answer can take a moment, and the sheet may be opened again meanwhile
    say(`Starting ${src.label}…`);
    await act(() => api("POST", "/api/player/source", { source: src }), (x) => (x.preparing ? `Getting ${src.label} ready…` : `Playing ${src.label}: ${x.count} photos`));
  }
  async function play(source, msg) {
    closeSheet();
    say(`Starting ${source.label}…`);
    await act(() => api("POST", "/api/player/source", { source }), (x) => msg || (x.preparing ? `Getting ${source.label} ready…` : `Playing ${source.label}: ${x.count} photos`));
  }

  // ---------- browse: years, places, people, keywords, folders, specials ----------
  const open = new Set();
  function browsePane() {
    if (!vocab) { loadVocab().then(render); return h("div", {}, "Loading…"); }
    const toggle = (k) => { if (open.has(k)) open.delete(k); else open.add(k); render(); };
    const item = (label, n, onPlay, extra) => h("button", { on: { click: onPlay } }, h("span", {}, label), h("span", { class: "n" }, extra || (n ? `${n}` : "")));
    const years = Object.entries(vocab.years || {}).sort();
    const dateOrder = st.settings.order === "date-asc" || st.settings.order === "date-desc";
    const tree = buildFolderTree(vocab.folders || []);
    return h("div", { class: "list" },
      h("h3", {}, dateOrder ? "Years: jump to" : "Years: play"),
      h("div", { class: "years" }, years.map(([y, n]) => h("button", { on: { click: () => (dateOrder ? act(() => api("POST", "/api/player/jump", { year: Number(y) }), `Jumped to ${y}`) : play({ years: [Number(y)], label: y })) } }, `${y} `, h("span", { class: "n" }, n)))),
      h("h3", {}, "Suggestions"),
      item("This week in past years", null, () => play({ onThisDay: true, label: "This week in past years" })),
      item("Not seen in a while (90 days)", null, () => play({ notSeenDays: 90, label: "Not seen in a while" })),
      h("h3", {}, "Places"),
      (vocab.places || []).length ? (vocab.places || []).map((c) => [
        h("button", { on: { click: () => toggle(`c:${c.cc}`) } }, h("span", {}, `${open.has(`c:${c.cc}`) ? "▾" : "▸"} ${c.country}`), h("span", { class: "n" }, c.photos)),
        open.has(`c:${c.cc}`) ? h("div", { class: "sub" }, item(`All of ${c.country}`, c.photos, () => play({ places: [c.key], label: c.country })),
          c.cities.map((city) => item(city.city, city.photos, () => play({ places: [city.key], label: city.city })))) : null]) : h("p", {}, "No places yet (the nightly build adds them)."),
      h("h3", {}, "People"),
      (vocab.people || []).filter((p) => p.searchable).map((p) => item(p.word, p.photos, () => play({ query: p.word, label: p.word }))),
      h("h3", {}, "Keywords"),
      (vocab.keywords || []).filter((p) => p.searchable).map((p) => item(p.word, p.photos, () => play({ query: p.word, label: p.word }))),
      h("h3", {}, "Folders"),
      folderNodes(tree, toggle, item));
  }
  function buildFolderTree(folders) {
    const root2 = { children: new Map() };
    for (const f of folders) {
      let node = root2;
      for (const part of f.path.split("/")) {
        if (!node.children.has(part)) node.children.set(part, { name: part, children: new Map() });
        node = node.children.get(part);
      }
      node.folder = f;
    }
    return root2;
  }
  function folderNodes(node, toggle, item, depth = 0) {
    return [...node.children.values()].sort((a, b) => (a.name < b.name ? 1 : -1)).map((n) => {
      const key = `f:${n.folder ? n.folder.path : n.name}`;
      const kids = n.children.size;
      const row = kids
        ? h("button", { on: { click: () => toggle(key) } }, h("span", {}, `${open.has(key) ? "▾" : "▸"} ${n.name}`), h("span", { class: "n" }, n.folder ? n.folder.photos : ""))
        : item(n.name, n.folder && n.folder.photos, () => play({ query: n.folder.query, label: n.name }));
      return [row, kids && open.has(key) ? h("div", { class: "sub" }, n.folder ? item(`All of ${n.name}`, n.folder.photos, () => play({ query: n.folder.query, label: n.name })) : null, folderNodes(n, toggle, item, depth + 1)) : null];
    });
  }

  // ---------- settings ----------
  let schedule = null;
  function settingsPane() {
    const s = st.settings;
    const set = (change) => act(() => api("PATCH", "/api/player/settings", change));
    const seg = (key, values, labels, sub) => h("div", { class: "seg" }, values.map((v, k) => {
      const cur = sub ? s[key][sub] : s[key];
      return h("button", { class: cur === v ? "on" : "", on: { click: () => set(sub ? { [key]: { [sub]: v } } : { [key]: v }) } }, labels ? labels[k] : String(v));
    }));
    const row = (label, control) => h("div", { class: "row" }, h("label", {}, label), control);
    const onoff = (key, sub) => seg(key, [true, false], ["On", "Off"], sub);
    if (!schedule) api("GET", "/api/schedule").then((x) => { schedule = x; if (sheet === "settings") render(); }).catch(() => {});
    const styles = presets ? presets.overlayStyles : [];
    return h("div", {},
      h("h3", {}, "Presets"),
      h("div", { class: "seg", style: "justify-content:flex-start" }, (presets ? presets.presets : []).map((p) =>
        h("button", { class: s.preset === p.name ? "on" : "", title: p.about, on: { click: () => act(() => api("POST", "/api/player/preset", { name: p.name }), `${p.label}: ${p.about}`) } }, p.label))),
      h("h3", {}, "Playing"),
      row("Plays by itself", onoff("autoplay")),
      row(`Each photo: ${s.interval} s`, h("div", { class: "seg" },
        h("button", { on: { click: () => act(() => api("POST", "/api/player/nudge", { setting: "interval", by: -1 })) } }, "Faster"),
        h("button", { on: { click: () => act(() => api("POST", "/api/player/nudge", { setting: "interval", by: 1 })) } }, "Slower"))),
      row("Order", seg("order", ["random", "chapters", "date-asc", "date-desc"], ["Random", "Chapters", "Oldest first", "Newest first"])),
      row("Upright photos", seg("upright", ["fill", "skip"], ["Show", "Skip"])),
      row("One photo per burst", onoff("bursts")),
      row("Starred photos more often", onoff("highlights")),
      h("h3", {}, "Look"),
      row("Motion", seg("motion", ["off", "subtle", "lively"], ["Off", "Subtle", "Lively"])),
      row("Transition", seg("transition", ["fade", "slide", "zoom", "dip"], ["Fade", "Slide", "Zoom", "Dip"])),
      row("Title cards", onoff("titleCards")),
      row("Clock", onoff("clock")),
      row("Night (dimmer)", onoff("night")),
      h("h3", {}, "Words on screen"),
      row("Date", seg("overlay", ["off", "absolute", "relative"], ["Off", "Date", "How long ago"], "date")),
      row("Place", onoff("overlay", "place")),
      row("Event", onoff("overlay", "event")),
      row("People", onoff("overlay", "people")),
      row(`Style: ${styles[s.overlayStyle] ? styles[s.overlayStyle].name : s.overlayStyle}`, h("button", { on: { click: () => act(() => api("POST", "/api/player/nudge", { setting: "overlayStyle" })) } }, "Next style")),
      h("h3", {}, "Screen"),
      row("Shelf screen", h("div", { class: "seg" },
        h("button", { on: { click: () => act(() => api("POST", "/api/screen", { on: false }), "Screen off") } }, "Off"),
        h("button", { on: { click: () => act(() => api("POST", "/api/screen", { on: false, minutes: 60 }), "Screen off for an hour") } }, "Off 1 h"),
        h("button", { on: { click: () => act(() => api("POST", "/api/screen", { on: true }), "Screen on") } }, "On"))),
      schedule ? row(`Every night: off ${schedule.off}, on ${schedule.on}`, h("div", { class: "seg" },
        h("button", { class: schedule.enabled ? "on" : "", on: { click: async () => { schedule = await act(() => api("PUT", "/api/schedule", { enabled: !schedule.enabled }), (x) => (x.enabled ? "Nightly schedule on" : "Nightly schedule off")) || schedule; render(); } } }, schedule.enabled ? "On" : "Off"))) : null,
      h("h3", {}, "Fallback"),
      row("Shelf shows", seg("viewer", ["layer", "picapport"], ["This page", "Picapport's page"])));
  }
  function mapPane() { return window.ShowMap ? window.ShowMap.pane({ h, api, play, say }) : h("div", {}, "No map"); }

  // ---------- render ----------
  function render() {
    if (!st) return;
    const active = document.activeElement && document.activeElement.tagName === "INPUT" ? document.activeElement : null;
    const scroll = root.querySelector(".pane") ? root.querySelector(".pane").scrollTop : 0;
    root.replaceChildren(...renderBars(), ...(sheet ? [renderSheet()] : []));
    const pane = root.querySelector(".pane");
    if (pane) pane.scrollTop = scroll;
    if (active) { const i = root.querySelector("input[type=search]"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  api("GET", "/api/presets").then((p) => { presets = p; render(); }).catch(() => {});
  Show.onState((s) => {
    st = s;
    // keep a typing person's sheet stable: re-render only the bars
    if (sheet === "search" && document.activeElement && document.activeElement.tagName === "INPUT") {
      const [top, bottom] = renderBars();
      const bars = root.querySelectorAll(".bar");
      if (bars.length === 2) { bars[0].replaceWith(top); bars[1].replaceWith(bottom); return; }
    }
    render();
  });
  window.ShowControls = { show, hide, openSheet, closeSheet, get picked() { return picked; } };
})();
