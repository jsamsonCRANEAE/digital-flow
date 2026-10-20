// P2 — THE VOXEL. Rides the conduit graph (Pac-Man style turning with buffered input),
// stretches across blown fuses as a living jumper, materialises insulated stepping stones
// and decoys, and spends Signal Coherence to do any of it.
import { TILE, hashNoise, clamp } from '../engine/Util.js';
import { DIRS } from '../systems/LevelGen.js';
import { PC } from '../engine/ParticlePool.js';
import { audio } from '../engine/AudioSynth.js';

// A rough 7×8 mask of Cole's face; 0 = hole (eyes, mouth shadow).
const FACE = [
  '.11111.',
  '1111111',
  '1101011',
  '1111111',
  '1111111',
  '1110111',
  '.11111.',
  '..111..',
];

export class VerletRope {
  constructor(n = 12) {
    this.n = n;
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.inited = false;
  }

  reset(ax, ay, bx, by) {
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      this.x[i] = this.px[i] = ax + (bx - ax) * t;
      this.y[i] = this.py[i] = ay + (by - ay) * t;
    }
    this.inited = true;
  }

  /** Pinned at both ends; jitter injects current-induced vibration; gravity gives sag. */
  update(dt, ax, ay, bx, by, jitter = 0, gravity = 300, slack = 1.08) {
    if (!this.inited) this.reset(ax, ay, bx, by);
    const n = this.n;
    for (let i = 1; i < n - 1; i++) {
      const vx = (this.x[i] - this.px[i]) * 0.96, vy = (this.y[i] - this.py[i]) * 0.96;
      this.px[i] = this.x[i]; this.py[i] = this.y[i];
      this.x[i] += vx + (Math.random() - 0.5) * jitter;
      this.y[i] += vy + gravity * dt * dt + (Math.random() - 0.5) * jitter;
    }
    this.x[0] = ax; this.y[0] = ay; this.x[n - 1] = bx; this.y[n - 1] = by;
    const rest = (Math.hypot(bx - ax, by - ay) / (n - 1)) * slack;
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < n - 1; i++) {
        const dx = this.x[i + 1] - this.x[i], dy = this.y[i + 1] - this.y[i];
        const d = Math.hypot(dx, dy) || 1e-4;
        const diff = (d - rest) / d * 0.5;
        if (i > 0) { this.x[i] += dx * diff; this.y[i] += dy * diff; }
        if (i + 1 < n - 1) { this.x[i + 1] -= dx * diff; this.y[i + 1] -= dy * diff; }
      }
    }
  }

  points() {
    const out = [];
    for (let i = 0; i < this.n; i++) out.push(this.x[i], this.y[i]);
    return out;
  }
}

export class PlayerVoxel {
  constructor(tx, ty, stats) {
    this.tx = tx; this.ty = ty;
    this.x = (tx + 0.5) * TILE; this.y = (ty + 0.5) * TILE;
    this.mdir = null;
    this.progress = 0;
    this.moving = false;
    this.coherence = 100;
    this.desyncT = 0;
    this.jumper = null;
    this.latched = false;
    this.hackHeldT = 0;
    this.hackArmed = false;
    this.materializeCd = 0;
    this.pulseCd = 0;
    this.ghostCd = 0;
    this.overclockCd = 0;
    this.idleT = 0;
    this.trail = [];
    this.rope = new VerletRope(10);
    this.speedStat = stats.voxelSpeed;
    this.hurtFlash = 0;
  }

  spend(n) {
    if (n <= 0) return true;
    if (this.coherence < n) { audio.deny(); return false; }
    this.coherence -= n;
    return true;
  }

  damage(n, world) {
    if (this.desyncT > 0) return;
    this.coherence -= n;
    this.hurtFlash = 1;
    world.particles.voxels(this.x, this.y, 8, { color: PC.ROT, burst: 80 });
    if (this.coherence <= 0) this.desync(world);
  }

  desync(world) {
    this.coherence = 0;
    this.desyncT = 3;
    this.releaseJumper(world);
    audio.desync();
    world.toast('VOXEL DESYNC — SIGNAL LOST', '#ff5060');
    world.particles.voxels(this.x, this.y, 40, { burst: 160 });
  }

  releaseJumper(world) {
    this.latched = false;
    if (!this.jumper) return;
    this.jumper.setBridged(world, false);
    this.jumper = null;
  }

