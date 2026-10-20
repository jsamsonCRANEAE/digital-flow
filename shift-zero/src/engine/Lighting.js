// Darkness compositing: raycast flashlight cone, shadow-casting tungsten bulbs that flicker,
// soft personal lights and coloured tints. Everything lands in one half-resolution buffer
// (cut with destination-out, tinted with source-over) composited once per frame. Static bulb
// light shapes are pre-baked into sprites so a frame is mostly cheap alpha blits.
import { TILE, noise1, clamp } from './Util.js';

/** Amanatides–Woo grid traversal; returns distance to the first opaque tile. */
export function castRay(world, ox, oy, angle, maxDist) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
  let tMaxX = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
  let tMaxY = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
  let t = 0;
  for (let guard = 0; guard < 256; guard++) {
    if (tMaxX < tMaxY) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
    else { t = tMaxY; tMaxY += tDeltaY; ty += stepY; }
    if (t >= maxDist) return maxDist;
    if (world.isOpaque(tx, ty)) return Math.min(maxDist, t + 3);
  }
  return maxDist;
}

export function castFan(world, x, y, a0, a1, range, rays) {
  const pts = [x, y];
  for (let i = 0; i <= rays; i++) {
    const a = a0 + (a1 - a0) * (i / rays);
    const d = castRay(world, x, y, a, range);
    pts.push(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  return pts;
}

function tracePoly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

/** Radial falloff used for every light cut (alpha channel is what matters). */
function falloff(ctx, x, y, r, rgb = '0,0,0', a = 1) {
  const g = ctx.createRadialGradient(x, y, r * 0.05, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.55, `rgba(${rgb},${a * 0.6})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  return g;
}

export class Lighting {
  /** The darkness buffer renders at `scale` resolution and is upscaled with smoothing. */
  constructor(w, h, scale = 0.5) {
    this.w = w; this.h = h;
    this.scale = scale;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * scale); this.canvas.height = Math.round(h * scale);
    this.ctx = this.canvas.getContext('2d');
    this.radial = this.makeRadial('255,255,255', 1);
    this.tints = new Map();
  }

  makeRadial(rgb, a) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = falloff(g, 32, 32, 32, rgb, a);
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  /** Cached full-strength sprite per colour; per-light strength is applied via globalAlpha. */
  tintSprite(color) {
    let entry = this.tints.get(color);
    if (!entry) {
      const m = /rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)/.exec(color);
      if (!m) return null;
      const rgb = `${m[1].trim()},${m[2].trim()},${m[3].trim()}`;
      const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
      let sprite = this.tints.get(rgb);
      if (!sprite) { sprite = this.makeRadial(rgb, 1); this.tints.set(rgb, sprite); }
      entry = { sprite, alpha };
      if (this.tints.size < 512) this.tints.set(color, entry);
    }
    return entry;
  }

  /** Bake static shadow polygons + light/tint sprites for every bulb (walls don't move). */
  prepare(world) {
    const s = this.scale;
    for (const b of world.bulbs) {
      const pts = [];
      const rays = 56;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        const d = castRay(world, b.x, b.y, a, b.r);
        pts.push(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d);
      }
      b.poly = pts;
      const R = Math.ceil(b.r * s);
      const bake = (rgb, a, radius) => {
        const c = document.createElement('canvas');
        c.width = c.height = R * 2;
        const g = c.getContext('2d');
        g.setTransform(s, 0, 0, s, R - b.x * s, R - b.y * s);
        g.fillStyle = falloff(g, b.x, b.y, radius, rgb, a);
        tracePoly(g, pts);
        g.fill();
        return c;
      };
      b.cutSprite = bake('0,0,0', 1, b.r);
      b.tintSprite = bake('255,180,100', 0.16, b.r * 0.8);
    }
  }

  static bulbIntensity(b, t) {
    if (b.kind === 'steady') return 0.95 + 0.05 * noise1(t * 3 + b.seed, b.seed);
    if (b.kind === 'flicker') {
      const n = noise1(t * 14 + b.seed, b.seed);
      return n > 0.28 ? 0.85 + n * 0.15 : 0.15;
    }
    // Dying tungsten: long dark stretches, sputtering bursts.
    const slow = noise1(t * 0.6 + b.seed, b.seed + 3);
    const fast = noise1(t * 30 + b.seed, b.seed + 5);
    return slow > 0.55 ? (fast > 0.4 ? 0.8 : 0.1) : 0.05 * fast;
  }

  /** Gradient-filled polygon cut (used only for the per-frame flashlight fans). */
  cutPoly(ctx, pts, x, y, r, intensity) {
    if (intensity <= 0.01) return;
    ctx.fillStyle = falloff(ctx, x, y, r, '0,0,0', clamp(intensity, 0, 1));
    tracePoly(ctx, pts);
    ctx.fill();
  }

  blit(ctx, sprite, x, y, r, alpha) {
    if (alpha <= 0.01) return;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  }

  render(mainCtx, camera, world, t) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(2,4,8,${world.darkness})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = 'destination-out';
    camera.apply(ctx, this.scale);
    const view = camera.visibleRect(260);
    const lightScale = world.lightScale;
    const visible = (b) => b.x > view.x0 && b.x < view.x1 && b.y > view.y0 && b.y < view.y1;

    for (const b of world.bulbs) {
      b.current = visible(b) ? Lighting.bulbIntensity(b, t) * lightScale : 0;
      this.blit(ctx, b.cutSprite, b.x, b.y, b.r, b.current * 0.9);
    }
    const body = world.body;
    if (body) this.blit(ctx, this.radial, body.x, body.y, 78, 0.55);
    for (const L of world.dynLights) this.blit(ctx, this.radial, L.x, L.y, L.r, L.i);
    ctx.globalAlpha = 1;

    const fl = world.flashlight;
    if (fl && body && !body.downed) {
      const range = fl.range * lightScale;
      const wide = castFan(world, fl.x, fl.y, fl.angle - fl.spread, fl.angle + fl.spread, range, 64);
      this.cutPoly(ctx, wide, fl.x, fl.y, range, 0.85 * fl.power);
      const tight = castFan(world, fl.x, fl.y, fl.angle - fl.spread * 0.45, fl.angle + fl.spread * 0.45, range * 1.15, 32);
      this.cutPoly(ctx, tight, fl.x, fl.y, range * 1.15, 0.6 * fl.power);
      fl.poly = tight;
    }

    // Coloured tint into the same buffer: one full-screen composite per frame.
    ctx.globalCompositeOperation = 'source-over';
    for (const b of world.bulbs) this.blit(ctx, b.tintSprite, b.x, b.y, b.r, b.current);
    for (const L of world.dynLights) {
      if (!L.color) continue;
      const e = this.tintSprite(L.color);
      if (e) this.blit(ctx, e.sprite, L.x, L.y, L.r, e.alpha);
    }
    ctx.globalAlpha = 1;
    if (fl && fl.poly && body && !body.downed) {
      ctx.fillStyle = falloff(ctx, fl.x, fl.y, fl.range, '255,236,200', 0.1 * fl.power);
      tracePoly(ctx, fl.poly);
      ctx.fill();
    }

    mainCtx.save();
    mainCtx.setTransform(1, 0, 0, 1, 0, 0);
    mainCtx.imageSmoothingEnabled = true;
    mainCtx.drawImage(this.canvas, 0, 0, this.w, this.h);
    mainCtx.restore();
  }
}
