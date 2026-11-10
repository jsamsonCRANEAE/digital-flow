// SP-1200 MODERN — the still: the object posed like the reference, already playing (pads, meters, screen).
// render(t) is a pure function of t. window.__TOOLS holds the measuring and camera-fitting hooks for the still loop.
import * as THREE from 'three';
import {runSim} from 'cutaway-kit/runtime.js';
import {buildDevice, D, FEET, hB, hF, T, W} from '../sp1200-shared/device.js';
import {PATTERN} from '../sp1200-shared/screen.js';
import {createStage} from '../sp1200-shared/stage.js';
import TL from './timeline.json';

const STEP = 60 / TL.bpm / 4;
// pads 0..5 follow the pattern rows; 6..8 play a slow fill
const lastHit = (row, t) => {
  const cur = Math.floor(t / STEP);
  for (let k = 0; k < 16; k++) {
    const s = cur - k;
    if (s < 0) break;
    if (PATTERN[row][((s % 16) + 16) % 16]) return t - s * STEP;
  }
  return 9;
};
export function stateAt(t) {
  const hits = [];
  for (let i = 0; i < 9; i++) {
    const dt = i < 6 ? lastHit(i, t) : (t + i * 0.7) % 2.6;
    hits.push(Math.exp(-dt * 7));
  }
  const meters = [0, 1, 2, 3, 4, 5, 6].map((i) => 0.25 + 0.7 * (hits[i % 6] * 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3 + i))));
  return {
    padHits: hits,
    meters,
    faders: [0.63, 0.63, 0.62, 0.63, 0.63, 0.62, 0.63],
    knobs: [0.35, 0.45, 0.55, 0.65],
    ledLevels: [1, 1, 1, 0.6 + 0.4 * hits[0], 1, 1, 1, 1, 1],
    screen: {step: Math.floor(t / STEP) % 16, playhead: (t * 0.12) % 1, bpm: TL.bpm, meters},
  };
}

