// Car roster + procedural, customizable anime-style car models.
// Every car is built from side-profile polygons (extruded with bevels), then dressed with
// lights, grilles, glass, trims, wheels and livery. All names are fictional homages.
(function () {
  'use strict';
  const AR = window.AR;

  // Profiles are authored in car space: z (front is negative), y (ground = 0), metres.
  // `top` runs from the front-bottom corner, over the car, to the rear-bottom corner;
  // the sill and wheel arches are added automatically.
  AR.CARS = [
    {
      id: 'rv4', name: 'Kitsune RV-4', jp: 'キツネ', year: 2026, cls: 'Compact SUV',
      inspired: '2026 Toyota RAV4',
      desc: 'Boxy hybrid crossover with hammerhead LEDs and chunky cladding. Planted AWD all-rounder.',
      L: 4.6, W: 1.86, wb: 2.69, track: 1.6, wheelR: 0.37, tireW: 0.25, archR: 0.47, sill: 0.4,
      top: [[-2.24, 0.36], [-2.31, 0.55], [-2.3, 0.88], [-2.24, 0.98], [-2.05, 1.03], [-0.95, 1.1], [1.95, 1.12], [2.24, 1.1], [2.3, 0.95], [2.3, 0.55], [2.22, 0.36]],
      cabin: { bf: -0.98, rf: -0.22, rr: 1.92, br: 2.2, belt: 1.1, roof: 1.68, inset: 0.05, taper: 0.12, windows: [[-0.82, 0.3], [0.4, 1.3], [1.4, 1.95]] },
      round: 0.06, cladding: 0.6, flares: true, rails: true, seams: [-0.86, 0.35, 1.35],
      head: 'hammer', headY: 0.88, tail: 'cshape', tailY: 0.98, grille: 'hex',
      paint: 0x5b7f6a, accent: 0x1e1f24,
      phys: { mass: 1680, torque: 300, redline: 6200, idle: 850, gears: [3.6, 2.1, 1.45, 1.1, 0.86, 0.7], final: 4.1, drive: 'AWD', split: 0.45, cgH: 0.62, k: 42000, restLen: 0.24, steer: 34, brake: 13000 },
      sound: { cyl: 4, base: 1.0, turbo: false },
    },
    {
      id: 'sienna03', name: 'Tanuki Family Van', jp: 'タヌキ', year: 2003, cls: 'Minivan',
      inspired: '2003 Toyota Sienna',
      desc: 'Old-school V6 people mover. Soft springs, big body roll, sliding doors, zero shame.',
      L: 5.0, W: 1.96, wb: 3.03, track: 1.66, wheelR: 0.34, tireW: 0.22, archR: 0.42, sill: 0.36,
      top: [[-2.42, 0.32], [-2.5, 0.5], [-2.48, 0.72], [-2.38, 0.85], [-1.85, 0.98], [-1.25, 1.05], [2.3, 1.08], [2.48, 1.0], [2.52, 0.7], [2.45, 0.34]],
      cabin: { bf: -1.3, rf: -0.32, rr: 2.25, br: 2.45, belt: 1.06, roof: 1.75, inset: 0.07, taper: 0.1, windows: [[-1.12, -0.12], [0.02, 1.25], [1.42, 2.28]] },
      round: 0.09, cladding: 0, flares: false, rails: true, slidingDoor: true, seams: [-1.15, 0.0, 1.35],
      head: 'square', headY: 0.8, tail: 'vertical', tailY: 0.85, grille: 'chrome',
      paint: 0xc9cbd1, accent: 0x6b7078,
      phys: { mass: 1820, torque: 310, redline: 6200, idle: 750, gears: [2.9, 1.9, 1.3, 0.98, 0.75], final: 3.9, drive: 'FWD', split: 1, cgH: 0.72, k: 33000, restLen: 0.26, steer: 32, brake: 12000, softness: 1.25 },
      sound: { cyl: 6, base: 0.85, turbo: false },
    },
    {
      id: 'raijin', name: 'Raijin GT-Four', jp: 'ライジン', year: 1992, cls: 'Rally Coupe',
      inspired: '1990s Japanese AWD turbo rally coupes',
      desc: 'The hero car. Turbo AWD, big wing, loves to slide on hardpack.',
      L: 4.42, W: 1.75, wb: 2.525, track: 1.5, wheelR: 0.32, tireW: 0.23, archR: 0.4, sill: 0.33,
      top: [[-2.14, 0.3], [-2.21, 0.45], [-2.2, 0.62], [-2.05, 0.7], [-0.86, 0.86], [1.75, 0.92], [2.15, 0.92], [2.21, 0.8], [2.2, 0.45], [2.12, 0.3]],
      cabin: { bf: -0.9, rf: 0.08, rr: 1.0, br: 1.85, belt: 0.88, roof: 1.3, inset: 0.08, taper: 0.18, windows: [[-0.72, 0.92], [1.02, 1.62]] },
      round: 0.07, cladding: 0, flares: false, rails: false, seams: [-0.74, 0.96], hoodVents: true,
      head: 'pop', headY: 0.6, tail: 'bar', tailY: 0.8, grille: 'slot',
      paint: 0xd8262f, accent: 0xf5f1e8,
      defaults: { spoiler: 'wing', livery: 'rally', rims: 'rally', lights: 'hood', mudflaps: true },
      phys: { mass: 1350, torque: 380, redline: 7000, idle: 900, gears: [3.25, 1.95, 1.35, 1.03, 0.82], final: 4.2, drive: 'AWD', split: 0.4, cgH: 0.48, k: 50000, restLen: 0.22, steer: 36, brake: 12500 },
      sound: { cyl: 4, base: 1.15, turbo: true },
    },
    {
      id: 'hikari', name: 'Hikari Hatch Type-S', jp: 'ヒカリ', year: 2025, cls: 'Hot Hatch',
      inspired: '2025 Honda Civic hatchback',
      desc: 'Sharp, eager front-driver with a honeycomb grille. Lift-off oversteer is your friend.',
      L: 4.4, W: 1.8, wb: 2.7, track: 1.56, wheelR: 0.34, tireW: 0.24, archR: 0.42, sill: 0.32,
      top: [[-2.13, 0.3], [-2.2, 0.48], [-2.18, 0.66], [-2.0, 0.78], [-0.95, 0.95], [1.8, 1.0], [2.1, 0.98], [2.2, 0.75], [2.18, 0.45], [2.1, 0.3]],
      cabin: { bf: -0.98, rf: -0.05, rr: 1.2, br: 2.05, belt: 0.97, roof: 1.42, inset: 0.07, taper: 0.16, windows: [[-0.8, 0.32], [0.42, 1.25], [1.32, 1.72]] },
      round: 0.08, cladding: 0, flares: false, rails: false, seams: [-0.83, 0.37, 1.3], hoodVents: true,
      head: 'slim', headY: 0.68, tail: 'cshape', tailY: 0.86, grille: 'mesh',
      paint: 0x2f6fd6, accent: 0x15161a,
      defaults: { spoiler: 'lip', rims: 'five' },
      phys: { mass: 1380, torque: 300, redline: 6800, idle: 850, gears: [3.6, 2.1, 1.5, 1.15, 0.92, 0.75], final: 4.35, drive: 'FWD', split: 1, cgH: 0.5, k: 46000, restLen: 0.21, steer: 36, brake: 12000 },
      sound: { cyl: 4, base: 1.1, turbo: true },
    },
    {
      id: 'sakura', name: 'Sakura Sedan', jp: 'サクラ', year: 2025, cls: 'Midsize Sedan',
      inspired: '2025 Toyota Camry',
      desc: 'The commuter king. Comfortable, predictable, secretly great at drifting with the handbrake.',
      L: 4.92, W: 1.84, wb: 2.825, track: 1.6, wheelR: 0.35, tireW: 0.23, archR: 0.43, sill: 0.32,
      top: [[-2.4, 0.3], [-2.46, 0.48], [-2.44, 0.66], [-2.28, 0.78], [-1.15, 0.95], [1.75, 1.0], [2.35, 0.99], [2.46, 0.85], [2.45, 0.5], [2.38, 0.3]],
      cabin: { bf: -1.18, rf: -0.15, rr: 0.95, br: 1.8, belt: 0.97, roof: 1.45, inset: 0.07, taper: 0.17, windows: [[-1.0, 0.27], [0.37, 1.22], [1.3, 1.55]] },
      round: 0.08, cladding: 0, flares: false, rails: false, seams: [-1.03, 0.32, 1.27],
      head: 'hammer', headY: 0.72, tail: 'bar', tailY: 0.9, grille: 'wide',
      paint: 0xf0eee8, accent: 0x1a1b20,
      phys: { mass: 1590, torque: 320, redline: 6400, idle: 750, gears: [3.5, 2.0, 1.4, 1.05, 0.83, 0.68], final: 3.9, drive: 'FWD', split: 1, cgH: 0.52, k: 40000, restLen: 0.22, steer: 34, brake: 12500 },
      sound: { cyl: 4, base: 0.95, turbo: false },
    },
    {
      id: 'kuma', name: 'Kuma Trail', jp: 'クマ', year: 2024, cls: 'Midsize Pickup',
      inspired: '2024 Toyota Tacoma',
      desc: 'Lifted 4x4 on all-terrains. Huge travel, soaks up jumps, leans like a bear.',
      L: 5.4, W: 1.95, wb: 3.23, track: 1.66, wheelR: 0.41, tireW: 0.3, archR: 0.52, sill: 0.55,
      top: [[-2.55, 0.48], [-2.62, 0.7], [-2.6, 1.05], [-2.5, 1.18], [-1.1, 1.26], [0.85, 1.28], [2.75, 1.28], [2.8, 1.2], [2.8, 0.62], [2.7, 0.5]],
      cabin: { bf: -1.12, rf: -0.42, rr: 0.72, br: 0.85, belt: 1.27, roof: 1.86, inset: 0.06, taper: 0.1, windows: [[-0.95, -0.05], [0.05, 0.7]] },
      round: 0.05, cladding: 0.75, flares: true, rails: false, bed: [0.93, 2.72], seams: [-0.97, 0.0, 0.76],
      head: 'square', headY: 1.02, tail: 'vertical', tailY: 0.95, grille: 'wide',
      paint: 0xd77a2b, accent: 0x202226,
      defaults: { rims: 'steel', mudflaps: true, lights: 'roof', tires: 'gravel' },
      phys: { mass: 2050, torque: 420, redline: 5600, idle: 700, gears: [3.8, 2.3, 1.5, 1.1, 0.85, 0.68], final: 3.9, drive: 'AWD', split: 0.3, cgH: 0.8, k: 46000, restLen: 0.32, steer: 32, brake: 15000, softness: 1.1 },
      sound: { cyl: 6, base: 0.8, turbo: true },
    },
    {
      id: 'denki', name: 'Denki Y', jp: 'デンキ', year: 2026, cls: 'Electric Crossover',
      inspired: '2026 Tesla Model Y',
      desc: 'Silent dual-motor EV. Instant torque, one gear, flush handles, full-width light bar.',
      L: 4.75, W: 1.92, wb: 2.89, track: 1.64, wheelR: 0.37, tireW: 0.25, archR: 0.45, sill: 0.34,
      top: [[-2.3, 0.32], [-2.37, 0.48], [-2.35, 0.68], [-2.15, 0.82], [-1.0, 0.98], [1.95, 1.06], [2.3, 1.02], [2.38, 0.85], [2.36, 0.5], [2.28, 0.32]],
      cabin: { bf: -1.05, rf: -0.1, rr: 1.25, br: 2.25, belt: 1.0, roof: 1.62, inset: 0.07, taper: 0.18, windows: [[-0.86, 0.42], [0.52, 1.35], [1.43, 1.85]] },
      round: 0.1, cladding: 0, flares: false, rails: false, seams: [-0.89, 0.47, 1.38], ev: true, glassRoof: true,
      head: 'slim', headY: 0.74, tail: 'bar', tailY: 0.95, grille: 'none',
      paint: 0x2a2d34, accent: 0x111214,
      defaults: { rims: 'fan' },
      phys: { mass: 2000, torque: 510, redline: 16000, idle: 0, gears: [1.0], final: 9.0, drive: 'AWD', split: 0.35, cgH: 0.5, k: 47000, restLen: 0.22, steer: 34, brake: 15000, ev: true },
      sound: { cyl: 0, base: 1.0, ev: true },
    },
    {
      id: 'mochi', name: 'Mochi Kei Box', jp: 'モチ', year: 2023, cls: 'Kei Car',
      inspired: 'Japanese kei boxes (Honda N-BOX / Daihatsu Tanto)',
      desc: 'Tiny 660cc turbo toaster. Tall, light, hilarious through banked corners.',
      L: 3.395, W: 1.475, wb: 2.52, track: 1.3, wheelR: 0.29, tireW: 0.17, archR: 0.36, sill: 0.28,
      top: [[-1.64, 0.28], [-1.7, 0.45], [-1.7, 0.72], [-1.62, 0.84], [-1.3, 0.92], [1.62, 0.95], [1.7, 0.88], [1.7, 0.45], [1.64, 0.28]],
      cabin: { bf: -1.32, rf: -0.95, rr: 1.62, br: 1.68, belt: 0.92, roof: 1.79, inset: 0.04, taper: 0.06, windows: [[-1.15, -0.15], [0.0, 1.05], [1.15, 1.56]] },
      round: 0.1, cladding: 0, flares: false, rails: false, slidingDoor: true, seams: [-1.18, -0.05, 1.1],
      head: 'round', headY: 0.7, tail: 'vertical', tailY: 0.62, grille: 'chrome',
      paint: 0xf4c9d6, accent: 0xffffff,
      defaults: { roof: 'accent', rims: 'steel', livery: 'sakura' },
      phys: { mass: 900, torque: 104, redline: 7500, idle: 900, gears: [4.0, 2.3, 1.5, 1.05, 0.8], final: 4.6, drive: 'FWD', split: 1, cgH: 0.7, k: 26000, restLen: 0.2, steer: 36, brake: 8000 },
      sound: { cyl: 3, base: 1.3, turbo: true },
    },
  ];

  AR.PAINTS = [
    { n: 'Hayate Red', c: 0xd8262f }, { n: 'Kitsune Sage', c: 0x5b7f6a }, { n: 'Glacier White', c: 0xf0eee8 },
    { n: 'Midnight', c: 0x2a2d34 }, { n: 'Silver Sky', c: 0xc9cbd1 }, { n: 'Sora Blue', c: 0x2f6fd6 },
    { n: 'Tangerine', c: 0xd77a2b }, { n: 'Sakura Pink', c: 0xf4c9d6 }, { n: 'Neon Lime', c: 0xb6e33a },
    { n: 'Sunflower', c: 0xf2c230 }, { n: 'Ultraviolet', c: 0x6b45c9 }, { n: 'Teal Dream', c: 0x1fa7a0 },
    { n: 'Rally Navy', c: 0x1b2a55 }, { n: 'Desert Tan', c: 0xc8ad86 }, { n: 'Mint Soda', c: 0x9fe3c9 },
    { n: 'Magenta Rush', c: 0xd8327c },
  ];
  AR.ACCENTS = [0x15161a, 0xffffff, 0xd8262f, 0xf2c230, 0x2f6fd6, 0x1fa7a0, 0xf4c9d6, 0x8a8f99];
  AR.RIM_COLORS = [0xc8ccd4, 0x1a1b1f, 0xf5f1e8, 0xd4a53a, 0xb5162b, 0x2f6fd6, 0x7cf0d0];
  AR.OPTIONS = {
    livery: ['none', 'stripes', 'rally', 'sakura', 'flames', 'itasha'],
    rims: ['five', 'mesh', 'steel', 'dish', 'fan', 'rally'],
    spoiler: ['none', 'lip', 'duck', 'wing'],
    lights: ['none', 'hood', 'roof'],
    height: ['lowered', 'stock', 'lifted'],
    roof: ['body', 'accent'],
    tint: ['light', 'medium', 'dark'],
    tires: ['street', 'gravel', 'snow'],
    tune: ['stock', 'stage 1', 'stage 2'],
    susp: ['soft', 'medium', 'stiff'],
    drive: ['factory', 'FWD', 'RWD', 'AWD'],
  };

  AR.defaultConfig = function (def) {
    const d = def.defaults || {};
    return Object.assign(
      {
        paint: def.paint, accent: def.accent, livery: 'none', number: 7, plate: 'HAYATE',
        rims: 'five', rimColor: AR.RIM_COLORS[0], spoiler: 'none', lights: 'none', mudflaps: false,
        height: 'stock', roof: 'body', tint: 'medium', tires: 'gravel', tune: 'stock', susp: 'medium', drive: 'factory',
      },
      d
    );
  };

  // Real-car finishing touches per model: window trim finish, fog lamps, tow hooks.
  const CAR_ACCENTS = {
    rv4: { trim: 'black', fog: true }, sienna03: { trim: 'chrome', fog: true }, raijin: { trim: 'black', tow: true },
    hikari: { trim: 'black' }, sakura: { trim: 'chrome', fog: true }, kuma: { trim: 'black', fog: true, tow: true },
    denki: { trim: 'black' }, mochi: { trim: 'chrome' },
  };
  const BEVEL = 0.06; // body edge rounding
  const CAB_BEVEL = 0.05; // greenhouse edge rounding

  // ---------- small geometry helpers ----------
  function extrudeProfile(pts, width, bevel, curveSeg) {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(-p[0], p[1])));
    const depth = Math.max(0.01, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: curveSeg || 4, steps: 1,
    });
    g.rotateY(Math.PI / 2);
    g.translate(-depth / 2, 0, 0);
    return g;
  }
  // Shape lying in the XY plane (faces +Z), extruded `d` deep, centred on z.
  function extrudeShape2D(pts, d, bevel) {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: d, bevelEnabled: !!bevel, bevelThickness: bevel || 0, bevelSize: bevel || 0, bevelSegments: 2, curveSegments: 10,
    });
    g.translate(0, 0, -d / 2);
    return g;
  }
  function roundRect(w, h, r, seg) {
    r = Math.min(r, w / 2, h / 2);
    const pts = [];
    const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
    seg = seg || 4;
    corners.forEach((c) => {
      for (let i = 0; i <= seg; i++) {
        const a = c[2] + (i / seg) * (Math.PI / 2);
        pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
      }
    });
    return pts;
  }
  function circlePts(r, n) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);
    return pts;
  }
  function box(w, h, d) {
    return new THREE.BoxGeometry(w, h, d);
  }
  function bboxUV(geo, axisU, axisV) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const get = (i, a) => (a === 'x' ? pos.getX(i) : a === 'y' ? pos.getY(i) : pos.getZ(i));
    const min = { x: bb.min.x, y: bb.min.y, z: bb.min.z }, max = { x: bb.max.x, y: bb.max.y, z: bb.max.z };
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (get(i, axisU) - min[axisU]) / (max[axisU] - min[axisU] || 1);
      uv[i * 2 + 1] = (get(i, axisV) - min[axisV]) / (max[axisV] - min[axisV] || 1);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }

  // Polygon intersections with horizontal line → extreme z on the front/back faces.
  function faceZAt(poly, y, front) {
    let best = front ? Infinity : -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      if ((p[1] - y) * (q[1] - y) <= 0 && p[1] !== q[1]) {
        const t = (y - p[1]) / (q[1] - p[1]);
        const z = p[0] + (q[0] - p[0]) * t;
        best = front ? Math.min(best, z) : Math.max(best, z);
      }
    }
    return best;
  }
  function topYAt(poly, z) {
    let best = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      if ((p[0] - z) * (q[0] - z) <= 0 && p[0] !== q[0]) {
        const t = (z - p[0]) / (q[0] - p[0]);
        best = Math.max(best, p[1] + (q[1] - p[1]) * t);
      }
    }
    return best;
  }

  // ---------- textures (anime glass, grilles, plates, liveries) ----------
  const texCache = {};
  function glassTex(tint) {
    const key = 'glass_' + tint;
    if (texCache[key]) return texCache[key];
    const c = AR.canvas(256, 256), g = c.getContext('2d');
    const base = { light: ['#5e86b8', '#2c3f63'], medium: ['#3d5a86', '#162238'], dark: ['#1d2638', '#07090f'] }[tint];
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, base[0]);
    grd.addColorStop(1, base[1]);
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    // anime glare streaks
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath(); g.moveTo(40, 256); g.lineTo(120, 256); g.lineTo(230, 0); g.lineTo(150, 0); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.moveTo(140, 256); g.lineTo(162, 256); g.lineTo(256, 40); g.lineTo(256, 0); g.lineTo(250, 0); g.fill();
    return (texCache[key] = AR.canvasTex(c));
  }
  function grilleTex(kind) {
    const key = 'grille_' + kind;
    if (texCache[key]) return texCache[key];
    const c = AR.canvas(256, 128), g = c.getContext('2d');
    g.fillStyle = '#14151a';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#3a3d46';
    g.lineWidth = 3;
    if (kind === 'hex' || kind === 'mesh') {
      const s = kind === 'hex' ? 18 : 12;
      for (let y = 0; y < 140; y += s * 0.86) {
        for (let x = ((y / (s * 0.86)) % 2) * s * 0.75; x < 270; x += s * 1.5) {
          g.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            g.lineTo(x + Math.cos(a) * s * 0.5, y + Math.sin(a) * s * 0.5);
          }
          g.closePath();
          g.stroke();
        }
      }
    } else {
      for (let y = 10; y < 128; y += 18) {
        g.fillStyle = kind === 'chrome' ? '#c9ced8' : '#3a3d46';
        g.fillRect(0, y, 256, kind === 'chrome' ? 7 : 5);
      }
    }
    return (texCache[key] = AR.canvasTex(c));
  }
  function plateTex(text) {
    const c = AR.canvas(256, 64), g = c.getContext('2d');
    g.fillStyle = '#f4f2ea';
    g.fillRect(0, 0, 256, 64);
    g.strokeStyle = '#1b1530';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 250, 58);
    g.fillStyle = '#1b1530';
    g.font = 'bold 40px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(text || '').toUpperCase().slice(0, 8), 128, 35);
    return AR.canvasTex(c);
  }
  function numberTex(num, color, accent) {
    const c = AR.canvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#1b1530';
    g.stroke();
    g.fillStyle = '#1b1530';
    g.font = 'bold 76px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), 64, 70);
    return AR.canvasTex(c);
  }
  // 疾風 (hayate = gale) badge, applied as a per-side decal so it never reads mirrored
  function kanjiTex() {
    const c = AR.canvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#1b1530';
    g.font = 'bold 110px "Yu Gothic", "Meiryo", "MS Gothic", "Noto Sans JP", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('疾風', 128, 132);
    return AR.canvasTex(c);
  }
  function hex(c) {
    return '#' + new THREE.Color(c).getHexString();
  }
  // Side livery (the extrusion caps). Canvas left = rear, right = front.
  function liveryTex(kind, paint, accent, number) {
    const c = AR.canvas(1024, 256), g = c.getContext('2d');
    g.fillStyle = hex(paint);
    g.fillRect(0, 0, 1024, 256);
    const A = hex(accent);
    const r = AR.rng(7 + number);
    if (kind === 'stripes') {
      g.fillStyle = A;
      g.fillRect(0, 170, 1024, 16);
      g.fillRect(0, 194, 1024, 6);
    } else if (kind === 'rally') {
      g.fillStyle = A;
      g.beginPath(); g.moveTo(180, 256); g.lineTo(330, 256); g.lineTo(560, 0); g.lineTo(410, 0); g.fill();
      g.fillStyle = '#1b1530';
      g.beginPath(); g.moveTo(345, 256); g.lineTo(380, 256); g.lineTo(610, 0); g.lineTo(575, 0); g.fill();
      g.fillStyle = '#f2c230';
      g.fillRect(0, 205, 1024, 10);
    } else if (kind === 'sakura') {
      for (let i = 0; i < 70; i++) {
        const x = r() * 700, y = 40 + r() * 200, s = 6 + r() * 16, a = r() * Math.PI;
        g.save(); g.translate(x, y); g.rotate(a);
        g.fillStyle = r() > 0.4 ? '#ff9fc4' : '#ffffff';
        for (let k = 0; k < 5; k++) {
          g.rotate((Math.PI * 2) / 5);
          g.beginPath(); g.ellipse(0, s * 0.6, s * 0.35, s * 0.6, 0, 0, Math.PI * 2); g.fill();
        }
        g.restore();
      }
      g.strokeStyle = '#6b3a4a';
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(0, 230); g.bezierCurveTo(200, 160, 300, 240, 560, 120); g.stroke();
    } else if (kind === 'flames') {
      const cols = ['#ffd23a', '#ff8a1f', '#e8262f'];
      cols.forEach((col, k) => {
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(1024, 40 + k * 10);
        for (let i = 0; i < 6; i++) {
          const y = 50 + i * 30;
          g.quadraticCurveTo(700 - k * 60 - r() * 120, y + 5, 520 - k * 50 - r() * 160, y + 15);
          g.quadraticCurveTo(700 - k * 60, y + 22, 1024, y + 26);
        }
        g.lineTo(1024, 256);
        g.fill();
      });
    } else if (kind === 'itasha') {
      // manga burst + kanji 疾風 (hayate = gale)
      g.save(); g.translate(560, 128);
      for (let i = 0; i < 48; i++) {
        g.rotate((Math.PI * 2) / 48);
        g.fillStyle = i % 2 ? A : '#ffffff';
        g.beginPath(); g.moveTo(0, 0); g.lineTo(600, -30); g.lineTo(600, 30); g.fill();
      }
      g.restore();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(560, 128, 100, 0, Math.PI * 2); g.fill();
      g.lineWidth = 10; g.strokeStyle = '#1b1530'; g.stroke();
      for (let i = 0; i < 30; i++) {
        g.fillStyle = '#ffffff';
        const x = r() * 1024, y = r() * 256;
        g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 3, y); g.lineTo(x, y + 8); g.lineTo(x - 3, y); g.fill();
      }
    }
    return AR.canvasTex(c);
  }
  // Top-surface livery (extrusion side walls): u runs along the contour, v across width.
  function topLiveryTex(kind, paint, accent) {
    const c = AR.canvas(16, 256), g = c.getContext('2d');
    g.fillStyle = hex(paint);
    g.fillRect(0, 0, 16, 256);
    if (kind === 'stripes' || kind === 'rally') {
      g.fillStyle = hex(accent);
      g.fillRect(0, 86, 16, 30);
      g.fillRect(0, 140, 16, 30);
    }
    return AR.canvasTex(c);
  }

  // ---------- the model builder ----------
  /**
   * Returns { root, wheels:[{pivot, spin, x, z}], brakeMats, meta }.
   * root is in car-model space (ground y=0); physics offsets it by the CG height.
   */
  AR.buildCarModel = function (def, cfg, opts) {
    opts = opts || {};
    const ghost = !!opts.ghost;
    const root = new THREE.Group();
    const halfW = def.W / 2;
    const ink = ghost ? 0 : 0.022;
    const ghostMat = ghost ? new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.28, depthWrite: false }) : null;
    const M = (color, o) => (ghost ? ghostMat : AR.toonMat(color, Object.assign({ hatch: true }, o || {})));
    const add = (geo, mat, thick, parent) => {
      const m = AR.inked(geo, mat, ghost ? 0 : thick == null ? ink : thick, parent || root);
      if (ghost) m.castShadow = false;
      return m;
    };

    // body extents & plan-view rounding
    const zs = def.top.map((p) => p[0]);
    const zMin = Math.min.apply(null, zs), zMax = Math.max.apply(null, zs);
    const zMid = (zMin + zMax) / 2, halfL = (zMax - zMin) / 2;
    const planScale = (z) => {
      const t = AR.clamp(Math.abs(z - zMid) / halfL, 0, 1);
      const s = AR.smoothstep(0.72, 1.0, t);
      return 1 - def.round * s * s * 1.6;
    };

    const paint = cfg.paint, accent = cfg.accent;
    const axF = -def.wb / 2, axR = def.wb / 2;

    // --- lower body polygon with wheel arches ---
    const top = def.top.map((p) => [p[0], p[1]]);
    const rear = top[top.length - 1], front = top[0];
    const bottom = [];
    const arch = (zc) => {
      const pts = [];
      const r = def.archR, yc = def.wheelR;
      // from rear side of arch (z = zc + r) over the top to front side
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI;
        pts.push([zc + Math.cos(a) * r, yc + Math.sin(a) * r * 1.02]);
      }
      return pts;
    };
    bottom.push([axR + def.archR + 0.02, def.sill]);
    arch(axR).forEach((p) => bottom.push(p));
    bottom.push([axR - def.archR - 0.02, def.sill]);
    bottom.push([axF + def.archR + 0.02, def.sill]);
    arch(axF).forEach((p) => bottom.push(p));
    bottom.push([axF - def.archR - 0.02, def.sill]);
    let bodyPoly = top.concat([[rear[0], def.sill]], bottom, [[front[0], def.sill]]);
    // clean: ensure arch ends sit at sill height or below
    bodyPoly = bodyPoly.map((p) => [p[0], Math.max(p[1], def.wheelR * 0.6)]);
    const bodySmooth = AR.chaikin(bodyPoly, 2, 0.18);

    // livery materials (caps = car sides)
    const capMat = M(paint, { rim: 0.55, spec: 0.5, map: ghost ? null : liveryTex(cfg.livery, paint, accent, cfg.number) });
    if (!ghost) {
      capMat.color.set(0xffffff);
      const lt = capMat.map;
      lt.wrapS = lt.wrapT = THREE.ClampToEdgeWrapping;
      const xmin = -zMax, xmax = -zMin; // shape x = -z
      lt.repeat.set(1 / (xmax - xmin), 1 / 1.4);
      lt.offset.set(-xmin / (xmax - xmin), -0.2 / 1.4);
    }
    const wallMat = M(paint, { rim: 0.55, spec: 0.5, map: ghost ? null : topLiveryTex(cfg.livery, paint, accent) });
    if (!ghost) {
      wallMat.color.set(0xffffff);
      const wt = wallMat.map;
      wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
      // generateSideWallUV uses v = 1 - z(extrude). depth ≈ W, so map 1/W across the width
      wt.repeat.set(1, 1 / def.W);
      wt.offset.set(0, 0);
    }
    const bodyGeo = extrudeProfile(bodySmooth, def.W, BEVEL, 4);
    {
      const pos = bodyGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * planScale(pos.getZ(i)));
    }
    add(bodyGeo, ghost ? ghostMat : [capMat, wallMat], ink * 1.2).userData.deform = true;

    // --- lower cladding (crossovers / trucks) ---
    if (def.cladding > 0) {
      const clip = AR.clipPoly(bodySmooth, 0, 1, def.cladding);
      const g = extrudeProfile(clip, def.W + 0.03, 0.04, 3);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * planScale(pos.getZ(i)));
      add(g, M(0x2b2d33, { rim: 0.2 }), ink).userData.deform = true;
    }
    // --- arch flares ---
    if (def.flares) {
      [axF, axR].forEach((z) => {
        [-1, 1].forEach((s) => {
          const g = new THREE.TorusGeometry(def.archR + 0.02, 0.055, 6, 18, Math.PI);
          g.rotateY(Math.PI / 2);
          const m = add(g, M(0x2b2d33), ink * 0.8);
          m.position.set(s * (halfW * planScale(z) + 0.01), def.wheelR, z);
          m.scale.set(1.6, 1, 1);
        });
      });
    }

    // --- cabin / greenhouse ---
    const cb = def.cabin;
    const cabW = def.W - 2 * cb.inset;
    const cabTaper = (y) => 1 - cb.taper * AR.clamp((y - cb.belt) / (cb.roof - cb.belt), 0, 1);
    const cabHalf = (y, z) => (cabW / 2) * cabTaper(y) * planScale(z);
    const cabPolyRaw = [[cb.bf, cb.belt - 0.06, 1], [cb.rf, cb.roof], [cb.rr, cb.roof], [cb.br, cb.belt - 0.06, 1]];
    const cabPoly = AR.chaikin(cabPolyRaw, 3, 0.16);
    const roofColor = cfg.roof === 'accent' ? accent : paint;
    const cabGeo = extrudeProfile(cabPoly, cabW, CAB_BEVEL, 4);
    {
      const pos = cabGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) * cabTaper(pos.getY(i)) * planScale(pos.getZ(i)));
      }
    }
    add(cabGeo, M(roofColor, { rim: 0.55, spec: 0.5 }), ink * 1.2).userData.deform = true;

    // --- glass ---
    const gMat = ghost ? ghostMat : AR.toonMat(0xffffff, { map: glassTex(cfg.tint), rim: 0.35, spec: 0.8, side: THREE.DoubleSide, hatch: false });
    const pillar = 0.075;
    const sideInner = AR.insetPoly(cabPolyRaw.map((p) => [p[0], p[1]]), pillar);
    def.cabin.windows.forEach((w) => {
      let poly = AR.clipPoly(sideInner, -1, 0, -w[0]); // z >= w0
      poly = AR.clipPoly(poly, 1, 0, w[1]); // z <= w1
      poly = AR.clipPoly(poly, 0, -1, -(cb.belt + 0.03)); // y >= belt
      if (poly.length < 3) return;
      poly = AR.chaikin(poly, 1, 0.12);
      [-1, 1].forEach((s) => {
        const shp = new THREE.Shape(poly.map((p) => new THREE.Vector2(-p[0], p[1])));
        const g = new THREE.ShapeGeometry(shp);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const z = -pos.getX(i), y = pos.getY(i);
          pos.setXYZ(i, s * (cabHalf(y, z) + 0.008), y, z);
        }
        g.computeVertexNormals();
        bboxUV(g, 'z', 'y');
        const m = new THREE.Mesh(g, gMat);
        m.userData.glass = true;
        root.add(m);
      });
    });
    function edgeGlass(A, B, t0, t1, out, mat) {
      const dz = B[0] - A[0], dy = B[1] - A[1];
      const l = Math.hypot(dz, dy);
      const nz = (-dy / l) * out, ny = (dz / l) * out;
      const P = (t) => [A[0] + dz * t, A[1] + dy * t];
      const p0 = P(t0), p1 = P(t1);
      const verts = [];
      [p0, p1].forEach((p) => {
        const hw = cabHalf(p[1], p[0]) - pillar;
        verts.push([-hw, p[1] + ny, p[0] + nz], [hw, p[1] + ny, p[0] + nz]);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([].concat(verts[0], verts[1], verts[2], verts[3]), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
      g.setIndex([0, 1, 2, 1, 3, 2]);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat || gMat);
      if (!mat) m.userData.glass = true;
      root.add(m);
      return m;
    }
    edgeGlass([cb.bf, cb.belt], [cb.rf, cb.roof], 0.1, 0.86, CAB_BEVEL + 0.012);
    edgeGlass([cb.rr, cb.roof], [cb.br, cb.belt], 0.14, 0.88, CAB_BEVEL + 0.012);
    if (def.glassRoof) {
      const g = box(cabW * (1 - cb.taper) - 0.25, 0.01, (cb.rr - cb.rf) * 0.8);
      const m = new THREE.Mesh(g, gMat);
      m.position.set(0, cb.roof + 0.045, (cb.rr + cb.rf) / 2);
      root.add(m);
    }

    // --- front & rear faces: lights, grille, plates ---
    const frontZ = (y) => faceZAt(bodySmooth, y, true);
    const rearZ = (y) => faceZAt(bodySmooth, y, false);
    const frontHalf = halfW * planScale(zMin + 0.02) - 0.06;
    const rearHalf = halfW * planScale(zMax - 0.02) - 0.06;
    const headMat = ghost ? ghostMat : AR.toonMat(0xfff6dd, { emissive: 0xfff1c8, rim: 0.2, hatch: false });
    if (!ghost) headMat.emissiveIntensity = 0.65;
    const housingMat = M(0x1d1e24);
    const chromeMat = M(0xdfe3ea, { spec: 1, rim: 0.6 });
    const amberMat = ghost ? ghostMat : AR.toonMat(0xffa31a, { emissive: 0xff8a00, hatch: false });
    if (!ghost) amberMat.emissiveIntensity = 0.45;
    const tailMat = ghost ? ghostMat : AR.toonMat(0xd0142b, { emissive: 0xff1030, hatch: false });
    if (!ghost) tailMat.emissiveIntensity = 0.25;
    const placeOnFace = (mesh, y, isFront, h) => {
      const fz = isFront ? frontZ : rearZ;
      const z0 = fz(y - h / 2), z1 = fz(y + h / 2);
      const z = isFront ? Math.min(z0, z1) : Math.max(z0, z1);
      const tilt = Math.atan2(z1 - z0, h);
      // the body bevel pushes the real surface ~6 cm past the profile polygon
      const out = BEVEL / Math.max(0.5, Math.cos(tilt)) + 0.012;
      mesh.position.set(mesh.position.x, y, z + (isFront ? -out : out));
      mesh.rotation.x = isFront ? -tilt : tilt;
      if (isFront) mesh.rotation.y = Math.PI;
    };
    function lightPair(style, y, isFront) {
      const mat = isFront ? headMat : tailMat;
      const hw = isFront ? frontHalf : rearHalf;
      const shapes = [];
      let w = 0.42, h = 0.12;
      if (style === 'hammer') { w = 0.36; h = 0.16; shapes.push({ p: [[-0.18, 0.02], [0.18, 0.05], [0.18, 0.08], [-0.18, 0.06]] }, { p: [[0.13, -0.08], [0.18, -0.08], [0.18, 0.05], [0.13, 0.05]] }); }
      else if (style === 'slim') { w = 0.5; h = 0.07; shapes.push({ p: roundRect(0.5, 0.06, 0.03) }); }
      else if (style === 'square') { w = 0.42; h = 0.22; shapes.push({ p: roundRect(0.4, 0.2, 0.07) }); }
      else if (style === 'round') { w = 0.26; h = 0.26; shapes.push({ p: circlePts(0.12, 20) }); }
      else if (style === 'pop') { w = 0.42; h = 0.1; shapes.push({ p: roundRect(0.4, 0.09, 0.015) }); }
      else if (style === 'bar') { w = 0.45; h = 0.08; shapes.push({ p: roundRect(0.44, 0.08, 0.02) }); }
      else if (style === 'vertical') { w = 0.14; h = 0.36; shapes.push({ p: roundRect(0.12, 0.34, 0.04) }); }
      else if (style === 'cshape') { w = 0.36; h = 0.16; shapes.push({ p: [[-0.18, 0.05], [0.16, 0.05], [0.16, -0.07], [0.11, -0.07], [0.11, 0.0], [-0.18, 0.0]] }); }
      [-1, 1].forEach((s) => {
        const grp = new THREE.Group();
        grp.position.x = s * (hw - w / 2);
        // housing
        const hg = extrudeShape2D(roundRect(w + 0.05, h + 0.05, 0.03), 0.03);
        add(hg, housingMat, ink * 0.6, grp);
        shapes.forEach((sh) => {
          const pts = sh.p.map((p) => [p[0] * (isFront ? -s : s), p[1]]);
          const g = extrudeShape2D(pts, 0.03);
          const m = add(g, mat, 0, grp);
          m.position.z = 0.012;
          m.userData.lamp = true;
          if (ghost) m.castShadow = false;
        });
        // projector lenses behind the headlight lens
        if (isFront && !ghost && style !== 'round') {
          [-0.08, 0.06].forEach((lx) => {
            const pl = add(new THREE.CylinderGeometry(0.032, 0.032, 0.02, 14).rotateX(Math.PI / 2), chromeMat, 0, grp);
            pl.position.set(lx * s, style === 'hammer' ? -0.03 : 0, 0.03);
          });
        }
        root.add(grp);
        placeOnFace(grp, y, isFront, h);
      });
      if (style === 'bar' && !isFront) {
        const g = extrudeShape2D(roundRect(rearHalf * 2 - 0.3, 0.035, 0.015), 0.025);
        const m = add(g, mat, 0);
        m.userData.lamp = true;
        m.position.x = 0;
        placeOnFace(m, y + 0.01, false, 0.04);
      }
      if (def.ev && isFront) {
        const g = extrudeShape2D(roundRect(frontHalf * 2 - 0.2, 0.02, 0.01), 0.02);
        const m = add(g, mat, 0);
        placeOnFace(m, y + 0.06, true, 0.02);
      }
    }
    lightPair(def.head, def.headY, true);
    lightPair(def.tail, def.tailY, false);

    // grille
    if (def.grille !== 'none') {
      const gw = { hex: 1.0, wide: 1.25, mesh: 1.0, chrome: 0.9, slot: 0.7 }[def.grille];
      const gh = { hex: 0.32, wide: 0.24, mesh: 0.3, chrome: 0.18, slot: 0.06 }[def.grille];
      const gy = { hex: 0.58, wide: 0.6, mesh: 0.5, chrome: def.headY, slot: def.headY - 0.03 }[def.grille] + (def.id === 'kuma' ? 0.32 : 0);
      const pts = def.grille === 'hex'
        ? [[-gw / 2, gh / 2], [gw / 2, gh / 2], [gw / 2 - 0.12, -gh / 2], [-gw / 2 + 0.12, -gh / 2]]
        : roundRect(gw, gh, 0.04);
      const g = extrudeShape2D(pts, 0.03);
      bboxUV(g, 'x', 'y');
      const gm = ghost ? ghostMat : AR.toonMat(0xffffff, { map: grilleTex(def.grille), hatch: false });
      const m = add(g, gm, ink * 0.6);
      placeOnFace(m, gy, true, gh);
      if (def.grille !== 'slot') {
        const framePts = def.grille === 'hex'
          ? [[-gw / 2 - 0.04, gh / 2 + 0.035], [gw / 2 + 0.04, gh / 2 + 0.035], [gw / 2 - 0.1, -gh / 2 - 0.035], [-gw / 2 + 0.1, -gh / 2 - 0.035]]
          : roundRect(gw + 0.07, gh + 0.07, 0.06);
        const fr = add(extrudeShape2D(framePts, 0.02), CAR_ACCENTS[def.id] && CAR_ACCENTS[def.id].trim === 'chrome' ? chromeMat : M(0x111216, { spec: 0.9 }), ink * 0.5);
        placeOnFace(fr, gy, true, gh);
        fr.position.z += 0.012;
      }
      // emblem
      const e = add(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 16).rotateX(Math.PI / 2), M(0xd9dde6, { spec: 1, rim: 0.4 }), 0.01);
      placeOnFace(e, def.grille === 'hex' ? def.headY : gy, true, 0.1);
      e.position.z -= 0.02;
    } else {
      // EV: smooth nose + low intake
      const g = extrudeShape2D(roundRect(0.9, 0.08, 0.04), 0.03);
      const m = add(g, M(0x15161a), ink * 0.6);
      placeOnFace(m, 0.42, true, 0.08);
    }
    // plates
    if (!ghost) {
      const pm = AR.toonMat(0xffffff, { map: plateTex(cfg.plate), hatch: false });
      [true, false].forEach((isFront) => {
        const g = extrudeShape2D(roundRect(0.52, 0.13, 0.015), 0.012);
        bboxUV(g, 'x', 'y');
        const m = add(g, pm, 0.01);
        m.userData.breakable = 9;
        if (isFront) m.rotation.y = Math.PI;
        placeOnFace(m, isFront ? 0.42 : 0.56, isFront, 0.13);
        if (isFront) m.position.z -= 0.025; else m.position.z += 0.02;
      });
    }
    // bumper strips (dark)
    [true, false].forEach((isFront) => {
      const g = extrudeShape2D(roundRect((isFront ? frontHalf : rearHalf) * 2 + 0.02, 0.07, 0.03), 0.04);
      const m = add(g, M(0x24262c), ink * 0.6);
      m.userData.breakable = 13;
      placeOnFace(m, isFront ? 0.33 : 0.36, isFront, 0.07);
    });
    // exhaust
    {
      const g = new THREE.CylinderGeometry(0.045, 0.05, 0.16, 12).rotateX(Math.PI / 2);
      const m = add(g, M(0xb9bec8, { spec: 1 }), 0.012);
      m.position.set(-halfW * 0.55, 0.27, zMax - 0.02);
      m.userData.breakable = 14;
      if (def.ev) m.visible = false;
    }

    // --- side details: mirrors, handles, seams, rails ---
    const sideX = (z) => halfW * planScale(z);
    [-1, 1].forEach((s) => {
      // mirror
      const mz = cb.bf + 0.32;
      const mg = new THREE.Group();
      mg.userData.breakable = 6;
      root.add(mg);
      const mir = add(box(0.2, 0.11, 0.08), M(roofColor === accent ? accent : paint, { rim: 0.5, spec: 0.5 }), ink * 0.6, mg);
      mir.position.set(s * (sideX(mz) + 0.12), cb.belt + 0.09, mz);
      const stalk = add(box(0.1, 0.03, 0.04), M(0x1d1e24), 0, mg);
      stalk.position.set(s * (sideX(mz) + 0.04), cb.belt + 0.06, mz);
      if (!ghost) {
        const sig = add(box(0.12, 0.018, 0.01), amberMat, 0, mg);
        sig.position.set(s * (sideX(mz) + 0.14), cb.belt + 0.07, mz - 0.042);
        sig.userData.lamp = true;
        const glassM = add(box(0.16, 0.08, 0.008), AR.toonMat(0x9fb8d8, { spec: 1, hatch: false }), 0, mg);
        glassM.position.set(s * (sideX(mz) + 0.12), cb.belt + 0.09, mz + 0.042);
      }
      // seams as ink lines
      def.seams.forEach((z) => {
        const ytop = Math.min(cb.belt, topYAt(bodyPoly, z)) - 0.02;
        const ybot = def.sill + 0.06;
        const sm = new THREE.Mesh(box(0.006, ytop - ybot, 0.012), new THREE.MeshBasicMaterial({ color: AR.styleUniforms.uInk.value }));
        sm.position.set(s * (sideX(z) + 0.002), (ytop + ybot) / 2, z);
        if (!ghost) root.add(sm);
      });
      // handles
      def.cabin.windows.slice(0, def.ev ? 2 : 2).forEach((w) => {
        const hz = w[1] - 0.22;
        const h = add(box(0.03, 0.035, 0.16), M(def.ev ? paint : 0x2a2b31, { spec: 0.6 }), 0.008);
        h.position.set(s * (sideX(hz) + 0.012), cb.belt - 0.12, hz);
      });
      if (def.slidingDoor && !ghost) {
        const tr = new THREE.Mesh(box(0.008, 0.012, def.cabin.windows[2][0] - def.cabin.windows[1][1] + 0.5), new THREE.MeshBasicMaterial({ color: AR.styleUniforms.uInk.value }));
        const z = (def.cabin.windows[1][1] + def.cabin.windows[2][0]) / 2 + 0.1;
        tr.position.set(s * (sideX(z) + 0.003), cb.belt + 0.04, z);
        root.add(tr);
      }
      if (def.rails) {
        const len = (cb.rr - cb.rf) * 0.95;
        const rg = new THREE.Group();
        rg.userData.breakable = 11;
        root.add(rg);
        const rail = add(box(0.05, 0.05, len), M(0x1d1e24, { spec: 0.6 }), 0.01, rg);
        const z = (cb.rr + cb.rf) / 2;
        rail.position.set(s * (cabHalf(cb.roof, z) - 0.12), cb.roof + 0.06, z);
        [cb.rf + 0.1, cb.rr - 0.1].forEach((lz) => {
          const leg = add(box(0.05, 0.07, 0.1), M(0x1d1e24), 0.008, rg);
          leg.position.set(s * (cabHalf(cb.roof, lz) - 0.12), cb.roof + 0.03, lz);
        });
      }
    });
    // wipers
    if (!ghost) {
      [-0.25, 0.25].forEach((x) => {
        const w = new THREE.Mesh(box(0.5, 0.012, 0.02), new THREE.MeshBasicMaterial({ color: 0x15161a }));
        w.position.set(x, cb.belt + BEVEL + 0.02, cb.bf - 0.02);
        w.rotation.z = x > 0 ? 0.12 : -0.12;
        root.add(w);
      });
    }
    // hood vents / scoop
    if (def.hoodVents) {
      [-0.3, 0.3].forEach((x) => {
        const z = (cb.bf + zMin) / 2;
        const v = add(box(0.26, 0.04, 0.3), M(0x15161a), 0.01);
        v.userData.breakable = 15;
        v.position.set(x, topYAt(bodyPoly, z) + BEVEL + 0.012, z);
        v.rotation.x = -0.08;
      });
    }
    // pickup bed: dark recessed floor sitting on the body top, framed by rails and a tailgate
    if (def.bed) {
      const bl = def.bed[1] - def.bed[0];
      const zc = (def.bed[0] + def.bed[1]) / 2;
      const topY = cb.belt + BEVEL;
      const floor = new THREE.Mesh(box(def.W - 0.24, 0.02, bl - 0.06), M(0x1e1f23));
      floor.position.set(0, topY + 0.012, zc);
      root.add(floor);
      [-1, 1].forEach((s) => {
        const r = add(box(0.12, 0.16, bl), M(paint, { rim: 0.5, spec: 0.4 }), ink * 0.6);
        r.position.set(s * (halfW - 0.06), topY + 0.08, zc);
      });
      const tg = add(box(def.W - 0.06, 0.16, 0.1), M(paint, { rim: 0.5 }), ink * 0.6);
      tg.position.set(0, topY + 0.08, def.bed[1]);
      const fw = add(box(def.W - 0.06, 0.16, 0.08), M(paint, { rim: 0.5 }), ink * 0.6);
      fw.position.set(0, topY + 0.08, def.bed[0]);
      const h = add(box(0.1, 0.1, 0.25), M(0x2a2b31), 0.01);
      h.position.set(0, 0.45, zMax + 0.12);
    }

    // --- real-car finishing: trims, pillars, creases, markers, badges, antenna, fog lamps ---
    if (!ghost) {
      const acc = CAR_ACCENTS[def.id] || {};
      const inkMat = new THREE.MeshBasicMaterial({ color: AR.styleUniforms.uInk.value });
      const trimMat = acc.trim === 'chrome' ? chromeMat : AR.toonMat(0x111216, { spec: 0.9, rim: 0.3, hatch: false });
      const line = (a, b, w, mat, parent) => {
        const A = new THREE.Vector3().fromArray(a), B = new THREE.Vector3().fromArray(b);
        const m = new THREE.Mesh(box(w, w, A.distanceTo(B)), mat || inkMat);
        m.position.copy(A).add(B).multiplyScalar(0.5);
        (parent || root).add(m);
        m.lookAt(B);
        return m;
      };
      const tilt = Math.atan(((cabW / 2) * cb.taper) / (cb.roof - cb.belt));
      const wins = cb.windows;
      const pc = new THREE.Color(paint);
      const lum = pc.r * 0.3 + pc.g * 0.59 + pc.b * 0.11;
      const creaseMat = new THREE.MeshBasicMaterial({ color: lum > 0.7 ? pc.clone().multiplyScalar(0.78) : pc.clone().lerp(new THREE.Color(0xffffff), 0.5) });
      [-1, 1].forEach((s) => {
        // beltline trim under each side window
        wins.forEach((w) => {
          const zc = (w[0] + w[1]) / 2;
          const t = add(box(0.022, 0.028, w[1] - w[0] + 0.06), trimMat, 0);
          t.position.set(s * (cabHalf(cb.belt + 0.03, zc) + 0.012), cb.belt + 0.035, zc);
          t.userData.trim = true;
        });
        // gloss-black pillar appliques between the windows
        if (acc.trim === 'black') {
          for (let i = 0; i < wins.length - 1; i++) {
            const z0 = wins[i][1], z1 = wins[i + 1][0];
            const ylo = cb.belt + 0.05, yhi = cb.roof - 0.13;
            const zc = (z0 + z1) / 2, yc = (ylo + yhi) / 2;
            const ap = add(box(0.012, (yhi - ylo) / Math.cos(tilt), z1 - z0 + 0.05), trimMat, 0);
            ap.position.set(s * (cabHalf(yc, zc) + 0.01), yc, zc);
            ap.rotation.z = s * tilt;
          }
        }
        // shoulder crease highlight that follows the plan-view curve
        const zA = zMin + 0.4, zB = zMax - 0.45, yC = Math.min(cb.belt - 0.1, (def.sill + cb.belt) / 2 + 0.2);
        for (let k = 0; k < 6; k++) {
          const za = zA + ((zB - zA) * k) / 6, zb = zA + ((zB - zA) * (k + 1)) / 6;
          line([s * (sideX(za) + 0.004), yC, za], [s * (sideX(zb) + 0.004), yC, zb], 0.012, creaseMat);
        }
        // rocker panel / side skirt
        if (!def.cladding) {
          const z0 = axF + def.archR + 0.04, z1 = axR - def.archR - 0.04;
          const sk = add(box(0.03, 0.08, z1 - z0), M(0x1c1d22, { spec: 0.4 }), ink * 0.5);
          sk.position.set(s * (halfW + 0.004), def.sill + 0.05, (z0 + z1) / 2);
          sk.userData.breakable = 16;
        }
        // side marker lamps
        const fzm = zMin + 0.3, rzm = zMax - 0.28;
        const fm = add(box(0.012, 0.035, 0.1), amberMat, 0);
        fm.position.set(s * (sideX(fzm) + 0.004), def.headY - 0.04, fzm);
        fm.userData.lamp = true;
        const rm = add(box(0.012, 0.035, 0.1), tailMat, 0);
        rm.position.set(s * (sideX(rzm) + 0.004), def.tailY - 0.02, rzm);
        rm.userData.lamp = true;
      });
      // fuel filler door (right rear quarter)
      {
        const fz = axR, fy = Math.max(cb.belt - 0.15, def.wheelR + def.archR + 0.12);
        const x = sideX(fz) + 0.004, hs = 0.08;
        line([x, fy - hs, fz - hs], [x, fy - hs, fz + hs], 0.008);
        line([x, fy + hs, fz - hs], [x, fy + hs, fz + hs], 0.008);
        line([x, fy - hs, fz - hs], [x, fy + hs, fz - hs], 0.008);
        line([x, fy - hs, fz + hs], [x, fy + hs, fz + hs], 0.008);
      }
      // hood shut lines
      if (!def.bed || true) {
        const z0 = cb.bf - 0.12, z1 = zMin + 0.25;
        [-1, 1].forEach((s) => {
          const x = s * halfW * 0.74;
          line([x, topYAt(bodyPoly, z0) + BEVEL + 0.004, z0], [x, topYAt(bodyPoly, z1) + BEVEL + 0.004, z1], 0.01);
        });
      }
      // third brake light at the top of the rear glass
      {
        const t3 = add(box(0.34, 0.035, 0.03), tailMat, 0);
        t3.position.set(0, cb.roof + CAB_BEVEL * 0.4, cb.rr + 0.03);
        t3.userData.lamp = true;
      }
      // shark-fin antenna
      if (cfg.lights !== 'roof' && !def.glassRoof) {
        const fz = cb.rr - 0.3;
        const fin = add(extrudeProfile([[fz - 0.1, 0], [fz + 0.1, 0], [fz + 0.06, 0.06], [fz + 0.0, 0.075]].map((p) => [p[0], p[1] + cb.roof + CAB_BEVEL - 0.01]), 0.06, 0.01, 2), M(def.ev ? paint : 0x15161a, { spec: 0.8 }), 0.01);
        fin.userData.breakable = 6;
      }
      // fog lamps and rear reflectors
      if (acc.fog) {
        [-1, 1].forEach((s) => {
          const fg = new THREE.Group();
          fg.position.x = s * (frontHalf - 0.16);
          const ring = add(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 18).rotateX(Math.PI / 2), M(0x15161a), 0.008, fg);
          const lens = add(new THREE.CylinderGeometry(0.048, 0.048, 0.02, 18).rotateX(Math.PI / 2), headMat, 0, fg);
          lens.position.z = 0.012;
          lens.userData.lamp = true;
          root.add(fg);
          placeOnFace(fg, 0.44, true, 0.1);
        });
      }
      [-1, 1].forEach((s) => {
        const rf = add(extrudeShape2D(roundRect(0.14, 0.04, 0.015), 0.015), AR.toonMat(0xb01020, { spec: 0.8, hatch: false }), 0);
        rf.position.x = s * (rearHalf - 0.12);
        placeOnFace(rf, 0.44, false, 0.04);
      });
      // rear emblem + model badge
      {
        const em = add(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 16).rotateX(Math.PI / 2), chromeMat, 0.006);
        placeOnFace(em, 0.74, false, 0.1);
        const bc = AR.canvas(256, 48), g2 = bc.getContext('2d');
        g2.font = 'italic bold 30px "Arial Black", Impact, sans-serif';
        g2.textAlign = 'center';
        g2.textBaseline = 'middle';
        g2.lineWidth = 5;
        g2.strokeStyle = '#1b1530';
        g2.strokeText(def.name.split(' ')[0].toUpperCase(), 128, 26);
        g2.fillStyle = '#e8ecf2';
        g2.fillText(def.name.split(' ')[0].toUpperCase(), 128, 26);
        const bm = new THREE.MeshBasicMaterial({ map: AR.canvasTex(bc), transparent: true });
        const bp = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.064), bm);
        bp.position.x = rearHalf * 0.55;
        root.add(bp);
        placeOnFace(bp, 0.6, false, 0.06);
      }
      // tow hooks / straps
      if (acc.tow) {
        const th = add(box(0.05, 0.12, 0.03), AR.toonMat(0xd8262f, { hatch: false }), 0.006);
        th.position.x = frontHalf * 0.6;
        placeOnFace(th, 0.28, true, 0.12);
        th.userData.breakable = 10;
      }
      // windshield sun-strip banner on rally-style liveries
      if (cfg.livery === 'rally' || cfg.livery === 'itasha' || cfg.livery === 'stripes') {
        const sc = AR.canvas(512, 64), g3 = sc.getContext('2d');
        g3.fillStyle = '#16161a';
        g3.fillRect(0, 0, 512, 64);
        g3.fillStyle = '#ffd83a';
        g3.font = 'bold 40px Bangers, Impact, sans-serif';
        g3.textAlign = 'center';
        g3.textBaseline = 'middle';
        g3.fillText('HAYATE RALLY  疾風', 256, 34);
        const smat = new THREE.MeshBasicMaterial({ map: AR.canvasTex(sc), side: THREE.DoubleSide });
        edgeGlass([cb.bf, cb.belt], [cb.rf, cb.roof], 0.72, 0.86, CAB_BEVEL + 0.016, smat);
      }
    }

    // --- customization parts ---
    const roofZ = (cb.rf + cb.rr) / 2;
    if (cfg.spoiler === 'wing') {
      const deckZ = def.bed ? def.bed[1] - 0.2 : Math.min(zMax - 0.25, cb.br + 0.15);
      const deckY = topYAt(bodyPoly, deckZ) + BEVEL;
      const wingW = def.W - 0.12;
      const wgp = new THREE.Group();
      wgp.userData.breakable = 9;
      root.add(wgp);
      const wing = add(extrudeProfile([[0.0, 0.0], [-0.1, 0.05], [-0.28, 0.035], [-0.3, 0.0]].map((p) => [p[0] + deckZ + 0.15, p[1] + deckY + 0.24]), wingW, 0.01, 2), M(cfg.livery === 'none' ? paint : accent, { rim: 0.5, spec: 0.6 }), ink, wgp);
      [-1, 1].forEach((s) => {
        const st = add(box(0.04, 0.24, 0.14), M(0x1d1e24), 0.01, wgp);
        st.position.set(s * (wingW / 2 - 0.25), deckY + 0.12, deckZ);
        const ep = add(box(0.02, 0.14, 0.34), M(0x1d1e24), 0.01, wgp);
        ep.position.set(s * (wingW / 2 + 0.01), deckY + 0.27, deckZ + 0.02);
      });
      wing.userData.part = 'wing';
    } else if (cfg.spoiler === 'lip') {
      const l = add(box(cabW * (1 - cb.taper) - 0.1, 0.05, 0.22), M(roofColor, { rim: 0.5 }), ink * 0.8);
      l.userData.breakable = 12;
      l.position.set(0, cb.roof + 0.0, cb.rr + 0.05);
      l.rotation.x = 0.18;
    } else if (cfg.spoiler === 'duck') {
      const deckZ = Math.min(zMax - 0.12, cb.br + 0.3);
      const l = add(box(def.W - 0.3, 0.06, 0.12), M(paint, { rim: 0.5 }), ink * 0.8);
      l.userData.breakable = 12;
      l.position.set(0, topYAt(bodyPoly, deckZ) + BEVEL + 0.02, deckZ);
      l.rotation.x = 0.35;
    }
    if (cfg.lights !== 'none') {
      const onRoof = cfg.lights === 'roof';
      const z = onRoof ? cb.rf + 0.15 : zMin + 0.18;
      const y = onRoof ? cb.roof + 0.14 : topYAt(bodyPoly, zMin + 0.35) + 0.12;
      const pg = new THREE.Group();
      pg.userData.breakable = 7;
      root.add(pg);
      const bar = add(box(onRoof ? cabW * 0.8 : def.W * 0.75, 0.04, 0.05), M(0x15161a), 0.01, pg);
      bar.position.set(0, y - 0.09, z + 0.03);
      const n = 4;
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n - 0.5) * (onRoof ? cabW * 0.75 : def.W * 0.68);
        const pod = add(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 18).rotateX(Math.PI / 2), M(0x15161a), 0.012, pg);
        pod.position.set(x, y, z);
        const lens = add(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 18).rotateX(Math.PI / 2), headMat, 0, pg);
        lens.userData.lamp = true;
        lens.position.set(x, y, z - 0.055);
        // classic yellow "X" covers on the inner pods
        if (!ghost && (i === 1 || i === 2)) {
          const c = add(new THREE.CylinderGeometry(0.088, 0.088, 0.02, 18).rotateX(Math.PI / 2), AR.toonMat(0xf2c230, { hatch: false }), 0.006, pg);
          c.position.set(x, y, z - 0.066);
        }
      }
      if (onRoof) {
        [-1, 1].forEach((s) => {
          const b = add(box(0.04, 0.12, 0.04), M(0x15161a), 0, pg);
          b.position.set(s * cabW * 0.35, cb.roof + 0.05, z + 0.02);
        });
      }
    }
    // numbers
    if (!ghost && (cfg.livery === 'rally' || cfg.livery === 'stripes' || cfg.livery === 'itasha')) {
      const nm = new THREE.MeshBasicMaterial({ map: numberTex(cfg.number), transparent: true });
      const doorZ = (def.cabin.windows[0][0] + def.cabin.windows[0][1]) / 2;
      const dy = (def.sill + cb.belt) / 2 + 0.05;
      const sz = Math.min(0.42, cb.belt - def.sill - 0.15);
      [-1, 1].forEach((s) => {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), nm);
        p.rotation.y = (s * Math.PI) / 2;
        p.position.set(s * (sideX(doorZ) + 0.004), dy, doorZ);
        root.add(p);
      });
      const rp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), nm);
      rp.rotation.x = -Math.PI / 2;
      rp.position.set(0, cb.roof + CAB_BEVEL + 0.006, roofZ);
      root.add(rp);
    }

    if (!ghost && cfg.livery === 'itasha') {
      const km = new THREE.MeshBasicMaterial({ map: kanjiTex(), transparent: true });
      // the burst is centred at 45% of the body length from the rear (canvas x = 560/1024)
      const kz = zMax - (zMax - zMin) * (560 / 1024);
      const ky = (def.sill + cb.belt) / 2 + 0.02;
      [-1, 1].forEach((s) => {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), km);
        p.rotation.y = (s * Math.PI) / 2;
        p.position.set(s * (sideX(kz) + 0.006), ky, kz);
        root.add(p);
      });
    }

    // --- wheels ---
    const wheels = [];
    const tireMat = M(0x26262b, { rim: 0.15 });
    const rimMat = M(cfg.rimColor, { rim: 0.5, spec: 0.9 });
    const darkMat = M(0x18191d);
    const caliperMat = M(cfg.livery === 'none' ? 0xd8262f : accent, { spec: 0.6 });
    const positions = [[-def.track / 2, axF], [def.track / 2, axF], [-def.track / 2, axR], [def.track / 2, axR]];
    positions.forEach((p, idx) => {
      const pivot = new THREE.Group();
      pivot.position.set(p[0], def.wheelR, p[1]);
      const spin = new THREE.Group();
      pivot.add(spin);
      const side = new THREE.Group();
      if (p[0] < 0) side.rotation.y = Math.PI; // rim faces outward
      spin.add(side);
      const R = def.wheelR, TW = def.tireW;
      const tire = add(new THREE.CylinderGeometry(R, R, TW, 26, 1).rotateZ(Math.PI / 2), tireMat, ghost ? 0 : 0.02, side);
      // tread blocks (read as motion when spinning)
      if (!ghost) {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const tb = new THREE.Mesh(box(TW * 0.9, 0.025, 0.06), darkMat);
          tb.position.set(0, Math.cos(a) * (R + 0.004), Math.sin(a) * (R + 0.004));
          tb.rotation.x = -a;
          side.add(tb);
        }
      }
      const rr = R * 0.66;
      const face = TW / 2 + 0.005;
      const rim = new THREE.Group();
      rim.position.x = face - 0.02;
      side.add(rim);
      const disc = (r, t, mat) => add(new THREE.CylinderGeometry(r, r, t, 24).rotateZ(Math.PI / 2), mat, 0, rim);
      disc(rr, 0.03, darkMat).position.x = -0.02; // barrel shadow
      const lip = add(new THREE.TorusGeometry(rr, 0.02, 6, 28).rotateY(Math.PI / 2), rimMat, 0.008, rim);
      lip.position.x = 0.01;
      const hub = disc(rr * 0.22, 0.05, rimMat);
      hub.position.x = 0.01;
      const spoke = (n, w, len, twist) => {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const s = add(box(0.025, len, w), rimMat, 0.006, rim);
          s.position.set(0.005, Math.cos(a) * (rr * 0.22 + len / 2), Math.sin(a) * (rr * 0.22 + len / 2));
          s.rotation.x = -a + (twist || 0);
        }
      };
      const st = cfg.rims;
      if (st === 'five') spoke(5, 0.07, rr * 0.78);
      else if (st === 'mesh') spoke(10, 0.025, rr * 0.78);
      else if (st === 'rally') spoke(6, 0.09, rr * 0.78);
      else if (st === 'fan') spoke(10, 0.06, rr * 0.78, 0.5);
      else if (st === 'steel' || st === 'dish') {
        disc(rr * 0.95, 0.02, rimMat).position.x = 0.0;
        const holes = st === 'steel' ? 6 : 5;
        for (let i = 0; i < holes; i++) {
          const a = (i / holes) * Math.PI * 2;
          const h = add(new THREE.CylinderGeometry(st === 'steel' ? 0.035 : 0.012, st === 'steel' ? 0.035 : 0.012, 0.025, 10).rotateZ(Math.PI / 2), darkMat, 0, rim);
          const rad = st === 'steel' ? rr * 0.6 : rr * 0.32;
          h.position.set(0.006, Math.cos(a) * rad, Math.sin(a) * rad);
        }
      }
      if (!ghost) {
        // lug nuts, centre cap and a sidewall ring for a rounder tyre profile
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.3;
          const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6).rotateZ(Math.PI / 2), darkMat);
          lug.position.set(0.03, Math.cos(a) * rr * 0.15, Math.sin(a) * rr * 0.15);
          rim.add(lug);
        }
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(rr * 0.08, rr * 0.08, 0.012, 14).rotateZ(Math.PI / 2), M(accent === cfg.rimColor ? 0x15161a : accent, { spec: 1 }));
        cap.position.x = 0.04;
        rim.add(cap);
        const wall = new THREE.Mesh(new THREE.TorusGeometry(R * 0.86, 0.022, 6, 30).rotateY(Math.PI / 2), M(0x3a3a42));
        wall.position.x = TW / 2 - 0.005;
        side.add(wall);
      }
      // brake caliper (does not spin)
      const cal = add(box(0.06, 0.12, 0.16), caliperMat, 0.008, pivot);
      cal.position.set((p[0] < 0 ? -1 : 1) * (TW / 2 - 0.09), R * 0.32, (idx < 2 ? 1 : -1) * R * 0.25);
      if (ghost) cal.visible = false;
      // mudflaps hang behind the wheels on the body
      if (cfg.mudflaps && !ghost) {
        const mf = add(box(TW + 0.04, 0.22, 0.02), M(accent === 0x15161a ? 0xd8262f : accent), 0.008);
        mf.position.set(p[0], def.sill - 0.08, p[1] + def.archR + 0.04);
        mf.userData.breakable = 8;
      }
      root.add(pivot);
      wheels.push({ pivot, spin, x: p[0], z: p[1], restY: R });
    });

    root.traverse((o) => {
      if (o.isMesh && ghost) { o.castShadow = false; o.receiveShadow = false; }
    });
    // collision bookkeeping for the damage system
    const deformables = [], glass = [], lamps = [];
    root.traverse((o) => {
      if (o.userData.deform) deformables.push(o);
      if (o.userData.glass) glass.push(o);
      if (o.userData.lamp) lamps.push(o);
    });
    const breakables = root.children.filter((o) => o.userData.breakable);
    return {
      root, wheels, tailMat, headMat, deformables, glass, lamps, breakables,
      meta: { zMin, zMax, halfW, roof: cb.roof, wheelR: def.wheelR, bf: cb.bf, hoodY: topYAt(bodyPoly, cb.bf - 0.3) },
    };
  };

  // Effective physics parameters after the player's tune.
  AR.carPhysics = function (def, cfg) {
    const p = Object.assign({}, def.phys);
    p.wheelR = def.wheelR;
    p.tireW = def.tireW;
    p.track = def.track;
    p.wb = def.wb;
    p.W = def.W;
    p.L = def.L;
    p.H = def.cabin.roof;
    const tune = { stock: 1, 'stage 1': 1.18, 'stage 2': 1.38 }[cfg.tune] || 1;
    p.torque *= tune;
    if (cfg.drive && cfg.drive !== 'factory' && !p.ev) {
      p.drive = cfg.drive;
      p.split = cfg.drive === 'AWD' ? 0.4 : cfg.drive === 'FWD' ? 1 : 0;
    } else if (cfg.drive && cfg.drive !== 'factory' && p.ev) {
      p.drive = cfg.drive;
      p.split = cfg.drive === 'AWD' ? 0.35 : cfg.drive === 'FWD' ? 1 : 0;
    }
    if (p.drive === 'RWD') p.split = 0;
    const susp = { soft: 0.78, medium: 1, stiff: 1.3 }[cfg.susp] || 1;
    p.k *= susp;
    p.heightOffset = { lowered: -0.05, stock: 0, lifted: 0.07 }[cfg.height] || 0;
    p.tires = cfg.tires || 'gravel';
    return p;
  };
})();
