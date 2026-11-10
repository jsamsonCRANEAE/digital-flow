// SP-1200 Modern, built from code. Every part that comes apart is its own group with a named anchor;
// pose(state) sets the whole object for one moment and is a pure function of the state it is given.
// Units: 1 ≈ 100 mm. Y up, front = +Z, right = +X. Layout measured off the reference (see ../CHECKLIST.md).
import * as THREE from 'three';
import {M, PAL, R, canvasTex, instances, knurled, led, mesh, rbox} from './parts.js';
import {drawScreen} from './screen.js';

export const W = 4.6, D = 3.85, hF = 0.64, hB = 1.14, FEET = 0.04, T = 0.06;
export const SLOPE = Math.atan2(hB - hF, D);
export const L = Math.hypot(D, hB - hF);
// the panel layout was measured on a 4.03-long deck; the deck group is scaled in z to the real length
const L0 = Math.hypot(4.0, 0.5);

export const LAYOUT = {
  screen: {x: -1.095, z: -0.89, w: 1.89, h: 1.1},
  runStop: {x: -1.92, z: 0.1},
  numRow: {z: 0.09, x0: -1.51, dx: 0.234, n: 8},
  faders: {x0: -1.55, dx: 0.323, n: 7, z0: 0.49, z1: 1.33},
  frontRow: {z: 1.6, x0: -1.53, dx: 0.287, n: 8},
  leftBtns: [{x: -1.95, z: 0.94}, {x: -1.95, z: 1.59}],
  knobs: [0, 1, 2, 3].map((i) => ({x: 0.12 + i * 0.52, z: -1.36})),
  repeat: {x: 0.21, z: -0.39}, roll: {x: 0.47, z: -0.39}, tap: {x: 0.45, z: 0.12},
  toggle: {x: 1.23, z: -0.47}, small: [{x: 1.56, z: -0.46}, {x: 1.87, z: -0.46}],
  pads: {cx: 1.41, cz: 0.61, pitch: 0.48, size: 0.42},
  ledRow: {z: 1.62, x0: 0.91, dx: 0.275, n: 5},
};

