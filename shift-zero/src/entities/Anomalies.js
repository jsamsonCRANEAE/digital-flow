// Grid anomalies: Arc Hounds (lunging lightning dogs), Bit-Rot Crawlers (hunt the Voxel),
// Harmonic Phantoms (only real when measured) — and THE MAIN TIE TRANSFORMER.
import { TILE, dist, lightningPath, strokePath, hashNoise, clamp, distToSegment } from '../engine/Util.js';
import { PC } from '../engine/ParticlePool.js';
import { audio } from '../engine/AudioSynth.js';

class Anomaly {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 10;
    this.alive = true;
    this.stunT = 0;
    this.hitFlash = 0;
    this.measuredT = 0;
    this.attackCd = 0;
    this.seed = Math.random() * 1000;
    this.homeX = x; this.homeY = y;
    this.wanderT = 0; this.wx = x; this.wy = y;
  }

  get hittable() { return true; }

  hit(dmg, world, fx, fy) {
    if (!this.alive || !this.hittable) return false;
    this.hp -= dmg;
    this.hitFlash = 1;
    const d = Math.hypot(this.x - fx, this.y - fy) || 1;
    this.vx += ((this.x - fx) / d) * 260;
    this.vy += ((this.y - fy) / d) * 260;
    if (this.hp <= 0) this.die(world);
    return true;
  }

  die(world) {
    this.alive = false;
    audio.kill();
    world.particles.sparks(this.x, this.y, 40, { speed: 300, color: this.sparkColor ?? PC.WHITE });
    world.particles.voxels(this.x, this.y, 20, { color: this.voxelColor ?? PC.CYAN, burst: 140 });
    world.camera.addTrauma(0.3);
    world.camera.hitStop(60);
    world.onAnomalyKilled(this);
  }

  baseUpdate(dt) {
    this.stunT = Math.max(0, this.stunT - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.measuredT = Math.max(0, this.measuredT - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
  }

  /** Steering along a BFS distance field; direct pursuit when the target is in plain sight. */
  steer(world, field, tx, ty, speed, dt) {
    let dx = tx - this.x, dy = ty - this.y;
    const close = Math.hypot(dx, dy) < TILE * 4 && world.los(this.x, this.y, tx, ty);
    if (!close && field) {
      const cx = Math.floor(this.x / TILE), cy = Math.floor(this.y / TILE);
      let best = world.fieldAt(field, cx, cy), bx = cx, by = cy;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const v = world.fieldAt(field, cx + ox, cy + oy);
        if (v >= 0 && (best < 0 || v < best)) { best = v; bx = cx + ox; by = cy + oy; }
      }
      dx = (bx + 0.5) * TILE - this.x;
      dy = (by + 0.5) * TILE - this.y;
    }
    const l = Math.hypot(dx, dy) || 1;
    this.vx += ((dx / l) * speed - this.vx) * Math.min(1, dt * 6);
    this.vy += ((dy / l) * speed - this.vy) * Math.min(1, dt * 6);
  }

  wander(world, speed, dt) {
    this.wanderT -= dt;
    if (this.wanderT <= 0 || Math.hypot(this.wx - this.x, this.wy - this.y) < 8) {
      this.wanderT = 1.5 + Math.random() * 2.5;
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * TILE * 4;
        const x = this.homeX + Math.cos(a) * r, y = this.homeY + Math.sin(a) * r;
        if (!world.isSolidPx(x, y)) { this.wx = x; this.wy = y; break; }
      }
    }
    this.steer(world, null, this.wx, this.wy, speed, dt);
  }

  integrate(world, dt, ghost = false) {
    if (ghost) { this.x += this.vx * dt; this.y += this.vy * dt; }
    else world.moveEntity(this, this.vx * dt, this.vy * dt, this.r, false);
  }

  targetOf(world) {
    for (const d of world.decoys) if (dist(d.x, d.y, this.x, this.y) < TILE * 9) return { x: d.x, y: d.y, decoy: true };
    return { x: world.body.x, y: world.body.y, decoy: false };
  }
}

