// hud.js - what is drawn over the photo: the clock faces and the captions. Used by the slideshow
// (show.js) and by the live previews in the phone's settings, so a preview is the real thing.
// Only opacity and transform ever animate (smooth on the Pi, docs/architecture.md "Motion on the Pi").
"use strict";
(function () {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const POSITIONS = ["top-left", "top-center", "top-right", "center", "bottom-left", "bottom-center", "bottom-right"];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  // ---------- dates ----------
  const parts = (iso) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
  function absDate(iso) { const p = parts(iso); return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`; }
  function relDate(iso, nowMs) {
    const p = parts(iso), then = new Date(p.y, p.m - 1, p.d), now = new Date(nowMs);
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

  // ---------- captions ----------
  function fieldText(item, photo, st, nowMs) {
    const i = (photo && photo.info) || {};
    switch (item.field) {
      case "date": {
        if (!i.date) return null;
        const p = parts(i.date);
        switch (item.format) {
          case "short": return `${p.d} ${MONTHS[p.m - 1].slice(0, 3)} ${p.y}`;
          case "weekday": return `${DAYS[new Date(p.y, p.m - 1, p.d).getDay()]}, ${absDate(i.date)}`;
          case "month": return `${MONTHS[p.m - 1]} ${p.y}`;
          case "year": return String(p.y);
          case "ago": return relDate(i.date, nowMs);
          default: return absDate(i.date);
        }
      }
      case "place":
        if (!i.place) return null;
        if (item.format === "country") return i.country || i.place;
        return item.format === "name" ? i.place.split(", ")[0] : i.place;
      case "event": {
        if (!i.event) return null;
        const bits = i.event.split(" › ");
        if (item.format === "first") return bits[0];
        return item.format === "last" ? bits[bits.length - 1] : i.event;
      }
      case "people": {
        const list = i.people || [];
        if (!list.length) return null;
        if (item.format !== "with") return list.join(", ");
        return `With ${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0]}`;
      }
      case "show": return (st.source && st.source.label) || null;
      default: return null;
    }
  }

  // The classic overlay (the knob's styles) expressed as captions, so there is one way of drawing.
  function classicCaptions(s, styles) {
    const style = styles[s.overlayStyle] || styles[0];
    if (!style || style.position === "none") return { items: [], groups: {} };
    const corner = style.position === "bottom" ? "bottom-center" : style.position;
    const look = { shadow: "shadow", strip: "strip", none: "plain" }[style.backing] || "shadow";
    const large = style.size === "large", o = s.overlay || {}, items = [];
    const add = (field, format) => items.push({ id: `c${items.length}`, field, format, corner, size: large ? "l" : "s", font: "sans" });
    if (o.date && o.date !== "off") add("date", o.date === "relative" ? "ago" : "long");
    if (o.place) add("place", "full");
    if (o.event) add("event", "full");
    if (o.people) add("people", "list");
    return { items, groups: { [corner]: { look, tone: style.text === "dark" ? "dark" : "light" } }, leadSize: large ? "xl" : "m" };
  }
  function activeCaptions(s, styles) {
    return s.overlayMode === "custom" && s.captions ? s.captions : classicCaptions(s, styles);
  }

  // ---------- the layer ----------
  function makeHud(root) {
    if (!root.querySelector(".anchor")) for (const p of POSITIONS) { const a = el("div", `anchor at-${p}`); a.dataset.pos = p; root.append(a); }
    return root;
  }
  const anchor = (root, pos) => root.querySelector(`.anchor[data-pos="${pos}"]`);

  // ctx: { fill: url of a small blurred copy of the photo, lum(rect): brightness 0..255 there, root(): the frame's rect }
  function paintGlass(node, ctx) {
    const pane = node.querySelector(":scope > .glass-pane");
    if (!pane) return;
    if (!ctx || !ctx.fill) { pane.style.backgroundImage = "none"; return; }
    const r = node.getBoundingClientRect(), f = ctx.root();
    pane.style.backgroundImage = `url("${ctx.fill}")`;
    pane.style.backgroundSize = `${f.width}px ${f.height}px`;
    pane.style.backgroundPosition = `${f.left - r.left}px ${f.top - r.top}px`;
  }
  function finish(node, look, tone, ctx) {
    let t = tone;
    if (tone === "auto") {
      const solid = { pill: "light", paper: "dark" }[look];
      const b = solid ? null : ctx && ctx.lum ? ctx.lum(node.getBoundingClientRect()) : null;
      t = solid || (b !== null && b > 150 ? "dark" : "light");
    }
    node.classList.remove("tone-light", "tone-dark", "tone-gold");
    node.classList.add(`tone-${t}`);
    if (look === "glass") paintGlass(node, ctx);
  }
  function setLook(node, look) {
    let pane = node.querySelector(":scope > .glass-pane");
    if (look === "glass" && !pane) { pane = el("div", "glass-pane"); node.prepend(pane); }
    if (look !== "glass" && pane) pane.remove();
  }

  // Draw the captions into their corners; returns how many lines are showing.
  function renderCaptions(root, st, photo, styles, nowMs, ctx) {
    makeHud(root);
    root.querySelectorAll(".capgroup").forEach((g) => g.remove());
    const cap = activeCaptions(st.settings, styles);
    const byCorner = new Map();
    for (const it of cap.items) {
      const text = photo ? fieldText(it, photo, st, nowMs) : null;
      if (!text) continue;
      if (!byCorner.has(it.corner)) byCorner.set(it.corner, []);
      byCorner.get(it.corner).push({ it, text });
    }
    let n = 0;
    for (const [corner, lines] of byCorner) {
      const g = (cap.groups && cap.groups[corner]) || { look: "shadow", tone: "light" };
      const look = g.look === "strip" && !corner.endsWith("center") ? "pill" : g.look;
      const box = el("div", `capgroup look-${look}`);
      setLook(box, look);
      lines.forEach(({ it, text }, k) => {
        const lead = cap.leadSize && k === 0;
        const line = el("div", `cap size-${lead ? cap.leadSize : it.size} font-${lead ? "bold" : it.font}`, text);
        line.dataset.id = it.id;
        box.append(line);
        n++;
      });
      anchor(root, corner).append(box);
      finish(box, look, g.tone, ctx);
    }
    return n;
  }

  // ---------- the clock ----------
  const WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
  const STEPS = { 5: "five past", 10: "ten past", 15: "quarter past", 20: "twenty past", 25: "twenty-five past", 30: "half past", 35: "twenty-five to", 40: "twenty to", 45: "quarter to", 50: "ten to", 55: "five to" };
  function inWords(d) {
    const m = d.getMinutes(), near = Math.round(m / 5) * 5, off = m - near;
    const hour = (d.getHours() + (near > 30 ? 1 : 0)) % 12;
    const name = WORDS[hour];
    const base = near === 0 || near === 60 ? `${WORDS[(d.getHours() + (near === 60 ? 1 : 0)) % 12]} o'clock` : `${STEPS[near]} ${name}`;
    const lead = off > 0 ? "just after " : off < 0 ? "nearly " : "";
    const text = lead + base;
    return text[0].toUpperCase() + text.slice(1);
  }
  function timeText(d, hour12) {
    const h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
    return `${hour12 ? h % 12 || 12 : h}:${m}`;
  }
  function dateLine(d) { return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; }

  function flipCard(ch) {
    const c = el("span", "flip");
    c.dataset.ch = ch;
    const half = (cls, t) => { const s = el("span", cls); s.append(el("b", "", t)); return s; };
    c.append(half("upper", ch), half("lower", ch));
    return c;
  }
  function setHalf(node, t) { node.firstChild.textContent = t; }
  function flipTo(card, ch, animate) {
    const was = card.dataset.ch;
    if (was === ch) return;
    card.dataset.ch = ch;
    const upper = card.querySelector(".upper"), lower = card.querySelector(".lower");
    setHalf(upper, ch);
    if (!animate) { setHalf(lower, ch); return; }
    card.querySelectorAll(".flap").forEach((f) => f.remove());
    const mk = (cls, t) => { const s = el("span", `flap ${cls}`); s.append(el("b", "", t)); return s; };
    const down = mk("flap-top upper", was), up = mk("flap-bottom lower", ch);
    card.append(down, up);
    up.addEventListener("animationend", () => { setHalf(lower, ch); down.remove(); up.remove(); }, { once: true });
  }
  function renderFlip(box, text, animate) {
    const chars = [...text];
    if (box.children.length !== chars.length || [...box.children].some((c, k) => (c.classList.contains("sep") !== (chars[k] === ":")))) {
      box.replaceChildren(...chars.map((c) => (c === ":" ? el("span", "sep", ":") : flipCard(c))));
      return;
    }
    chars.forEach((c, k) => { if (c !== ":") flipTo(box.children[k], c, animate); });
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
  function renderDial(box, d) {
    if (!box.querySelector("svg")) {
      const s = svg("svg", { viewBox: "0 0 100 100", class: "dial" });
      for (let i = 0; i < 12; i++) s.append(svg("line", { x1: 50, y1: i % 3 ? 7 : 5, x2: 50, y2: i % 3 ? 10 : 13, class: i % 3 ? "tick" : "tick major", transform: `rotate(${i * 30} 50 50)` }));
      s.append(svg("line", { x1: 50, y1: 54, x2: 50, y2: 28, class: "hand hour" }), svg("line", { x1: 50, y1: 56, x2: 50, y2: 15, class: "hand minute" }), svg("circle", { cx: 50, cy: 50, r: 2.4, class: "pivot" }));
      box.replaceChildren(s);
    }
    const m = d.getMinutes(), h = (d.getHours() % 12) + m / 60;
    box.querySelector(".hour").setAttribute("transform", `rotate(${h * 30} 50 50)`);
    box.querySelector(".minute").setAttribute("transform", `rotate(${m * 6} 50 50)`);
  }

  // Draw the clock into `node` (kept between calls, so the flip clock can flip). `opts.still` never animates.
  function renderClock(node, style, d, ctx, opts = {}) {
    const look = style.backing, key = `${style.face}|${style.size}|${look}|${style.date}`;
    if (node._key !== key) {
      node._key = key;
      node.replaceChildren();
      node.className = `clock face-${style.face} size-${style.size} look-${look}`;
      setLook(node, look);
      node.append(el("div", "clock-time"));
      if (style.date) node.append(el("div", "clock-date"));
      node._text = null;
    }
    node.style.opacity = String((style.opacity === undefined ? 100 : style.opacity) / 100);
    const time = node.querySelector(".clock-time"), text = timeText(d, style.hour12);
    if (node._text !== text) {
      if (style.face === "flip") renderFlip(time, text, node._text !== null && !opts.still);
      else if (style.face === "analog") renderDial(time, d);
      else time.textContent = style.face === "words" ? inWords(d) : text;
      node._text = text;
    }
    const line = node.querySelector(".clock-date");
    if (line) line.textContent = dateLine(d);
    finish(node, look, style.tone, ctx);
  }

  window.ShowHud = { makeHud, anchor, renderCaptions, renderClock, classicCaptions, activeCaptions, fieldText, paintGlass, absDate, relDate, inWords, MONTHS };
})();