export function buildDevice() {
  const root = new THREE.Group();
  root.position.y = FEET;
  const parts = {}; // name -> {g, base: Vector3, dir: Vector3}
  const part = (name, parent, dir, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    parts[name] = {g, base: g.position.clone(), dir: new THREE.Vector3(...dir)};
    return g;
  };

  // ======================= shell: U-profile tray, side walls, cheeks =======================
  const tray = part('tray', root, [0, 0, 0]);
  {
    const t = 0.07;
    const s = new THREE.Shape(); // u = -z, v = y
    s.moveTo(-D / 2, 0);
    s.lineTo(-D / 2, hF);
    s.lineTo(-D / 2 + t, hF);
    s.lineTo(-D / 2 + t, t);
    s.lineTo(D / 2 - t, t);
    s.lineTo(D / 2 - t, hB);
    s.lineTo(D / 2, hB);
    s.lineTo(D / 2, 0);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {depth: W, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelOffset: -0.06, bevelSegments: 5, curveSegments: 4});
    g.rotateY(Math.PI / 2);
    g.translate(-W / 2, 0, 0);
    mesh(g, M.shell, 0, 0, 0, tray);
    // side walls (full wedge profile), slightly inset
    for (const sx of [-1, 1]) {
      const p = profile(0.03);
      const sg = new THREE.ExtrudeGeometry(p, {depth: 0.06, bevelEnabled: false});
      sg.rotateY(Math.PI / 2);
      mesh(sg, M.shell, sx > 0 ? W / 2 - 0.07 : -W / 2 + 0.01, 0, 0, tray);
    }
    // feet
    for (const x of [-1.9, 1.9]) for (const z of [-1.6, 1.6]) mesh(new THREE.CylinderGeometry(0.16, 0.18, FEET, 24), M.rubber, x, -FEET / 2, z, tray);
  }
  // aluminium cheeks inset into the sides: below the rim, behind the front face
  for (const sx of [-1, 1]) {
    const name = sx < 0 ? 'cheekL' : 'cheekR';
    const g = part(name, root, [sx * 1.2, 0, 0], sx > 0 ? W / 2 - 0.005 : -W / 2 - 0.055);
    const outer = profile(0.1, 0.05);
    const hole = new THREE.Path();
    const zf = D / 2 - 0.7, zb = -D / 2 + 0.55;
    hole.moveTo(-zf, 0.22);
    hole.lineTo(-zf, hF - 0.3);
    hole.lineTo(-zb, hB - 0.38);
    hole.lineTo(-zb, 0.22);
    hole.closePath();
    outer.holes.push(hole);
    const pg = new THREE.ExtrudeGeometry(outer, {depth: 0.06, bevelEnabled: true, bevelSize: 0.022, bevelThickness: 0.022, bevelOffset: -0.022, bevelSegments: 3});
    pg.rotateY(Math.PI / 2);
    mesh(pg, M.alu, 0, 0, 0, g);
    const gg = new THREE.ExtrudeGeometry(new THREE.Shape(hole.getPoints()), {depth: 0.02, bevelEnabled: false});
    gg.rotateY(Math.PI / 2);
    mesh(gg, M.grille, sx > 0 ? 0.036 : 0.004, 0, 0, g);
    for (const [z, y] of [[D / 2 - 0.27, 0.13], [-D / 2 + 0.24, 0.13], [-D / 2 + 0.24, hB - 0.2], [D / 2 - 0.27, hF - 0.14]]) {
      const sc = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.02, 20), M.chrome, sx > 0 ? 0.065 : -0.005, y, z, g);
      sc.rotation.z = Math.PI / 2;
      const slot = mesh(new THREE.BoxGeometry(0.004, 0.006, 0.04), M.black, sx > 0 ? 0.076 : -0.016, y, z, g);
    }
  }

  // ======================= internals (only seen when it opens) =======================
  buildInternals(part, root);

  // ======================= front panel: floppy + I/O =======================
  buildFront(part, root);
  // ======================= rear: plugs + cables =======================
  buildRear(part, root);

  // ======================= the sloped deck =======================
  const deck = part('deck', root, [0, 1.25, 0], 0, (hF + hB) / 2, 0);
  deck.rotation.x = SLOPE;
  deck.scale.z = L / L0;
  const plate = part('topPlate', deck, [0, 0.45, 0]);
  mesh(rbox(W - 0.01, T, L0 - 0.01, 0.05), M.shell, 0, T / 2, 0, plate);
  const printing = mesh(new THREE.PlaneGeometry(W - 0.13, L0 - 0.13), new THREE.MeshPhysicalMaterial({map: printTexture(), roughness: 0.6, metalness: 0.22, clearcoat: 0.1}), 0, T + 0.001, 0, plate);
  printing.rotation.x = -Math.PI / 2;
  // cut-outs read as dark wells: drawn on the printing; controls sit on top at y = T
  const ctl = {};
  ctl.screen = buildScreen(part, deck);
  ctl.buttons = buildButtons(part, deck);
  ctl.knobs = buildKnobs(part, deck);
  ctl.faders = buildFaders(part, deck);
  ctl.pads = buildPads(part, deck);
  buildDeckUnderside(part, deck);

  // anchors: an Object3D at the heart of every part, for labels and cameras
  const anchors = {};
  for (const [name, p] of Object.entries(parts)) anchors[name] = p.g;

  const pose = (s = {}) => {
    const E = s.explode ?? 0;
    for (const [name, p] of Object.entries(parts)) {
      const k = Math.max(E, s.open?.[name] ?? 0);
      p.g.position.copy(p.base).addScaledVector(p.dir, k);
    }
    // pads: edge glow + travel
    ctl.pads.forEach((pd, i) => {
      const h = s.padHits?.[i] ?? 0;
      pd.glow.emissiveIntensity = 0.75 + h * 1.3;
      pd.pad.position.y = 0.075 - h * 0.022;
    });
    // fader caps + LED ladders
    ctl.faders.set(s.faders ?? [], s.meters ?? []);
    (s.knobs ?? []).forEach((v, i) => ctl.knobs[i] && (ctl.knobs[i].rotation.y = -THREE.MathUtils.degToRad(-135 + 270 * v)));
    ctl.buttons.leds.forEach((m, i) => (m.emissiveIntensity = (s.ledLevels?.[i] ?? 1) * 2.4));
    ctl.screen.draw(s.screen ?? {});
  };
  pose({});
  return {root, anchors, parts, pose, deck};
}

