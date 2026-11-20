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
  const TRANSITION_MS = {
    fade: 1500, slide: 900, zoom: 1300, dip: 1600, rise: 1000, bloom: 1400, drift: 1700, deck: 1100,
    cube: 1500, flip: 1400, louvres: 1700, mosaic: 1900, shatter: 2000, ripple: 1700, doors: 1700, vortex: 1500, glitch: 1100, snapshot: 2000,
  };
  // "Surprise me": chosen from the photo's id, so every screen picks the same one; the owner's
  // surpriseSkip leaves some out.
  function transitionFor(settings, id) {
    const kind = settings && settings.transition;
    if (kind !== "random") return kind;
    const skip = settings.surpriseSkip || [];
    const all = transitions.filter((t) => t !== "random" && TRANSITION_MS[t]);
    const list = all.filter((t) => !skip.includes(t));
    const from = list.length ? list : all;
    return from.length ? from[hash(`t${id}`) % from.length] : "fade";
  }
  // The same "random" numbers on every screen: seeded from the photo's id.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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
      const kind = transitionFor(st.settings, photo.id);
      const total = st.duration + (TRANSITION_MS[kind] || 1500) + (st.settings.night ? 4000 : 0);
      const anim = frame.animate(motionFrames(photo.id, st.settings.motion), { duration: total, easing: "linear", fill: "forwards" });
      anim.currentTime = Math.min(total, Math.max(0, st.elapsed + (serverNow() - st.serverTime)));
      if (st.paused) anim.pause();
      slide._anim = anim;
    }
    return slide;
  }

  // ---------- the showpiece transitions (B42) ----------
  // Still only opacity and transform (smooth on the Pi). Two kinds: whole-photo moves in 3D (cube,
  // flip, vortex, snapshot), and "pieces": the screen cut into tiles, each a window onto a still copy
  // of the old photo (and, two-sided, of the new one on its back), frozen where the pan and zoom are,
  // so the hand-over to the real photo underneath is seamless.
  function frameTransform(slide, ahead) {
    const f = slide.querySelector(".frame");
    if (!f) return "none";
    const a = slide._anim;
    if (!ahead || !a || a.currentTime === null) return getComputedStyle(f).transform;
    const t = a.currentTime;
    a.currentTime = t + ahead; // where the pan and zoom will be when the transition ends
    const tr = getComputedStyle(f).transform;
    a.currentTime = t;
    return tr;
  }
  function ghost(slide, transform, x, y) {
    const g = slide.cloneNode(true); // a still copy: not a .slide, so it never counts as one
    g.className = "ghost";
    g.removeAttribute("data-id");
    Object.assign(g.style, { left: `${-x}px`, top: `${-y}px`, width: `${innerWidth}px`, height: `${innerHeight}px`, visibility: "visible" });
    const f = g.querySelector(".frame");
    if (f) f.style.transform = transform;
    return g;
  }
  function cutUp(fx, cols, rows, backTurn) {
    const W = innerWidth, H = innerHeight;
    const layer = document.createElement("div");
    layer.className = "shards";
    const tOld = frameTransform(fx.prev), tNew = backTurn ? frameTransform(fx.slide, fx.ms) : null;
    const list = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = Math.round((c * W) / cols), y = Math.round((r * H) / rows);
      const w = Math.round(((c + 1) * W) / cols) - x, h = Math.round(((r + 1) * H) / rows) - y;
      const el = document.createElement("div");
      el.className = backTurn ? "shard two" : "shard";
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const face = (s, t, back) => {
        const f = document.createElement("div");
        f.className = "face";
        if (back) f.style.transform = backTurn;
        f.appendChild(ghost(s, t, x, y));
        el.appendChild(f);
      };
      face(fx.prev, tOld, false);
      if (backTurn) face(fx.slide, tNew, true);
      layer.appendChild(el);
      list.push({ el, c, r, x: (x + w / 2) / W, y: (y + h / 2) / H });
    }
    fx.hideOld();
    fx.add(layer);
    return list;
  }
  const P = () => Math.round(Math.max(innerWidth, innerHeight) * 1.25); // perspective for the 3D moves

  const FANCY = {
    cube(fx) { // the two photos are sides of a turning cube, pulled back a little at the turn
      const half = innerWidth / 2, d = fx.dir, pull = -innerWidth * 0.3;
      const at = (z, a) => ({ transform: `perspective(${P() * 1.6}px) translateZ(${z}px) translateZ(${-half}px) rotateY(${a}deg) translateZ(${half}px)` });
      const o = { duration: fx.ms, easing: "cubic-bezier(.6,0,.3,1)", fill: "both" };
      fx.run(fx.prev, [at(0, 0), { ...at(pull, -45 * d), offset: 0.5 }, at(0, -90 * d)], o);
      fx.run(fx.slide, [at(0, 90 * d), { ...at(pull, 45 * d), offset: 0.5 }, at(0, 0)], o);
    },
    flip(fx) { // a card turned over, lifted off the table at the turn
      const d = fx.dir;
      const at = (a, s) => ({ transform: `perspective(${P()}px) rotateY(${a}deg) scale(${s})` });
      const o = { duration: fx.ms, easing: "cubic-bezier(.55,0,.35,1)", fill: "both" };
      fx.prev.style.backfaceVisibility = fx.slide.style.backfaceVisibility = "hidden";
      fx.run(fx.prev, [at(0, 1), { ...at(90 * d, 0.8), offset: 0.5 }, at(180 * d, 1)], o);
      fx.run(fx.slide, [at(-180 * d, 1), { ...at(-90 * d, 0.8), offset: 0.5 }, at(0, 1)], o);
    },
    louvres(fx) { // tall slats turn in a wave, the new photo on their backs
      const cols = 10, step = 75, turn = fx.ms - step * (cols - 1);
      cutUp(fx, cols, 1, "rotateY(180deg)").forEach((p) => {
        const k = fx.dir > 0 ? p.c : cols - 1 - p.c;
        const at = (z, a) => ({ transform: `translateZ(${z}px) rotateY(${a * fx.dir}deg)` });
        fx.run(p.el, [at(0, 0), { ...at(-160, 90), offset: 0.5 }, at(0, 180)], { duration: turn, delay: k * step, easing: "cubic-bezier(.45,0,.3,1)", fill: "both" });
      });
    },
    mosaic(fx) { // tiles flip over corner to corner in a diagonal wave
      const cols = 6, rows = 4, spread = 900, turn = fx.ms - spread;
      cutUp(fx, cols, rows, "rotate3d(1, 1, 0, 180deg)").forEach((p) => {
        const c = fx.dir > 0 ? p.c : cols - 1 - p.c;
        const k = (c / (cols - 1) + p.r / (rows - 1)) / 2;
        const at = (z, a) => ({ transform: `translateZ(${z}px) rotate3d(1, 1, 0, ${a}deg)` });
        fx.run(p.el, [at(0, 0), { ...at(-220, 90), offset: 0.5 }, at(0, 180)], { duration: turn, delay: k * spread, easing: "ease-in-out", fill: "both" });
      });
    },
    shatter(fx) { // cracks from a point of impact, then the pieces tumble away
      const W = innerWidth, H = innerHeight, rnd = fx.rnd;
      const ix = 0.3 + 0.4 * rnd(), iy = 0.3 + 0.4 * rnd();
      cutUp(fx, 7, 5).forEach((p) => {
        const dx = p.x - ix, dy = p.y - iy, dist = Math.hypot(dx, dy) || 0.01, ux = dx / dist, uy = dy / dist;
        const delay = Math.min(450, dist * 600) + 60 * rnd();
        const fly = 0.25 + 0.45 * rnd();
        const at = (tx, ty, tz, rx, ry, rz, s) => `translate3d(${tx}px, ${ty}px, ${tz}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`;
        fx.run(p.el, [
          { transform: at(0, 0, 0, 0, 0, 0, 1), opacity: 1 },
          { transform: at(ux * 14, uy * 14, 30, 0, 0, (rnd() - 0.5) * 6, 0.97), opacity: 1, offset: 0.14, easing: "cubic-bezier(.5,0,.9,.5)" },
          { transform: at(ux * fly * W, uy * 0.15 * H + (0.6 + 0.5 * rnd()) * H, 200 + 300 * rnd(), (rnd() - 0.5) * 300, (rnd() - 0.5) * 300, (rnd() - 0.5) * 200, 0.6), opacity: 0 },
        ], { duration: fx.ms - delay - 80, delay, fill: "both" });
      });
      fx.run(fx.slide, [{ transform: "scale(1.1)" }, { transform: "scale(1)" }], { duration: fx.ms, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" });
    },
    ripple(fx) { // the old photo melts away in rings from the centre
      const spread = 750, melt = fx.ms - spread, aspect = innerWidth / innerHeight;
      cutUp(fx, 9, 5).forEach((p) => {
        const dist = Math.hypot((p.x - 0.5) * aspect, p.y - 0.5) / Math.hypot(0.5 * aspect, 0.5);
        fx.run(p.el, [
          { transform: "scale(1) rotate(0deg)", opacity: 1 },
          { transform: "scale(1.08) rotate(0deg)", opacity: 1, offset: 0.3 },
          { transform: "scale(0) rotate(90deg)", opacity: 0 },
        ], { duration: melt, delay: dist * spread, easing: "ease-in", fill: "both" });
      });
      fx.run(fx.slide, [{ transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: fx.ms, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" });
    },
    doors(fx) { // a crack down the middle, then the halves swing open
      const gap = innerWidth * 0.012;
      cutUp(fx, 2, 1).forEach((p) => {
        const s = p.c === 0 ? -1 : 1; // left door, right door
        p.el.style.transformOrigin = p.c === 0 ? "0 50%" : "100% 50%";
        const at = (tx, a) => `translateX(${tx}px) rotateY(${a}deg)`;
        fx.run(p.el, [
          { transform: at(0, 0), opacity: 1 },
          { transform: at(s * gap, 0), opacity: 1, offset: 0.15, easing: "cubic-bezier(.55,0,.35,1)" },
          { transform: at(s * gap, -s * 82), opacity: 1, offset: 0.8 },
          { transform: at(s * gap, -s * 90), opacity: 0 },
        ], { duration: fx.ms, fill: "both" });
      });
      fx.run(fx.slide, [{ transform: "scale(1.15)", opacity: 0.5 }, { transform: "scale(1)", opacity: 1 }], { duration: fx.ms, easing: "cubic-bezier(.3,.5,.3,1)", fill: "both" });
    },
    vortex(fx) { // the old photo spins down the drain; the new one unwinds out of it
      const d = fx.dir;
      const at = (a, s) => `rotate(${a}deg) scale(${s})`;
      fx.run(fx.prev, [{ transform: at(0, 1), opacity: 1 }, { transform: at(-150 * d, 0.05), opacity: 0 }], { duration: fx.ms * 0.65, easing: "cubic-bezier(.55,0,.8,.4)", fill: "both" });
      fx.run(fx.slide, [
        { transform: at(140 * d, 1.9), opacity: 0 },
        { transform: at(140 * d, 1.9), opacity: 0, offset: 0.2, easing: "cubic-bezier(.15,.75,.3,1)" },
        { transform: at(0, 1), opacity: 1 },
      ], { duration: fx.ms, fill: "both" });
    },
    glitch(fx) { // horizontal bands jolt sideways, flicker and drop out; the new photo stutters in
      const W = innerWidth, rnd = fx.rnd;
      const jolt = () => `translateX(${((rnd() - 0.5) * 0.24 * W).toFixed(0)}px)`;
      cutUp(fx, 1, 14).forEach((p) => {
        const at = [0.12, 0.2, 0.33, 0.46, 0.58, 0.7].map((o) => o + (rnd() - 0.5) * 0.06);
        const frames = [{ transform: "translateX(0px)", opacity: 1, offset: 0, easing: "steps(1, end)" }];
        at.forEach((offset, k) => frames.push({ transform: jolt(), opacity: k > 2 && rnd() < 0.4 ? 0.3 : 1, offset, easing: "steps(1, end)" }));
        frames.push({ transform: jolt(), opacity: 0, offset: 0.8, easing: "steps(1, end)" }, { transform: "translateX(0px)", opacity: 0, offset: 1 });
        fx.run(p.el, frames, { duration: fx.ms, fill: "both" });
      });
      const k = (x, o, offset) => ({ transform: `translateX(${x * W}px)`, opacity: o, offset, easing: "steps(1, end)" });
      fx.run(fx.slide, [k(0, 0, 0), k(0.03, 0.7, 0.35), k(0, 0, 0.42), k(-0.02, 1, 0.55), k(0.008, 1, 0.68), k(0, 1, 0.8), k(0, 1, 1)], { duration: fx.ms, fill: "both" });
    },
    snapshot(fx) { // tossed in like a print, lands with a little bounce, then grows to fill the screen
      const d = fx.dir, s = fx.slide;
      const edge = document.createElement("div");
      edge.className = "print-edge";
      s.appendChild(edge);
      s.style.boxShadow = "0 4vmin 12vmin rgba(0,0,0,.65)";
      fx.after(() => { edge.remove(); s.style.boxShadow = ""; });
      const at = (x, y, a, sc) => `translate(${x}%, ${y}%) rotate(${a}deg) scale(${sc})`;
      fx.run(s, [
        { transform: at(-75 * d, 70, -26 * d, 0.36), easing: "cubic-bezier(.2,.75,.3,1)" },
        { transform: at(0, 0, 6 * d, 0.44), offset: 0.38, easing: "ease-in-out" },
        { transform: at(0, 0, 3 * d, 0.42), offset: 0.5 },
        { transform: at(0, 0, 3 * d, 0.42), offset: 0.6, easing: "cubic-bezier(.7,0,.2,1)" },
        { transform: at(0, 0, 0, 1) },
      ], { duration: fx.ms, fill: "both" });
      fx.run(edge, [{ opacity: 1 }, { opacity: 1, offset: 0.66 }, { opacity: 0, offset: 0.9 }, { opacity: 0 }], { duration: fx.ms, fill: "both" });
      fx.run(fx.prev, [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.94)", opacity: 0.45, offset: 0.5 }, { transform: "scale(.94)", opacity: 0.45 }], { duration: fx.ms, easing: "ease-out", fill: "both" });
    },
  };

  // Runs a showpiece transition; false when there is no old photo to work with.
  function fancyIn(slide, kind, old, ms, dir, done) {
    const prev = old.filter((o) => o.classList.contains("slide")).pop();
    if (!prev) return false;
    const anims = [], added = [], after = [];
    const fx = {
      slide, prev, ms, dir, rnd: seeded(hash(`fx${slide.dataset.id}`)),
      run: (el, frames, opts) => { const a = el.animate(frames, opts); anims.push([el, a]); return a; },
      add: (el) => { added.push(el); stage.insertBefore(el, slide); },
      hideOld: () => old.forEach((o) => { if (o.classList.contains("slide")) o.style.visibility = "hidden"; }),
      after: (fn) => after.push(fn),
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
      added.forEach((el) => el.remove());
      after.forEach((fn) => fn());
      // the new photo keeps no leftover transform (its own pan and zoom is on its frame)
      anims.forEach(([el, a]) => { if (el === slide) a.cancel(); });
      slide.style.backfaceVisibility = "";
    };
    try {
      FANCY[kind](fx);
      Promise.all(anims.map(([, a]) => a.finished)).then(finish, finish);
      setTimeout(finish, ms + 1500); // never left half-way, whatever happens
    } catch (e) {
      console.error(e);
      anims.forEach(([, a]) => a.cancel());
      finish();
    }
    return true;
  }

  function transitionIn(slide, kind, back, immediate) {
    const old = [...stage.children];
    stage.appendChild(slide);
    const ms = immediate ? 0 : TRANSITION_MS[kind] || 1500;
    const done = () => old.forEach((o) => o.remove());
    if (!ms) { done(); return; }
    const dir = back ? -1 : 1;
    if (FANCY[kind] && fancyIn(slide, kind, old, ms, dir, done)) return;
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
    const kind = transitionFor(st.settings, photo.id);
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