// ---------------------------------------------------------------- Arc Hound
export class ArcHound extends Anomaly {
  constructor(x, y) {
    super(x, y);
    this.kind = 'hound';
    this.hp = this.maxHp = 60;
    this.r = 11;
    this.state = 'patrol';
    this.stateT = 0;
    this.heading = 0;
    this.lungeDir = { x: 0, y: 0 };
    this.hitThisLunge = false;
    this.aggro = false;
    this.legPhase = 0;
    this.sparkColor = PC.WHITE;
  }

  update(dt, world) {
    this.baseUpdate(dt);
    const body = world.body;
    const tgt = this.targetOf(world);
    const dT = dist(this.x, this.y, tgt.x, tgt.y);
    if (!this.aggro && !body.downed) {
      const db = dist(this.x, this.y, body.x, body.y);
      if (db < TILE * 3 || (db < TILE * 8 && world.los(this.x, this.y, body.x, body.y))) {
        this.aggro = true;
        audio.growl();
      }
    }
    if (this.aggro && body.downed && !tgt.decoy) this.aggro = false;
    this.stateT -= dt;
    if (this.stunT > 0) {
      this.vx *= 0.85; this.vy *= 0.85;
    } else if (this.state === 'windup') {
      this.vx *= 0.8; this.vy *= 0.8;
      if (this.stateT <= 0) {
        this.state = 'lunge';
        this.stateT = 0.26;
        this.hitThisLunge = false;
      }
    } else if (this.state === 'lunge') {
      this.vx = this.lungeDir.x * 450; this.vy = this.lungeDir.y * 450;
      if (!this.hitThisLunge && !body.downed && dist(this.x, this.y, body.x, body.y) < this.r + body.r + 4) {
        this.hitThisLunge = true;
        if (world.hurtBody(16, this.x, this.y, 'arc') > 0) body.knock(this.lungeDir.x * 300, this.lungeDir.y * 300);
      }
      if (this.stateT <= 0) { this.state = 'recover'; this.stateT = 0.55; }
    } else if (this.state === 'recover') {
      this.vx *= 0.88; this.vy *= 0.88;
      if (this.stateT <= 0) this.state = this.aggro ? 'chase' : 'patrol';
    } else if (this.aggro || tgt.decoy) {
      this.state = 'chase';
      this.steer(world, world.flowBody, tgt.x, tgt.y, 150, dt);
      if (dT < 86 && world.los(this.x, this.y, tgt.x, tgt.y) && this.attackCd <= 0) {
        this.state = 'windup';
        this.stateT = 0.42;
        this.attackCd = 1.4;
        const l = dT || 1;
        this.lungeDir = { x: (tgt.x - this.x) / l, y: (tgt.y - this.y) / l };
        audio.growl();
      }
    } else {
      this.state = 'patrol';
      this.wander(world, 60, dt);
    }
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 10) this.heading = Math.atan2(this.vy, this.vx);
    this.legPhase += sp * dt * 0.09;
    this.integrate(world, dt);
  }

  skeleton() {
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const P = (f, side) => ({ x: this.x + c * f - s * side, y: this.y - 8 + s * f + c * side * 0.6 });
    const legs = [[8, 6, 0], [8, -6, Math.PI], [-8, 6, Math.PI], [-8, -6, 0]].map(([f, side, ph]) => {
      const hip = P(f, side);
      const swing = Math.sin(this.legPhase + ph) * 5;
      return [hip, { x: hip.x + c * swing, y: hip.y + 10 + s * swing }];
    });
    return { tail: P(-16, 0), hip: P(-8, 0), shoulder: P(8, 0), head: P(17, 0), jaw: P(22, this.state === 'windup' ? 3 : 1), legs };
  }

  render(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + 4, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
    const k = this.skeleton();
    ctx.strokeStyle = '#0c1018';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(k.hip.x, k.hip.y); ctx.lineTo(k.shoulder.x, k.shoulder.y); ctx.lineTo(k.head.x, k.head.y); ctx.stroke();
  }

  renderGlow(ctx, world, t) {
    const k = this.skeleton();
    const wind = this.state === 'windup';
    const col = this.hitFlash > 0 ? 'rgba(255,255,255,1)' : wind ? 'rgba(255,240,180,0.95)' : 'rgba(170,210,255,0.9)';
    ctx.strokeStyle = col;
    ctx.lineWidth = wind ? 2.2 : 1.6;
    const j = 3 + (wind ? 3 : 0);
    strokePath(ctx, lightningPath(k.tail.x, k.tail.y, k.hip.x, k.hip.y, 3, j));
    strokePath(ctx, lightningPath(k.hip.x, k.hip.y, k.shoulder.x, k.shoulder.y, 4, j));
    strokePath(ctx, lightningPath(k.shoulder.x, k.shoulder.y, k.head.x, k.head.y, 3, j));
    strokePath(ctx, lightningPath(k.head.x, k.head.y, k.jaw.x, k.jaw.y, 2, 2));
    for (const [a, b] of k.legs) strokePath(ctx, lightningPath(a.x, a.y, b.x, b.y, 3, 2));
    ctx.fillStyle = wind ? '#ffef9a' : '#e0f4ff';
    ctx.fillRect(k.head.x - 1.5, k.head.y - 2, 3, 3);
    world.dynLights.push({ x: this.x, y: this.y, r: wind ? 110 : 70, i: 0.5, color: wind ? 'rgba(255,230,150,0.22)' : 'rgba(140,180,255,0.14)' });
  }
}