  /** Solo-Swap: latch a held jumper so the Voxel keeps the circuit closed on its own. */
  latch(world) {
    if (!this.jumper || this.latched) return;
    this.latched = true;
    world.toast('JUMPER LATCHED — the Voxel holds the line alone (drains 1.5× faster)', '#50f0ff', 4);
  }

  canMove(world, tx, ty, d) { return (world.conduitAt(tx, ty) & d.bit) !== 0; }

  wanted(intent) {
    const c = [];
    if (intent.x) c.push(DIRS.find((d) => d.dx === Math.sign(intent.x) && d.dy === 0));
    if (intent.y) c.push(DIRS.find((d) => d.dy === Math.sign(intent.y) && d.dx === 0));
    // Prefer turning: try the axis perpendicular to the current heading first.
    if (this.mdir && c.length === 2 && c[0].dx !== 0 && this.mdir.dx !== 0) c.reverse();
    return c;
  }

  update(dt, intent, world) {
    const stats = world.stats;
    this.materializeCd = Math.max(0, this.materializeCd - dt);
    this.pulseCd = Math.max(0, this.pulseCd - dt);
    this.ghostCd = Math.max(0, this.ghostCd - dt);
    this.overclockCd = Math.max(0, this.overclockCd - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);

    if (intent.overclock) world.overclock();

    if (this.desyncT > 0) {
      this.desyncT -= dt;
      if (this.desyncT <= 0) { this.coherence = 40; audio.materialize(); }
      return;
    }

    // Living jumper: hold to complete the circuit; the amperage shakes the whole screen.
    if (this.jumper) {
      const letGo = this.latched ? intent.hackPressed || intent.x || intent.y : !intent.hackHeld;
      if (letGo) { this.releaseJumper(world); }
      else {
        this.coherence -= stats.jumperDrain * (this.latched ? 1.5 : 1) * dt;
        world.camera.addTrauma(dt * 0.9);
        const j = this.jumper;
        this.rope.update(dt, j.px - 14, j.py - 2, j.px + 14, j.py - 2, 3.5, -500, 1.25);
        if (Math.random() < dt * 25) world.particles.voxels(j.px + (Math.random() - 0.5) * 24, j.py - 6, 1, { rise: 60 });
        if (Math.random() < dt * 6) audio.jumperHum(1);
        if (this.coherence <= 0) this.desync(world);
        return;
      }
    }

    this.move(dt, intent, world);

    if (!this.moving) this.idleT += dt; else this.idleT = 0;
    if (this.idleT > 0.4 || !this.moving) this.coherence = Math.min(100, this.coherence + stats.regen * dt);
    else this.coherence = Math.min(100, this.coherence + stats.regen * 0.35 * dt);

    // Hack / Shunt: tap = act on device or pulse; hold away from devices = Ghost Lockout.
    const action = world.voxelTarget;
    if (intent.hackPressed) {
      this.hackArmed = true;
      this.hackHeldT = 0;
      if (action) {
        this.hackArmed = false;
        if (action.disabled) audio.deny();
        else if (action.hold) {
          if (stats.jumperDrain > 0 && this.coherence < 5) audio.deny();
          else {
            this.jumper = action.device;
            this.rope.inited = false;
            this.jumper.setBridged(world, true);
            this.moving = false;
            this.progress = 0;
          }
        } else action.run();
      }
    }
    if (this.hackArmed) {
      if (intent.hackHeld) {
        this.hackHeldT += dt;
        if (stats.ghostLockout && this.hackHeldT >= 0.6) {
          this.hackArmed = false;
          if (this.ghostCd <= 0) { if (world.ghostLockoutNearest()) this.ghostCd = 12; }
          else { audio.deny(); world.toast(`GHOST LOCKOUT RECHARGING ${Math.ceil(this.ghostCd)}s`, '#50f0ff'); }
        }
      } else {
        this.hackArmed = false;
        this.pulse(world);
      }
    }

    if (intent.materialize) world.voxelMaterialize(this);

    this.trail.push({ x: this.x, y: this.y, t: 0.35 });
    for (const p of this.trail) p.t -= dt;
    while (this.trail.length && this.trail[0].t <= 0) this.trail.shift();
  }

