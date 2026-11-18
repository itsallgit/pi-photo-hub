// show.js - the viewer: follows the one slideshow on the Pi (GET /api/events) and shows it.
// Lockstep (R1): the Pi decides which photo shows and when it started; every viewer shows that
// photo, runs the same motion (its direction comes from the photo's id) and places the motion by
// the time already elapsed, so a viewer that joins late is in step. Viewers never talk to Picapport.
"use strict";
(function () {
  const params = new URLSearchParams(location.search);
  const kiosk = params.get("kiosk") === "1";
  if (kiosk) document.body.classList.add("kiosk");
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), overlay = $("overlay"), card = $("card"), clock = $("clock"), status = $("status"), pausemark = $("pausemark"), toast = $("toast");

  let state = null;
  let offset = 0; // server time - local time
  let styles = [];
  let shownId = null;
  let slideStarted = 0;
  let lastPos = null;
  let overlayTimer = null;
  const listeners = [];
  const cache = new Map(); // photo id -> Promise<{ img, fill, w, h }>
  const serverNow = () => Date.now() + offset;

  // ---------- images ----------
  function blurFill(img) {
    const c = document.createElement("canvas");
    c.width = 48; c.height = 27;
    const ctx = c.getContext("2d");
    ctx.filter = "blur(2px)";
    const s = Math.max(48 / img.naturalWidth, 27 / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, (48 - w) / 2, (27 - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.85);
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
          return { img, fill: blurFill(img), w: img.naturalWidth, h: img.naturalHeight };
        } catch (e) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      cache.delete(photo.id);
      return null;
    })();
    cache.set(photo.id, p);
    return p;
  }
  function keepOnly(ids) {
    for (const id of [...cache.keys()]) if (!ids.includes(id)) cache.delete(id);
  }

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
  const TRANSITION_MS = { fade: 1500, slide: 900, zoom: 1300, dip: 1600 };

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
      const total = st.duration + (TRANSITION_MS[st.settings.transition] || 1500) + (st.settings.night ? 4000 : 0);
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
      case "zoom":
        inFrames = [{ opacity: 0, transform: "scale(1.12)" }, { opacity: 1, transform: "scale(1)" }];
        outFrames = [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.94)" }];
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

  // ---------- overlay, card, clock ----------
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function absDate(iso) {
    return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  }
  function relDate(iso) {
    const then = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
    const now = new Date(serverNow());
    const days = Math.floor((now - then) / 86400000);
    if (days < 1) return "today";
    if (days < 2) return "yesterday";
    if (days < 14) return `${days} days ago`;
    let months = (now.getFullYear() - then.getFullYear()) * 12 + now.getMonth() - then.getMonth();
    if (now.getDate() < then.getDate()) months--;
    if (months < 2) return `${Math.max(2, Math.round(days / 7))} weeks ago`;
    if (months < 12) return `${months} months ago`;
    const years = Math.floor(months / 12);
    return years === 1 ? "a year ago" : `${years} years ago`;
  }
  function overlayLines(photo, st) {
    const o = st.settings.overlay || {};
    const i = photo.info || {};
    const lines = [];
    if (o.date !== "off" && i.date) lines.push({ text: o.date === "relative" ? relDate(i.date) : absDate(i.date), main: true });
    if (o.place && i.place) lines.push({ text: i.place });
    if (o.event && i.event) lines.push({ text: i.event });
    if (o.people && i.people && i.people.length) lines.push({ text: i.people.join(", ") });
    if (lines.length && !lines.some((l) => l.main)) lines[0].main = true;
    return lines;
  }
  function renderOverlay(photo, st) {
    const style = styles[st.settings.overlayStyle] || styles[0];
    const lines = photo ? overlayLines(photo, st) : [];
    if (!style || style.position === "none" || !lines.length) { overlay.classList.add("hidden"); return; }
    overlay.className = `pos-${style.position} backing-${style.backing} text-${style.text} size-${style.size}`;
    overlay.replaceChildren(...lines.map((l) => { const d = document.createElement("div"); d.className = l.main ? "line main" : "line"; d.textContent = l.text; return d; }));
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
    if (!state || !state.settings.clock) { clock.classList.add("hidden"); return; }
    const d = new Date(serverNow());
    clock.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    clock.classList.remove("hidden");
  }
  setInterval(tickClock, 10000);

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
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), TOAST_MS);
  }

  // ---------- following the slideshow ----------
  let pending = 0;
  async function apply(st) {
    state = st;
    offset = st.serverTime - Date.now();
    document.body.classList.toggle("night", !!st.settings.night);
    renderStatus(st, true);
    tickClock();
    pausemark.classList.toggle("hidden", !st.paused || !kiosk);
    renderToast(st.toast);
    listeners.forEach((fn) => { try { fn(st); } catch (e) { console.error(e); } });
    const cur = st.current;
    // preload what comes next (and the one before, for "back")
    [...st.next, st.prev].filter(Boolean).forEach((p) => load(p));
    keepOnly([cur, ...st.next, st.prev].filter(Boolean).map((p) => p.id));
    if (!cur) { stage.replaceChildren(); renderOverlay(null, st); return; }
    if (cur.id === shownId) {
      // same photo: settings or pause may have changed
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
    shownId = cur.id;
    slideStarted = Date.now();
    const cardLeft = showCard(cur, state);
    const slide = makeSlide(cur, loaded, state);
    const immediate = first || cardLeft > 0 || state.manualMove; // next, back and jump snap; autoplay transitions
    transitionIn(slide, state.settings.transition, back, immediate);
    // The words change halfway through the transition, when the new photo is mostly visible.
    clearTimeout(overlayTimer);
    const st2 = state;
    overlayTimer = setTimeout(() => { if (shownId === cur.id) renderOverlay(cur, st2); }, immediate ? 0 : (TRANSITION_MS[st2.settings.transition] || 1500) / 2);
  }

  let es = null, connected = false, lostAt = 0;
  function connect() {
    es = new EventSource(`/api/events?role=${kiosk ? "shelf" : "phone"}`);
    es.addEventListener("state", (e) => { connected = true; apply(JSON.parse(e.data)).catch((err) => console.error(err)); });
    es.onerror = () => {
      if (connected) { connected = false; lostAt = Date.now(); }
      setTimeout(() => { if (!connected && Date.now() - lostAt > 4000 && state) renderStatus(state, false); }, 4500);
    };
  }

  fetch("/api/presets").then((r) => r.json()).then((p) => { styles = p.overlayStyles; if (state) renderOverlay(state.current, state); }).catch(() => {});
  connect();

  // For the controls layer (controls.js) and tests.
  window.Show = {
    kiosk,
    get state() { return state; },
    onState(fn) { listeners.push(fn); if (state) fn(state); },
    api: async (method, path, body) => {
      const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return j;
    },
    relDate, absDate,
  };
})();