// ---------------------------------------------------------------- Bit-Rot Crawler
export class BitRotCrawler extends Anomaly {
  constructor(x, y) {
    super(x, y);
    this.kind = 'crawler';
    this.hp = this.maxHp = 30;
    this.r = 8;
    this.sparkColor = PC.ROT;
    this.voxelColor = PC.ROT;
    this.skitterT = 0;
  }

  update(dt, world) {
    this.baseUpdate(dt);
    const v = world.voxel, b = world.body;
    const dv = dist(this.x, this.y, v.x, v.y);
    const db = dist(this.x, this.y, b.x, b.y);
    if (this.stunT > 0) { this.vx *= 0.85; this.vy *= 0.85; }
    else if (dv < TILE * 9 && v.desyncT <= 0) this.steer(world, world.flowVoxel, v.x, v.y, 78, dt);
    else if (db < TILE * 5 && !b.downed) this.steer(world, world.flowBody, b.x, b.y, 70, dt);
    else this.wander(world, 40, dt);
    if (this.attackCd <= 0) {
      if (dv < 20 && v.desyncT <= 0) { v.damage(12, world); this.attackCd = 1; audio.skitter(); }
      else if (db < 20 && !b.downed) { world.hurtBody(8, this.x, this.y, 'bite'); this.attackCd = 1; audio.skitter(); }
    }
    this.skitterT -= dt;
    if (this.skitterT <= 0 && Math.hypot(this.vx, this.vy) > 20) { this.skitterT = 0.5 + Math.random(); if (dv < TILE * 6) audio.skitter(); }
    this.integrate(world, dt);
  }

  render(ctx, world, t) {
    const tick = Math.floor(t * 14);
    for (let i = 0; i < 14; i++) {
      const a = hashNoise(i, tick, this.seed) * Math.PI * 2;
      const r = hashNoise(i, tick + 1, this.seed) * 9;
      ctx.fillStyle = i % 3 === 0 ? '#d63cc8' : i % 3 === 1 ? '#2a0a2a' : '#7a1a70';
      if (this.hitFlash > 0) ctx.fillStyle = '#fff';
      ctx.fillRect(this.x + Math.cos(a) * r - 2, this.y - 4 + Math.sin(a) * r * 0.7 - 2, 4, 4);
    }
    ctx.strokeStyle = '#3a0a38';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.sin(t * 20 + i) * 0.3;
      ctx.beginPath(); ctx.moveTo(this.x, this.y - 2); ctx.lineTo(this.x + Math.cos(a) * 12, this.y + Math.sin(a) * 8); ctx.stroke();
    }
  }

  renderGlow(ctx, world) {
    world.dynLights.push({ x: this.x, y: this.y, r: 40, i: 0.25, color: 'rgba(214,60,200,0.12)' });
  }
}