/** The side wedge profile (u = -z, v = y), inset all round by `inset`; `bottom` raises the floor edge. */
function profile(inset, bottom = 0) {
  const s = new THREE.Shape();
  const zf = D / 2 - inset, zb = -D / 2 + inset;
  const yf = hF + T - inset * 1.4, yb = hB + T - inset * 1.4;
  s.moveTo(-zf, bottom + inset * 0.3);
  s.lineTo(-zf, yf);
  s.lineTo(-zb, yb);
  s.lineTo(-zb, bottom + inset * 0.3);
  s.closePath();
  return s;
}

// ---------------------------------------------------------------------------------------------
function printTexture() {
  const PW = W - 0.13, PL = L0 - 0.13;
  const CW = 2048, CH = Math.round((2048 * PL) / PW), S = CW / PW;
  const toC = (x, z) => [((x + PW / 2) / PW) * CW, ((z + PL / 2) / PL) * CH];
  return canvasTex(CW, CH, (g) => {
    g.fillStyle = PAL.rim;
    g.fillRect(0, 0, CW, CH);
    // inset panel, darker, rounded, with a thin light outline; the back strip stays rim-coloured for the logos
    const [ax, ay] = toC(-2.17, -1.53), [bx, by] = toC(2.17, 1.9);
    g.fillStyle = PAL.panel;
    g.beginPath();
    g.roundRect(ax, ay, bx - ax, by - ay, 0.12 * S);
    g.fill();
    g.strokeStyle = 'rgba(200,200,205,0.55)';
    g.lineWidth = 0.012 * S;
    g.stroke();
    for (let i = 0; i < 30000; i++) {
      g.fillStyle = `rgba(255,255,255,${R() * 0.03})`;
      g.fillRect(R() * CW, R() * CH, 1.5, 1.5);
    }
    const txt = (x, z, s, size = 0.07, col = PAL.ink, align = 'center', weight = 600, style = '') => {
      const [cx, cy] = toC(x, z);
      g.fillStyle = col;
      g.textAlign = align;
      g.textBaseline = 'middle';
      g.font = `${style} ${weight} ${size * S}px Inter, "Helvetica Neue", Arial, sans-serif`;
      g.fillText(s, cx, cy);
    };
    const line = (x1, z1, x2, z2, col = PAL.orange, w = 0.009) => {
      const [a, b] = toC(x1, z1), [c, d] = toC(x2, z2);
      g.strokeStyle = col;
      g.lineWidth = w * S;
      g.beginPath();
      g.moveTo(a, b);
      g.lineTo(c, d);
      g.stroke();
    };
    const well = (x, z, w, h, r = 0.03) => {
      const [cx, cy] = toC(x - w / 2, z - h / 2);
      g.fillStyle = '#141517';
      g.beginPath();
      g.roundRect(cx, cy, w * S, h * S, r * S);
      g.fill();
    };
    const Lt = LAYOUT;
    // logos on the back strip
    txt(-2.1, -1.76, 'SP-1200', 0.24, '#36383c', 'left', 800, 'italic');
    txt(-1.02, -1.74, 'Modern', 0.17, '#3d3f43', 'left', 500);
    txt(0.62, -1.76, 'E-mu', 0.22, '#e9e5de', 'left', 800);
    txt(1.24, -1.76, 'Modern', 0.2, PAL.orange, 'left', 600);
    // section lines (measured off the reference)
    line(-2.05, 0.3, 0.27, 0.3);
    line(-1.75, 1.43, 0.62, 1.43);
    line(0.72, 1.43, 2.12, 1.43);
    line(0.02, -1.62 + 0.12, 2.1, -1.5);
    line(0.95, -0.66, 2.12, -0.66);
    line(0.08, -0.6, 0.6, -0.6);
    line(0.25, -0.1, 0.62, -0.1);
    txt(1.55, -0.76, '12-bit / 26kHz', 0.07, PAL.ink, 'center', 600);
    txt(1.05, -1.42 + 0.2 - 0.25, '', 0.05);
    txt(1.4, 1.36 + 0.0, '', 0.05);
    txt(0.72, -0.24, 'PAD BANK / KIT', 0.045, PAL.dim, 'left');
    // labels
    txt(Lt.runStop.x, Lt.runStop.z - 0.17, 'RUN/STOP', 0.065);
    for (let i = 0; i < 8; i++) {
      txt(Lt.numRow.x0 + i * Lt.numRow.dx, Lt.numRow.z - 0.16, String(i + 1), 0.07);
      txt(Lt.frontRow.x0 + i * Lt.frontRow.dx, Lt.frontRow.z + 0.17, ['MUTE', 'SOLO', 'TUNE', 'DECAY', 'MIX', 'PAN', 'SWING', 'STEP'][i], 0.045, PAL.dim);
    }
    ['HPF CUTOFF', 'RESONANCE', 'DRIVE', 'MASTER'].forEach((s, i) => txt(Lt.knobs[i].x, Lt.knobs[i].z + 0.3, s, 0.05));
    txt(Lt.repeat.x, Lt.repeat.z - 0.16, 'REPEAT', 0.05);
    txt(Lt.roll.x, Lt.roll.z - 0.16, 'ROLL', 0.05);
    txt(Lt.repeat.x + 0.12, Lt.repeat.z + 0.17, 'NOTE RPT · 1/16', 0.038, PAL.dim);
    txt(Lt.tap.x, Lt.tap.z - 0.16, 'TAP/REPEAT', 0.05);
    txt(Lt.tap.x, Lt.tap.z + 0.16, 'TEMPO', 0.045, PAL.orange);
    txt(Lt.toggle.x, Lt.toggle.z + 0.15, 'VINTAGE · CLEAN', 0.035, PAL.dim);
    Lt.small.forEach((b, i) => txt(b.x, b.z + 0.15, ['PADS', 'FILTER'][i], 0.04, PAL.dim));
    ['REC/STOP', 'A', 'B', 'C', 'ERASE'].forEach((s, i) => txt(Lt.ledRow.x0 + i * Lt.ledRow.dx, Lt.ledRow.z + 0.17, s, 0.04, PAL.dim));
    Lt.leftBtns.forEach((b, i) => txt(b.x + 0.18, b.z, ['PAGE', 'SHIFT'][i], 0.04, PAL.dim, 'left'));
    // fader scales + slots
    const F = Lt.faders;
    for (let i = 0; i < F.n; i++) {
      const x = F.x0 + i * F.dx;
      well(x, (F.z0 + F.z1) / 2, 0.05, F.z1 - F.z0 + 0.08, 0.02);
      for (let t = 0; t <= 10; t++) {
        const z = F.z0 + ((F.z1 - F.z0) * t) / 10;
        line(x - 0.06, z, x - (t % 5 ? 0.035 : 0.07), z, '#77746f', 0.005);
      }
    }
    // pad well
    const P = Lt.pads;
    well(P.cx, P.cz, P.pitch * 2 + P.size + 0.08, P.pitch * 2 + P.size + 0.08, 0.05);
  });
}

