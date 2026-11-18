// show.js - the viewer: follows the one slideshow on the Pi (GET /api/events) and shows it.
// Lockstep (R1): the Pi decides which photo shows and when it started; every viewer shows that
// photo, runs the same motion and the same transition (both come from the photo's id) and places the
// motion by the time already elapsed, so a viewer that joins late is in step. Viewers never talk to
// Picapport. What is drawn over the photo (clock, captions) is in hud.js.
"use strict";
(function () {
  const params = new URLSearchParams(location.search);
  const kiosk = params.get("kiosk") === "1";
  if (kiosk) document.body.classList.add("kiosk");
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), hud = $("hud"), card = $("card"), clock = $("clock"), status = $("status"), pausemark = $("pausemark"), toast = $("toast"), starmark = $("starmark");
  const Hud = window.ShowHud;
  Hud.makeHud(hud);
  Hud.anchor(hud, "top-center").append(starmark);
  Hud.anchor(hud, "top-right").append(pausemark);

  let state = null;
  let offset = 0; // server time - local time
  let styles = [];
  let transitions = [];
  let shownId = null;
  let shownPhoto = null;
  let lastPos = null;
  let overlayTimer = null;
  let firstBuild = null;
  let localMove = null; // a next/back this screen has already shown, while the Pi confirms it
  const listeners = [];
  const cache = new Map(); // photo id -> Promise<{ img, fill, lum, w, h }>
  const serverNow = () => Date.now() + offset;

  // ---------- images ----------
  function blurFill(img) {
    const c = document.createElement("canvas");
    c.width = 48; c.height = 27;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.filter = "blur(2px)";
    const s = Math.max(48 / img.naturalWidth, 27 / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, (48 - w) / 2, (27 - h) / 2, w, h);
    let lum = null;
    try {
      const d = ctx.getImageData(0, 0, 48, 27).data;
      lum = new Uint8Array(48 * 27);
      for (let i = 0; i < lum.length; i++) lum[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
    } catch { /* brightness is only used for the automatic text colour */ }
    return { fill: c.toDataURL("image/jpeg", 0.85), lum };
  }
  function load(photo) {
    if (!photo) return Promise.resolve(null);
    if (cache.has(photo.id)) return cache.get(photo.id);
    const p = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const img = new Image();
          img.decoding = "async";
          img.src = photo.url;
          await img.decode();
          return { img, ...blurFill(img), w: img.naturalWidth, h: img.naturalHeight };
        } catch (e) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      cache.delete(photo.id);
      return null;
    })();
    cache.set(photo.id, p);
    p.then((v) => { p.ready = v; });
    return p;
  }
  function keepOnly(ids) {
    for (const id of [...cache.keys()]) if (!ids.includes(id)) cache.delete(id);
  }

  // What the clock and captions need to know about the photo behind them.
  let shownLoaded = null;
  const hudCtx = {
    get fill() { return shownLoaded ? shownLoaded.fill : null; },
    root: () => ({ left: 0, top: 0, width: innerWidth, height: innerHeight }),
    lum(r) {
      const lum = shownLoaded && shownLoaded.lum;
      if (!lum || !r.width) return null;
      const x0 = Math.max(0, Math.floor((r.left / innerWidth) * 48)), x1 = Math.min(47, Math.ceil((r.right / innerWidth) * 48));
      const y0 = Math.max(0, Math.floor((r.top / innerHeight) * 27)), y1 = Math.min(26, Math.ceil((r.bottom / innerHeight) * 27));
      let sum = 0, n = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { sum += lum[y * 48 + x]; n++; }
      return n ? sum / n : null;
    },
  };

  // ---------- motion and transitions ----------
  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function motionFrames(id, level) {
    const amt = level === "lively" ? 0.15 : 0.06;
    const h = hash(id);
    const zoomIn = (h & 1) === 0;
    const dx = (((h >>> 1) % 1000) / 1000 - 0.5) * amt * 100; // percent of the frame
    const dy = (((h >>> 11) % 1000) / 1000 - 0.5) * amt * 60;
    const big = `scale(${1 + amt}) translate(${dx / (1 + amt)}%, ${dy / (1 + amt)}%)`;
    return zoomIn ? [{ transform: "scale(1)" }, { transform: big }] : [{ transform: big }, { transform: "scale(1)" }];
  }
  const TRANSITION_MS = { fade: 1500, slide: 900, zoom: 1300, dip: 1600, rise: 1000, bloom: 1400, drift: 1700, deck: 1100 };
  // "Surprise me": chosen from the photo's id, so every screen picks the same one.
  function transitionFor(kind, id) {
    if (kind !== "random") return kind;
    const list = transitions.filter((t) => t !== "random" && TRANSITION_MS[t]);
    return list.length ? list[hash(`t${id}`) % list.length] : "fade";
  }

  function makeSlide(photo, loaded, st) {
    const slide = document.createElement("div");
    slide.className = "slide";
    slide.dataset.id = photo.id;
    const va = innerWidth / innerHeight, pa = loaded.w / loaded.h;
    if (Math.min(va, pa) / Math.max(va, pa) < 0.96) {
      const f = new Image();
      f.className = "fill";
      f.src = loaded.fill;
      slide.appendChild(f);
    }
    const frame = document.createElement("div");
    frame.className = "frame";
    const img = loaded.img.cloneNode();
    img.className = "photo";
    img.alt = "";
    frame.appendChild(img);
    slide.appendChild(frame);
    if (st.settings.motion !== "off") {
      const kind = transitionFor(st.settings.transition, photo.id);
      const total = st.duration + (TRANSITION_MS[kind] || 1500) + (st.settings.night ? 4000 : 0);
      const anim = frame.animate(motionFrames(photo.id, st.settings.motion), { duration: total, easing: "linear", fill: "forwards" });
      anim.currentTime = Math.min(total, Math.max(0, st.elapsed + (serverNow() - st.serverTime)));
      if (st.paused) anim.pause();
      slide._anim = anim;
    }
    return slide;
  }

  function transitionIn(slide, kind, back, immediate) {
    const old = [...stage.children];
    stage.appendChild(slide);
    const ms = immediate ? 0 : TRANSITION_MS[kind] || 1500;
    const done = () => old.forEach((o) => o.remove());
    if (!ms) { done(); return; }
    const dir = back ? -1 : 1;
    let inFrames, outFrames, outOpts = { duration: ms, fill: "forwards" }, inOpts = { duration: ms, fill: "both", easing: "ease-in-out" };
    switch (kind) {
      case "slide":
        inFrames = [{ transform: `translateX(${100 * dir}%)` }, { transform: "translateX(0)" }];
        outFrames = [{ transform: "translateX(0)" }, { transform: `translateX(${-100 * dir}%)` }];
        outOpts.easing = "ease-in-out";
        break;
      case "rise":
        inFrames = [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }];
        outFrames = [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-18%)", opacity: 0.2 }];
        inOpts.easing = outOpts.easing = "cubic-bezier(.22,.8,.26,1)";
        break;
      case "zoom":
        inFrames = [{ opacity: 0, transform: "scale(1.12)" }, { opacity: 1, transform: "scale(1)" }];
        outFrames = [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.94)" }];
        break;
      case "bloom":
        inFrames = [{ opacity: 0, transform: "scale(0.82)" }, { opacity: 1, transform: "scale(1)" }];
        outFrames = [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(1.1)" }];
        inOpts.easing = "cubic-bezier(.16,.8,.3,1)";
        break;
      case "drift":
        inFrames = [{ opacity: 0, transform: `translateX(${5 * dir}%) scale(1.04)` }, { opacity: 1, transform: "translateX(0) scale(1)" }];
        outFrames = [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${-5 * dir}%)` }];
        break;
      case "deck":
        inFrames = [{ opacity: 0, transform: "translateY(7%) scale(1.07)" }, { opacity: 1, transform: "translateY(0) scale(1)" }];
        outFrames = [{ opacity: 1, transform: "scale(1)" }, { opacity: 0.15, transform: "scale(0.88)" }];
        inOpts.easing = "cubic-bezier(.2,.8,.25,1)";
        break;
      case "dip":
        inFrames = [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }];
        outFrames = [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }];
        break;
      default:
        inFrames = [{ opacity: 0 }, { opacity: 1 }];
        outFrames = null; // the new photo fades in over the old one
    }
    slide.animate(inFrames, inOpts).finished.then(done, done);
    if (outFrames) old.forEach((o) => o.animate(outFrames, outOpts));
  }

  // ---------- captions, card, clock ----------
  let hudKey = null;
  function renderOverlay(photo, st) {
    starmark.classList.toggle("hidden", !(photo && photo.info && photo.info.favourite));
    const s = st.settings;
    const key = JSON.stringify([photo && photo.id, photo && photo.info, s.overlay, s.overlayStyle, s.overlayMode, s.captions, st.source && st.source.label, styles.length, innerWidth, innerHeight]);
    if (key === hudKey) return;
    hudKey = key;
    Hud.renderCaptions(hud, st, photo, styles, serverNow(), hudCtx);
    tickClock();
  }
  let cardTimer = null;
  function showCard(photo, st) {
    clearTimeout(cardTimer);
    card.classList.remove("fade");
    document.body.classList.remove("carding");
    if (!photo || !photo.card) { card.classList.add("hidden"); return 0; }
    const left = st.cardMs - (st.elapsed + (serverNow() - st.serverTime));
    if (left <= 300) { card.classList.add("hidden"); return 0; }
    card.querySelector(".card-title").textContent = photo.card.t;
    card.querySelector(".card-dates").textContent = photo.card.d || "";
    card.classList.remove("hidden");
    document.body.classList.add("carding");
    cardTimer = setTimeout(() => { card.classList.add("fade"); document.body.classList.remove("carding"); cardTimer = setTimeout(() => card.classList.add("hidden"), 1300); }, left);
    return left;
  }
  function tickClock() {
    const s = state && state.settings;
    const on = !!(s && s.clock);
    const cs = (s && s.clockStyle) || {};
    document.body.classList.toggle("scrim-soft", on && cs.scrim === "soft");
    document.body.classList.toggle("scrim-deep", on && cs.scrim === "deep");
    if (!on) { clock.classList.add("hidden"); return; }
    const home = Hud.anchor(hud, cs.position || "top-left");
    if (clock.parentElement !== home) home.append(clock);
    Hud.renderClock(clock, cs, new Date(serverNow()), hudCtx);
    clock.classList.remove("hidden");
  }
  setInterval(() => tickClock(), 1000);
  addEventListener("resize", () => { hudKey = null; if (state) renderOverlay(shownPhoto || state.current, state); });

  function renderStatus(st, connected) {
    status.classList.remove("center");
    let text = null;
    if (!connected) text = "Reconnecting to the slideshow…";
    else if (st.preparing) {
      const p = st.preparing;
      text = `Getting ${p.label} ready${p.total ? `: ${Math.round((100 * p.done) / p.total)}%` : "…"}`;
    } else if (!st.current) text = st.error || "Nothing is playing";
    status.textContent = text || "";
    status.classList.toggle("hidden", !text);
    if (!st.current) status.classList.add("center");
  }

  // A toast shows once, and not at all on a screen that connects after it was sent.
  const TOAST_MS = 2200;
  let lastToast = null, toastTimer = null;
  function renderToast(t) {
    if (!t || t.id === lastToast) return;
    lastToast = t.id;
    if (serverNow() - t.id > TOAST_MS) return;
    toast.textContent = t.text;
    toast.classList.add("show");
    document.body.classList.add("toasting");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove("show"); document.body.classList.remove("toasting"); }, TOAST_MS);
  }

  // The app was updated while this page stayed open: load the new page (the phone waits until its
  // menus are closed, so nobody loses what they were doing).
  function checkBuild(st) {
    if (!st.build) return;
    if (firstBuild === null) firstBuild = st.build;
    if (st.build === firstBuild) return;
    const c = window.ShowControls;
    if (kiosk || !c || !c.busy()) location.reload();
  }

  // ---------- showing a photo ----------
  function showPhoto(photo, loaded, st, immediate, back) {
    shownId = photo.id;
    shownPhoto = photo;
    shownLoaded = loaded;
    const kind = transitionFor(st.settings.transition, photo.id);
    transitionIn(makeSlide(photo, loaded, st), kind, back, immediate);
    // The words change halfway through the transition, when the new photo is mostly visible.
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => { if (shownId === photo.id) renderOverlay(photo, state); }, immediate ? 0 : (TRANSITION_MS[kind] || 1500) / 2);
    if (immediate) { clearTimeout(overlayTimer); renderOverlay(photo, st); }
  }

  // Next or back from this screen: the photo is already here, so it shows at once, with no transition
  // and without waiting for the Pi. The Pi's answer then confirms it (or corrects it).
  async function step(dir) {
    const path = dir > 0 ? "/api/player/next" : "/api/player/back";
    const st = state;
    const target = st && (dir > 0 ? st.next[0] : st.prev);
    const entry = target && !target.card && !localMove ? cache.get(target.id) : null;
    if (entry && entry.ready) {
      pending++;
      localMove = { id: target.id };
      lastPos = dir > 0 ? (st.position + 1) % Math.max(1, st.count) : st.position - 1;
      showCard(null, st);
      showPhoto(target, entry.ready, { ...st, current: target, elapsed: 0, serverTime: serverNow() }, true, dir < 0);
    }
    let view;
    try {
      view = await api("POST", path);
    } catch (e) {
      localMove = null;
      if (state) apply(state).catch((err) => console.error(err));
      throw e;
    }
    localMove = null;
    await apply(view.v >= state.v ? view : state); // the answer and the event stream can arrive in either order
    return view;
  }

  // ---------- following the slideshow ----------
  let pending = 0;
  async function apply(st) {
    state = st;
    offset = st.serverTime - Date.now();
    checkBuild(st);
    document.body.classList.toggle("night", !!st.settings.night);
    renderStatus(st, true);
    tickClock();
    pausemark.classList.toggle("hidden", !st.paused || !kiosk);
    renderToast(st.toast);
    listeners.forEach((fn) => { try { fn(st); } catch (e) { console.error(e); } });
    const cur = st.current;
    // preload what comes next (and the one before, for "back")
    [...st.next, st.prev].filter(Boolean).forEach((p) => load(p));
    const keep = [cur, ...st.next, st.prev, shownPhoto].filter(Boolean).map((p) => p.id);
    keepOnly(keep);
    if (!cur) { stage.replaceChildren(); shownId = null; shownPhoto = null; shownLoaded = null; renderOverlay(null, st); return; }
    if (localMove && cur.id !== localMove.id) return; // the Pi has not caught up with this screen yet
    if (cur.id === shownId) {
      // same photo: settings or pause may have changed
      lastPos = st.position;
      shownPhoto = cur;
      const slide = stage.lastElementChild;
      if (slide && slide._anim) {
        if (st.paused) slide._anim.pause(); else if (slide._anim.playState === "paused") {
          slide._anim.currentTime = st.elapsed + (serverNow() - st.serverTime);
          slide._anim.play();
        }
      }
      renderOverlay(cur, st);
      return;
    }
    const mine = ++pending;
    const loaded = await load(cur);
    if (mine !== pending || !loaded) return; // a newer photo arrived meanwhile, or it failed
    const back = lastPos !== null && st.position < lastPos && lastPos - st.position < st.count / 2; // stepped back (slide moves the other way)
    lastPos = st.position;
    const first = shownId === null;
    const cardLeft = showCard(cur, state);
    showPhoto(cur, loaded, state, first || cardLeft > 0 || state.manualMove, back); // next, back and jump snap; autoplay transitions
  }

  let es = null, connected = false, lostAt = 0;
  function connect() {
    es = new EventSource(`/api/events?role=${kiosk ? "shelf" : "phone"}`);
    es.addEventListener("state", (e) => {
      connected = true;
      const st = JSON.parse(e.data);
      if (state && st.v < state.v && st.build === state.build) return; // older than what a control's answer already showed
      apply(st).catch((err) => console.error(err));
    });
    es.onerror = () => {
      if (connected) { connected = false; lostAt = Date.now(); }
      setTimeout(() => { if (!connected && Date.now() - lostAt > 4000 && state) renderStatus(state, false); }, 4500);
    };
  }

  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  fetch("/api/presets").then((r) => r.json()).then((p) => {
    styles = p.overlayStyles;
    transitions = p.catalog.transitions.map((t) => t.name);
    hudKey = null;
    if (state) renderOverlay(shownPhoto || state.current, state);
  }).catch(() => {});
  connect();

  // For the controls layer (controls.js) and tests.
  window.Show = {
    kiosk,
    get state() { return state; },
    get styles() { return styles; },
    get shownPhoto() { return shownPhoto; },
    get now() { return serverNow(); },
    onState(fn) { listeners.push(fn); if (state) fn(state); },
    api, step,
    relDate: (iso) => Hud.relDate(iso, serverNow()),
    absDate: Hud.absDate,
  };
})();