// ---------------------------------------------------------------- Harmonic Phantom
export class HarmonicPhantom extends Anomaly {
  constructor(x, y) {
    super(x, y);
    this.kind = 'phantom';
    this.hp = this.maxHp = 40;
    this.r = 12;
    this.sparkColor = PC.GREEN;
    this.voxelColor = PC.GREEN;
    this.whineT = 2 + Math.random() * 4;
    this.harmonic = 3 + Math.floor(Math.random() * 3) * 2; // 3rd, 5th, 7th
  }

  get hittable() { return this.measuredT > 0; }

  update(dt, world) {
    this.baseUpdate(dt);
    const b = world.body;
    const tgt = this.targetOf(world);
    const speed = this.measuredT > 0 ? 20 : 48;
    if (this.stunT <= 0) {
      const dx = tgt.x - this.x, dy = tgt.y - this.y, l = Math.hypot(dx, dy) || 1;
      const weave = Math.sin(world.time * 2 + this.seed) * 0.6;
      this.vx += ((dx / l + (-dy / l) * weave) * speed - this.vx) * Math.min(1, dt * 2);
      this.vy += ((dy / l + (dx / l) * weave) * speed - this.vy) * Math.min(1, dt * 2);
    } else { this.vx *= 0.9; this.vy *= 0.9; }
    this.integrate(world, dt, true);
    if (!b.downed && this.attackCd <= 0 && dist(this.x, this.y, b.x, b.y) < 22) {
      this.attackCd = 1.6;
      world.hurtBody(8, this.x, this.y, 'phantom');
      world.drainAnchor(2, 'A harmonic whispers through you. Something slips.');
    }
    this.whineT -= dt;
    if (this.whineT <= 0) {
      this.whineT = 3 + Math.random() * 5;
      if (dist(this.x, this.y, b.x, b.y) < TILE * 8) audio.whine();
    }
  }

  render(ctx, world, t) {
    const measured = this.measuredT > 0;
    const a = measured ? 0.9 : 0.18 + 0.1 * Math.sin(t * 3 + this.seed);
    ctx.lineWidth = measured ? 2 : 1.2;
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = measured
        ? (this.hitFlash > 0 ? '#fff' : k === 0 ? `rgba(120,255,140,${a})` : `rgba(255,120,90,${a * 0.7})`)
        : `rgba(200,230,220,${a * (1 - k * 0.25)})`;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        const yy = this.y - 34 + u * 40;
        const amp = 10 * Math.sin(u * Math.PI);
        const xx = this.x + Math.sin(u * this.harmonic * Math.PI + t * (4 + k) + k) * amp * (1 - k * 0.2);
        if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
    if (measured) {
      ctx.font = '6px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9dff9d';
      ctx.fillText(`H${this.harmonic} · ${60 * this.harmonic}Hz · THD ${Math.round(this.hp / this.maxHp * 40)}%`, this.x, this.y - 40);
    }
  }

  renderGlow(ctx, world) {
    if (this.measuredT > 0) world.dynLights.push({ x: this.x, y: this.y - 14, r: 50, i: 0.3, color: 'rgba(120,255,140,0.1)' });
  }
}

export function createAnomaly(kind, x, y) {
  if (kind === 'hound') return new ArcHound(x, y);
  if (kind === 'crawler') return new BitRotCrawler(x, y);
  if (kind === 'phantom') return new HarmonicPhantom(x, y);
  return null;
}