// ---------------------------------------------------------------------------------------------
const btnGeo = rbox(0.17, 0.085, 0.17, 0.032);
const wellGeo = rbox(0.205, 0.016, 0.205, 0.012);
function button(parent, x, z, ledHex = null) {
  const g = new THREE.Group();
  g.position.set(x, T, z);
  mesh(wellGeo, M.black, 0, 0.004, 0, g);
  mesh(btnGeo, M.rubber, 0, 0.05, 0, g);
  let lm = null;
  if (ledHex) {
    lm = led(ledHex, 2.4);
    mesh(new THREE.BoxGeometry(0.11, 0.012, 0.018), lm, 0, 0.094, -0.045, g);
  }
  parent.add(g);
  return lm;
}

function buildButtons(part, deck) {
  const g = part('buttons', deck, [0, 1.0, 0]);
  const Lt = LAYOUT;
  const leds = [];
  leds.push(button(g, Lt.runStop.x, Lt.runStop.z, 0x3cff6a));
  for (let i = 0; i < 8; i++) button(g, Lt.numRow.x0 + i * Lt.numRow.dx, Lt.numRow.z);
  for (let i = 0; i < 8; i++) button(g, Lt.frontRow.x0 + i * Lt.frontRow.dx, Lt.frontRow.z);
  Lt.leftBtns.forEach((b, i) => leds.push(button(g, b.x, b.z, i ? 0xff6a2a : 0x3cff6a)));
  button(g, Lt.repeat.x, Lt.repeat.z);
  button(g, Lt.roll.x, Lt.roll.z);
  leds.push(button(g, Lt.tap.x, Lt.tap.z, 0xff7a2e));
  Lt.small.forEach((b) => button(g, b.x, b.z));
  for (let i = 0; i < Lt.ledRow.n; i++) leds.push(button(g, Lt.ledRow.x0 + i * Lt.ledRow.dx, Lt.ledRow.z, PAL.leds[i]));
  // vintage / clean toggle
  const tg = new THREE.Group();
  tg.position.set(Lt.toggle.x, T, Lt.toggle.z);
  mesh(rbox(0.34, 0.03, 0.14, 0.012), M.black, 0, 0.015, 0, tg);
  mesh(rbox(0.12, 0.075, 0.1, 0.02), M.satin, -0.08, 0.055, 0, tg);
  g.add(tg);
  return {leds: leds.filter(Boolean)};
}