  move(dt, intent, world) {
    const want = this.wanted(intent);
    let remaining = this.speedStat * TILE * dt;
    // Cornering forgiveness: a late perpendicular turn just past a junction snaps back and takes it.
    if (this.moving && this.progress < 0.3) {
      const turn = want.find((q) => q.dx !== this.mdir.dx && q.dy !== this.mdir.dy && this.canMove(world, this.tx, this.ty, q));
      if (turn) { this.mdir = turn; this.progress = 0; }
    }
    if (!this.moving) {
      const d = want.find((q) => this.canMove(world, this.tx, this.ty, q));
      if (d) { this.mdir = d; this.moving = true; this.progress = 0; }
    }
    let guard = 0;
    while (this.moving && remaining > 0 && guard++ < 8) {
      const rev = want.find((q) => q.dx === -this.mdir.dx && q.dy === -this.mdir.dy);
      if (rev && this.progress > 0) {
        this.tx += this.mdir.dx; this.ty += this.mdir.dy;
        this.progress = 1 - this.progress;
        this.mdir = rev;
      }
      const left = (1 - this.progress) * TILE;
      if (remaining < left) { this.progress += remaining / TILE; remaining = 0; break; }
      remaining -= left;
      this.tx += this.mdir.dx; this.ty += this.mdir.dy;
      this.progress = 0;
      if (!want.length) { this.moving = false; break; }
      const next = want.find((q) => this.canMove(world, this.tx, this.ty, q));
      if (next) this.mdir = next;
      else if (!this.canMove(world, this.tx, this.ty, this.mdir)) { this.moving = false; break; }
    }
    const dx = this.moving ? this.mdir.dx * this.progress : 0;
    const dy = this.moving ? this.mdir.dy * this.progress : 0;
    this.x = (this.tx + 0.5 + dx) * TILE;
    this.y = (this.ty + 0.5 + dy) * TILE;
  }

  pulse(world) {
    if (this.pulseCd > 0) return;
    if (!this.spend(10)) return;
    this.pulseCd = 0.7;
    audio.pulse();
    world.voxelPulse(this);
  }

  render(ctx, t, world) {
    for (const p of this.trail) {
      ctx.fillStyle = `rgba(80,240,255,${p.t * 0.5})`;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    if (this.jumper) {
      const pts = this.rope.points();
      for (let i = 0; i < pts.length; i += 2) {
        const f = hashNoise(i, Math.floor(t * 20), 5);
        ctx.fillStyle = f < 0.5 ? '#50f0ff' : '#c8ffff';
        ctx.fillRect(pts[i] - 2.5, pts[i + 1] - 2.5, 5, 5);
      }
    }
    const scatter = (this.desyncT > 0 ? 10 : 0) + (1 - this.coherence / 100) * 3 + this.hurtFlash * 4;
    const alpha = this.desyncT > 0 ? 0.25 + 0.25 * Math.sin(t * 30) : 0.95;
    const tick = Math.floor(t * 12);
    const bob = Math.sin(t * 4) * 2;
    for (let r = 0; r < FACE.length; r++) {
      for (let c = 0; c < 7; c++) {
        if (FACE[r][c] !== '1') continue;
        const n = hashNoise(c, r, tick);
        if (n < 0.08 + (1 - this.coherence / 100) * 0.25) continue;
        const ox = (c - 3) * 3 + (n - 0.5) * scatter;
        const oy = (r - 4) * 3 + (hashNoise(r, c, tick) - 0.5) * scatter - 14 + bob;
        ctx.fillStyle = this.hurtFlash > 0.5 ? `rgba(255,90,200,${alpha})` : n < 0.3 ? `rgba(200,255,255,${alpha})` : `rgba(80,240,255,${alpha})`;
        ctx.fillRect(Math.round(this.x + ox - 1.5), Math.round(this.y + oy - 1.5), 3, 3);
      }
    }
    // Conduit contact sparkle
    ctx.fillStyle = 'rgba(80,240,255,0.5)';
    ctx.fillRect(this.x - 3, this.y - 1, 6, 2);
  }

  renderGlow(ctx, world) {
    const k = this.desyncT > 0 ? 0.3 : 1;
    world.dynLights.push({ x: this.x, y: this.y - 10, r: 95, i: 0.55 * k, color: `rgba(60,220,255,${0.18 * k})` });
  }

  get coherenceRatio() { return clamp(this.coherence / 100, 0, 1); }
}