// ---------------------------------------------------------------- THE MAIN TIE TRANSFORMER
export class MainTieTransformer {
  constructor(world, tx, ty) {
    this.x = (tx + 0.5) * TILE;
    this.y = (ty + 0.5) * TILE;
    this.phase = 1;
    this.beamAngle = 0;
    this.beamLen = 430;
    this.coreHp = this.maxCoreHp = 420;
    this.deadT = { A: 0, B: 0, C: 0 };
    this.failed = new Set();
    this.shockT = 5;
    this.waveT = 6;
    this.crawlT = 4;
    this.rings = [];
    this.meltdown = 0;
    this.meltdownMax = 55;
    this.defeated = false;
    this.beamHitCd = 0;
    this.waterLiveT = 0;
    this.burnT = 0;
    this.paths = [];
    this.coreFlash = 0;
    this.denyT = 0;
  }

  get beamCount() { return this.phase === 1 ? 2 : this.phase === 2 ? 3 : 4; }
  get beamSpeed() { return this.phase === 1 ? 0.5 : this.phase === 2 ? 0.75 : 0.42; }

  grounded(world) { const e = world.circuit.getEdge('GND'); return !!e && e.bridged; }
  beamsActive(world) { return !this.defeated && !(this.phase >= 2 && this.grounded(world)); }

  update(dt, world) {
    if (this.defeated) return;
    this.beamHitCd = Math.max(0, this.beamHitCd - dt);
    this.waterLiveT = Math.max(0, this.waterLiveT - dt);
    this.coreFlash = Math.max(0, this.coreFlash - dt * 3);
    this.denyT = Math.max(0, this.denyT - dt);
    this.beamAngle += this.beamSpeed * dt * (this.phase === 3 ? (Math.sin(world.time * 0.7) > 0 ? 1 : -1) : 1);
    const body = world.body;

    if (this.phase === 1) {
      for (const ph of ['A', 'B', 'C']) {
        if (this.failed.has(ph)) continue;
        if (!world.circuit.isEnergized(`BUSH_${ph}`)) {
          this.deadT[ph] += dt;
          if (this.deadT[ph] >= 3) this.ruptureBushing(world, ph);
        } else this.deadT[ph] = 0;
      }
      this.waveT -= dt;
      if (this.waveT <= 0) { this.waveT = 14; world.spawnAnomalyNear('hound', this.x, this.y + 120, 2); }
      if (this.failed.size === 3) this.enterPhase(world, 2);
    } else if (this.phase === 2) {
      this.shockT -= dt;
      if (this.shockT <= 0) {
        this.shockT = 5.5;
        this.rings.push({ r: 50, hit: false });
        this.waterLiveT = 1.6;
        audio.bossRoar();
        world.camera.addTrauma(0.5);
      }
      this.waveT -= dt;
      if (this.waveT <= 0) { this.waveT = 9; world.spawnAnomalyNear('hound', this.x, this.y, 4); }
      if (this.grounded(world)) {
        this.crawlT -= dt;
        if (this.crawlT <= 0) { this.crawlT = 5; world.spawnAnomalyNear('crawler', world.voxel.x, world.voxel.y, 3, TILE * 5); }
      }
    } else if (this.phase === 3) {
      this.meltdown -= dt;
      this.burnT -= dt;
      if (Math.random() < dt * 8) world.particles.embers(this.x + (Math.random() - 0.5) * 80, this.y, 2);
      world.camera.addTrauma(dt * 0.25);
      if (this.meltdown <= 0) {
        this.meltdown = 0;
        if (this.burnT <= 0) {
          this.burnT = 1;
          world.hurtBody(25, this.x, this.y, 'flash');
          world.flash = Math.max(world.flash, 0.4);
        }
      }
    }

    for (const ring of this.rings) {
      ring.r += 230 * dt;
      if (!ring.hit && !body.downed && Math.abs(dist(body.x, body.y, this.x, this.y) - ring.r) < 14) {
        ring.hit = true;
        world.hurtBody(20, this.x, this.y, 'beam');
      }
    }
    this.rings = this.rings.filter((r) => r.r < 700);

    if (this.beamsActive(world)) {
      if (Math.random() < dt * 25) this.paths = this.beamEnds().map(([bx, by]) => lightningPath(this.x, this.y - 20, bx, by, 18, 14));
      if (!body.downed && this.beamHitCd <= 0 && !body.isPhasing(world)) {
        for (const [bx, by] of this.beamEnds()) {
          if (distToSegment(body.x, body.y, this.x, this.y, bx, by) < body.r + 6) {
            this.beamHitCd = 0.7;
            world.hurtBody(26, this.x, this.y, 'beam');
            const a = Math.atan2(body.y - this.y, body.x - this.x);
            body.knock(Math.cos(a) * 320, Math.sin(a) * 320);
            audio.zap();
            break;
          }
        }
      }
    }
  }