function buildKnobs(part, deck) {
  const g = part('knobs', deck, [0, 2.0, 0]);
  const spins = [];
  LAYOUT.knobs.forEach((k, i) => {
    const kg = new THREE.Group();
    kg.position.set(k.x, T, k.z);
    const spin = new THREE.Group();
    kg.add(spin);
    mesh(new THREE.CylinderGeometry(0.2, 0.205, 0.035, 48), M.knob, 0, 0.018, 0, spin);
    mesh(knurled(0.15, 0.24, 36), M.knob, 0, 0.155, 0, spin);
    mesh(new THREE.CylinderGeometry(0.13, 0.138, 0.022, 48), M.satin, 0, 0.285, 0, spin);
    mesh(new THREE.BoxGeometry(0.02, 0.012, 0.11), M.white, 0, 0.298, -0.065, spin);
    mesh(new THREE.BoxGeometry(0.014, 0.01, 0.07), M.white, 0, 0.038, -0.17, spin);
    for (let j = 0; j <= 10; j++) {
      const a = THREE.MathUtils.degToRad(-135 + j * 27);
      mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 8), M.white, Math.sin(a) * 0.255, 0.003, -Math.cos(a) * 0.255, kg);
    }
    // the pot under it (seen when it lifts)
    mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 24), M.heatsink, 0, -0.06, 0, kg);
    mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12), M.satin, 0, -0.0, 0, kg);
    spin.rotation.y = -THREE.MathUtils.degToRad(-135 + 270 * (0.35 + i * 0.1));
    g.add(kg);
    spins.push(spin);
  });
  return spins;
}

function buildFaders(part, deck) {
  const g = part('faders', deck, [0, 1.5, 0]);
  const F = LAYOUT.faders;
  const n = 16;
  const caps = [];
  const ledI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.016, 0.01, 0.016), new THREE.MeshBasicMaterial({toneMapped: false}), F.n * n);
  ledI.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(F.n * n * 3), 3);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < F.n; i++) {
    const x = F.x0 + i * F.dx;
    const fg = new THREE.Group();
    fg.position.set(x, T, 0);
    // slot frame + rails (the fader body is under the plate)
    mesh(rbox(0.07, 0.01, F.z1 - F.z0 + 0.12, 0.004), M.dark, 0, 0.005, (F.z0 + F.z1) / 2, fg);
    mesh(new THREE.BoxGeometry(0.022, 0.012, F.z1 - F.z0 + 0.05), M.black, 0, 0.007, (F.z0 + F.z1) / 2, fg);
    mesh(new THREE.BoxGeometry(0.16, 0.08, F.z1 - F.z0 + 0.3), M.dark, 0, -0.07, (F.z0 + F.z1) / 2, fg);
    mesh(new THREE.CylinderGeometry(0.012, 0.012, F.z1 - F.z0 + 0.28, 8), M.satin, 0.05, -0.03, (F.z0 + F.z1) / 2, fg).rotation.x = Math.PI / 2;
    const cap = new THREE.Group();
    mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), M.black, 0, 0.03, 0, cap);
    mesh(rbox(0.17, 0.11, 0.12, 0.02), M.chrome, 0, 0.1, 0, cap);
    mesh(new THREE.BoxGeometry(0.172, 0.02, 0.014), M.black, 0, 0.155, 0, cap);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.172, 0.012, 0.012), M.satin, 0, 0.152, s * 0.035, cap);
    fg.add(cap);
    caps.push(cap);
    g.add(fg);
    for (let j = 0; j < n; j++) {
      m4.makeTranslation(x + 0.1, T + 0.008, F.z1 - ((F.z1 - F.z0) * j) / (n - 1));
      ledI.setMatrixAt(i * n + j, m4);
    }
  }
  g.add(ledI);
  const amber = [new THREE.Color(0xffc93a), new THREE.Color(0xff9a2a), new THREE.Color(0xff4a2a)];
  const off = new THREE.Color(0x1c150a);
  const c = new THREE.Color();
  const set = (vals, meters) => {
    caps.forEach((cap, i) => (cap.position.z = THREE.MathUtils.lerp(F.z1, F.z0, vals[i] ?? 0.63)));
    for (let i = 0; i < F.n; i++) {
      const lit = Math.round((meters[i] ?? 1) * n);
      for (let j = 0; j < n; j++) {
        const on = j < lit;
        c.copy(on ? amber[j > 13 ? 2 : j > 10 ? 1 : 0] : off).multiplyScalar(on ? 0.9 : 1);
        ledI.setColorAt(i * n + j, c);
      }
    }
    ledI.instanceColor.needsUpdate = true;
  };
  return {set};
}

