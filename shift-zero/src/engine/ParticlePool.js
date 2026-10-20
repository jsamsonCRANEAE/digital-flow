// Struct-of-arrays particle pool. Sparks live in pseudo-3D (z = height above the floor)
// so they arc, bounce off concrete, and can be mirrored into puddles.
import { TILE } from './Util.js';

export const PT = { SPARK: 0, VOXEL: 1, SMOKE: 2, EMBER: 3, DROP: 4, DEBRIS: 5, GLYPH: 6 };

const GRAVITY = 980;

// Palette indices. Each entry: [r, g, b].
export const PC = {
  AMBER: 0, CYAN: 1, ROT: 2, WHITE: 3, SMOKE: 4, WATER: 5, BRASS: 6, RED: 7, GREEN: 8,
};
const PALETTE = [
  [255, 176, 64], [80, 240, 255], [214, 60, 200], [255, 255, 240], [70, 72, 78],
  [120, 170, 200], [210, 170, 80], [255, 70, 50], [120, 255, 140],
];
// Pre-built style strings; per-particle fade goes through globalAlpha (no string churn).
const SOLID = PALETTE.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`);
const SPARK_HOT = PALETTE.map((c) => `rgb(${(c[0] + 255) >> 1},${(c[1] + 255) >> 1},${(c[2] + 255) >> 1})`);

export class ParticlePool {
  constructor(max = 3500) {
    this.max = max;
    this.count = 0;
    this.x = new Float32Array(max); this.y = new Float32Array(max); this.z = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.type = new Uint8Array(max); this.color = new Uint8Array(max);
    this.bounces = new Uint8Array(max);
  }

  clear() { this.count = 0; }

  spawn(type, x, y, z, vx, vy, vz, life, size, color) {
    if (this.count >= this.max) return -1;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.type[i] = type; this.color[i] = color;
    this.bounces[i] = 0;
    return i;
  }

  /** Physics-based amber spark shower. angle/spread steer the horizontal burst. */
  sparks(x, y, n, o = {}) {
    const speed = o.speed ?? 240, up = o.up ?? 220, angle = o.angle ?? 0, spread = o.spread ?? Math.PI * 2;
    const color = o.color ?? PC.AMBER, z = o.z ?? 14;
    for (let k = 0; k < n; k++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.25 + Math.random() * 0.85);
      this.spawn(PT.SPARK, x, y, z, Math.cos(a) * s, Math.sin(a) * s, up * (0.3 + Math.random()),
        0.5 + Math.random() * 0.8, 1 + Math.random() * 1.4, color);
    }
  }

  embers(x, y, n, color = PC.AMBER) {
    for (let k = 0; k < n; k++) {
      this.spawn(PT.EMBER, x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10, 4,
        (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 40 + Math.random() * 60,
        1 + Math.random() * 1.5, 1.5, color);
    }
  }

  /** Rising, drifting voxel pixels — Cole's mind leaking into the grid. */
  voxels(x, y, n, o = {}) {
    const color = o.color ?? PC.CYAN, spread = o.spread ?? 10, rise = o.rise ?? 40;
    for (let k = 0; k < n; k++) {
      this.spawn(PT.VOXEL, x + (Math.random() - 0.5) * spread * 2, y + (Math.random() - 0.5) * spread, 6 + Math.random() * 16,
        (Math.random() - 0.5) * (o.burst ?? 30), (Math.random() - 0.5) * (o.burst ?? 30), rise * (0.4 + Math.random()),
        0.6 + Math.random() * (o.life ?? 1.2), 2 + Math.floor(Math.random() * 3), color);
    }
  }

  smoke(x, y, n, o = {}) {
    for (let k = 0; k < n; k++) {
      this.spawn(PT.SMOKE, x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12, 10,
        (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 18 + Math.random() * 20,
        1.2 + Math.random() * 1.4, (o.size ?? 8) + Math.random() * 8, PC.SMOKE);
    }
  }

  splash(x, y, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 70;
      this.spawn(PT.DROP, x, y, 2, Math.cos(a) * s, Math.sin(a) * s * 0.6, 90 + Math.random() * 90,
        0.35 + Math.random() * 0.3, 1.2, PC.WATER);
    }
  }

  debris(x, y, n, color = PC.SMOKE) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 160;
      this.spawn(PT.DEBRIS, x, y, 8, Math.cos(a) * s, Math.sin(a) * s, 120 + Math.random() * 160,
        1 + Math.random(), 2 + Math.random() * 2, color);
    }
  }

  /** world is optional: when provided, sparks ricochet off solid tiles. */
  update(dt, world) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const t = this.type[i];
      if (t === PT.SPARK || t === PT.DROP || t === PT.DEBRIS) {
        this.vz[i] -= GRAVITY * dt;
        this.z[i] += this.vz[i] * dt;
        if (this.z[i] < 0) {
          this.z[i] = 0;
          this.vz[i] = -this.vz[i] * (t === PT.DEBRIS ? 0.3 : 0.42);
          this.vx[i] *= 0.62; this.vy[i] *= 0.62;
          if (++this.bounces[i] > 3 || t === PT.DROP) this.life[i] = Math.min(this.life[i], 0.15);
        }
        const nx = this.x[i] + this.vx[i] * dt, ny = this.y[i] + this.vy[i] * dt;
        if (world && world.isSolidPx(nx, this.y[i])) this.vx[i] = -this.vx[i] * 0.5; else this.x[i] = nx;
        if (world && world.isSolidPx(this.x[i], ny)) this.vy[i] = -this.vy[i] * 0.5; else this.y[i] = ny;
      } else if (t === PT.VOXEL || t === PT.GLYPH) {
        this.z[i] += this.vz[i] * dt;
        this.vx[i] *= 1 - dt * 1.6; this.vy[i] *= 1 - dt * 1.6;
        this.x[i] += this.vx[i] * dt + Math.sin(this.life[i] * 9 + i) * 6 * dt;
        this.y[i] += this.vy[i] * dt;
      } else if (t === PT.SMOKE) {
        this.z[i] += this.vz[i] * dt;
        this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt;
        this.size[i] += dt * 10;
      } else if (t === PT.EMBER) {
        this.z[i] += this.vz[i] * dt;
        this.vz[i] *= 1 - dt * 0.8;
        this.x[i] += this.vx[i] * dt + Math.sin(this.life[i] * 5 + i) * 10 * dt;
        this.y[i] += this.vy[i] * dt;
      }
      i++;
    }
  }

  kill(i) {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.z[i] = this.z[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
    this.size[i] = this.size[j]; this.type[i] = this.type[j]; this.color[i] = this.color[j];
    this.bounces[i] = this.bounces[j];
  }

  render(ctx, view) {
    ctx.save();
    ctx.lineCap = 'butt';
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i], y = this.y[i];
      if (view && (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1)) continue;
      const k = this.life[i] / this.maxLife[i];
      const ci = this.color[i];
      const t = this.type[i];
      const sy = y - this.z[i];
      if (t === PT.SPARK) {
        // Hot near-white core while young, cooling to the palette colour.
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.strokeStyle = k > 0.55 ? SPARK_HOT[ci] : SOLID[ci];
        ctx.lineWidth = this.size[i];
        ctx.beginPath();
        ctx.moveTo(x, sy);
        ctx.lineTo(x - this.vx[i] * 0.025, sy - this.vy[i] * 0.025 + this.vz[i] * 0.025);
        ctx.stroke();
      } else if (t === PT.VOXEL || t === PT.GLYPH) {
        const s = this.size[i];
        ctx.globalAlpha = k;
        ctx.fillStyle = SOLID[ci];
        ctx.fillRect(Math.round(x - s / 2), Math.round(sy - s / 2), s, s);
      } else if (t === PT.SMOKE) {
        ctx.globalAlpha = k * 0.25;
        ctx.fillStyle = SOLID[ci];
        ctx.beginPath(); ctx.arc(x, sy, this.size[i], 0, Math.PI * 2); ctx.fill();
      } else if (t === PT.EMBER) {
        ctx.globalAlpha = k;
        ctx.fillStyle = SOLID[ci];
        ctx.fillRect(x - 1, sy - 1, 2, 2);
      } else if (t === PT.DROP) {
        ctx.globalAlpha = k * 0.8;
        ctx.fillStyle = SOLID[ci];
        ctx.fillRect(x - 0.75, sy - 0.75, 1.5, 1.5);
      } else if (t === PT.DEBRIS) {
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = SOLID[ci];
        ctx.fillRect(x - this.size[i] / 2, sy - this.size[i] / 2, this.size[i], this.size[i]);
      }
    }
    ctx.restore();
  }

  /** Additive bloom pass — call with globalCompositeOperation = 'lighter'. */
  renderGlow(ctx, view) {
    for (let i = 0; i < this.count; i++) {
      const t = this.type[i];
      if (t !== PT.SPARK && t !== PT.VOXEL && t !== PT.EMBER) continue;
      const x = this.x[i], y = this.y[i] - this.z[i];
      if (view && (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1)) continue;
      const r = t === PT.VOXEL ? 7 : 9;
      ctx.globalAlpha = (this.life[i] / this.maxLife[i]) * 0.22;
      ctx.fillStyle = SOLID[this.color[i]];
      ctx.fillRect(x - r / 2, y - r / 2, r, r);
    }
    ctx.globalAlpha = 1;
  }

  /** Mirror airborne sparks into puddles: reflection sits at y + z beneath the spark. */
  renderReflections(ctx, world, view) {
    for (let i = 0; i < this.count; i++) {
      const t = this.type[i];
      if (t !== PT.SPARK && t !== PT.EMBER && t !== PT.VOXEL) continue;
      const x = this.x[i], ry = this.y[i] + this.z[i] * 0.6;
      if (view && (x < view.x0 || x > view.x1 || ry < view.y0 || ry > view.y1)) continue;
      if (!world.isWater(Math.floor(x / TILE), Math.floor(ry / TILE))) continue;
      ctx.globalAlpha = (this.life[i] / this.maxLife[i]) * 0.45;
      ctx.fillStyle = SOLID[this.color[i]];
      ctx.fillRect(x - 1, ry - 2, 2, 4 + this.z[i] * 0.05);
    }
    ctx.globalAlpha = 1;
  }
}
