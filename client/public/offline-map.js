/*
 * Offline field map viewer (W5b). Reads only what "Save this area for offline"
 * stored on this device; makes no network request of its own except the tile
 * <img>s, which the service worker answers from Cache Storage. Names must
 * match client/src/lib/offline-map-store.ts (pinned by
 * tests/unit/offlineMapSources.test.ts).
 */
(function () {
  "use strict";
  var DB_NAME = "acreos-offline-maps";
  var DB_STORE = "areas";
  var TILE = 256;

  var els = {
    area: document.getElementById("area"),
    since: document.getElementById("since"),
    map: document.getElementById("map"),
    tiles: document.getElementById("tiles"),
    overlay: document.getElementById("overlay"),
    facts: document.getElementById("facts"),
    attribution: document.getElementById("attribution"),
  };

  var state = { areas: [], area: null, z: 0, cx: 0, cy: 0, me: null };

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE, { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function loadAreas() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(DB_STORE, "readonly");
        var r = t.objectStore(DB_STORE).getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  // Web-Mercator world pixel coordinates at zoom z.
  function project(lng, lat, z) {
    var s = TILE * Math.pow(2, z);
    var r = (lat * Math.PI) / 180;
    return { x: ((lng + 180) / 360) * s, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s };
  }

  function fmtSince(iso) {
    var d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function tileUrl(template, z, x, y) {
    return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  }

  function render() {
    var a = state.area;
    if (!a) return;
    var w = els.map.clientWidth, h = els.map.clientHeight;
    var left = state.cx - w / 2, top = state.cy - h / 2;
    var saved = {};
    for (var i = 0; i < a.tileUrls.length; i++) saved[a.tileUrls[i]] = true;
    els.tiles.innerHTML = "";
    var x0 = Math.floor(left / TILE), x1 = Math.floor((left + w) / TILE);
    var y0 = Math.floor(top / TILE), y1 = Math.floor((top + h) / TILE);
    for (var s = 0; s < a.sources.length; s++) {
      for (var x = x0; x <= x1; x++) {
        for (var y = y0; y <= y1; y++) {
          var url = tileUrl(a.sources[s].template, state.z, x, y);
          if (!saved[url]) continue; // only what was saved; nothing is fetched live
          var img = document.createElement("img");
          img.alt = "";
          img.src = url;
          img.crossOrigin = "anonymous";
          img.style.left = x * TILE - left + "px";
          img.style.top = y * TILE - top + "px";
          img.setAttribute("data-tile", state.z + "/" + x + "/" + y);
          els.tiles.appendChild(img);
        }
      }
    }
    drawParcels(left, top, w, h);
  }

  function ringPath(ring, left, top) {
    var d = "";
    for (var i = 0; i < ring.length; i++) {
      var p = project(ring[i][0], ring[i][1], state.z);
      d += (i === 0 ? "M" : "L") + (p.x - left).toFixed(1) + " " + (p.y - top).toFixed(1);
    }
    return d + "Z";
  }

  function drawParcels(left, top, w, h) {
    var svg = els.overlay;
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.innerHTML = "";
    var ns = "http://www.w3.org/2000/svg";
    var parcels = state.area.parcels || [];
    parcels.forEach(function (p) {
      var shape;
      if (p.boundary && p.boundary.coordinates) {
        var polys = p.boundary.type === "MultiPolygon" ? p.boundary.coordinates : [p.boundary.coordinates];
        var d = "";
        polys.forEach(function (poly) { poly.forEach(function (ring) { d += ringPath(ring, left, top); }); });
        shape = document.createElementNS(ns, "path");
        shape.setAttribute("d", d);
        shape.setAttribute("fill", "rgba(234,88,12,0.15)");
      } else if (p.lat != null && p.lng != null) {
        var c = project(p.lng, p.lat, state.z);
        shape = document.createElementNS(ns, "circle");
        shape.setAttribute("cx", c.x - left);
        shape.setAttribute("cy", c.y - top);
        shape.setAttribute("r", 8);
        shape.setAttribute("fill", "rgba(234,88,12,0.6)");
      }
      if (!shape) return;
      shape.setAttribute("stroke", "var(--parcel)");
      shape.setAttribute("stroke-width", "2");
      shape.setAttribute("data-parcel", String(p.id));
      shape.style.pointerEvents = "auto";
      shape.addEventListener("click", function () { showFacts(p); });
      svg.appendChild(shape);
    });
    svg.style.pointerEvents = "none";
    if (state.me) {
      var m = project(state.me.lng, state.me.lat, state.z);
      var dot = document.createElementNS(ns, "circle");
      dot.setAttribute("cx", m.x - left);
      dot.setAttribute("cy", m.y - top);
      dot.setAttribute("r", 7);
      dot.setAttribute("fill", "#2563eb");
      dot.setAttribute("stroke", "#fff");
      dot.setAttribute("stroke-width", "2");
      svg.appendChild(dot);
    }
  }

  function showFacts(p) {
    var rows = [
      ["APN", p.apn], ["County", p.county + ", " + p.state], ["Acres", p.acres], ["Address", p.address],
      ["Status", p.status], ["Zoning", p.zoning], ["Road access", p.roadAccess], ["Assessed value", p.assessedValue],
    ];
    els.facts.innerHTML = "";
    rows.forEach(function (r) {
      if (r[1] == null || r[1] === "") return;
      var div = document.createElement("div");
      var b = document.createElement("strong");
      b.textContent = r[0] + ": ";
      div.appendChild(b);
      div.appendChild(document.createTextNode(String(r[1])));
      els.facts.appendChild(div);
    });
    var note = document.createElement("div");
    note.textContent = "As saved " + fmtSince(state.area.savedAt) + " — not live.";
    els.facts.appendChild(note);
  }

  function center() {
    var b = state.area.bbox;
    var c = project((b.west + b.east) / 2, (b.south + b.north) / 2, state.z);
    state.cx = c.x;
    state.cy = c.y;
  }

  function selectArea(id) {
    state.area = state.areas.filter(function (a) { return a.id === id; })[0] || null;
    if (!state.area) return;
    var a = state.area;
    state.z = Math.min(a.maxZoom, Math.max(a.minZoom, a.maxZoom - 2));
    center();
    var mb = (a.bytes / 1024 / 1024).toFixed(1);
    els.since.textContent =
      "Offline since " + fmtSince(a.savedAt) + " — " + a.parcels.length + " parcel" + (a.parcels.length === 1 ? "" : "s") +
      ", " + a.tileCount + " imagery tiles (" + mb + " MB). Facts are as saved, not live." +
      (a.parcelsTruncated ? " Only the first " + a.parcels.length + " parcels in the area were saved." : "");
    var attr = a.sources.map(function (s) { return s.attribution; }).join(" · ");
    var refused = (a.refusedSources || []).map(function (s) { return s.label; }).join(", ");
    els.attribution.textContent = attr + (refused ? " — Not available offline: " + refused + " (its terms don't allow saving tiles)." : "");
    render();
  }

  function zoom(delta) {
    var a = state.area;
    if (!a) return;
    var nz = Math.min(a.maxZoom, Math.max(a.minZoom, state.z + delta));
    if (nz === state.z) return;
    var f = Math.pow(2, nz - state.z);
    state.cx *= f;
    state.cy *= f;
    state.z = nz;
    render();
  }

  // Drag to pan (pointer events cover touch and mouse).
  var drag = null;
  els.map.addEventListener("pointerdown", function (e) {
    if (e.target.closest && e.target.closest("#controls")) return;
    drag = { x: e.clientX, y: e.clientY, cx: state.cx, cy: state.cy };
    els.map.setPointerCapture(e.pointerId);
  });
  els.map.addEventListener("pointermove", function (e) {
    if (!drag) return;
    state.cx = drag.cx - (e.clientX - drag.x);
    state.cy = drag.cy - (e.clientY - drag.y);
    render();
  });
  els.map.addEventListener("pointerup", function (e) {
    if (drag && Math.abs(e.clientX - drag.x) < 4 && Math.abs(e.clientY - drag.y) < 4) {
      // A tap: hit-test parcels at the tap point.
      var hit = document.elementsFromPoint(e.clientX, e.clientY).filter(function (n) { return n.getAttribute && n.getAttribute("data-parcel"); })[0];
      if (hit) {
        var id = Number(hit.getAttribute("data-parcel"));
        var p = state.area.parcels.filter(function (x) { return x.id === id; })[0];
        if (p) showFacts(p);
      }
    }
    drag = null;
  });
  document.getElementById("zin").addEventListener("click", function () { zoom(1); });
  document.getElementById("zout").addEventListener("click", function () { zoom(-1); });
  document.getElementById("locate").addEventListener("click", function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      var c = project(state.me.lng, state.me.lat, state.z);
      state.cx = c.x;
      state.cy = c.y;
      render();
    });
  });
  els.area.addEventListener("change", function () { selectArea(els.area.value); });
  window.addEventListener("resize", render);

  loadAreas().then(function (areas) {
    state.areas = areas.sort(function (a, b) { return b.savedAt < a.savedAt ? -1 : 1; });
    if (state.areas.length === 0) {
      els.map.innerHTML = '<div class="empty">No area is saved on this device yet. While online, open Map and choose “Save this area for offline”.</div>';
      els.since.textContent = "Nothing saved for offline use.";
      return;
    }
    state.areas.forEach(function (a) {
      var o = document.createElement("option");
      o.value = a.id;
      o.textContent = a.name;
      els.area.appendChild(o);
    });
    selectArea(state.areas[0].id);
  }).catch(function () {
    els.since.textContent = "This browser couldn't open the offline map storage.";
  });
})();