runSim({duration: TL.duration, fps: 60, theme: 'dark', hud: {enabled: false, title: 'SP-1200 Modern', subtitle: ''}, director: {enabled: false}, watermark: ''}, async ({canvas, capture}) => {
  const st = createStage({canvas});
  const dev = buildDevice();
  st.scene.add(dev.root);
  let cam = {...TL.cam};
  const resize = () => st.resize(innerWidth, innerHeight, capture ? devicePixelRatio || 1 : Math.min(devicePixelRatio || 1, 2));
  resize();

  // ---------- still-loop tools ----------
  const y0 = FEET, yF = FEET + hF + T, yB = FEET + hB + T;
  const LM = {
    FLT: [-W / 2, yF, D / 2], FRT: [W / 2, yF, D / 2], FRB: [W / 2, 0, D / 2], FLB: [-W / 2, 0, D / 2],
    BRT: [W / 2, yB, -D / 2], BRB: [W / 2, 0, -D / 2], BLT: [-W / 2, yB, -D / 2],
  };
  const v = new THREE.Vector3();
  const projectAll = (c) => {
    st.place(c);
    const out = {};
    for (const [k, p] of Object.entries(LM)) out[k] = st.project(v.set(...p));
    return out;
  };
  const norm = (pts) => {
    const n = pts.length;
    const cx = pts.reduce((a, p) => a + p[0], 0) / n, cy = pts.reduce((a, p) => a + p[1], 0) / n;
    const s = Math.sqrt(pts.reduce((a, p) => a + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / n);
    return pts.map((p) => [(p[0] - cx) / s, (p[1] - cy) / s]);
  };
  const keys = ['FLT', 'FRT', 'FRB', 'FLB', 'BRT', 'BLT'];
  const fit = (ref) => {
    const R = norm(keys.map((k) => ref[k]));
    const err = (az, el, dist) => {
      const P = projectAll({...cam, az, el, dist, fov: 30, sx: 0, sy: 0});
      const N = norm(keys.map((k) => P[k]));
      return N.reduce((a, p, i) => a + (p[0] - R[i][0]) ** 2 + (p[1] - R[i][1]) ** 2, 0);
    };
    let best = [1e9];
    for (let az = 0.1; az < 1.5; az += 0.04) for (let el = 0.3; el < 1.4; el += 0.04) for (const dist of [8, 12, 18, 28, 45]) {
      const e = err(az, el, dist);
      if (e < best[0]) best = [e, az, el, dist];
    }
    let step = [0.02, 0.02, 0.15];
    for (let it = 0; it < 400; it++) {
      let improved = false;
      for (let d = 0; d < 3; d++) for (const sgn of [-1, 1]) {
        const c = best.slice(1);
        c[d] = d === 2 ? c[d] * (1 + sgn * step[d]) : c[d] + sgn * step[d];
        const e = err(...c);
        if (e < best[0]) { best = [e, ...c]; improved = true; }
      }
      if (!improved) step = step.map((s) => s * 0.6);
    }
    return {err: best[0], az: best[1], el: best[2], dist: best[3]};
  };
  // frame it: fov sets the size (perspective unchanged), shift centres it; heightShare of the frame
  const frameIt = (c, heightShare = 0.8, cx = 0.5, cy = 0.52) => {
    let f = {...c, fov: 30, sx: 0, sy: 0};
    let P = projectAll(f);
    const ys = Object.values(P).map((p) => p[1]);
    const hgt = (Math.max(...ys) - Math.min(...ys)) / innerHeight;
    const k = Math.tan((30 * Math.PI) / 360) * (hgt / heightShare);
    f.fov = (Math.atan(k) * 360) / Math.PI;
    P = projectAll(f);
    const xs2 = Object.values(P).map((p) => p[0]), ys2 = Object.values(P).map((p) => p[1]);
    f.sx = cx - (Math.max(...xs2) + Math.min(...xs2)) / 2 / innerWidth;
    f.sy = cy - (Math.max(...ys2) + Math.min(...ys2)) / 2 / innerHeight;
    return f;
  };
  // ---------- live page only: drag to orbit, wheel to zoom, a button that opens the object ----------
  const live = {explode: 0, target: 0};
  if (!capture) {
    let drag = null;
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, cam.az, cam.el]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      cam.az = drag[2] - (e.clientX - drag[0]) * 0.006;
      cam.el = Math.min(1.45, Math.max(0.08, drag[3] + (e.clientY - drag[1]) * 0.005));
    });
    addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.fov = Math.min(12, Math.max(1.2, cam.fov * (1 + Math.sign(e.deltaY) * 0.08))); }, {passive: false});
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:18px;display:flex;gap:8px;justify-content:center;font:600 13px Inter,system-ui,sans-serif;z-index:5';
    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'border:1px solid rgba(255,255,255,.18);background:rgba(20,18,16,.8);color:#f2ece4;border-radius:999px;padding:9px 16px;font:inherit;cursor:pointer;backdrop-filter:blur(8px)';
      b.onclick = () => fn(b);
      bar.appendChild(b);
    };
    mk('Take apart', (b) => { live.target = live.target ? 0 : 1; b.textContent = live.target ? 'Reassemble' : 'Take apart'; });
    mk('Reference view', () => (cam = {...TL.cam}));
    document.body.appendChild(bar);
  }
  window.__TOOLS = {fit, frameIt, landmarks: () => projectAll(cam), setCam: (c) => (cam = {...cam, ...c}), getCam: () => cam, dev, live};

  return {
    resize,
    render(t) {
      live.explode += (live.target - live.explode) * 0.08; // live page only; capture leaves both at 0 unless a tool sets them
      dev.pose({...stateAt(t), explode: capture ? live.target : live.explode});
      st.frame(cam);
      return {};
    },
  };
});
