// controls.js - the phone's controls (R14, R20, B41). The same page as the shelf; on a phone a tap
// shows the controls (and asks for full screen), a swipe steps back or forward. Everything goes
// through the photo API, so the shelf, the phone and Paseo always show the same slideshow.
// This file is the shell: the bars over the photo, the panel with its pages, the shared building
// blocks, and Search. Browse is browse.js, Settings settings-ui.js, the map map.js.
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
      else if (k === "value") e.value = v;
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) e.append(kid.nodeType ? kid : String(kid));
    return e;
  };

  // ---------- icons: one hand-drawn set, 24 px grid, 1.7 px line ----------
  const ICONS = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    browse: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    map: '<path d="m9 4.5-5 2v13l5-2 6 2 5-2v-13l-5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
    settings: '<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>', back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>', chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>', down: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', plus: '<path d="M12 5v14M5 12h14"/>', up: '<path d="m5.5 14.5 6.5-6.5 6.5 6.5"/>',
    star: '<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
    prev: '<path d="M18.5 6v12L9 12zM5.5 6v12"/>', next: '<path d="M5.5 6v12L15 12zM18.5 6v12"/>',
    play: '<path d="M7.5 5v14l11.5-7z"/>', pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    pin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    people: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.8 20c.5-3.6 3-5.5 6.2-5.5s5.7 1.9 6.2 5.5"/><path d="M16 5.3a3.5 3.5 0 0 1 0 6.4M18 14.9c1.8.8 3 2.5 3.3 5.1"/>',
    tag: '<path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2L20.5 12a1.6 1.6 0 0 1 0 2.2l-6.3 6.3a1.6 1.6 0 0 1-2.2 0z"/><circle cx="8" cy="8" r="1.3"/>',
    folder: '<path d="M3.5 18V6.5A1.5 1.5 0 0 1 5 5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
    sparkle: '<path d="M12 3.5c.7 4.8 3.2 7.3 8 8-4.8.7-7.3 3.2-8 8-.7-4.8-3.2-7.3-8-8 4.8-.7 7.3-3.2 8-8z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.3 2"/>',
    type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>', film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M8.5 5v14M15.5 5v14M3.5 12h17"/>',
    monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M12 16.5V20M8 20h8"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>', copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    pencil: '<path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8.5 19z"/>', eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    eyeoff: '<path d="M4 4l16 16M9.8 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a15 15 0 0 1-3 3.7M6.5 7.4A15 15 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>', image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.7"/><path d="m4 17 5-4 3.5 2.8L16 12.5l4.5 4"/>',
    bookmark: '<path d="M6.5 3.5h11v17L12 16.5l-5.5 4z"/>', shuffle: '<path d="M3.5 7h3.2c5 0 6.6 10 11.6 10h2.2M3.5 17h3.2c1.7 0 3-1.1 4-2.7M13.5 9.7c1-1.6 2.5-2.7 4.8-2.7h2.2M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>',
    hash: '<path d="M9.5 4 7.5 20M16.5 4l-2 16M4.5 9h16M3.5 15h16"/>',
  };
  function icon(name, cls) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("class", `ic${cls ? ` ${cls}` : ""}`);
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name] || "";
    return s;
  }

  const api = Show.api;
  let st = null, presetData = null, presetsRev = null, vocab = null, words = null;
  let sheet = null; // "search" | "browse" | "map" | "settings" | null
  let stack = []; // the pages open in the panel, deepest last
  let lastTab = "browse", hideTimer = null, settingsKey = null, sliding = false, modal = null;

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
    try { const r = await fn(); if (done) say(typeof done === "function" ? done(r) : done); return r; } catch (e) { say(e.message); return undefined; }
  }

  // ---------- showing and hiding ----------
  function visible() { return !root.classList.contains("hidden"); }
  // While the controls show, the words on the photo step aside (the controls show the same and more).
  function show() { root.classList.remove("hidden"); document.body.classList.add("controls-on"); poke(); }
  function hide() { if (sheet) return; root.classList.add("hidden"); document.body.classList.remove("controls-on"); }
  function poke() { clearTimeout(hideTimer); if (!sheet) hideTimer = setTimeout(hide, 6000); }
  async function fullscreen() {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* the browser said no; the page still works */ }
  }
  const step = (dir) => act(() => Show.step(dir));

  // Tap: full screen and the controls. Swipe left/right: next/back, at once.
  let touch = null;
  document.getElementById("stage").parentElement.addEventListener("pointerdown", (e) => {
    if (root.contains(e.target) && e.target !== root) return;
    touch = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  window.addEventListener("pointerup", (e) => {
    if (!touch) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { step(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      fullscreen();
      if (sheet) { closeSheet(); return; }
      if (visible()) hide(); else show();
    }
  });
  document.addEventListener("keydown", (e) => { // a keyboard (PC, TV browser) works too
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === " ") act(() => api("POST", "/api/player/toggle"));
    else if (e.key === "Escape" && sheet) closeSheet();
  });

  // ---------- the bars over the photo ----------
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const presetLabel = (n) => (presetData && (presetData.presets.find((p) => p.name === n) || {}).label) || n;
  const round = (name, label, click, cls) => h("button", { class: `round${cls ? ` ${cls}` : ""}`, "aria-label": label, on: { click } }, icon(name));
  function renderBars() {
    const i = (st.current && st.current.info) || {};
    const sub = [st.count ? `${(st.position + 1).toLocaleString()} of ${st.count.toLocaleString()}` : "",
      st.preset ? `${presetLabel(st.preset.name)}${st.preset.changed.length ? " (changed)" : ""}` : "",
      st.preparing ? `getting ${st.preparing.label} ready${st.preparing.total ? ` ${Math.round((100 * st.preparing.done) / st.preparing.total)}%` : ""}` : ""].filter(Boolean).join("  ·  ");
    const top = h("div", { class: "bar top" },
      h("div", { class: "title" }, h("div", { class: "t1" }, st.source && st.source.label ? st.source.label : "Slideshow"), h("div", { class: "t2" }, sub)),
      h("div", { class: "bar-actions" }, round("search", "Search", () => openSheet("search")), round("browse", "Browse", () => openSheet("browse")), round("settings", "Settings", () => openSheet("settings"))));
    const info = h("div", { class: "info" },
      i.date ? h("div", { class: "when" }, `${Number(i.date.slice(8, 10))} ${MONTHS[Number(i.date.slice(5, 7)) - 1]} ${i.date.slice(0, 4)}`, h("span", { class: "muted" }, `  ·  ${Show.relDate(i.date)}`)) : null,
      i.place ? h("div", { class: "line" }, icon("pin"), i.place) : null,
      i.event ? h("div", { class: "line muted" }, icon("folder"), i.event) : null,
      i.people && i.people.length ? h("div", { class: "line muted" }, icon("people"), i.people.join(", ")) : null);
    const transport = h("div", { class: "transport" },
      round("star", "Star", () => rate("favourite"), `side star${i.favourite ? " on" : ""}`),
      round("prev", "Back", () => step(-1)),
      round(st.playing ? "pause" : "play", st.playing ? "Pause" : "Play", () => act(() => api("POST", "/api/player/toggle")), "primary"),
      round("next", "Next", () => step(1)),
      round("ban", "Skip this photo", () => rate("skip"), `side bad${i.skipped ? " on" : ""}`));
    return [top, h("div", { class: "bar bottom" }, info, transport)];
  }
  // The result arrives as a toast on every screen, also when saving is refused.
  function rate(what) { if (st.current) api("POST", "/api/photo/toggle", { what, id: st.current.id }).catch(() => {}); }
  function updateBars() {
    const [top, bottom] = renderBars();
    const old = root.querySelectorAll(":scope > .bar");
    if (old.length === 2) { old[0].replaceWith(top); old[1].replaceWith(bottom); } else root.prepend(top, bottom);
  }

  // ---------- the panel and its pages ----------
  const TABS = [["search", "Search", "search"], ["browse", "Browse", "browse"], ["map", "Map", "map"], ["settings", "Settings", "settings"]];
  const rootPage = (name) => ({ search: searchPage, browse: () => window.ShowPanes.browse(app), map: () => window.ShowPanes.map(app), settings: () => window.ShowPanes.settings(app) }[name] || searchPage)();
  const top = () => stack[stack.length - 1];
  function openSheet(name) {
    if (name !== "map") lastTab = name;
    sheet = name; stack = [rootPage(name)];
    clearTimeout(hideTimer);
    renderPanel("enter");
  }
  function closeSheet() { sheet = null; stack = []; closeModal(); const p = root.querySelector(".panel"); if (p) p.remove(); poke(); }
  function push(page) { stack.push(page); renderPanel("push"); }
  function replace(page) { stack[stack.length - 1] = page; renderPanel("push"); }
  function back() { if (stack.length > 1) { stack.pop(); renderPanel("pop"); } else closeSheet(); }
  function renderPanel(motion) {
    let panel = root.querySelector(".panel");
    const fresh = !panel;
    if (fresh) {
      panel = h("div", { class: "panel", on: { pointerdown: (e) => e.stopPropagation(), pointerup: (e) => e.stopPropagation() } }, h("div", { class: "panel-bg" }, h("img", { alt: "" })));
      root.append(panel);
      updateBackdrop();
    }
    const page = top();
    panel.classList.toggle("is-full", !!page.full);
    panel.dataset.tab = sheet;
    panel.querySelectorAll(":scope > .rail, :scope > .panel-main").forEach((n) => n.remove());
    const rail = h("nav", { class: "rail" }, TABS.map(([name, label, ic]) => h("button", { class: sheet === name ? "on" : "", "aria-current": sheet === name ? "page" : null, on: { click: () => openSheet(name) } }, icon(ic), h("span", {}, label))));
    const head = page.full ? null : h("header", { class: "page-head" },
      stack.length > 1 ? round("back", "Go back", back) : null,
      h("div", { class: "page-title" }, h("h2", {}, page.title), page.sub ? h("p", {}, typeof page.sub === "function" ? page.sub() : page.sub) : null),
      page.actions ? page.actions() : null,
      round("close", "Close", closeSheet));
    const body = h("div", { class: "page-body" }, page.render());
    const main = h("div", { class: `panel-main${motion ? ` go-${motion}` : ""}` }, head, h("div", { class: "pane" }, body));
    panel.append(rail, main);
    settingsKey = keyOf();
  }
  // Redraw the open page where it is (new data, or a setting changed elsewhere).
  function refresh() {
    const pane = root.querySelector(".panel .pane");
    if (!pane || !top()) return;
    const y = pane.scrollTop;
    pane.querySelector(".page-body").replaceChildren(...[top().render()].flat(Infinity).filter(Boolean));
    pane.scrollTop = y;
    settingsKey = keyOf();
  }
  function updateBackdrop() {
    const img = root.querySelector(".panel-bg img");
    const u = st && st.current && st.current.thumb;
    if (img && u && img.getAttribute("src") !== u) img.src = u;
  }
  const keyOf = () => (st ? JSON.stringify([st.settings, st.preset]) : "");

  // ---------- pop-ups: a list to choose from, a question, a name to type ----------
  function closeModal() { if (modal) { modal.remove(); modal = null; } }
  function openModal(cls, ...kids) {
    closeModal();
    modal = h("div", { class: "modal", on: { pointerdown: (e) => { e.stopPropagation(); if (e.target === modal) closeModal(); }, pointerup: (e) => e.stopPropagation() } }, h("div", { class: `modal-card ${cls}`, role: "dialog", "aria-modal": "true" }, kids));
    root.append(modal);
    return modal;
  }
  function pick({ title, options, value, onPick, demo }) {
    openModal("picker", h("div", { class: "modal-head" }, h("h3", {}, title), round("close", "Close", closeModal)),
      h("div", { class: "picker-list" }, options.map((o) => h("button", { class: `option${o.name === value ? " on" : ""}`, on: { click: () => { closeModal(); onPick(o.name); } } },
        demo ? h("span", { class: `tdemo t-${o.name}` }, h("i"), h("i")) : o.icon ? h("span", { class: "chip-ic" }, icon(o.icon)) : null,
        h("span", { class: "option-text" }, h("b", {}, o.label), o.about ? h("small", {}, o.about) : null),
        o.name === value ? icon("check", "tick") : null))));
    const on = modal.querySelector(".option.on");
    if (on) on.scrollIntoView({ block: "center" });
  }
  function ask({ title, text, ok = "OK", danger }) {
    return new Promise((res) => {
      openModal("dialog", h("h3", {}, title), text ? h("p", {}, text) : null, h("div", { class: "dialog-actions" },
        h("button", { class: "btn", on: { click: () => { closeModal(); res(false); } } }, "Cancel"),
        h("button", { class: `btn ${danger ? "danger" : "accent"}`, on: { click: () => { closeModal(); res(true); } } }, ok)));
    });
  }
  function promptText({ title, text, value = "", placeholder, ok = "Save" }) {
    return new Promise((res) => {
      const input = h("input", { type: "text", class: "field", maxlength: 40, value, placeholder, autocomplete: "off" });
      const done = (v) => { closeModal(); res(v); };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(input.value.trim() || null); });
      openModal("dialog", h("h3", {}, title), text ? h("p", {}, text) : null, input, h("div", { class: "dialog-actions" },
        h("button", { class: "btn", on: { click: () => done(null) } }, "Cancel"),
        h("button", { class: "btn accent", on: { click: () => done(input.value.trim() || null) } }, ok)));
      setTimeout(() => { input.focus(); input.select(); }, 60);
    });
  }

  // ---------- building blocks ----------
  const ui = {
    group: (title, ...rows) => h("section", { class: "group" }, title ? h("h3", {}, title) : null, h("div", { class: "group-card" }, rows)),
    row: (label, sub, control, opts = {}) => h(opts.click ? "button" : "div", { class: `row${opts.cls ? ` ${opts.cls}` : ""}`, on: opts.click ? { click: opts.click } : undefined },
      opts.icon ? h("span", { class: "chip-ic" }, icon(opts.icon)) : null,
      h("span", { class: "row-text" }, h("span", { class: "row-label" }, label), sub ? h("small", {}, sub) : null), control),
    toggle: (label, sub, value, onChange, opts = {}) => ui.row(label, sub,
      h("span", { class: `switch${value ? " on" : ""}`, role: "switch", "aria-checked": value ? "true" : "false" }, h("i")),
      { ...opts, cls: "is-toggle", click: () => onChange(!value) }),
    select: (label, sub, options, value, onPick, opts = {}) => {
      const cur = options.find((o) => o.name === value);
      return ui.row(label, sub, h("span", { class: "select-value" }, h("span", {}, cur ? cur.label : value), icon("down")),
        { ...opts, cls: "is-select", click: () => pick({ title: label, options, value, onPick, demo: opts.demo }) });
    },
    seg: (options, value, onPick) => h("div", { class: "seg", role: "radiogroup" }, options.map((o) => h("button", { class: o.name === value ? "on" : "", role: "radio", "aria-checked": o.name === value ? "true" : "false", on: { click: () => onPick(o.name) } }, o.short || o.label))),
    stacked: (label, control, sub) => h("div", { class: "row stacked" }, h("span", { class: "row-text" }, h("span", { class: "row-label" }, label), sub ? h("small", {}, sub) : null), control),
    slider: ({ label, sub, min, max, step: by = 1, value, format, onInput, onCommit }) => {
      const out = h("span", { class: "slider-value" }, format(value));
      const input = h("input", { type: "range", min, max, step: by, value, "aria-label": label, on: {
        pointerdown: () => { sliding = true; }, input: (e) => { out.textContent = format(Number(e.target.value)); paintRange(e.target); if (onInput) onInput(Number(e.target.value)); },
        change: (e) => { sliding = false; onCommit(Number(e.target.value)); } } });
      paintRange(input);
      return h("div", { class: "row stacked slider" }, h("span", { class: "row-text inline" }, h("span", { class: "row-label" }, label), out), input, sub ? h("small", { class: "slider-sub" }, sub) : null);
    },
    empty: (ic, title, text) => h("div", { class: "empty" }, h("span", { class: "empty-ic" }, icon(ic)), h("h4", {}, title), text ? h("p", {}, text) : null),
    loading: (text = "Loading…") => h("div", { class: "loading" }, h("i"), text),
    img: (src, cls) => { const i = h("img", { class: cls || "cover", alt: "", loading: "lazy", decoding: "async", src, on: { load: (e) => e.target.classList.add("in"), error: (e) => e.target.remove() } }); return i; },
  };
  function paintRange(input) { const p = ((input.value - input.min) / (input.max - input.min)) * 100; input.style.setProperty("--p", `${p}%`); }

  // Change settings: shown here at once, sent to the Pi in order.
  let sending = Promise.resolve(), unsent = 0;
  function patch(change) {
    const s = { ...st.settings, ...change };
    if (change.clockStyle) s.clockStyle = { ...st.settings.clockStyle, ...change.clockStyle };
    if (change.overlay) s.overlay = { ...st.settings.overlay, ...change.overlay };
    if ((change.overlay || change.overlayStyle !== undefined) && change.overlayMode === undefined) s.overlayMode = "styles";
    st = { ...st, settings: s };
    refresh();
    unsent++;
    sending = sending.then(() => api("PATCH", "/api/player/settings", change)).catch((e) => say(e.message)).finally(() => { unsent--; });
    return sending;
  }

  async function loadVocab() {
    if (!vocab) vocab = await api("GET", "/api/vocabulary").catch(() => ({ keywords: [], people: [], folders: [], places: [], years: {} }));
    if (!words) words = await api("GET", "/api/words").catch(() => ({ words: {} }));
    return vocab;
  }
  async function play(source, msg) {
    closeSheet();
    say(`Starting ${source.label}…`);
    await act(() => api("POST", "/api/player/source", { source }), (x) => msg || (x.preparing ? `Getting ${source.label} ready…` : `Playing ${source.label}: ${x.count} photos`));
  }
  const loadPresets = () => api("GET", "/api/presets?all=1").then((p) => { presetData = p; if (st) updateBars(); if (sheet === "settings") refresh(); }).catch(() => {});

  // ---------- search: type a word, pick it, AND or OR, the next ----------
  const STOP = new Set(["in", "of", "the", "and", "at", "on", "from", "to", "with", "a", "an", "for", "photos", "pictures"]);
  const KIND_ICON = { "your word": "sparkle", keyword: "tag", person: "people", country: "pin", folder: "folder", year: "calendar" };
  let picked = []; // { kind, label, query?, place?, year?, op }
  let typed = "", countText = "";
  const folderName = (p) => p.split("/").pop();
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
    const q = [], places = [], years = [];
    picked.forEach((c) => {
      if (c.query) { if (q.length) q.push(c.op === "OR" ? "OR" : ""); q.push(c.query); } else if (c.place) places.push(c.place); else if (c.year) years.push(c.year);
    });
    const query = q.filter(Boolean).join(" ").trim();
    const src = { label: picked.map((c, k) => (k ? (c.op === "OR" ? " or " : " + ") : "") + c.label).join("") };
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
    }
    const c = root.querySelector(".play-row .count"); // only the number: the person may be typing the next word
    if (sheet === "search" && c) c.textContent = countText;
  }
  function suggestBox() {
    return h("div", { class: "suggest" }, suggestions().map((c) => h("button", { on: { click: () => { picked.push({ ...c, op: "AND" }); typed = ""; updateCount(); refresh(); } } },
      h("span", { class: "chip-ic" }, icon(KIND_ICON[c.kind] || "pin")), h("span", { class: "row-text" }, h("span", { class: "row-label" }, c.label), h("small", { class: "kind" }, `${c.kind}${c.n ? ` · ${c.n.toLocaleString()}` : ""}`)))));
  }
  function searchPage() {
    return { title: "Search", sub: "A place, a person, a trip, a year", render() {
      if (!vocab || !words) { loadVocab().then(() => { if (sheet === "search") refresh(); }); return ui.loading("Loading your words…"); }
      const input = h("input", { type: "search", class: "field", placeholder: "Try “Italy” or “2019”", value: typed, autocomplete: "off",
        on: { input: (e) => { typed = e.target.value; root.querySelector(".suggest").replaceWith(suggestBox()); } } });
      setTimeout(() => { if (sheet === "search" && input.isConnected && !picked.length) input.focus(); }, 50);
      return h("div", { class: "search" }, h("div", { class: "search-box" }, icon("search"), input), suggestBox(),
        picked.length ? h("div", { class: "picked" }, picked.map((c, k) => [
          k ? h("button", { class: "op", on: { click: () => { c.op = c.op === "OR" ? "AND" : "OR"; updateCount(); refresh(); } } }, c.op === "OR" ? "or" : "and") : null,
          h("span", { class: "chip" }, c.label, h("button", { class: "x", "aria-label": `Remove ${c.label}`, on: { click: () => { picked.splice(k, 1); updateCount(); refresh(); } } }, icon("close")))])) : null,
        picked.length ? h("div", { class: "play-row" }, h("span", { class: "count" }, countText),
          h("button", { class: "btn", on: { click: () => { picked = []; countText = ""; refresh(); } } }, "Clear"),
          h("button", { class: "btn accent", on: { click: () => { const src = buildSource(); play(src); } } }, icon("play"), "Play"))
          : h("p", { class: "hint" }, "Pick several words to combine them. “and” needs both; tap it to make it “or”."));
    } };
  }

  // ---------- the app the panels are built with ----------
  const app = {
    h, icon, api, say, act, ui, play, patch, pick, ask, promptText, push, replace, back, refresh, loadVocab, openSheet, closeSheet, loadPresets, closeMap: () => openSheet(lastTab),
    get st() { return st; }, get vocab() { return vocab; }, get presets() { return presetData; },
    isOpen: (name) => sheet === name, isTop: (page) => top() === page,
  };

  Show.onState((s) => {
    st = unsent && st ? { ...s, settings: st.settings } : s; // an event from before a change must not undo it on screen
    updateBars();
    updateBackdrop();
    if (s.presetsRev !== presetsRev) { presetsRev = s.presetsRev; loadPresets(); }
    if (!sheet || sliding || top().full || keyOf() === settingsKey) return;
    const typing = document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
    if (!typing && top().live) refresh(); else if (!typing) settingsKey = keyOf();
  });
  window.ShowControls = { show, hide, openSheet, closeSheet, busy: () => !!sheet || !!modal || visible(), get picked() { return picked; } };
})();