function buildPads(part, deck) {
  const g = part('pads', deck, [0, 1.3, 0]);
  const P = LAYOUT.pads;
  const pads = [];
  const padGeo = rbox(P.size, 0.1, P.size, 0.04, 4);
  const glowGeo = rbox(P.size + 0.024, 0.045, P.size + 0.024, 0.04, 4);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const pg = new THREE.Group();
      pg.position.set(P.cx + (c - 1) * P.pitch, T, P.cz + (r - 1) * P.pitch);
      const gm = led(PAL.pads[i], 0.9);
      mesh(glowGeo, gm, 0, 0.032, 0, pg);
      const pad = mesh(padGeo, M.pad, 0, 0.075, 0, pg);
      g.add(pg);
      pads.push({glow: gm, pad});
    }
  return pads;
}

function buildScreen(part, deck) {
  const S = LAYOUT.screen;
  const g = part('screen', deck, [0, 1.8, 0], S.x, T, S.z);
  mesh(rbox(S.w + 0.14, 0.05, S.h + 0.14, 0.03), M.gloss, 0, 0.02, 0, g);
  const tex = canvasTex(1290, 750, () => {});
  const disp = mesh(new THREE.PlaneGeometry(S.w, S.h), new THREE.MeshBasicMaterial({map: tex, color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false}), 0, 0.047, 0, g);
  disp.rotation.x = -Math.PI / 2;
  const glass = mesh(new THREE.PlaneGeometry(S.w + 0.1, S.h + 0.1), new THREE.MeshPhysicalMaterial({color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.02, clearcoat: 1}), 0, 0.05, 0, g);
  glass.rotation.x = -Math.PI / 2;
  // module behind the glass: metal tray, driver board, flex
  mesh(new THREE.BoxGeometry(S.w + 0.05, 0.06, S.h + 0.05), M.heatsink, 0, -0.06, 0, g);
  mesh(new THREE.BoxGeometry(S.w * 0.7, 0.02, S.h * 0.5), M.pcb, 0, -0.1, 0.1, g);
  g.add(instances(new THREE.BoxGeometry(0.12, 0.025, 0.12), M.chip, [[-0.3, -0.12, 0.1], [0, -0.12, 0.15], [0.3, -0.12, 0.05], [0.15, -0.12, -0.12]]));
  mesh(new THREE.BoxGeometry(0.4, 0.004, 0.5), M.ribbon, 0.5, -0.12, S.h / 2 + 0.1, g);
  return {draw: (s) => drawScreen(tex, s)};
}

function buildDeckUnderside(part, deck) {
  // pad sensor board + fader/knob harness under the plate; lifts with the deck
  const g = part('padBoard', deck, [0, -0.2, 0]);
  const P = LAYOUT.pads;
  mesh(new THREE.BoxGeometry(P.pitch * 3 + 0.1, 0.025, P.pitch * 3 + 0.1), M.pcb, P.cx, -0.04, P.cz, g);
  const fsr = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) fsr.push([P.cx + (c - 1) * P.pitch, -0.02, P.cz + (r - 1) * P.pitch]);
  g.add(instances(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 32), M.gold, fsr));
  // ribbon harness across the underside
  for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(0.28, 0.004, 2.6), M.ribbon, -1.4 + i * 0.95, -0.12, 0.2, g).rotation.y = 0.2 * (i - 1.5);
}

