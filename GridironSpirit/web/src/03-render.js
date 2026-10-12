// ---------------------------------------------------------------------------
// Rendering: pseudo-3D "Mode 7" field rasterizer, stadium backdrop and
// procedural player sprites. Camera values match GSRenderCore.CameraConfig.
// World: x 0..53.33 across, y 0..120 (end zones 0-10 and 110-120); the
// offense always drives toward +y and the camera sits behind it.
// ---------------------------------------------------------------------------
const CAM = { focal: 317, horizon: 96, height: 6, back: 16, cy: H / 2 };
CAM.pitch = Math.atan((CAM.cy - CAM.horizon) / CAM.focal);
CAM.c = Math.cos(CAM.pitch); CAM.s = Math.sin(CAM.pitch);
const FIELD_W = 53.33;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

class Camera {
  constructor() { this.x = 26.67; this.y = 20; this.z = CAM.height; this.shake = 0; this.sx = 0; this.sy = 0; }
  // Follow a focus point (ball or carrier), critically damped.
  follow(fx, fy, dt, zoom = 1) {
    const tx = clamp(fx, 14, FIELD_W - 14), ty = fy - CAM.back * zoom;
    const k = 1 - Math.exp(-dt / 0.22);
    this.x += (tx - this.x) * k; this.y += (ty - this.y) * k;
    this.z += (CAM.height * zoom - this.z) * (1 - Math.exp(-dt / 0.35));
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt); const a = this.shake * 14; this.sx = (Math.random() * 2 - 1) * a; this.sy = (Math.random() * 2 - 1) * a; }
    else this.sx = this.sy = 0;
  }
  snap(fx, fy) { this.x = clamp(fx, 14, FIELD_W - 14); this.y = fy - CAM.back; this.z = CAM.height; }
  // World point -> {x, y, scale} in canvas pixels (null if behind the camera).
  project(wx, wy, wz = 0) {
    const dx = wx - this.x, dy = wy - this.y, dz = wz - this.z;
    const Z = dy * CAM.c - dz * CAM.s, Y = dy * CAM.s + dz * CAM.c;
    if (Z < 0.8) return null;
    const k = CAM.focal / Z;
    return { x: W / 2 + dx * k + this.sx, y: CAM.cy - Y * k + this.sy, k, Z };
  }
}