  beamEnds() {
    const out = [];
    for (let i = 0; i < this.beamCount; i++) {
      const a = this.beamAngle + (i / this.beamCount) * Math.PI * 2;
      out.push([this.x + Math.cos(a) * this.beamLen, this.y + Math.sin(a) * this.beamLen]);
    }
    return out;
  }

  ruptureBushing(world, ph) {
    this.failed.add(ph);
    world.circuit.getNode(`BUSH_${ph}`).failed = true;
    world.circuit.propagate();
    const idx = ['A', 'B', 'C'].indexOf(ph);
    const bx = this.x - 24 + idx * 24, by = this.y - 30;
    world.particles.sparks(bx, by, 80, { speed: 380, up: 380 });
    world.particles.smoke(bx, by, 14);
    world.particles.debris(bx, by, 20, PC.WHITE);
    world.camera.addTrauma(0.8);
    world.camera.hitStop(90);
    world.flash = 0.5;
    audio.arcFlash();
    world.toast(`BUSHING H${idx + 1} RUPTURED — PHASE ${ph} DEAD`, '#ffb040');
    // The lock is no longer needed on a dead phase: return it to the Body.
    const e = world.circuit.getEdge(`BRK_${ph}`);
    if (e && e.locked) { e.locked = false; world.body.padlocks++; world.toast('Padlock recovered from dead phase', '#d8b04a'); }
    if (e) world.circuit.removeEdge(e.id);
  }

  enterPhase(world, p) {
    this.phase = p;
    audio.bossRoar();
    world.camera.addTrauma(1);
    world.flash = 0.7;
    if (p === 2) {
      world.narrative.event('bossPhase2', { priority: true });
      world.toast('PHASE 2 · BACK-FEED — Voxel: GROUND THE CORE · Body: strike the coil', '#ff8040', 5);
    } else if (p === 3) {
      this.meltdown = this.meltdownMax;
      world.narrative.event('bossPhase3', { priority: true });
      world.toast('PHASE 3 · LOAD SPIKE — throw the MAIN DISCONNECT (north) while grounded', '#ff4040', 6);
      if (world.run.anchor > 0) world.toast('…or OVERCLOCK: burn every memory and end it now', '#50f0ff', 6);
    }
  }

  hitCore(dmg, world) {
    if (this.phase !== 2) return false;
    if (!this.grounded(world)) {
      if (this.denyT <= 0) {
        this.denyT = 1.5;
        world.toast('CORE UNGROUNDED — hits glance off', '#ff8060');
        audio.deny();
      }
      world.particles.sparks(world.body.x, world.body.y - 10, 6, { speed: 120 });
      return false;
    }
    this.coreHp -= dmg;
    this.coreFlash = 1;
    world.particles.sparks(this.x, this.y + 10, 24, { speed: 260 });
    if (this.coreHp <= 0) { this.coreHp = 0; this.enterPhase(world, 3); }
    return true;
  }