function buildInternals(part, root) {
  // mainboard: dense with chips, capacitors, headers
  const mb = part('mainboard', root, [0, 0.3, 0]);
  mesh(new THREE.BoxGeometry(3.4, 0.03, 3.3), M.pcb, -0.45, 0.13, 0.05, mb);
  const chips = [], caps = [], hdrs = [];
  for (let i = 0; i < 46; i++) {
    const big = i < 8;
    chips.push([-2.0 + R() * 3.1, 0.165, -1.5 + R() * 3.0, big ? 2.4 : 0.6 + R() * 0.9, 1, big ? 2.4 : 0.6 + R() * 0.6, ((R() * 2) | 0) * Math.PI / 2]);
  }
  for (let i = 0; i < 70; i++) caps.push([-2.0 + R() * 3.1, 0.2, -1.5 + R() * 3.0, 1, 0.6 + R() * 1.2, 1]);
  for (let i = 0; i < 6; i++) hdrs.push([-1.9 + i * 0.55, 0.18, 1.45, 1, 1, 1]);
  mb.add(instances(new THREE.BoxGeometry(0.12, 0.03, 0.12), M.chip, chips));
  mb.add(instances(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12), M.cap, caps));
  mb.add(instances(new THREE.BoxGeometry(0.4, 0.06, 0.08), M.black, hdrs));
  // ribbons up to the deck
  for (let i = 0; i < 3; i++) {
    const rb = mesh(new THREE.BoxGeometry(0.3, 0.004, 0.7), M.ribbon, -1.5 + i * 0.9, 0.38, 1.2, mb);
    rb.rotation.x = -0.9;
  }
  // power supply: transformer, toroid, heatsink, big caps
  const ps = part('psu', root, [0, 0.55, 0], 1.65, 0.07, -1.0);
  mesh(new THREE.BoxGeometry(1.1, 0.03, 1.5), M.pcb, 0, 0.0, 0, ps);
  mesh(new THREE.TorusGeometry(0.22, 0.09, 16, 32), M.copper, -0.2, 0.12, -0.35, ps).rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 16), M.black, -0.2, 0.12, -0.35, ps);
  const fins = [];
  for (let i = 0; i < 12; i++) fins.push([0.3, 0.17, -0.6 + i * 0.07, 1, 1, 1]);
  ps.add(instances(new THREE.BoxGeometry(0.4, 0.3, 0.012), M.heatsink, fins));
  ps.add(instances(new THREE.CylinderGeometry(0.08, 0.08, 0.26, 16), M.cap, [[-0.3, 0.13, 0.3], [-0.1, 0.13, 0.3], [0.1, 0.13, 0.45]]));
  mesh(new THREE.BoxGeometry(0.3, 0.1, 0.2), M.white, 0.3, 0.06, 0.5, ps);
}