// --- Field ---------------------------------------------------------------
class FieldRenderer {
  constructor() { this.img = new ImageData(W, H); this.buf = new Uint32Array(this.img.data.buffer); this.backdrops = null; }
  static pack(c) { return (255 << 24) | ((c[2] & 255) << 16) | ((c[1] & 255) << 8) | (c[0] & 255); }
  setTeams(near, far) {
    this.near = near; this.far = far;
    const P = FieldRenderer.pack;
    this.cols = { a: P(PAL.turfA), b: P(PAL.turfB), side: P(PAL.turfSide), line: P(PAL.line), dirt: P(PAL.dirt), dirtD: P(shade(PAL.dirt, -0.25)),
      nearA: P(near), nearB: P(shade(near, -0.3)), farA: P(far), farB: P(shade(far, -0.3)), los: P(hex('#3FA7FF')), ltg: P(hex('#FFE45C')),
      haze: PAL.haze };
  }
  buildBackdrops(home, away) {
    // Two crowd frames, 800 px wide for parallax.
    const bw = 800, hz = CAM.horizon;
    this.backdrops = [0, 1].map((frame) => {
      const c = makeCanvas(bw, hz + 2), x = c.x;
      for (let y = 0; y < 26; y++) { rect(x, 0, y, bw, 1, mix(PAL.sky1, PAL.sky2, y / 26)); }
      const r = RNG(77 + frame * 0);
      // stands: three tiers of crowd pixels
      const crowd = ['#FF4D4D', '#FFD23F', '#3FA7FF', '#FFFFFF', '#7CFF6B', '#FF7AE0', '#F6CDA8', '#8C5634', '#2A2850'].map(hex);
      for (let y = 22; y < hz - 14; y++) for (let xx = 0; xx < bw; xx += 2) {
        const tier = y < 44 ? 0 : 1; const base = tier ? hex('#2A2850') : hex('#33305C');
        const rr = RNG(y * 1000 + xx); const v = rr();
        let col = v < 0.62 ? crowd[(rr() * crowd.length) | 0] : base;
        if (y % 6 === 5) col = shade(base, -0.4);
        const bob = frame && ((xx >> 3) + y) % 3 === 0 ? -1 : 0;
        rect(x, xx, y + bob, 2, 1, mix(col, base, tier ? 0.25 : 0.1));
      }
      rect(x, 0, 43, bw, 2, hex('#1F2A4A'));
      // scoreboard (decorative; live score is in the HUD)
      panel(x, bw / 2 - 60, 2, 120, 26, hex('#2A2850'), hex('#0B0A1E'));
      textC(x, 'GRIDIRON', bw / 2, 7, hex('#FFB238'), null); textC(x, 'SPIRIT', bw / 2, 16, hex('#3FD8FF'), null);
      // ad boards
      const ads = ['BLITZO GUM', 'KAIJUMOTO', 'HYPERNOVA TV', 'GOGO CURRY', 'PIXELPOP', 'TORII BANK', 'ZUNKO COLA', 'RAMEN ROCKET'];
      const adCols = ['#1A1838', '#E83E9C', '#18A8A0', '#FFF6E0', '#D8452B', '#1A1838', '#E83E9C', '#18A8A0'].map(hex);
      let ax = 0; let i = 0;
      while (ax < bw) { const t = ads[i % ads.length], w = textW(t) + 14, bg = adCols[i % adCols.length];
        rect(x, ax, hz - 13, w, 10, bg); rect(x, ax, hz - 13, 1, 10, PAL.ink);
        text(x, t, ax + 7, hz - 11, bg[0] > 200 && bg[1] > 200 ? hex('#D8452B') : hex('#FFE45C'), null); ax += w; i++; }
      rect(x, 0, hz - 3, bw, 5, hex('#1F2A4A')); rect(x, 0, hz - 3, bw, 1, hex('#6C7FB0'));
      // floodlights
      for (const lx of [60, 260, 540, 740]) { rect(x, lx - 10, 3, 20, 5, hex('#FFF6C0')); rect(x, lx - 1, 8, 2, 14, hex('#2A2850')); }
      return c;
    });
  }
  // los / ltg: world y of line of scrimmage and line to gain (null hides).
  render(ctx, cam, crowdFrame, los, ltg) {
    const buf = this.buf, C = this.cols, hz = CAM.horizon;
    const c = CAM.c, s = CAM.s, f = CAM.focal;
    const rowInfo = (row) => { const v = CAM.cy - (row + 0.5 - cam.sy); const dirY = f * c + v * s, dirZ = -f * s + v * c;
      if (dirZ > -1e-6) return null; const t = -cam.z / dirZ; return { wy: cam.y + t * dirY, t }; };
    let prev = rowInfo(hz);
    for (let row = hz + 1; row < H; row++) {
      const ri = rowInfo(row); if (!ri || !prev) { prev = ri; continue; }
      const wy = ri.wy, t = ri.t, yFar = prev.wy, span = Math.max(1e-3, yFar - wy);
      const dist = wy - cam.y;
      const fog = clamp((dist - 30) / 90, 0, 0.55);
      // Row-level features: stripes and lines (every line covers >= 1 row: no shimmer).
      const band = Math.floor((wy - 10) / 5);
      let rowCol = (band & 1) ? C.b : C.a;
      let inEnd = 0; if (wy < 10) inEnd = 1; else if (wy > 110) inEnd = 2;
      let lineHere = false;
      for (let ly = 10; ly <= 110; ly += 5) if (ly >= wy - 0.09 && ly <= yFar + 0.09) { lineHere = true; break; }
      if (wy < 0 || wy > 120) { rowCol = C.side; inEnd = 0; }
      const isLos = los != null && los >= wy - 0.12 && los <= yFar + 0.12;
      const isLtg = ltg != null && ltg >= wy - 0.12 && ltg <= yFar + 0.12 && ltg < 110;
      const hashRow = !lineHere && Math.abs(wy - Math.round(wy)) < Math.max(0.12, span * 0.6) && wy > 10 && wy < 110;
      const x0 = cam.x + t * (0.5 - W / 2 - cam.sx), base = row * W;
      const fogDither = fog > 0;
      for (let px = 0; px < W; px++) {
        const wx = x0 + t * px;
        let col;
        if (wx < -1.4 || wx > FIELD_W + 1.4 || wy < -1.4 || wy > 121.4) {
          col = (wx < -7 || wx > FIELD_W + 7 || wy < -6 || wy > 126) ? (((px >> 2) + row) & 1 ? C.dirt : C.dirtD) : C.side;
        } else if (wx < 0 || wx > FIELD_W || wy < 0 || wy > 120) col = C.line;               // boundary border
        else if (inEnd) {
          const st = (Math.floor((wx + wy) / 2.2) & 1);
          col = inEnd === 1 ? (st ? C.nearA : C.nearB) : (st ? C.farA : C.farB);
          if (lineHere) col = C.line;
        } else {
          col = rowCol;
          if (lineHere) col = C.line;
          else if (hashRow && ((wx > 22.9 && wx < 23.7) || (wx > 29.6 && wx < 30.4) || wx < 0.9 || wx > FIELD_W - 0.9)) col = C.line;
          if (isLos) col = C.los; else if (isLtg) col = C.ltg;
        }
        if (fogDither && BAYER[((row & 3) << 2) | (px & 3)] / 16 < fog) {
          const r = col & 255, g = (col >> 8) & 255, b = (col >> 16) & 255;
          col = (255 << 24) | (((b + C.haze[2]) >> 1) << 16) | (((g + C.haze[1]) >> 1) << 8) | ((r + C.haze[0]) >> 1);
        }
        buf[base + px] = col;
      }
      prev = ri;
    }
    ctx.putImageData(this.img, 0, 0, 0, hz, W, H - hz);
    // Backdrop with slight parallax.
    const bd = this.backdrops[crowdFrame & 1];
    const ox = clamp(-80 - (cam.x - 26.67) * 3, -160, 0) | 0;
    ctx.drawImage(bd, ox, (cam.sy | 0) + 1 - 2);
  }
}

