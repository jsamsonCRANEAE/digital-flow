// Dynamic co-op framing, trauma-based directional screen shake, zoom punch and hit-stop.
import { clamp, damp, noise1 } from './Util.js';

export class Camera {
  constructor(viewW, viewH) {
    this.w = viewW;
    this.h = viewH;
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.minZoom = 0.6;
    this.maxZoom = 1.2;
    this.bounds = null;
    this.trauma = 0;
    this.dirX = 0;
    this.dirY = 0;
    this.dirWeight = 0;
    this.offX = 0;
    this.offY = 0;
    this.rot = 0;
    this.punchZoom = 0;
    this.hitStopT = 0;
    this.hudBias = 46; // screen px: frame action above the bottom HUD console
    this.t = 0;
  }

  setBounds(x0, y0, x1, y1) { this.bounds = { x0, y0, x1, y1 }; }

  snap(x, y, zoom = this.zoom) {
    this.x = x; this.y = y; this.zoom = zoom;
    this.clampToBounds();
  }

  /**
   * Frame weighted targets. Each target: {x, y, weight, pad}. Zoom pulls out to keep
   * both players visible, but if they split too far the primary (first) target wins.
   */
  frame(targets, dt) {
    if (!targets.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let cx = 0, cy = 0, wsum = 0;
    for (const t of targets) {
      const w = t.weight ?? 1;
      cx += t.x * w; cy += t.y * w; wsum += w;
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
    }
    cx /= wsum; cy /= wsum;
    cy += this.hudBias / Math.max(this.zoom, 0.01);
    const spanX = maxX - minX + 480;
    const spanY = maxY - minY + 420;
    let z = Math.min(this.w / spanX, this.h / spanY);
    z = clamp(z, this.minZoom, this.maxZoom);
    // If even the widest zoom can't fit both, bias hard toward the primary target.
    if (z <= this.minZoom + 1e-3 && targets.length > 1) {
      const p = targets[0];
      const fitX = (this.w / this.minZoom) * 0.5 - 140;
      const fitY = (this.h / this.minZoom) * 0.5 - 110;
      cx = clamp(cx, p.x - fitX, p.x + fitX);
      cy = clamp(cy, p.y - fitY, p.y + fitY);
    }
    const k = damp(5, dt);
    this.x += (cx - this.x) * k;
    this.y += (cy - this.y) * k;
    this.zoom += (z - this.zoom) * damp(2.2, dt);
    this.clampToBounds();
  }

  clampToBounds() {
    if (!this.bounds) return;
    const b = this.bounds;
    const hw = this.w / (2 * this.zoom), hh = this.h / (2 * this.zoom);
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    this.x = bw < hw * 2 ? (b.x0 + b.x1) / 2 : clamp(this.x, b.x0 + hw, b.x1 - hw);
    this.y = bh < hh * 2 ? (b.y0 + b.y1) / 2 : clamp(this.y, b.y0 + hh, b.y1 - hh);
  }

  /** Trauma is squared for falloff; an optional direction biases the kick. */
  addTrauma(amount, dirX = 0, dirY = 0) {
    this.trauma = Math.min(1, this.trauma + amount);
    const l = Math.hypot(dirX, dirY);
    if (l > 0) {
      this.dirX = dirX / l;
      this.dirY = dirY / l;
      this.dirWeight = 1;
    }
  }

  punch(amount) { this.punchZoom = Math.max(this.punchZoom, amount); }

  hitStop(ms) { this.hitStopT = Math.max(this.hitStopT, ms / 1000); }

  /** Real-time update (runs even during hit-stop so shake keeps breathing). */
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.35);
    const s = this.trauma * this.trauma;
    const max = 24;
    const n1 = noise1(this.t * 31, 11) * 2 - 1;
    const n2 = noise1(this.t * 29, 23) * 2 - 1;
    const n3 = noise1(this.t * 17, 37) * 2 - 1;
    this.dirWeight *= Math.exp(-dt * 9);
    // Directional kick: a damped spring-like oscillation along the impact vector.
    const kick = Math.cos(this.t * 60) * this.dirWeight;
    this.offX = max * s * n1 + this.dirX * kick * 14 * (0.3 + s);
    this.offY = max * s * n2 + this.dirY * kick * 14 * (0.3 + s);
    this.rot = 0.035 * s * n3;
    this.punchZoom *= Math.exp(-dt * 8);
  }

  get effZoom() { return this.zoom * (1 + this.punchZoom); }

  /** base scales the whole transform (e.g. 0.5 for a half-resolution light buffer). */
  apply(ctx, base = 1) {
    const z = this.effZoom;
    ctx.setTransform(base, 0, 0, base, 0, 0);
    ctx.translate(this.w / 2 + this.offX, this.h / 2 + this.offY);
    ctx.rotate(this.rot);
    ctx.scale(z, z);
    ctx.translate(-this.x, -this.y);
  }

  worldToScreen(wx, wy) {
    const z = this.effZoom;
    return { x: (wx - this.x) * z + this.w / 2 + this.offX, y: (wy - this.y) * z + this.h / 2 + this.offY };
  }

  visibleRect(pad = 64) {
    const z = this.effZoom;
    const hw = this.w / (2 * z) + pad, hh = this.h / (2 * z) + pad;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }
}