function buildFront(part, root) {
  const lab = canvasTex(2048, 200, (g, w, h) => {
    g.fillStyle = '#cfc9bf';
    g.font = '600 20px Inter, Arial';
    g.textAlign = 'center';
    g.font = '600 17px Inter, Arial';
    g.fillText('REC', 1722, 188);
    g.fillText('PHONES', 1800, 188);
  });
  const lp = mesh(new THREE.PlaneGeometry(W - 0.2, ((W - 0.2) * 200) / 2048), new THREE.MeshStandardMaterial({map: lab, transparent: true, roughness: 0.6}), 0, hF * 0.42, D / 2 + 0.002, root);
  // floppy: bezel + mechanism behind it
  const fd = part('floppy', root, [0, 0, 1.3], -1.2, hF * 0.46, D / 2);
  mesh(rbox(1.55, 0.38, 0.05, 0.02), M.dark, 0, 0, 0.008, fd);
  mesh(rbox(1.45, 0.3, 0.05, 0.015), M.black, 0, 0, 0.016, fd);
  mesh(new THREE.BoxGeometry(1.15, 0.04, 0.03), M.hole, -0.07, 0.05, 0.035, fd);
  mesh(new THREE.BoxGeometry(1.15, 0.034, 0.006), M.dark, -0.07, 0.05, 0.044, fd);
  mesh(rbox(0.18, 0.07, 0.04, 0.01), M.dark, 0.55, -0.08, 0.04, fd);
  mesh(new THREE.BoxGeometry(0.06, 0.02, 0.01), led(0x3cff6a, 0.6), -0.6, -0.09, 0.044, fd);
  const mech = new THREE.Group();
  mech.position.z = -0.55;
  fd.add(mech);
  mesh(new THREE.BoxGeometry(1.1, 0.24, 1.0), M.heatsink, 0, -0.01, 0, mech);
  mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 32), M.satin, 0, 0.12, 0, mech);
  mesh(new THREE.BoxGeometry(0.08, 0.04, 0.5), M.black, 0.32, 0.12, -0.05, mech);
  mesh(new THREE.BoxGeometry(0.7, 0.02, 0.3), M.pcb, 0, -0.13, 0.3, mech);
  // I/O block
  const io = part('io', root, [0, 0, 1.0], 0.62, hF * 0.46, D / 2);
  mesh(rbox(1.15, 0.33, 0.05, 0.02), M.black, 0, 0, 0.012, io);
  mesh(new THREE.BoxGeometry(0.22, 0.025, 0.02), M.hole, -0.4, 0.04, 0.035, io);
  mesh(new THREE.BoxGeometry(0.13, 0.025, 0.02), M.hole, -0.4, -0.04, 0.035, io);
  mesh(rbox(0.09, 0.035, 0.03, 0.015), M.chrome, -0.13, 0, 0.033, io);
  mesh(rbox(0.075, 0.02, 0.02, 0.009), M.hole, -0.13, 0, 0.043, io);
  mesh(new THREE.BoxGeometry(0.13, 0.06, 0.03), M.chrome, 0.1, 0, 0.033, io);
  mesh(new THREE.BoxGeometry(0.11, 0.022, 0.02), M.usb, 0.1, 0.008, 0.044, io);
  mesh(new THREE.TorusGeometry(0.03, 0.012, 12, 24), M.chrome, 0.34, 0, 0.042, io);
  mesh(new THREE.BoxGeometry(1.0, 0.02, 0.4), M.pcb, 0, -0.08, -0.25, io);
  // rec knob + 1/4" jack
  const rk = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 24), M.satin, 1.5, hF * 0.56, D / 2 + 0.03, root);
  rk.rotation.x = Math.PI / 2;
  mesh(new THREE.TorusGeometry(0.06, 0.018, 12, 28), M.chrome, 1.66, hF * 0.56, D / 2 + 0.015, root);
  mesh(new THREE.CircleGeometry(0.045, 24), M.hole, 1.66, hF * 0.56, D / 2 + 0.012, root);
}

function buildRear(part, root) {
  const g = part('rear', root, [0, 0, 0]);
  const plugs = [
    {x: -1.5, y: 0.95, mat: M.cable}, {x: -1.15, y: 0.95, mat: M.cableRed}, {x: -0.8, y: 0.95, mat: M.cable},
    {x: 0.2, y: 0.92, mat: M.cable, xlr: true}, {x: 0.65, y: 0.92, mat: M.cable, xlr: true},
    {x: 1.25, y: 0.95, mat: M.braid}, {x: 1.75, y: 0.95, mat: M.braid},
  ];
  for (const p of plugs) {
    const z0 = -D / 2;
    const pl = new THREE.Group();
    pl.position.set(p.x, p.y, z0);
    mesh(new THREE.CylinderGeometry(p.xlr ? 0.075 : 0.05, p.xlr ? 0.075 : 0.05, 0.28, 24), p.xlr ? M.chrome : M.satin, 0, 0, -0.14, pl).rotation.x = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.04, p.xlr ? 0.065 : 0.045, 0.2, 18), M.black, 0, 0, -0.36, pl).rotation.x = Math.PI / 2;
    g.add(pl);
    const pts = [
      [p.x, p.y, z0 - 0.45], [p.x * 1.02, p.y + 0.32, z0 - 1.0], [p.x * 1.05 + 0.1, p.y + 0.1, z0 - 1.8],
      [p.x * 1.1 + 0.2, 0.0, z0 - 2.9], [p.x * 1.15 + 0.4, 0.0, z0 - 6.0],
    ].map((v) => new THREE.Vector3(...v));
    const tube = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, p.xlr ? 0.045 : 0.035, 10), p.mat, 0, 0, 0, g);
    tube.position.y = -FEET + 0.035;
  }
}