// --- Player sprites --------------------------------------------------------
const SKIN = ['#F6CDA8', '#E2A877', '#C07D4E', '#8C5634', '#5E3A22'].map(hex);
const spriteCache = new Map();
// look: {jersey, trim, pants, helmet, style}; pose: idle|run0..3|throw|stance|down|dive
function playerSprite(look, h, view, pose, number, skin, big, aura) {
  h = clamp(h & ~1, 10, 96);
  const key = `${look.id}|${h}|${view}|${pose}|${h >= 30 ? number : -1}|${skin}|${big ? 1 : 0}|${aura || ''}`;
  let c = spriteCache.get(key); if (c) return c;
  const lying = pose === 'down' || pose === 'dive';
  const w = Math.max(6, Math.round(h * (big ? 0.66 : 0.56)));
  const cw = lying ? h + 4 : w + 6, ch = lying ? Math.round(w * 0.8) + 4 : h + 3;
  c = makeCanvas(cw, ch); const x = c.x;
  const J = look.jersey, T = look.trim, P = look.pants, Hm = look.helmet, S = SKIN[skin % SKIN.length];
  if (lying) {
    // Horizontal body: helmet at the right for a dive, left when down.
    const bh = Math.round(w * 0.55), y0 = ch - bh - 2, hr = Math.max(2, bh * 0.55);
    const dir = pose === 'dive' ? 1 : -1, cx = cw / 2;
    rect(x, cx - h * 0.35, y0, h * 0.4, bh, J);                // torso
    rect(x, cx - h * 0.35, y0, h * 0.4, Math.max(1, bh * 0.2), T);
    rect(x, cx - h * 0.35 - h * 0.25 * dir * (dir < 0 ? -1 : 1) * 0, y0 + bh * 0.2, h * 0.02, 1, J);
    rect(x, dir > 0 ? cx - h * 0.62 : cx + 0.05 * h, y0 + bh * 0.15, h * 0.3, bh * 0.7, P);   // legs/pants
    ellipse(x, dir > 0 ? cx + h * 0.15 : cx - h * 0.42, y0 + bh / 2, hr, hr, Hm);
    outline(c, PAL.outline); spriteCache.set(key, c); return c;
  }
  const cx = cw / 2, top = 1;
  const u = h / 30; // unit: 1 at 30 px tall
  const helmR = Math.max(2, 3.3 * u), headY = top + helmR;
  const shoulderW = w * (big ? 1.0 : 0.94), waistW = w * 0.62;
  const torsoTop = top + helmR * 1.7, torsoBot = top + h * 0.56, pantsBot = top + h * 0.74;
  const crouch = pose === 'stance' ? h * 0.08 : 0;
  // legs (run cycle)
  const phase = pose.startsWith('run') ? +pose[3] : -1;
  const legW = Math.max(2, waistW * 0.36), legTop = pantsBot - 1 - crouch, legLen = top + h - legTop - 1;
  const legs = [[-1, 0], [1, 0]];
  if (phase >= 0) { const lift = [[0.3, 0], [0, 0.25], [0, 0.3], [0.25, 0]][phase]; legs[0][1] = lift[0]; legs[1][1] = lift[1]; }
  for (const [side, lift] of legs) {
    const lx = cx + side * waistW * 0.26 - legW / 2, ll = legLen * (1 - lift);
    rect(x, lx, legTop, legW, ll * 0.45, P);
    rect(x, lx, legTop + ll * 0.45, legW, ll * 0.55, shade(J, -0.2).map((v, i) => [230, 230, 236][i] * 0.6 + v * 0.4)); // socks
    rect(x, lx - (view === 'front' ? 0 : 0), legTop + ll - Math.max(1, u * 1.2), legW + 1, Math.max(1, u * 1.2), hex('#1A1420'));
  }
  // pants
  rect(x, cx - waistW / 2, torsoBot - crouch, waistW, pantsBot - torsoBot, P);
  rect(x, cx - waistW / 2, pantsBot - crouch - 1, waistW, 1, shade(P, -0.4));
  // torso: shoulder pads tapering to waist
  for (let y = torsoTop + crouch; y < torsoBot - crouch * 0.2; y++) {
    const tt = (y - torsoTop - crouch) / Math.max(1, torsoBot - torsoTop);
    const ww = tt < 0.3 ? shoulderW : lerp(shoulderW, waistW, (tt - 0.3) / 0.7);
    rect(x, cx - ww / 2, y, ww, 1, J);
  }
  rect(x, cx - shoulderW / 2, torsoTop + crouch, shoulderW, Math.max(1, u * 1.4), T);       // pad trim
  rect(x, cx - shoulderW / 2, torsoTop + crouch, Math.max(1, u), torsoBot - torsoTop, shade(J, 0.3));
  rect(x, cx + shoulderW / 2 - Math.max(1, u), torsoTop + crouch, Math.max(1, u), torsoBot - torsoTop, shade(J, -0.35));
  // arms
  const armW = Math.max(1, u * 1.8), armL = h * 0.27;
  const swing = phase >= 0 ? [1, 0, -1, 0][phase] * u * 2 : 0;
  const ay = torsoTop + crouch + u;
  if (pose === 'throw') {
    rect(x, cx + shoulderW / 2 - armW, ay - armL * 0.8, armW, armL, S);
    rect(x, cx - shoulderW / 2 - armW + 1, ay + u, armW, armL * 0.8, S);
  } else {
    rect(x, cx - shoulderW / 2 - armW + 1, ay + swing, armW, armL, J); rect(x, cx - shoulderW / 2 - armW + 1, ay + swing + armL * 0.55, armW, armL * 0.45, S);
    rect(x, cx + shoulderW / 2 - 1, ay - swing, armW, armL, J); rect(x, cx + shoulderW / 2 - 1, ay - swing + armL * 0.55, armW, armL * 0.45, S);
  }
  // number
  if (h >= 30 && number != null) {
    const k = h >= 60 ? 2 : 1, ns = String(number), nw = textW(ns) * k;
    text(x, ns, cx - nw / 2, torsoTop + crouch + (torsoBot - torsoTop) * 0.32, T, null, k);
  }
  // helmet
  ellipse(x, cx, headY + crouch, helmR * 1.05, helmR, Hm);
  rect(x, cx - helmR * 1.05, headY + crouch + helmR * 0.3, helmR * 2.1, Math.max(1, helmR * 0.5), Hm);
  if (look.style === 0) rect(x, cx - Math.max(1, u * 0.6), headY + crouch - helmR, Math.max(1, u * 1.2), helmR * 1.2, hex('#F6C040'));     // gold crest
  if (look.style === 1) { rect(x, cx - 1, headY + crouch - helmR + 1, Math.max(1, u), helmR, T); }
  if (look.style === 2) { rect(x, cx - helmR * 0.5, headY + crouch - helmR, Math.max(1, u), helmR, T); rect(x, cx + helmR * 0.5 - 1, headY + crouch - helmR, Math.max(1, u), helmR, T); }
  if (view === 'front') {
    rect(x, cx - helmR * 0.7, headY + crouch - helmR * 0.05, helmR * 1.4, helmR * 0.55, S);              // face
    rect(x, cx - helmR * 0.7, headY + crouch + helmR * 0.25, helmR * 1.4, Math.max(1, u * 0.7), hex('#C8CCD8')); // facemask
    if (h >= 36) { rect(x, cx - helmR * 0.4, headY + crouch, Math.max(1, u * 0.7), Math.max(1, u * 0.7), PAL.ink); rect(x, cx + helmR * 0.25, headY + crouch, Math.max(1, u * 0.7), Math.max(1, u * 0.7), PAL.ink); }
  } else rect(x, cx - helmR * 0.5, headY + crouch - helmR * 0.4, Math.max(1, helmR * 0.35), Math.max(1, helmR * 0.35), shade(Hm, 0.5));
  outline(c, PAL.outline);
  if (aura) { // dithered Spirit aura ring
    const a = makeCanvas(cw + 4, ch + 4); a.x.drawImage(c, 2, 2);
    const id = a.x.getImageData(0, 0, a.width, a.height), d = id.data, ac = hex(aura);
    for (let y = 0; y < a.height; y++) for (let xx = 0; xx < a.width; xx++) { const i = (y * a.width + xx) * 4; if (d[i + 3]) continue;
      let near = false; for (let oy = -2; oy <= 2 && !near; oy++) for (let ox = -2; ox <= 2; ox++) { const yy = y + oy, x2 = xx + ox;
        if (yy >= 0 && x2 >= 0 && yy < a.height && x2 < a.width && d[(yy * a.width + x2) * 4 + 3] && Math.abs(ox) + Math.abs(oy) <= 3) { near = true; break; } }
      if (near && ((xx + y) & 1)) { d[i] = ac[0]; d[i + 1] = ac[1]; d[i + 2] = ac[2]; d[i + 3] = 255; } }
    a.x.putImageData(id, 0, 0); c = a;
  }
  spriteCache.set(key, c); return c;
}

function ballSprite(len, ang) {
  const key = len + '|' + ang; let c = spriteCache.get('ball' + key); if (c) return c;
  const s = len + 4; c = makeCanvas(s, s);
  c.x.translate(s / 2, s / 2); c.x.rotate(ang);
  ellipse(c.x, 0, 0, len / 2, Math.max(1.2, len / 3.4), hex('#8A4A24'));
  if (len >= 5) c.x.fillStyle = '#FFFFFF', c.x.fillRect(-1, -0.5, 2, 1);
  c.x.setTransform(1, 0, 0, 1, 0, 0); outline(c, PAL.outline);
  spriteCache.set('ball' + key, c); return c;
}

function starburst(ctx, x, y, r, frame) {
  const n = 10, ins = r * 0.45;
  ctx.fillStyle = frame < 2 ? '#FFFFFF' : '#FFE45C';
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * TAU + frame * 0.3, rr = i & 1 ? ins : r * (0.8 + ((i * 7) % 3) * 0.12);
    ctx.lineTo(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr)); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#FF7A2E'; ctx.beginPath(); ctx.arc(x, y, ins * 0.6, 0, TAU); ctx.fill();
}
