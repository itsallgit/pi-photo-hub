// settings-ui.js - the phone's Settings: a home page with the presets and one tile per subject, and a
// page for each subject. The menus are built from the catalog in config/slideshow-presets.json, so a
// new transition or clock face added there shows up here by itself. Every change shows at once on the
// real screens; the previews use the same drawing code as the shelf (hud.js).
"use strict";
(function () {
  window.ShowPanes = window.ShowPanes || {};
  const INTERVALS = [3, 5, 8, 10, 12, 15, 20, 25, 30, 40, 60, 90, 120, 180, 300];
  const ORDERS = [
    { name: "random", label: "Shuffle", about: "Any photo, any time" }, { name: "chapters", label: "Chapters", about: "A few photos from one event, then the next" },
    { name: "date-asc", label: "Oldest first", about: "From the beginning" }, { name: "date-desc", label: "Newest first", about: "Most recent first" },
  ];
  const SAMPLE = { date: "2026-09-19T12:00:00", place: "Vernazza, Italy", country: "Italy", city: "Vernazza", event: "Honeymoon › Cinque Terre", people: ["Sam", "Alex"] };
  const PRESET_ICONS = { ambient: "sparkle", present: "image", guests: "people", night: "moon" };
  const secs = (s) => (s >= 120 ? `${s / 60} minutes` : `${s} seconds`);

  window.ShowPanes.settings = function (app) {
    const { h, icon, api, ui, push, patch, say, act } = app;
    const Hud = window.ShowHud;
    const S = () => app.st.settings;
    const cat = () => (app.presets ? app.presets.catalog : null);
    const label = (list, name) => (list.find((x) => x.name === name) || {}).label || name;
    const toggle = (key, title, sub, opts) => ui.toggle(title, sub, !!S()[key], (v) => patch({ [key]: v }), opts);
    const live = (page) => ({ live: true, ...page });

    // ---------- the preview: a small shelf screen, drawn by the shelf's own code ----------
    function preview({ clockStyle, showClock, showCaptions, settings, cls }) {
      const photo = app.st.current || {};
      const hud = h("div", { class: "hud" });
      const box = h("div", { class: `preview${cls ? ` ${cls}` : ""}` }, photo.thumb ? h("img", { class: "preview-photo", src: photo.thumb, alt: "" }) : null);
      const scrim = clockStyle && showClock && clockStyle.scrim !== "none" ? h("div", { class: `preview-scrim ${clockStyle.scrim}` }) : null;
      if (scrim) box.append(scrim);
      box.append(hud);
      const paint = () => {
        if (!box.isConnected) return;
        Hud.makeHud(hud);
        const f = box.getBoundingClientRect();
        const ctx = { fill: photo.thumb, root: () => f, lum: null };
        const shown = { ...photo, info: { ...SAMPLE, ...Object.fromEntries(Object.entries(photo.info || {}).filter(([, v]) => v && (!Array.isArray(v) || v.length))) } };
        if (showCaptions) Hud.renderCaptions(hud, { ...app.st, settings: settings || S() }, shown, window.Show.styles, window.Show.now, ctx);
        if (showClock && clockStyle) {
          const c = h("div", { class: "clock" });
          Hud.anchor(hud, clockStyle.position).append(c);
          Hud.renderClock(c, clockStyle, new Date(window.Show.now), ctx, { still: true });
        }
      };
      requestAnimationFrame(paint);
      return box;
    }

    function posGrid(options, value, onPick) {
      const cells = ["top-left", "top-center", "top-right", null, "center", null, "bottom-left", "bottom-center", "bottom-right"];
      return h("div", { class: "pos-grid", role: "radiogroup" }, cells.map((c) => {
        const o = c && options.find((x) => x.name === c);
        return o ? h("button", { class: c === value ? "on" : "", "aria-label": o.label, role: "radio", "aria-checked": c === value ? "true" : "false", on: { click: () => onPick(c) } }, h("i")) : h("span");
      }));
    }

    // ---------- playback ----------
    const playbackPage = () => live({ title: "Playback", sub: "How the slideshow moves along", render: () => {
      const s = S();
      const at = Math.max(0, INTERVALS.findIndex((x) => x >= s.interval));
      return [ui.group(null,
        toggle("autoplay", "Plays by itself", "Off: you step through the photos"),
        ui.slider({ label: "Time on each photo", min: 0, max: INTERVALS.length - 1, value: at, format: (k) => secs(INTERVALS[k]), onCommit: (k) => patch({ interval: INTERVALS[k] }) }),
        ui.select("Order", null, ORDERS, s.order, (v) => patch({ order: v }))),
      ui.group("What gets shown",
        ui.stacked("Upright photos", ui.seg([{ name: "fill", label: "Show" }, { name: "skip", label: "Leave out" }], s.upright, (v) => patch({ upright: v }))),
        toggle("bursts", "One photo per burst", "Near-identical shots count once"),
        toggle("highlights", "Favourites more often", "Starred photos come up more, and stay longer"))];
    } });

    // ---------- transitions and motion ----------
    const lookPage = () => live({ title: "Transitions", sub: "How one photo becomes the next", render: () => {
      const s = S();
      return [ui.group(null,
        ui.select("Transition", (cat().transitions.find((t) => t.name === s.transition) || {}).about, cat().transitions, s.transition, (v) => patch({ transition: v }), { demo: true }),
        ui.stacked("Movement on the photo", ui.seg([{ name: "off", label: "Still" }, { name: "subtle", label: "Subtle" }, { name: "lively", label: "Lively" }], s.motion, (v) => patch({ motion: v })))),
      ui.group("Atmosphere",
        toggle("titleCards", "Title cards", "The event's name before its photos"),
        toggle("night", "Night look", "Dims the whole picture"))];
    } });

    // ---------- the clock ----------
    const clockPage = () => live({ title: "Clock", sub: "Time, in your style", render: () => {
      const s = S(), c = cat(), cs = s.clockStyle;
      const set = (change) => patch({ clockStyle: change, ...(s.clock ? {} : { clock: true }) });
      const usedLook = (l) => Object.entries(l.style).every(([k, v]) => cs[k] === v);
      return [preview({ clockStyle: cs, showClock: s.clock, cls: "hero-preview" }),
        ui.group(null, toggle("clock", "Show the clock", null)),
        h("section", { class: "group" }, h("h3", {}, "Looks"), h("div", { class: "rail-scroll" }, c.clockLooks.map((l) => h("button", { class: `look-card${usedLook(l) && s.clock ? " on" : ""}`, on: { click: () => set(l.style) } }, preview({ clockStyle: { hour12: cs.hour12, ...l.style }, showClock: true }), h("span", {}, l.label))))),
        ui.group("Make it yours",
          ui.select("Face", (c.clockFaces.find((f) => f.name === cs.face) || {}).about, c.clockFaces, cs.face, (v) => set({ face: v })),
          ui.stacked("Size", ui.seg(c.clockSizes.map((x) => ({ ...x, short: { s: "S", m: "M", l: "L", xl: "XL", huge: "Huge" }[x.name] })), cs.size, (v) => set({ size: v }))),
          ui.stacked("Colour", ui.seg(c.tones, cs.tone, (v) => set({ tone: v }))),
          ui.select("Background", null, c.looks.filter((l) => l.name !== "strip"), cs.backing, (v) => set({ backing: v })),
          ui.slider({ label: "Strength", sub: "Lower it for a clock that melts into the photo", min: 10, max: 100, step: 5, value: cs.opacity, format: (v) => `${v}%`, onCommit: (v) => set({ opacity: v }) })),
        ui.group("Where", ui.stacked("Position on the screen", posGrid(c.clockPositions, cs.position, (v) => set({ position: v })))),
        ui.group("Details",
          ui.toggle("12-hour time", null, cs.hour12, (v) => set({ hour12: v })),
          ui.toggle("Show the date", null, cs.date, (v) => set({ date: v })),
          ui.stacked("Dim the photo behind it", ui.seg(c.clockScrims, cs.scrim, (v) => set({ scrim: v })), "Makes the clock the star of the room"))];
    } });

    // ---------- captions ----------
    const newId = () => `k${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const isCustom = () => S().overlayMode === "custom" && S().captions;
    const fieldOf = (it) => cat().captionFields.find((f) => f.name === it.field);
    const groupOf = (caps, corner) => (caps.groups && caps.groups[corner]) || { look: "shadow", tone: "light" };
    function saveCaptions(fn) {
      const caps = clone(S().captions || { items: [], groups: {} });
      caps.groups = caps.groups || {};
      fn(caps);
      for (const k of Object.keys(caps.groups)) if (!caps.items.some((i) => i.corner === k)) delete caps.groups[k];
      return patch({ captions: caps, overlayMode: "custom" });
    }
    function startOwn() {
      const c = Hud.classicCaptions(S(), window.Show.styles);
      let caps = { items: c.items.map((it, k) => ({ ...it, id: newId() + k, size: k === 0 ? c.leadSize : it.size, font: k === 0 ? "bold" : it.font })), groups: c.groups };
      if (S().captions && S().captions.items.length) caps = S().captions;
      else if (!caps.items.length) caps = { items: [{ id: newId(), field: "date", format: "ago", corner: "bottom-left", size: "m", font: "bold" }, { id: newId(), field: "place", format: "full", corner: "bottom-left", size: "s", font: "sans" }], groups: { "bottom-left": { look: "shadow", tone: "light" } } };
      patch({ captions: caps, overlayMode: "custom" });
    }
    const sampleFor = (it) => Hud.fieldText(it, { info: { ...SAMPLE, ...Object.fromEntries(Object.entries((app.st.current || {}).info || {}).filter(([, v]) => v && (!Array.isArray(v) || v.length))) } }, app.st, window.Show.now) || "";
    function addCaption(corner) {
      app.pick({ title: "Add to the screen", options: cat().captionFields.map((f) => ({ name: f.name, label: f.label, icon: f.icon })), onPick: (name) => {
        const f = cat().captionFields.find((x) => x.name === name), id = newId();
        const items = S().captions ? S().captions.items : [];
        if (items.length >= 12) { say("That is the most the screen can hold: 12"); return; }
        const where = corner || (items[items.length - 1] || {}).corner || "bottom-left";
        saveCaptions((c) => { c.items.push({ id, field: name, format: f.formats[0].name, corner: where, size: "s", font: "sans" }); });
        push(captionPage(id));
      } });
    }
    function moveCaption(id, by) {
      saveCaptions((c) => {
        const it = c.items.find((x) => x.id === id);
        const same = c.items.filter((x) => x.corner === it.corner), k = same.indexOf(it), other = same[k + by];
        if (!other) return;
        const a = c.items.indexOf(it), b = c.items.indexOf(other);
        c.items[a] = other; c.items[b] = it;
      });
    }
    function captionPage(id) {
      const find = () => (S().captions ? S().captions.items.find((x) => x.id === id) : null);
      const edit = (change) => saveCaptions((c) => Object.assign(c.items.find((x) => x.id === id), change));
      return live({ title: "Caption", sub: () => { const it = find(); return it ? fieldOf(it).label : ""; }, render: () => {
        const it = find(), c = cat();
        if (!it) return ui.empty("type", "This caption is gone");
        const f = fieldOf(it);
        return [preview({ showCaptions: true, cls: "hero-preview" }),
          ui.group("What it says",
            ui.select("Shows", null, c.captionFields.map((x) => ({ name: x.name, label: x.label, icon: x.icon })), it.field, (v) => edit({ field: v, format: c.captionFields.find((x) => x.name === v).formats[0].name })),
            f.formats.length > 1 ? ui.select("Format", null, f.formats, it.format, (v) => edit({ format: v })) : null),
          ui.group("How it looks",
            ui.stacked("Size", ui.seg(c.captionSizes.map((x) => ({ ...x, short: { xs: "XS", s: "S", m: "M", l: "L", xl: "XL", xxl: "XXL" }[x.name] })), it.size, (v) => edit({ size: v }))),
            ui.select("Style", null, c.captionFonts, it.font, (v) => edit({ font: v }))),
          ui.group("Where", ui.stacked("Corner of the screen", posGrid(c.captionCorners, it.corner, (v) => edit({ corner: v })))),
          h("div", { class: "action-row" },
            h("button", { class: "btn", on: { click: () => { const nid = newId(); saveCaptions((x) => { const src = x.items.find((i) => i.id === id); x.items.splice(x.items.indexOf(src) + 1, 0, { ...src, id: nid }); }); app.replace(captionPage(nid)); } } }, icon("copy"), "Duplicate"),
            h("button", { class: "btn danger", on: { click: () => { saveCaptions((x) => { x.items = x.items.filter((i) => i.id !== id); }); app.back(); } } }, icon("trash"), "Remove"))];
      } });
    }
    const captionsPage = () => live({ title: "Captions", sub: "What the photo says about itself", render: () => {
      const s = S(), c = cat();
      const classicRow = ui.select("Classic style", null, app.presets.overlayStyles.map((x, k) => ({ name: String(k), label: x.name[0].toUpperCase() + x.name.slice(1) })), String(s.overlayStyle), (v) => patch({ overlayStyle: Number(v) }));
      if (!isCustom()) return [preview({ showCaptions: true, cls: "hero-preview" }),
        h("button", { class: "promo", on: { click: startOwn } }, h("span", { class: "chip-ic" }, icon("sparkle")), h("span", { class: "row-text" }, h("span", { class: "row-label" }, s.captions ? "Back to my own layout" : "Design your own layout"), h("small", {}, "Choose each detail, its corner, size and style")), icon("chevron", "go")),
        ui.group("Quick setup", classicRow,
          ui.select("Date", null, [{ name: "off", label: "Off" }, { name: "absolute", label: "The date" }, { name: "relative", label: "How long ago" }], s.overlay.date, (v) => patch({ overlay: { date: v } })),
          ui.toggle("Place", null, s.overlay.place, (v) => patch({ overlay: { place: v } })), ui.toggle("Event", null, s.overlay.event, (v) => patch({ overlay: { event: v } })), ui.toggle("People", null, s.overlay.people, (v) => patch({ overlay: { people: v } })))];
      const caps = s.captions;
      const groups = c.captionCorners.filter((k) => caps.items.some((i) => i.corner === k.name));
      const setGroup = (corner, change) => saveCaptions((x) => { x.groups[corner] = { ...groupOf(x, corner), ...change }; });
      const looks = (corner) => c.looks.filter((l) => l.name !== "strip" || corner.endsWith("center"));
      return [preview({ showCaptions: true, cls: "hero-preview" }),
        groups.length ? null : ui.empty("type", "Nothing on the screen", "Add a detail to begin."),
        groups.map((g) => {
          const lines = caps.items.filter((i) => i.corner === g.name), look = groupOf(caps, g.name);
          return h("section", { class: "group" }, h("h3", {}, g.label), h("div", { class: "group-card" },
            lines.map((it, k) => h("div", { class: "cap-row" },
              h("button", { class: "cap-main", on: { click: () => push(captionPage(it.id)) } }, h("span", { class: "chip-ic" }, icon(fieldOf(it).icon)), h("span", { class: "row-text" }, h("span", { class: "row-label" }, sampleFor(it)), h("small", {}, `${fieldOf(it).label}  ·  ${label(c.captionSizes, it.size)}  ·  ${label(c.captionFonts, it.font)}`))),
              h("span", { class: "cap-move" }, h("button", { "aria-label": "Move up", disabled: k === 0, on: { click: () => moveCaption(it.id, -1) } }, icon("up")), h("button", { "aria-label": "Move down", disabled: k === lines.length - 1, on: { click: () => moveCaption(it.id, 1) } }, icon("down"))))),
            ui.select("Background", null, looks(g.name), look.look, (v) => setGroup(g.name, { look: v })),
            ui.stacked("Colour", ui.seg(c.tones, look.tone, (v) => setGroup(g.name, { tone: v }))),
            h("button", { class: "row add", on: { click: () => addCaption(g.name) } }, icon("plus"), "Add here")));
        }),
        h("div", { class: "action-row" }, h("button", { class: "btn accent", on: { click: () => addCaption(null) } }, icon("plus"), "Add a caption"), h("button", { class: "btn", on: { click: () => patch({ overlayStyle: s.overlayStyle }) } }, "Use a classic style"))];
    } });

    // ---------- screen ----------
    let schedule = null, screen = null;
    const screenPage = () => live({ title: "Screen", sub: "The monitor on the shelf", render: () => {
      if (!schedule) api("GET", "/api/schedule").then((x) => { schedule = x; app.refresh(); }).catch(() => {});
      if (!screen) api("GET", "/api/screen").then((x) => { screen = x; app.refresh(); }).catch(() => {});
      const set = async (body, word) => { screen = (await act(() => api("POST", "/api/screen", body), word)) || screen; app.refresh(); };
      const sched = async (change) => { schedule = (await act(() => api("PUT", "/api/schedule", change))) || schedule; app.refresh(); };
      const time = (key) => h("input", { type: "time", class: "time", value: schedule[key], "aria-label": key === "off" ? "Off at" : "On at", on: { change: (e) => { if (e.target.value) sched({ [key]: e.target.value }); } } });
      return [ui.group(null, ui.row("Right now", screen ? (screen.wantedOff ? (screen.offUntil ? `Off until ${new Date(screen.offUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Off") : "On") : "…", null, { icon: "monitor" })),
        h("div", { class: "action-row three" },
          h("button", { class: "btn", on: { click: () => set({ on: true }, "Screen on") } }, "Turn on"), h("button", { class: "btn", on: { click: () => set({ on: false }, "Screen off") } }, "Turn off"), h("button", { class: "btn", on: { click: () => set({ on: false, minutes: 60 }, "Screen off for an hour") } }, "Off 1 hour")),
        schedule ? ui.group("Every night", ui.toggle("Sleep on a schedule", "The screen rests, the slideshow waits", schedule.enabled, (v) => sched({ enabled: v })), schedule.enabled ? ui.row("Turns off", null, time("off")) : null, schedule.enabled ? ui.row("Turns on", null, time("on")) : null) : null];
    } });

    const advancedPage = () => live({ title: "Advanced", sub: "Rarely needed", render: () => [ui.group("If the slideshow misbehaves", ui.stacked("The shelf shows", ui.seg([{ name: "layer", label: "This slideshow" }, { name: "picapport", label: "Picapport's page" }], S().viewer, (v) => patch({ viewer: v })), "Picapport's own page is the emergency fallback"))] });

    // ---------- presets ----------
    const shelf = () => (app.presets ? app.presets.presets.filter((p) => !p.hidden) : []);
    const presetRequest = (fn, done) => act(async () => { const r = await fn(); await app.loadPresets(); return r; }, done);
    async function saveNew() {
      const name = await app.promptText({ title: "Save as a preset", text: "Keeps everything: playback, transition, clock and captions.", placeholder: "Living room evenings" });
      if (name) presetRequest(() => api("POST", "/api/presets", { label: name }), `Saved ${name}`);
    }
    function presetCard(p) {
      const s = app.st, on = s.settings.preset === p.name;
      return h("button", { class: `preset${on ? " on" : ""}${p.custom ? " mine" : ""}`, "aria-label": p.label, title: p.about, "data-name": p.name, on: { click: () => act(() => api("POST", "/api/player/preset", { name: p.name }), p.about ? `${p.label}: ${p.about}` : p.label) } },
        h("span", { class: "preset-ic" }, icon(PRESET_ICONS[p.name] || "bookmark")), h("b", {}, p.label), h("small", {}, on ? (s.preset && s.preset.changed.length ? "In use, with changes" : "In use") : p.custom ? "Yours" : "Built in"));
    }
    const managePage = () => live({ title: "Presets", sub: "Keep, rename and arrange them", actions: () => h("button", { class: "round", "aria-label": "Save the current look", on: { click: saveNew } }, icon("plus")), render: () => {
      const all = app.presets.presets;
      const put = (p, change, done) => presetRequest(() => api("PUT", `/api/presets/${p.name}`, change), done);
      return [h("div", { class: "group-card presets-list" }, all.map((p, k) => h("div", { class: `manage${p.hidden ? " is-hidden" : ""}` },
        h("span", { class: "chip-ic" }, icon(PRESET_ICONS[p.name] || "bookmark")), h("span", { class: "row-text" }, h("span", { class: "row-label" }, p.label), h("small", {}, p.hidden ? "Hidden" : p.custom ? p.about || "Your preset" : "Built in")),
        h("span", { class: "manage-actions" },
          h("button", { "aria-label": `Move ${p.label} up`, disabled: k === 0, on: { click: () => put(p, { move: -1 }) } }, icon("up")), h("button", { "aria-label": `Move ${p.label} down`, disabled: k === all.length - 1, on: { click: () => put(p, { move: 1 }) } }, icon("down")),
          p.custom ? h("button", { "aria-label": `Rename ${p.label}`, on: { click: async () => { const v = await app.promptText({ title: "Rename preset", value: p.label }); if (v) put(p, { label: v }, "Renamed"); } } }, icon("pencil")) : null,
          p.custom ? h("button", { "aria-label": `Update ${p.label} with the current look`, on: { click: async () => { if (await app.ask({ title: `Update ${p.label}?`, text: "It will take on everything as it is set right now.", ok: "Update" })) put(p, { capture: true }, `${p.label} updated`); } } }, icon("check")) : null,
          p.custom ? h("button", { "aria-label": `Delete ${p.label}`, on: { click: async () => { if (await app.ask({ title: `Delete ${p.label}?`, text: "This can't be undone.", ok: "Delete", danger: true })) presetRequest(() => api("DELETE", `/api/presets/${p.name}`), "Deleted"); } } }, icon("trash"))
            : h("button", { "aria-label": `${p.hidden ? "Show" : "Hide"} ${p.label}`, on: { click: () => put(p, { hidden: !p.hidden }) } }, icon(p.hidden ? "eye" : "eyeoff")))))),
      h("p", { class: "hint" }, "The check mark replaces a preset with what is set right now.")];
    } });

    // ---------- home ----------
    function subjectTile(ic, title, sub, page) {
      return h("button", { class: "subject", "aria-label": title, on: { click: () => push(page()) } }, h("span", { class: "subject-ic" }, icon(ic)), h("b", {}, title), h("small", {}, sub));
    }
    return live({ title: "Settings", sub: "Make the wall your own", render: () => {
      if (!cat()) { app.loadPresets(); return ui.loading(); }
      const s = S(), c = cat();
      const capSub = isCustom() ? `${s.captions.items.length} on screen` : app.presets.overlayStyles[s.overlayStyle] && app.presets.overlayStyles[s.overlayStyle].position === "none" ? "Hidden" : "Classic style";
      return h("div", { class: "settings-home" },
        h("section", { class: "group" }, h("div", { class: "group-title" }, h("h3", {}, "Presets"), h("button", { class: "link", on: { click: () => push(managePage()) } }, "Manage")),
          h("div", { class: "rail-scroll" }, shelf().map(presetCard), h("button", { class: "preset add", "aria-label": "Save the current look", on: { click: saveNew } }, h("span", { class: "preset-ic" }, icon("plus")), h("b", {}, "Save current"), h("small", {}, "As a new preset")))),
        h("div", { class: "subjects" },
          subjectTile("clock", "Clock", s.clock ? label(c.clockFaces, s.clockStyle.face) : "Off", clockPage),
          subjectTile("type", "Captions", capSub, captionsPage),
          subjectTile("film", "Transitions", label(c.transitions, s.transition), lookPage),
          subjectTile("play", "Playback", `${secs(s.interval)}, ${label(ORDERS, s.order).toLowerCase()}`, playbackPage),
          subjectTile("monitor", "Screen", "On, off, schedule", screenPage),
          subjectTile("gear", "Advanced", "Fallback", advancedPage)));
    } });
  };
})();