  defeat(how) {
    this.defeated = true;
    this.how = how;
    this.rings = [];
  }

  render(ctx, world, t) {
    const x = this.x, y = this.y;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 54, y + 30, 108, 14);
    // Tank with cooling fins
    ctx.fillStyle = '#4b5258';
    ctx.fillRect(x - 46, y - 40, 92, 76);
    ctx.fillStyle = '#383d42';
    for (let i = 0; i < 9; i++) ctx.fillRect(x - 56 + i * 13, y - 34, 6, 66);
    ctx.fillStyle = '#5c646b';
    ctx.fillRect(x - 40, y - 44, 80, 10);
    // Oil stains
    ctx.fillStyle = 'rgba(20,16,10,0.5)';
    ctx.beginPath(); ctx.ellipse(x + 18, y + 20, 14, 6, 0.3, 0, Math.PI * 2); ctx.fill();
    // Bushings
    ['A', 'B', 'C'].forEach((ph, i) => {
      const bx = x - 24 + i * 24, by = y - 30;
      const dead = this.failed.has(ph);
      ctx.fillStyle = dead ? '#3a3330' : '#d8d0bc';
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(bx, by - k * 4, 7 - k, 0, Math.PI * 2); ctx.fill(); }
      if (dead) { ctx.fillStyle = '#120c08'; ctx.fillRect(bx - 4, by - 14, 8, 6); }
      ctx.font = '7px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = dead ? '#806050' : '#ffd890';
      ctx.fillText(`H${i + 1}`, bx, by + 14);
      if (!dead && this.deadT[ph] > 0) {
        ctx.strokeStyle = '#ff9040'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, by - 6, 11, -Math.PI / 2, -Math.PI / 2 + (this.deadT[ph] / 3) * Math.PI * 2); ctx.stroke();
      }
    });
    // Exposed coil (phase 2+)
    if (this.phase >= 2) {
      const hot = this.phase === 3 ? 0.6 + 0.4 * Math.sin(t * 12) : 0.4 + 0.2 * Math.sin(t * 5);
      ctx.fillStyle = this.coreFlash > 0 ? '#ffffff' : `rgba(255,${120 + hot * 100},40,${0.7 + hot * 0.3})`;
      ctx.fillRect(x - 20, y - 8, 40, 30);
      ctx.strokeStyle = '#6a2a10'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(x - 20, y - 4 + i * 5); ctx.lineTo(x + 20, y - 2 + i * 5); ctx.stroke(); }
    }
    ctx.font = 'bold 8px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8d8a0';
    ctx.fillText('MAIN TIE · 13.8kV', x, y + 46);
  }

  renderGlow(ctx, world, t) {
    if (this.beamsActive(world)) {
      ctx.lineCap = 'round';
      for (const p of this.paths) {
        ctx.strokeStyle = 'rgba(160,200,255,0.25)'; ctx.lineWidth = 12; strokePath(ctx, p);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2.5; strokePath(ctx, p);
      }
    } else if (this.phase >= 2 && !this.defeated) {
      // Grounded: arcs crawl down into the floor instead.
      ctx.strokeStyle = 'rgba(80,240,255,0.7)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        strokePath(ctx, lightningPath(this.x, this.y, this.x + Math.cos(a) * 70, this.y + Math.sin(a) * 50, 6, 8));
      }
    }
    for (const ring of this.rings) {
      ctx.strokeStyle = `rgba(255,170,90,${clamp(1 - ring.r / 700, 0, 1) * 0.8})`;
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(this.x, this.y, ring.r, 0, Math.PI * 2); ctx.stroke();
    }
    const col = this.phase === 3 ? 'rgba(255,90,40,0.3)' : this.phase === 2 ? 'rgba(255,150,60,0.2)' : 'rgba(150,190,255,0.18)';
    world.dynLights.push({ x: this.x, y: this.y, r: 260, i: 0.7, color: col });
  }
}
