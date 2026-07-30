/* Harmony Verify — expert network globe.
 *
 * A rotating sphere with a marker at each city the reviewer network draws from,
 * and arcs between them for cases that cross borders. Canvas rather than a
 * mapping library: the whole thing is about 200 lines and adds no dependency, no
 * tiles, no third-party request — which matters on a page that must not phone
 * home before a visitor has agreed to anything.
 *
 * Rendering is orthographic — the projection your eye already expects from a
 * globe — with points on the far hemisphere culled, so the sphere reads as solid
 * without anything being drawn to fill it.
 */
(function () {
  "use strict";

  var stage = document.querySelector("[data-globe]");
  if (!stage) return;

  var canvas = document.createElement("canvas");
  stage.appendChild(canvas);
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Cities with the clinical academic density a reviewer network is recruited
     from. Coordinates are approximate — this is an illustration of reach, not a
     map of individuals, and marking real clinicians on a public page would be a
     privacy problem rather than a design flourish. */
  var HUBS = [
    { name: "Boston", lat: 42.36, lon: -71.06 },
    { name: "Rochester", lat: 44.02, lon: -92.47 },
    { name: "Toronto", lat: 43.65, lon: -79.38 },
    { name: "São Paulo", lat: -23.55, lon: -46.63 },
    { name: "London", lat: 51.51, lon: -0.13 },
    { name: "Paris", lat: 48.86, lon: 2.35 },
    { name: "Amsterdam", lat: 52.37, lon: 4.9 },
    { name: "Stockholm", lat: 59.33, lon: 18.07 },
    { name: "Zurich", lat: 47.38, lon: 8.54 },
    { name: "Milan", lat: 45.46, lon: 9.19 },
    { name: "Cairo", lat: 30.04, lon: 31.24 },
    { name: "Lagos", lat: 6.52, lon: 3.38 },
    { name: "Douala", lat: 4.05, lon: 9.77 },
    { name: "Nairobi", lat: -1.29, lon: 36.82 },
    { name: "Johannesburg", lat: -26.2, lon: 28.05 },
    { name: "Tel Aviv", lat: 32.09, lon: 34.78 },
    { name: "Dubai", lat: 25.2, lon: 55.27 },
    { name: "Mumbai", lat: 19.08, lon: 72.88 },
    { name: "Bengaluru", lat: 12.97, lon: 77.59 },
    { name: "Singapore", lat: 1.35, lon: 103.82 },
    { name: "Seoul", lat: 37.57, lon: 126.98 },
    { name: "Tokyo", lat: 35.68, lon: 139.65 },
    { name: "Sydney", lat: -33.87, lon: 151.21 },
    { name: "Melbourne", lat: -37.81, lon: 144.96 }
  ];

  /* Routes drawn as great-circle arcs — a case raised in one place, reviewed in
     another. Index pairs into HUBS. */
  var ROUTES = [
    [0, 4],
    [4, 17],
    [21, 19],
    [12, 4],
    [13, 18],
    [22, 19],
    [1, 8],
    [3, 5],
    [14, 10],
    [20, 0]
  ];

  var GOLD_SOFT = "rgba(212, 175, 55, ";
  var GRID = "rgba(72, 116, 208, ";
  var DOT = "rgba(158, 180, 220, ";

  /* Evenly spread points via a Fibonacci sphere — an even covering with no
     clustering at the poles, which is what a lat/lon grid gives you. */
  var FIELD = (function () {
    var count = 620;
    var points = [];
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < count; i++) {
      var y = 1 - (i / (count - 1)) * 2;
      var radius = Math.sqrt(Math.max(0, 1 - y * y));
      var theta = golden * i;
      points.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]);
    }
    return points;
  })();

  var toVector = function (lat, lon) {
    var phi = (lat * Math.PI) / 180;
    var lambda = (lon * Math.PI) / 180;
    return [Math.cos(phi) * Math.cos(lambda), Math.sin(phi), Math.cos(phi) * Math.sin(lambda)];
  };

  var HUB_VECTORS = HUBS.map(function (hub) {
    return toVector(hub.lat, hub.lon);
  });

  /* Slerp between two unit vectors: the shortest path over the surface, which is
     the path an arc between two cities should actually take. */
  function slerp(a, b, t) {
    var dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    var omega = Math.acos(dot);
    if (omega < 1e-6) return a;
    var s = Math.sin(omega);
    var k1 = Math.sin((1 - t) * omega) / s;
    var k2 = Math.sin(t * omega) / s;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  }

  var TILT = (-18 * Math.PI) / 180;
  var sinTilt = Math.sin(TILT);
  var cosTilt = Math.cos(TILT);

  var size = 0;
  var radius = 0;
  var centre = 0;

  function resize() {
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.max(1, Math.round(rect.width));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    radius = size * 0.42;
    centre = size / 2;
  }

  /** Rotate about Y (spin), then about X (tilt), then project orthographically. */
  function project(v, spin) {
    var cos = Math.cos(spin);
    var sin = Math.sin(spin);
    var x = v[0] * cos + v[2] * sin;
    var z = -v[0] * sin + v[2] * cos;
    var y = v[1] * cosTilt - z * sinTilt;
    var depth = v[1] * sinTilt + z * cosTilt;
    return { x: centre + x * radius, y: centre - y * radius, z: depth };
  }

  function drawGraticule(spin) {
    ctx.lineWidth = 1;

    for (var lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      var started = false;
      for (var lon = -180; lon <= 180; lon += 4) {
        var p = project(toVector(lat, lon), spin);
        if (p.z < 0) {
          started = false;
          continue;
        }
        if (started) ctx.lineTo(p.x, p.y);
        else {
          ctx.moveTo(p.x, p.y);
          started = true;
        }
      }
      ctx.strokeStyle = GRID + (lat === 0 ? 0.62 : 0.34) + ")";
      ctx.stroke();
    }

    for (var lon2 = -180; lon2 < 180; lon2 += 30) {
      ctx.beginPath();
      var on = false;
      for (var lat2 = -90; lat2 <= 90; lat2 += 4) {
        var q = project(toVector(lat2, lon2), spin);
        if (q.z < 0) {
          on = false;
          continue;
        }
        if (on) ctx.lineTo(q.x, q.y);
        else {
          ctx.moveTo(q.x, q.y);
          on = true;
        }
      }
      ctx.strokeStyle = GRID + "0.3)";
      ctx.stroke();
    }
  }

  function drawField(spin) {
    for (var i = 0; i < FIELD.length; i++) {
      var p = project(FIELD[i], spin);
      if (p.z < 0.02) continue;
      // Fade toward the limb so the sphere has volume rather than reading flat.
      ctx.fillStyle = DOT + (0.16 + p.z * 0.5).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.1 + p.z * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRoutes(spin, t) {
    ctx.lineWidth = 1.1;
    ROUTES.forEach(function (route, index) {
      var a = HUB_VECTORS[route[0]];
      var b = HUB_VECTORS[route[1]];
      // Each route runs on its own phase so they do not pulse in lockstep.
      var phase = (t * 0.00016 + index / ROUTES.length) % 1;
      var head = reduceMotion ? 1 : phase;

      ctx.beginPath();
      var drawing = false;
      for (var s = 0; s <= 1.0001; s += 0.02) {
        if (s > head) break;
        var p = project(slerp(a, b, s), spin);
        if (p.z < 0) {
          drawing = false;
          continue;
        }
        if (drawing) ctx.lineTo(p.x, p.y);
        else {
          ctx.moveTo(p.x, p.y);
          drawing = true;
        }
      }
      ctx.strokeStyle = GOLD_SOFT + (reduceMotion ? 0.3 : 0.16 + Math.sin(phase * Math.PI) * 0.42).toFixed(3) + ")";
      ctx.stroke();
    });
  }

  function drawHubs(spin, t) {
    HUB_VECTORS.forEach(function (v, index) {
      var p = project(v, spin);
      if (p.z < 0) return;

      var pulse = reduceMotion ? 0.5 : (Math.sin(t * 0.0018 + index) + 1) / 2;
      var alpha = 0.35 + p.z * 0.65;

      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2 + pulse * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = GOLD_SOFT + alpha.toFixed(3) + ")";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = GOLD_SOFT + (alpha * 0.22 * (1 - pulse)).toFixed(3) + ")";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }

  /* Drawn first, behind everything: a body for the sphere, lit from the upper
     left, so the graticule sits on something rather than floating in the page. */
  function drawBody() {
    var body = ctx.createRadialGradient(
      centre - radius * 0.35,
      centre - radius * 0.4,
      radius * 0.1,
      centre,
      centre,
      radius,
    );
    body.addColorStop(0, "rgba(30, 58, 120, 0.55)");
    body.addColorStop(0.55, "rgba(22, 49, 102, 0.34)");
    body.addColorStop(1, "rgba(10, 19, 37, 0.5)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(centre, centre, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLimb() {
    var gradient = ctx.createRadialGradient(centre, centre, radius * 0.72, centre, centre, radius * 1.03);
    gradient.addColorStop(0, "rgba(212, 175, 55, 0)");
    gradient.addColorStop(1, "rgba(212, 175, 55, 0.2)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centre, centre, radius * 1.03, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(centre, centre, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(212, 175, 55, 0.34)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  var start = null;

  function frame(now) {
    if (start === null) start = now;
    var t = now - start;
    var spin = reduceMotion ? 0.6 : (t * 0.00006) % (Math.PI * 2);

    ctx.clearRect(0, 0, size, size);
    drawBody();
    drawLimb();
    drawField(spin);
    drawGraticule(spin);
    drawRoutes(spin, t);
    drawHubs(spin, t);

    if (!reduceMotion && running) raf = window.requestAnimationFrame(frame);
  }

  var raf = null;
  var running = false;

  function play() {
    if (running) return;
    running = true;
    raf = window.requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (raf) window.cancelAnimationFrame(raf);
    raf = null;
  }

  resize();

  if (reduceMotion) {
    // One static frame: the network still reads, nothing moves.
    window.requestAnimationFrame(frame);
  } else if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      function (entries) {
        entries[0].isIntersecting ? play() : pause();
      },
      { threshold: 0.15 }
    ).observe(stage);
  } else {
    play();
  }

  document.addEventListener("visibilitychange", function () {
    if (reduceMotion) return;
    document.hidden ? pause() : play();
  });

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      resize();
      if (reduceMotion || !running) window.requestAnimationFrame(frame);
    }, 150);
  });

  // Screen readers get the same information as a list, not a canvas they cannot see.
  var summary = document.querySelector("[data-globe-list]");
  if (summary) {
    summary.textContent =
      "Reviewer network hubs: " +
      HUBS.map(function (h) {
        return h.name;
      }).join(", ") +
      ".";
  }
})();
