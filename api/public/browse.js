// browse.js - the phone's Browse: a home page of tiles, each opening its own page (years, places,
// people, tags, folders, suggestions), and the Favourites and Skipped galleries, where a photo can be
// looked at and its star or skip changed. Photos are never deleted from here (hard rule 1).
"use strict";
(function () {
  window.ShowPanes = window.ShowPanes || {};
  window.ShowPanes.browse = function (app) {
    const { h, icon, api, ui, play, push, say } = app;
    let covers = {}, ratings = null;
    const n = (x) => (x === null || x === undefined ? "" : Number(x).toLocaleString());
    const plural = (x, one, many) => `${n(x)} ${x === 1 ? one : many || `${one}s`}`;
    const redraw = () => { if (app.isOpen("browse")) app.refresh(); };

    function load() {
      api("GET", "/api/browse/covers").then((r) => { covers = r.covers; redraw(); }).catch(() => {});
      api("GET", "/api/ratings").then((r) => { ratings = r; redraw(); }).catch(() => {});
    }

    function tile({ title, sub, ic, cover, click, cls, label }) {
      return h("button", { class: `tile${cls ? ` ${cls}` : ""}`, "aria-label": label || title, on: { click } },
        h("span", { class: "tile-art" }, cover ? ui.img(cover) : null),
        h("span", { class: "tile-veil" }),
        ic ? h("span", { class: "tile-ic" }, icon(ic)) : null,
        h("span", { class: "tile-text" }, h("b", {}, title), sub ? h("small", {}, sub) : null));
    }
    function listRow({ title, sub, ic, cover, click, chevron, round }) {
      return h("button", { class: "list-row", on: { click } },
        h("span", { class: `thumb-ic${round ? " round-pic" : ""}` }, icon(ic), cover ? ui.img(cover) : null),
        h("span", { class: "row-text" }, h("span", { class: "row-label" }, title), sub ? h("small", {}, sub) : null),
        chevron ? icon("chevron", "go") : icon("play", "go faint"));
    }
    // A long list gets a filter box; typing redraws only the list.
    function filtered(items, placeholder, draw, min = 10) {
      const box = h("div", { class: "filter-result" }, draw(items));
      if (items.length < min) return box;
      const input = h("input", { type: "search", class: "field", placeholder, autocomplete: "off", on: { input: (e) => {
        const t = e.target.value.toLowerCase().trim();
        const hit = items.filter((x) => x.search.toLowerCase().includes(t));
        box.replaceChildren(...(hit.length ? [draw(hit)] : [ui.empty("search", "Nothing by that name")]));
      } } });
      return h("div", {}, h("div", { class: "search-box" }, icon("search"), input), box);
    }
    function heroPlay(title, sub, cover, click) {
      return h("button", { class: "hero", "aria-label": `Play ${title}`, on: { click } }, h("span", { class: "tile-art" }, cover ? ui.img(cover) : null), h("span", { class: "tile-veil" }),
        h("span", { class: "hero-text" }, h("b", {}, title), h("small", {}, sub)), h("span", { class: "hero-play" }, icon("play")));
    }

    // ---------- years ----------
    const yearsPage = () => ({ title: "Years", sub: () => (dateOrder() ? "Tap a year to jump to it" : "Tap a year to play it"), render() {
      const years = Object.entries(app.vocab.years || {}).sort((a, b) => b[0] - a[0]);
      return h("div", { class: "tiles small" }, years.map(([y, c]) => tile({ title: y, sub: plural(c, "photo"), cover: covers[`y:${y}`], label: y, click: () => {
        if (dateOrder()) { app.act(() => api("POST", "/api/player/jump", { year: Number(y) }), `Jumped to ${y}`); app.closeSheet(); } else play({ years: [Number(y)], label: y });
      } })));
    } });
    const dateOrder = () => ["date-asc", "date-desc"].includes(app.st.settings.order);

    // ---------- places ----------
    const countryPage = (c) => ({ title: c.country, sub: `${plural(c.cities.length, "place")}, ${plural(c.photos, "photo")}`, render: () => h("div", {},
      heroPlay(`All of ${c.country}`, plural(c.photos, "photo"), covers[`c:${c.cc}`], () => play({ places: [c.key], label: c.country })),
      filtered(c.cities.map((x) => ({ ...x, search: x.city })), "Find a place", (list) => h("div", { class: "list" }, list.map((x) => listRow({ title: x.city, sub: plural(x.photos, "photo"), ic: "pin", cover: covers[`t:${x.key}`], click: () => play({ places: [x.key], label: x.city }) }))))) });
    const placesPage = () => ({ title: "Places", sub: "Where the photos were taken", render() {
      const list = (app.vocab.places || []).map((c) => ({ ...c, search: `${c.country} ${c.cities.map((x) => x.city).join(" ")}` }));
      if (!list.length) return ui.empty("pin", "No places yet", "The nightly scan adds them.");
      return filtered(list, "Find a country or town", (items) => h("div", { class: "tiles" }, items.map((c) => tile({ title: c.country, sub: plural(c.photos, "photo"), ic: "pin", cover: covers[`c:${c.cc}`], click: () => push(countryPage(c)) }))));
    } });

    // ---------- people and tags ----------
    const peoplePage = () => ({ title: "People", sub: "Everyone named in your photos", render() {
      const list = (app.vocab.people || []).filter((p) => p.searchable).map((p) => ({ ...p, search: p.word }));
      if (!list.length) return ui.empty("people", "Nobody named yet");
      return filtered(list, "Find someone", (items) => h("div", { class: "people" }, items.map((p) => h("button", { class: "person", "aria-label": p.word, on: { click: () => play({ query: p.word, label: p.word }) } },
        h("span", { class: "avatar" }, h("span", { class: "monogram" }, p.word[0].toUpperCase()), covers[`p:${p.word}`] ? ui.img(covers[`p:${p.word}`]) : null),
        h("b", {}, p.word), h("small", {}, n(p.photos))))));
    } });
    const tagsPage = () => ({ title: "Tags", sub: "The keywords on your photos", render() {
      const list = (app.vocab.keywords || []).filter((p) => p.searchable).sort((a, b) => b.photos - a.photos).map((p) => ({ ...p, search: p.word }));
      if (!list.length) return ui.empty("tag", "No tags yet");
      return filtered(list, "Find a tag", (items) => h("div", { class: "tag-cloud" }, items.map((p) => h("button", { class: "tag", "aria-label": p.word, on: { click: () => play({ query: p.word, label: p.word }) } }, icon("hash"), h("span", {}, p.word), h("small", {}, n(p.photos))))));
    } });

    // ---------- folders ----------
    function tree() {
      const top = { name: "Folders", children: new Map() };
      for (const f of app.vocab.folders || []) {
        let node = top, sofar = "";
        for (const part of f.path.split("/")) {
          sofar = sofar ? `${sofar}/${part}` : part;
          if (!node.children.has(part)) node.children.set(part, { name: part, path: sofar, children: new Map() });
          node = node.children.get(part);
        }
        node.folder = f;
      }
      return top;
    }
    const nice = (name) => name.replace(/^\d{4}(\.\d{1,2})?(\.\d{1,2})?(\s*-\s*\d{4}(\.\d{1,2})?(\.\d{1,2})?)?\s*-\s*/, "").replace(/^\d{1,3}[\s._-]+(?=\D)/, "").replace(/^[_\s]+/, "") || name;
    const when = (name) => { const m = name.match(/^(\d{4})/); return m ? m[1] : ""; };
    function folderPage(node) {
      return { title: node.path ? nice(node.name) : "Folders", sub: node.path ? when(node.name) : "Your library as you filed it", render() {
        const kids = [...node.children.values()].sort((a, b) => (a.name < b.name ? 1 : -1)).map((k) => ({ ...k, search: k.name }));
        return h("div", {},
          node.folder ? heroPlay(`All of ${nice(node.name)}`, plural(node.folder.photos, "photo"), covers[`f:${node.path}`], () => play({ query: node.folder.query, label: node.name })) : null,
          filtered(kids, "Find a folder", (items) => h("div", { class: "list" }, items.map((k) => listRow({
            title: nice(k.name), sub: [when(k.name), k.folder ? plural(k.folder.photos, "photo") : "", k.children.size ? plural(k.children.size, "folder") : ""].filter(Boolean).join("  ·  "),
            ic: "folder", cover: covers[`f:${k.path}`], chevron: k.children.size > 0,
            click: () => (k.children.size ? push(folderPage(k)) : play({ query: k.folder.query, label: k.name })) })))));
      } };
    }

    // ---------- suggestions ----------
    const suggestPage = () => ({ title: "For you", sub: "Ideas from your own library", render: () => h("div", { class: "tiles wide" },
      tile({ title: "This week in past years", sub: "The same days, other years", ic: "calendar", cover: covers.places, click: () => play({ onThisDay: true, label: "This week in past years" }) }),
      tile({ title: "Not seen in a while", sub: "Nothing from the last 90 days", ic: "sparkle", cover: covers.all, click: () => play({ notSeenDays: 90, label: "Not seen in a while" }) }),
      tile({ title: "Long forgotten", sub: "Not shown for a year", ic: "moon", cover: covers.people, click: () => play({ notSeenDays: 365, label: "Long forgotten" }) })) });

    // ---------- favourites and skipped ----------
    const KINDS = {
      favourites: { title: "Favourites", ic: "star", none: "No favourites yet", hint: "Tap the star on a photo and it appears here.", source: { favourites: true, label: "Favourites" }, sub: "Shown more often, and for longer" },
      skipped: { title: "Skipped", ic: "ban", none: "Nothing skipped", hint: "Photos you skip wait here, out of every slideshow.", source: { skipped: true, label: "Skipped photos" }, sub: "Left out of every slideshow" },
    };
    const niceDate = (d) => (d ? window.ShowHud.absDate(d) : "No date");
    function galleryPage(kind) {
      const k = KINDS[kind];
      let photos = null, total = 0, busy = false;
      const more = async () => {
        if (busy) return;
        busy = true;
        try {
          const r = await api("GET", `/api/ratings/photos?kind=${kind}&offset=${photos ? photos.length : 0}&limit=60`);
          photos = [...(photos || []), ...r.photos]; total = r.total;
        } catch (e) { say(e.message); photos = photos || []; }
        busy = false;
        if (app.isTop(page)) app.refresh();
      };
      const page = { title: k.title, sub: k.sub, render() {
        if (!photos) { more(); return ui.loading(); }
        if (!photos.length) return ui.empty(k.ic, k.none, k.hint);
        return h("div", {},
          h("div", { class: "gallery-head" }, h("span", {}, plural(total, "photo")), h("button", { class: "btn accent", on: { click: () => play(k.source) } }, icon("play"), "Play all")),
          h("div", { class: "gallery" }, photos.map((p) => h("button", { class: "shot", "aria-label": p.file.split("/").pop(), on: { click: () => push(photoPage(p, kind, (gone) => { if (gone) { photos = photos.filter((x) => x.id !== p.id); total--; } })) } }, ui.img(p.thumb)))),
          photos.length < total ? h("button", { class: "btn wide", on: { click: more } }, "Show more") : null);
      } };
      return page;
    }
    function photoPage(p, kind, changed) {
      let saving = null;
      const setRating = async (rating, word) => {
        saving = word; app.refresh();
        try {
          await api("POST", "/api/photo/rating", { rating, id: p.id });
          ratings = null; load();
          changed(true);
          say(`${word}: saved in the photo`);
          app.back();
        } catch (e) { saving = null; say(e.message); if (app.isTop(page)) app.refresh(); }
      };
      const skipped = kind === "skipped";
      const page = { title: p.event ? p.event.split(" › ").pop() : "Photo", sub: niceDate(p.date), render: () => h("div", { class: "photo-detail" },
        h("div", { class: "photo-frame" }, h("img", { src: p.url, alt: "" })),
        h("div", { class: "photo-meta" }, p.place ? h("div", { class: "line" }, icon("pin"), p.place) : null, p.event ? h("div", { class: "line" }, icon("folder"), p.event) : null),
        saving ? ui.loading("Saving into the photo…") : h("div", { class: "action-row" },
          skipped ? h("button", { class: "btn accent", on: { click: () => setRating(0, "Back in your slideshows") } }, icon("check"), "Bring it back") : h("button", { class: "btn", on: { click: () => setRating(0, "Star removed") } }, icon("star"), "Remove star"),
          skipped ? h("button", { class: "btn", on: { click: () => setRating(5, "Now a favourite") } }, icon("star"), "Make favourite") : h("button", { class: "btn", on: { click: () => setRating(1, "Skipped") } }, icon("ban"), "Skip it")),
        skipped ? h("div", { class: "note" }, h("b", {}, "Want it gone for good?"), h("p", {}, "This app never deletes your photos. To remove this one, delete the file from the drive yourself:"), h("code", {}, p.file)) : null) };
      return page;
    }

    // ---------- home ----------
    const count = (list) => (list || []).length;
    const page = { title: "Browse", sub: "Find something to play", render() {
      if (!app.vocab) { app.loadVocab().then(redraw); return ui.loading(); }
      const v = app.vocab;
      const people = (v.people || []).filter((p) => p.searchable), tags = (v.keywords || []).filter((p) => p.searchable);
      const topFolders = new Set((v.folders || []).map((f) => f.path.split("/")[0])).size;
      const r = ratings || {};
      return h("div", { class: "browse-home" },
        h("div", { class: "tiles pair" },
          tile({ title: "Favourites", sub: ratings ? plural(r.favourites, "photo") : "", ic: "star", cover: covers.favourites, cls: "gold", click: () => push(galleryPage("favourites")) }),
          tile({ title: "Skipped", sub: ratings ? plural(r.skipped, "photo") : "", ic: "ban", cover: covers.skipped, cls: "rose", click: () => push(galleryPage("skipped")) })),
        h("div", { class: "tiles" },
          tile({ title: "For you", sub: "Ideas from your library", ic: "sparkle", cover: covers.all, click: () => push(suggestPage()) }),
          tile({ title: "Years", sub: plural(Object.keys(v.years || {}).length, "year"), ic: "calendar", cover: covers[`y:${Object.keys(v.years || {}).sort().pop()}`], click: () => push(yearsPage()) }),
          tile({ title: "Places", sub: plural(count(v.places), "country", "countries"), ic: "pin", cover: covers.places, click: () => push(placesPage()) }),
          tile({ title: "People", sub: plural(people.length, "person", "people"), ic: "people", cover: covers.people, click: () => push(peoplePage()) }),
          tile({ title: "Tags", sub: plural(tags.length, "tag"), ic: "tag", click: () => push(tagsPage()), cls: "plain" }),
          tile({ title: "Folders", sub: plural(topFolders, "collection"), ic: "folder", cover: covers[`f:${(v.folders || [{}])[0].path}`], click: () => push(folderPage(tree())) })));
    } };
    load();
    return page;
  };

  // The map tab: the whole screen is the map (map.js).
  window.ShowPanes.map = function (app) {
    return { title: "Map", full: true, render: () => (window.ShowMap ? window.ShowMap.pane(app) : app.ui.empty("map", "No map")) };
  };
})();
