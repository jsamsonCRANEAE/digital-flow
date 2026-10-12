// ---------------------------------------------------------------------------
// Core: math, RNG, colors, the 5x7 pixel font, and canvas helpers.
// Everything draws onto a 640x296 canvas that is upscaled with nearest
// neighbour, exactly like the iOS build.
// ---------------------------------------------------------------------------
const W = 640, H = 296;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const len = (x, y) => Math.hypot(x, y);
const TAU = Math.PI * 2;

// Deterministic RNG (mulberry32) so CPU behavior is reproducible per seed.
function RNG(seed) {
  let s = seed >>> 0;
  const f = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.int = (n) => Math.floor(f() * n);
  f.range = (a, b) => a + f() * (b - a);
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}
let rng = RNG(Date.now() & 0xffffffff);

// Colors as [r,g,b]; css() for canvas fills; shade() is pixel-art hue shift:
// shadows go darker and toward purple, highlights lighter and toward yellow.
function hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function css(c, a) { return a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`; }
function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
function shade(c, k) {
  if (k >= 0) return mix(c, [255, 246, 200], k * 0.55);
  return mix(c, [40, 20, 70], -k * 0.6);
}
const PAL = {
  ink: hex('#0E0B1C'), outline: hex('#16102A'), panel: hex('#1A1838'), edge: hex('#3A3F6E'),
  white: [255, 255, 255], soft: hex('#9AD8FF'), gold: hex('#FFE45C'), red: hex('#FF5A3C'),
  green: hex('#7CFF6B'), dim: hex('#7A7FA8'), violet: hex('#C23BFF'), letterbox: hex('#0E1426'),
  turfA: hex('#3DBA41'), turfB: hex('#2E9E38'), turfSide: hex('#27863A'), haze: hex('#86CF8C'),
  line: hex('#F6F4E8'), dirt: hex('#D3A062'), sky1: hex('#4FA8F0'), sky2: hex('#9AD8FF'),
};

// --- Canvas helpers ----------------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false; c.x = x; return c;
}
function rect(ctx, x, y, w, h, c) { ctx.fillStyle = typeof c === 'string' ? c : css(c); ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
// Adds a 1px outline around opaque pixels (the standard pixel-art silhouette).
function outline(cv, col) {
  const w = cv.width, h = cv.height, id = cv.x.getImageData(0, 0, w, h), d = id.data;
  const src = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) src[i] = d[i * 4 + 3] > 0 ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (src[i]) continue;
    if ((x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) {
      d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
    }
  }
  cv.x.putImageData(id, 0, 0); return cv;
}
function ellipse(ctx, cx, cy, rx, ry, c) {
  ctx.fillStyle = css(c);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry; if (Math.abs(dy) > 1) continue;
    const hw = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
    if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 1);
  }
}

// --- 5x7 pixel font (same glyphs as the iOS build) ---------------------------
const FONT = __FONT__;
const fontCache = new Map();
function glyphSheet(c) {
  const key = c.join(',');
  let s = fontCache.get(key); if (s) return s;
  const keys = Object.keys(FONT);
  s = makeCanvas(keys.length * 6, 7); s.map = {};
  s.x.fillStyle = css(c);
  keys.forEach((k, i) => { s.map[k] = i; const g = FONT[k];
    for (let r = 0; r < 7; r++) for (let col = 0; col < 5; col++) if ((g[r] >> (4 - col)) & 1) s.x.fillRect(i * 6 + col, r, 1, 1); });
  fontCache.set(key, s); return s;
}
const textW = (t) => (t.length ? t.length * 6 - 1 : 0);
function text(ctx, t, x, y, c = PAL.white, shadow = PAL.ink, k = 1) {
  t = String(t).toUpperCase();
  const draw = (col, ox, oy) => { const s = glyphSheet(col);
    for (let i = 0; i < t.length; i++) { const gi = s.map[t[i]] ?? s.map['?'];
      if (t[i] !== ' ') ctx.drawImage(s, gi * 6, 0, 5, 7, (x | 0) + i * 6 * k + ox, (y | 0) + oy, 5 * k, 7 * k); } };
  if (shadow) draw(shadow, k, k);
  draw(c, 0, 0);
}
function textC(ctx, t, cx, y, c, shadow, k = 1) { text(ctx, t, cx - (textW(String(t)) * k) / 2, y, c, shadow, k); }
function wrap(t, width) {
  const out = []; let cur = '';
  for (const w of String(t).split(' ')) { const cand = cur ? cur + ' ' + w : w;
    if (textW(cand) > width && cur) { out.push(cur); cur = w; } else cur = cand; }
  if (cur) out.push(cur); return out;
}

// Chrome / rainbow / fire block-letter callouts at integer scales.
const calloutCache = new Map();
const BANDS = {
  chrome: ['#FFFFFF', '#D8F4FF', '#9AD8FF', '#4FA8F0', '#1E4AA8', '#14206A', '#F6C040', '#FFE45C', '#FFF6C0'],
  rainbow: ['#FF4D6D', '#FF9A3C', '#FFE45C', '#7CFF6B', '#3FD8FF', '#6B7CFF', '#C86BFF'],
  fire: ['#FFF6C0', '#FFE45C', '#FFB238', '#FF7A2E', '#E0402A', '#9A1E3A'],
};
function callout(t, k, style = 'chrome') {
  const key = t + '|' + k + '|' + style;
  let c = calloutCache.get(key); if (c) return c;
  t = t.toUpperCase();
  const pad = 3, w = textW(t) * k + pad * 2, h = 7 * k + pad * 2;
  const b = makeCanvas(w, h); const s = glyphSheet([255, 255, 255]);
  for (let i = 0; i < t.length; i++) { if (t[i] === ' ') continue; const gi = s.map[t[i]] ?? s.map['?'];
    b.x.drawImage(s, gi * 6, 0, 5, 7, pad + i * 6 * k, pad, 5 * k, 7 * k); }
  // vertical gradient bands
  // Paint the bands on their own canvas, then keep them only where letters are
  // (one source-in draw; per-row source-in fills would erase the other rows).
  const bands = BANDS[style], grad = makeCanvas(w, h);
  for (let y = 0; y < h; y++) { const tt = clamp((y - pad) / (7 * k), 0, 0.999);
    grad.x.fillStyle = bands[Math.floor(tt * bands.length)]; grad.x.fillRect(0, y, w, 1); }
  b.x.globalCompositeOperation = 'source-in'; b.x.drawImage(grad, 0, 0);
  b.x.globalCompositeOperation = 'source-over';
  c = makeCanvas(w + 6, h + 6);
  c.x.globalAlpha = 1; c.x.drawImage(b, 3, 3);
  // drop shadow
  const sh = makeCanvas(w, h); sh.x.drawImage(b, 0, 0); sh.x.globalCompositeOperation = 'source-in'; sh.x.fillStyle = '#0A0814'; sh.x.fillRect(0, 0, w, h);
  c.x.globalCompositeOperation = 'destination-over'; c.x.drawImage(sh, 5, 5); c.x.globalCompositeOperation = 'source-over';
  outline(c, PAL.outline); outline(c, hex('#2A1E4A'));
  calloutCache.set(key, c); return c;
}

// Beveled pixel button.
function button(ctx, label, x, y, w, h, opts = {}) {
  const face = opts.disabled ? hex('#24233A') : opts.primary ? (opts.accent || hex('#3FA7FF')) : opts.danger ? hex('#A8323C') : hex('#2C2F5E');
  const dy = opts.pressed ? 1 : 0;
  rect(ctx, x, y + 2, w, h, PAL.ink);
  rect(ctx, x, y + dy, w, h, PAL.outline);
  rect(ctx, x + 1, y + dy + 1, w - 2, h - 2, shade(face, -0.5));
  rect(ctx, x + 1, y + dy + 1, w - 3, h - 4, face);
  rect(ctx, x + 2, y + dy + 1, w - 4, 1, shade(face, 0.6));
  if (opts.focus) { ctx.strokeStyle = css(PAL.gold); ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5 + dy, w + 3, h + 3); }
  textC(ctx, label, x + w / 2, y + dy + ((h - 7) >> 1), opts.disabled ? PAL.dim : PAL.white, PAL.ink);
}
function panel(ctx, x, y, w, h, accent = PAL.edge, fill = PAL.panel) {
  rect(ctx, x, y, w, h, PAL.outline); rect(ctx, x + 1, y + 1, w - 2, h - 2, accent);
  rect(ctx, x + 2, y + 2, w - 4, h - 4, fill); rect(ctx, x + 2, y + 2, w - 4, 1, shade(fill, 0.4));
}
function coinIcon(ctx, x, y) {
  ellipse(ctx, x + 4.5, y + 4.5, 4.5, 4.5, PAL.outline); ellipse(ctx, x + 4.5, y + 4.5, 3.6, 3.6, hex('#FFC83C'));
  rect(ctx, x + 4, y + 2, 1, 5, hex('#B9832A')); rect(ctx, x + 2, y + 2, 1, 1, hex('#FFF6C0'));
}
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
