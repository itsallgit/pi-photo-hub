// map.js - the map panel of the phone page (R15, stretch): where the photos were taken, as dots
// sized by the number of photos (GET /api/map/points, from the catalogue's GPS); move the map to an
// area and play it (a source with a box). Leaflet is vendored (vendor/leaflet) and loaded only when
// the map opens; the map tiles come from OpenStreetMap, which sees only map positions (accepted by
// the owner for the map). No photo data leaves the house.
"use strict";
(function () {
  let leaflet = null;
  function loadLeaflet() {
    if (leaflet) return leaflet;
    leaflet = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/vendor/leaflet/leaflet.css";
      document.head.append(css);
      const s = document.createElement("script");
      s.src = "/vendor/leaflet/leaflet.js";
      s.onload = () => resolve(window.L);
      s.onerror = () => { leaflet = null; reject(new Error("could not load the map")); };
      document.head.append(s);
    });
    return leaflet;
  }
  let points = null;
  let view = null; // keep the place the person was looking at between openings

  window.ShowMap = {
    pane({ h, api, play, say }) {
      const box = h("div", { class: "map" });
      const count = h("span", { class: "count" }, "");
      const wrap = h("div", {}, box, h("div", { class: "play-row" }, count,
        h("button", { class: "on", on: { click: () => {
          if (!wrap._map) return;
          const b = wrap._map.getBounds();
          const r = (x) => Math.round(x * 100000) / 100000;
          play({ box: [r(b.getSouth()), r(b.getWest()), r(b.getNorth()), r(b.getEast())], label: "Map area" });
        } } }, "Play this area")),
        h("p", { class: "muted" }, "Move and zoom to the place, then Play. Map © OpenStreetMap contributors; places: GeoNames."));
      Promise.all([loadLeaflet(), points || (points = api("GET", "/api/map/points").then((r) => r.points))]).then(([L, pts]) => {
        const map = L.map(box, { preferCanvas: true, zoomControl: true, attributionControl: true });
        wrap._map = map;
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
        const renderer = L.canvas();
        for (const [lat, lon, n] of pts) {
          L.circleMarker([lat, lon], { renderer, radius: Math.min(14, 3 + Math.log2(n + 1)), color: "#f5c518", weight: 1, fillOpacity: 0.55 })
            .on("click", () => map.setView([lat, lon], Math.max(map.getZoom() + 3, 12))).addTo(map);
        }
        const update = () => {
          view = { c: map.getCenter(), z: map.getZoom() };
          const b = map.getBounds();
          const n = pts.reduce((a, [lat, lon, k]) => a + (b.contains([lat, lon]) ? k : 0), 0);
          count.textContent = `About ${n.toLocaleString()} photos here`;
        };
        map.on("moveend", update);
        if (view) map.setView(view.c, view.z);
        else if (pts.length) map.fitBounds(pts.map(([a, b]) => [a, b]), { padding: [10, 10] });
        else map.setView([0, 0], 2);
        setTimeout(() => map.invalidateSize(), 50);
        update();
      }).catch((e) => say(e.message));
      return wrap;
    },
  };
})();
