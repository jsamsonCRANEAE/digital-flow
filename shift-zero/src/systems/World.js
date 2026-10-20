// One floor of Substation Zero: owns the tile map, circuit, devices, players, anomalies,
// hazards and the full render pipeline (static layer → water → props → entities →
// darkness → additive glow → emissive digital layer).
import { TILE, clamp, dist, hashNoise, noise2, angleDiff, lightningPath, strokePath } from '../engine/Util.js';
import { castRay } from '../engine/Lighting.js';
import { PC } from '../engine/ParticlePool.js';
import { audio } from '../engine/AudioSynth.js';
import { CircuitSim } from './CircuitSim.js';
import { T, DIRS } from './LevelGen.js';
import { createDevice, BreakerBox, Bulkhead, CapacitorBank, CipherTerminal } from './Devices.js';
import { memoriesLost, MEMORIES } from './Narrative.js';
import { PlayerBody, SkillCheck } from '../entities/PlayerBody.js';
import { PlayerVoxel, VerletRope } from '../entities/PlayerVoxel.js';
import { createAnomaly, MainTieTransformer } from '../entities/Anomalies.js';

export const MUTATORS = {
  flooded: { name: 'FLOODED BASEMENT', desc: 'Sump pumps failed. Standing water everywhere.' },
  brownout: { name: 'BROWNOUT', desc: 'Lighting at 60%. Your flashlight battery is tired too.' },
  harmonic: { name: 'HARMONIC STORM', desc: '+2 Harmonic Phantoms drift through the walls.' },
  overtime: { name: 'MANDATORY OVERTIME', desc: 'Meltdown timer −25%. Pay +50%.' },
  audit: { name: 'SAFETY AUDIT', desc: 'An inspector is watching: LOTO costs no efficiency.' },
  rust: { name: 'RUST BELT', desc: 'Seized hardware. Skill checks run 30% faster.' },
};

export class World {
  constructor(game, level) {
    this.game = game;
    this.run = game.run;
    this.narrative = game.narrative;
    this.camera = game.camera;
    this.particles = game.particles;
    this.lighting = game.lighting;
    this.level = level;
    this.isBoss = !!level.boss;
    this.w = level.w; this.h = level.h;
    this.tiles = level.tiles.slice();
    this.water = level.water;
    this.waterNode = level.waterNode;
    this.conduit = level.conduit;
    this.solid = new Uint8Array(this.w * this.h);
    this.opaque = new Uint8Array(this.w * this.h);
    this.stats = this.run.rpg.stats();

    this.circuit = CircuitSim.fromSpec(level.circuit);
    this.circuit.recloseDelay = this.isBoss ? 4.5 : this.stats.recloseDelay;
    this.circuit.on((type, data) => this.onCircuitEvent(type, data));

    this.devices = level.devices.map((d) => createDevice(d)).filter(Boolean);
    this.bulbs = level.bulbs.map((b) => ({ ...b }));
    this.body = new PlayerBody((level.start.x + 0.5) * TILE, (level.start.y + 0.5) * TILE, this.stats);
    this.body.hp = Math.min(this.run.hp ?? this.body.maxHp, this.body.maxHp);
    this.voxel = new PlayerVoxel(level.voxelStart.x, level.voxelStart.y, this.stats);
    this.anomalies = level.spawns.map((s) => createAnomaly(s.kind, (s.x + 0.5) * TILE, (s.y + 0.5) * TILE)).filter(Boolean);
    this.boss = this.isBoss ? new MainTieTransformer(this, level.center.x, level.center.y) : null;

    this.pads = [];
    this.decoys = [];
    this.effects = [];
    this.toasts = [];
    this.bigText = null;
    this.dynLights = [];
    this.dynLightsPrev = [];
    this.time = 0;
    this.flash = 0;
    this.overclockCd = 0;
    this.exitT = 0;
    this.completed = false;
    this.terminated = false;
    this.flowT = 0;
    this.flowBody = null;
    this.flowVoxel = null;
    this.stressSpawnT = 15;
    this.meltdownTick = 0;
    this.warned = false;
    this.liveWaterT = 0;
    this.outOfWaterT = 10;
    this.anchorToastCd = 0;
    this.lasso = new VerletRope(14);
    this.bodyTarget = null;
    this.voxelTarget = null;
    this.flashlight = null;

    const mut = this.run.mutator;
    this.darkness = this.isBoss ? 0.9 : mut === 'brownout' ? 0.965 : 0.935;
    this.lightScale = mut === 'brownout' ? 0.62 : 1;
    const depth = this.run.depth;
    const base = this.isBoss ? 0 : this.run.workOrder === 'hot' ? 150 - depth * 8 : 220 - depth * 10;
    this.meltdownMax = Math.round(base * (mut === 'overtime' ? 0.75 : 1));
    this.meltdown = this.meltdownMax;

    // Hazard clusters → one light each when live.
    this.hazardLights = level.hazardNodes.map((id, i) => {
      let sx = 0, sy = 0, n = 0;
      for (let k = 0; k < this.water.length; k++) if (this.waterNode[k] === i) { sx += k % this.w; sy += (k / this.w) | 0; n++; }
      return { node: id, x: (sx / Math.max(1, n) + 0.5) * TILE, y: (sy / Math.max(1, n) + 0.5) * TILE };
    });
    this.exitRoom = level.rooms.find((r) => r.isExit);

    this.rebuildSolid();
    this.lighting.prepare(this);
    this.staticLayer = this.buildStaticLayer();
    this.camera.setBounds(0, 0, this.w * TILE, this.h * TILE);
    this.camera.snap(this.body.x, this.body.y, 1);
    this.particles.clear();
    this.recomputeFlow();
  }

  // ------------------------------------------------------------------ map queries
  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  tileAt(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : T.VOID; }
  setTile(x, y, t) { if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = t; }
  conduitAt(x, y) { return this.inBounds(x, y) ? this.conduit[this.idx(x, y)] : 0; }

  isSolidTile(x, y, passFence = false) {
    if (!this.inBounds(x, y)) return true;
    const v = this.solid[this.idx(x, y)];
    return v === 1 || (v === 2 && !passFence);
  }
  isSolidPx(x, y) { return this.isSolidTile(Math.floor(x / TILE), Math.floor(y / TILE)); }
  isOpaque(x, y) { return !this.inBounds(x, y) || this.opaque[this.idx(x, y)] === 1; }

  isPadded(x, y) {
    for (const p of this.pads) if (Math.abs(x - p.tx) <= p.r && Math.abs(y - p.ty) <= p.r) return true;
    return false;
  }
  isWater(x, y) { return this.inBounds(x, y) && this.water[this.idx(x, y)] === 1; }
  isWaterPx(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    return this.isWater(tx, ty) && !this.isPadded(tx, ty);
  }
  isWaterLive(x, y) {
    if (!this.isWater(x, y) || this.isPadded(x, y)) return false;
    const n = this.waterNode[this.idx(x, y)];
    if (n >= 0) return this.circuit.isEnergized(this.level.hazardNodes[n]);
    if (n === -2) return !!this.boss && this.boss.waterLiveT > 0;
    return false;
  }

  rebuildSolid() {
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      this.solid[i] = t === T.FLOOR ? 0 : t === T.FENCE ? 2 : 1;
      this.opaque[i] = t === T.WALL || t === T.CABINET || t === T.VOID ? 1 : 0;
    }
    for (const d of this.devices) {
      if (d.solid && d.x !== undefined) this.solid[this.idx(d.x, d.y)] = 1;
      if (d instanceof Bulkhead && d.isSolidNow) {
        for (const [x, y] of d.tiles) { this.solid[this.idx(x, y)] = 1; this.opaque[this.idx(x, y)] = 1; }
      }
    }
    if (this.isBoss) {
      const c = this.level.center;
      for (let y = c.y - 1; y <= c.y + 1; y++) for (let x = c.x - 1; x <= c.x + 1; x++) this.solid[this.idx(x, y)] = 1;
    }
  }

  collides(x, y, r, passFence) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.isSolidTile(tx, ty, passFence)) return true;
    return false;
  }

  /** Axis-separated AABB sweep against the tile grid. */
  moveEntity(e, dx, dy, r, passFence = false) {
    if (dx) {
      e.x += dx;
      if (this.collides(e.x, e.y, r, passFence)) {
        e.x = dx > 0 ? Math.floor((e.x + r) / TILE) * TILE - r - 0.01 : (Math.floor((e.x - r) / TILE) + 1) * TILE + r + 0.01;
        e.vx = 0;
      }
    }
    if (dy) {
      e.y += dy;
      if (this.collides(e.x, e.y, r, passFence)) {
        e.y = dy > 0 ? Math.floor((e.y + r) / TILE) * TILE - r - 0.01 : (Math.floor((e.y - r) / TILE) + 1) * TILE + r + 0.01;
        e.vy = 0;
      }
    }
  }

  los(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    return castRay(this, x0, y0, Math.atan2(y1 - y0, x1 - x0), d) >= d - 4;
  }

  /** BFS distance field over walkable tiles towards (px,py); nearest walkable tile if inside a wall. */
  computeField(px, py) {
    const W = this.w, H = this.h;
    const field = new Int16Array(W * H).fill(-1);
    let sx = Math.floor(px / TILE), sy = Math.floor(py / TILE);
    if (this.isSolidTile(sx, sy)) {
      let found = false;
      for (let r = 1; r < 5 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
          if (!this.isSolidTile(sx + dx, sy + dy)) { sx += dx; sy += dy; found = true; break; }
        }
      }
      if (!found) return field;
    }
    const q = new Int32Array(W * H);
    let head = 0, tail = 0;
    field[sy * W + sx] = 0;
    q[tail++] = sy * W + sx;
    while (head < tail) {
      const i = q[head++];
      const x = i % W, y = (i / W) | 0;
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (this.isSolidTile(nx, ny)) continue;
        const j = ny * W + nx;
        if (field[j] >= 0) continue;
        field[j] = field[i] + 1;
        q[tail++] = j;
      }
    }
    return field;
  }
  fieldAt(field, x, y) { return field && this.inBounds(x, y) ? field[this.idx(x, y)] : -1; }
  recomputeFlow() {
    this.flowBody = this.computeField(this.body.x, this.body.y);
    this.flowVoxel = this.computeField(this.voxel.x, this.voxel.y);
  }

  // ------------------------------------------------------------------ feedback helpers
  toast(text, color = '#e8e0c8', duration = 3.2) {
    this.toasts.push({ text, color, t: 0, max: duration });
    if (this.toasts.length > 5) this.toasts.shift();
  }

  floatText(x, y, text, color) { this.effects.push({ type: 'text', x, y, text, color, t: 0, max: 1.2 }); }

  addScrap(n, x, y) {
    const mult = (this.run.workOrder === 'hot' ? 2 : 1) * (this.run.mutator === 'overtime' ? 1.5 : 1);
    const v = Math.round(n * mult);
    this.run.rpg.scrap += v;
    this.run.scrapEarned += v;
    if (x !== undefined) this.floatText(x, y, `+${v} Cu`, '#e09a50');
  }

  hurtBody(amount, sx, sy, kind) {
    const dmg = this.body.hurt(amount, sx, sy, kind, this);
    if (dmg > 0 && (kind === 'arc' || kind === 'beam')) this.markShortcut();
    return dmg;
  }

  markShortcut() { this.run.shortcuts++; }

  arcFlash(x, y, dmg) {
    this.hurtBody(dmg * this.stats.failMult, x, y, 'flash');
    this.flash = Math.max(this.flash, 0.65);
    this.particles.sparks(x, y, 80, { speed: 360, up: 320, color: PC.WHITE });
    this.particles.sparks(x, y, 40, { speed: 220 });
    this.particles.smoke(x, y, 10);
    this.camera.addTrauma(0.75, this.body.x - x, this.body.y - y);
    this.camera.hitStop(80);
    audio.arcFlash();
  }

  setAnchor(value) {
    const old = this.run.anchor;
    const next = clamp(Math.round(value), 0, 100);
    this.run.anchor = next;
    const before = memoriesLost(old), after = memoriesLost(next);
    if (after > before) {
      const i = after - 1;
      this.bigText = { title: 'MEMORY BURNED', text: this.narrative.memoryText(i, old), t: 0, max: 5, color: '#50f0ff', icon: MEMORIES[i].icon };
      audio.memoryBurn();
    } else if (after < before) {
      this.bigText = { title: 'MEMORY RECOVERED', text: this.narrative.memoryText(after, next), t: 0, max: 5, color: '#ffe0a0', icon: MEMORIES[after].icon };
    }
    audio.setMood(next);
  }

  drainAnchor(n, text) {
    this.setAnchor(this.run.anchor - n);
    if (text && this.anchorToastCd <= 0) { this.toast(text, '#9dffd0'); this.anchorToastCd = 6; }
  }

  // ------------------------------------------------------------------ interactions
  startSkillCheck({ device, title, onSuccess, onFail, speedMult = 1, widthMult = 1 }) {
    const s = this.stats;
    const speed = (0.95 + this.run.depth * 0.1) * speedMult * (this.run.mutator === 'rust' ? 1.3 : 1);
    this.body.skill = new SkillCheck({
      title, device, onSuccess, onFail, speed,
      goodWidth: 0.2 * s.sweetBonus * widthMult,
      perfectWidth: 0.055 * s.sweetBonus * widthMult,
    });
    this.body.vx *= 0.3; this.body.vy *= 0.3;
  }

  bodyInteract() {
    const t = this.bodyTarget;
    if (!t) return;
    t.action.run();
  }

  computeTargets() {
    const b = this.body;
    this.bodyTarget = null;
    if (!b.downed && !b.skill) {
      let best = Infinity;
      for (const d of this.devices) {
        if (!d.inBodyReach || !d.inBodyReach(b)) continue;
        const a = d.bodyAction(this);
        if (!a) continue;
        // Prefer what Cole is facing, then what's closest.
        const facingPenalty = Math.abs(angleDiff(b.facing, Math.atan2(d.py - b.y, d.px - b.x))) * 14;
        const dd = dist(b.x, b.y, d.px, d.py) + facingPenalty + (a.disabled ? 40 : 0);
        if (dd < best) { best = dd; this.bodyTarget = { device: d, action: a }; }
      }
    }
    const v = this.voxel;
    this.voxelTarget = null;
    if (v.desyncT <= 0 && !v.jumper) {
      let best = TILE * 0.75;
      for (const d of this.devices) {
        if (d.px === undefined || d.x === undefined) continue;
        const dd = dist(v.x, v.y, d.px, d.py);
        if (dd > best) continue;
        const a = d.voxelAction(this);
        if (!a) continue;
        best = dd;
        this.voxelTarget = { ...a, device: d };
      }
    }
  }

  applyLoto(device, edge) {
    if (!this.circuit.lock(edge.id)) return;
    this.body.padlocks--;
    this.run.lotoCount++;
    device.verified = false;
    audio.lockClick();
    this.particles.sparks(device.px, device.py, 6, { color: PC.BRASS, speed: 60 });
    if (this.run.mutator === 'audit') this.narrative.event('lotoAudit', { label: device.label });
    else {
      this.run.efficiency *= 0.86;
      this.narrative.event('loto', { label: device.label }, this.run.anchor);
    }
    this.toast('LOCKED · TAGGED — now TRY it: verify dead with the MULTIMETER', '#d8b04a', 4);
  }

  useTool(body) {
    if (body.tool === 'HOT STICK') {
      if (body.stickCd > 0) return;
      body.stickCd = 0.42;
      body.swingT = 0.22;
      audio.swing();
      const reach = this.stats.stickReach;
      const hx = body.x, hy = body.y - 8;
      let hits = 0;
      const struck = [];
      for (const a of this.anomalies) {
        if (!a.alive) continue;
        const d = dist(hx, hy, a.x, a.y);
        if (d > reach + a.r) continue;
        if (Math.abs(angleDiff(body.facing, Math.atan2(a.y - hy, a.x - hx))) > 1.2 && d > 18) continue;
        if (a.hit(this.stats.stickDamage, this, body.x, body.y)) { hits++; struck.push(a); }
        else if (a.kind === 'phantom') this.floatText(a.x, a.y - 30, 'UNMEASURED', '#9dffd0');
      }
      if (this.stats.chain && struck.length) {
        const src = struck[0];
        const others = this.anomalies.filter((a) => a.alive && a !== src && dist(a.x, a.y, src.x, src.y) < 150).slice(0, this.stats.chain);
        for (const o of others) {
          o.hit(this.stats.stickDamage * 0.6, this, src.x, src.y);
          this.effects.push({ type: 'bolt', pts: lightningPath(src.x, src.y - 8, o.x, o.y - 8, 8, 10), t: 0, max: 0.2, color: 'rgba(200,230,255,0.95)' });
        }
      }
      if (this.boss && dist(hx, hy, this.boss.x, this.boss.y) < reach + 52 &&
        Math.abs(angleDiff(body.facing, Math.atan2(this.boss.y - hy, this.boss.x - hx))) < 1.3) {
        if (this.boss.hitCore(this.stats.stickDamage, this)) hits++;
      }
      if (hits) {
        audio.hit();
        this.camera.hitStop(50);
        this.camera.addTrauma(0.22, Math.cos(body.facing), Math.sin(body.facing));
        this.particles.sparks(hx + Math.cos(body.facing) * reach * 0.7, hy + Math.sin(body.facing) * reach * 0.7, 16, { speed: 220, angle: body.facing, spread: 1.6 });
      }
    } else {
      if (body.scanCd > 0) return;
      body.scanCd = 1.6;
      audio.scan();
      const R = this.stats.scanRadius;
      this.effects.push({ type: 'ring', x: body.x, y: body.y, r0: 10, r1: R, t: 0, max: 0.6, color: '120,255,140' });
      for (const a of this.anomalies) {
        if (!a.alive || dist(a.x, a.y, body.x, body.y) > R) continue;
        if (a.kind === 'phantom') a.measuredT = 3.5;
        if (a.kind === 'hound') a.stunT = Math.max(a.stunT, this.stats.scanStun);
        if (a.kind === 'crawler') a.stunT = Math.max(a.stunT, 0.5);
      }
      for (const d of this.devices) {
        if (dist(d.px, d.py, body.x, body.y) > R) continue;
        if (d instanceof CipherTerminal) d.seenByBody = 8;
        if (d instanceof BreakerBox) {
          const e = this.circuit.getEdge(d.edge);
          const live = e && this.circuit.isEnergized(e.b);
          this.floatText(d.px, d.py - 30, live ? '480V LIVE' : '0.0V DEAD', live ? '#ff6040' : '#80ff90');
          if (e && e.locked && !d.verified) {
            d.verified = true;
            this.run.verified++;
            this.addScrap(4, d.px, d.py - 44);
            this.toast('LOCK · TAG · TRY — zero energy verified', '#80ff90');
          }
        }
      }
      for (const g of this.hazardLights) {
        if (dist(g.x, g.y, body.x, body.y) > R * 1.6) continue;
        const live = this.circuit.isEnergized(g.node);
        this.floatText(g.x, g.y - 10, live ? 'WATER LIVE · 277V' : 'WATER DEAD', live ? '#ff6040' : '#80ff90');
      }
    }
  }

  voxelMaterialize(v) {
    if (v.materializeCd > 0 || v.desyncT > 0) return;
    let best = null, bd = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = v.tx + dx, y = v.ty + dy;
      if (!this.isWater(x, y)) continue;
      const d = Math.hypot(dx, dy) - (this.isWaterLive(x, y) ? 0.5 : 0);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!v.spend(this.stats.materializeCost)) return;
    v.materializeCd = 0.8;
    audio.materialize();
    if (best) {
      this.pads.push({ tx: best.x, ty: best.y, r: 1, t: 10, max: 10 });
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        this.particles.voxels((best.x + dx + 0.5) * TILE, (best.y + dy + 0.5) * TILE, 3, { burst: 40 });
      }
      this.toast('INSULATED VOXEL PAD · 10s', '#50f0ff', 2);
    } else {
      this.decoys.push({ x: v.x, y: v.y, t: 6, max: 6 });
      this.particles.voxels(v.x, v.y, 24, { burst: 90 });
      this.toast('HOLOGRAPHIC DECOY · 6s', '#50f0ff', 2);
    }
  }

  voxelPulse(v) {
    const R = this.stats.pulseRadius;
    this.effects.push({ type: 'ring', x: v.x, y: v.y, r0: 6, r1: R, t: 0, max: 0.35, color: '80,240,255' });
    for (const a of this.anomalies) {
      if (!a.alive) continue;
      const d = dist(a.x, a.y, v.x, v.y);
      if (d > R) continue;
      if (this.stats.pulsePull && d > 1) { a.vx += ((v.x - a.x) / d) * 220; a.vy += ((v.y - a.y) / d) * 220; }
      a.stunT = Math.max(a.stunT, 0.5);
      if (a.kind !== 'phantom' || a.measuredT > 0) a.hit(a.kind === 'crawler' ? 30 : 14, this, v.x, v.y);
    }
  }

  ghostLockoutNearest() {
    let best = null, bd = Infinity;
    for (const d of this.devices) {
      if (!(d instanceof BreakerBox)) continue;
      const e = this.circuit.getEdge(d.edge);
      if (!e || e.removed || e.locked || e.ghostT > 0) continue;
      if (!e.closed && e.recloseT <= 0) continue;
      const dd = dist(d.px, d.py, this.voxel.x, this.voxel.y);
      if (dd < bd) { bd = dd; best = { d, e }; }
    }
    if (!best) { audio.deny(); this.toast('NO BREAKER TO GHOST-LOCK', '#50f0ff'); return false; }
    this.circuit.ghostLock(best.e.id, 8);
    audio.lockClick();
    audio.materialize();
    this.effects.push({ type: 'bolt', pts: lightningPath(this.voxel.x, this.voxel.y, best.d.px, best.d.py, 16, 18), t: 0, max: 0.5, color: 'rgba(80,240,255,0.9)' });
    this.particles.voxels(best.d.px, best.d.py, 20);
    this.toast(`GHOST LOCKOUT → ${best.d.label} · 8s`, '#50f0ff');
    return true;
  }

  overclock() {
    if (this.overclockCd > 0 || this.exitT > 0) return;
    const run = this.run;
    if (this.boss && this.boss.phase === 3 && !this.boss.defeated) {
      if (run.anchor <= 0) { audio.deny(); return; }
      run.burnedAll = true;
      this.setAnchor(0);
      this.surgeFx(1.2);
      this.narrative.event('burnAll', { priority: true });
      this.bigText = { title: 'EVERYTHING BURNED', text: 'Their names. The key. The watch. The porch light. All of it, into the grid.', t: 0, max: 6, color: '#50f0ff', icon: 'photo' };
      this.boss.defeat('burn');
      this.onBossDefeated('burn');
      return;
    }
    const cost = this.stats.overclockCost;
    if (this.voxel.desyncT > 0) { audio.deny(); return; }
    if (run.anchor < cost) {
      audio.deny();
      this.toast('NOT ENOUGH OF COLE LEFT TO BURN', '#ff8080');
      return;
    }
    this.overclockCd = 3;
    run.overclocks++;
    this.markShortcut();
    run.efficiency = Math.min(1.6, run.efficiency * 1.1);
    this.setAnchor(run.anchor - cost);
    this.surgeFx(1);
    if (this.body.downed) {
      this.body.revive(0.55);
      this.toast('OVERCLOCK REVIVE — the body stands back up', '#50f0ff');
    }
    this.circuit.forceOff(10);
    for (const a of this.anomalies) {
      if (!a.alive) continue;
      if (dist(a.x, a.y, this.body.x, this.body.y) < TILE * 9 || dist(a.x, a.y, this.voxel.x, this.voxel.y) < TILE * 6) {
        a.measuredT = 1;
        a.hit(999, this, this.body.x, this.body.y);
      }
    }
    for (const d of this.devices) {
      if (d instanceof CapacitorBank && dist(d.px, d.py, this.body.x, this.body.y) < TILE * 8) d.charge = 0;
    }
    this.voxel.coherence = 100;
    this.narrative.event('overclock', {}, run.anchor);
  }

  surgeFx(k) {
    this.flash = 1;
    this.camera.addTrauma(1);
    this.camera.hitStop(120 * k);
    this.camera.punch(0.08 * k);
    audio.overclock();
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 300;
      this.particles.voxels(this.voxel.x + Math.cos(a) * r, this.voxel.y + Math.sin(a) * r, 1, { burst: 120, rise: 90 });
    }
    this.particles.sparks(this.body.x, this.body.y, 60, { speed: 400, up: 300, color: PC.CYAN });
    this.effects.push({ type: 'ring', x: this.voxel.x, y: this.voxel.y, r0: 10, r1: 600, t: 0, max: 0.8, color: '80,240,255' });
  }

  spawnAnomalyNear(kind, x, y, max, radius = TILE * 6) {
    if (this.anomalies.filter((a) => a.alive && a.kind === kind).length >= max) return;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = radius * (0.5 + Math.random() * 0.5);
      const sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r;
      if (kind !== 'phantom' && this.isSolidPx(sx, sy)) continue;
      if (dist(sx, sy, this.body.x, this.body.y) < TILE * 3) continue;
      const m = createAnomaly(kind, sx, sy);
      m.aggro = true;
      this.anomalies.push(m);
      this.particles.voxels(sx, sy, 16, { color: kind === 'crawler' ? PC.ROT : PC.WHITE, burst: 60 });
      return;
    }
  }

  ejectBodyFrom(bulk) {
    const b = this.body;
    if (b.x + b.r < bulk.x0 || b.x - b.r > bulk.x1 || b.y + b.r < bulk.y0 || b.y - b.r > bulk.y1) return;
    if (bulk.orient === 'v') b.x = Math.abs(b.x - bulk.x0) < Math.abs(b.x - bulk.x1) ? bulk.x0 - b.r - 1 : bulk.x1 + b.r + 1;
    else b.y = Math.abs(b.y - bulk.y0) < Math.abs(b.y - bulk.y1) ? bulk.y0 - b.r - 1 : bulk.y1 + b.r + 1;
    this.hurtBody(8, bulk.px, bulk.py, 'crush');
    this.toast('The bulkhead slams shut — hold the jumper longer!', '#ffb040');
  }

  // ------------------------------------------------------------------ events
  onCircuitEvent(type, data) {
    const label = data.edge && data.edge.label;
    if (type === 'reclose') {
      this.narrative.event('reclose', { label }, this.run.anchor);
      audio.clunk();
      const dev = this.devices.find((d) => d instanceof BreakerBox && d.edge === data.edge.id);
      if (dev) { this.particles.sparks(dev.px, dev.py, 20); dev.flash = 1; this.toast(`SCADA AUTO-RECLOSE: ${label} is LIVE again`, '#ff8040'); }
    }
  }

  onBodyDowned() {
    this.run.downs++;
    this.narrative.event('downed', { priority: true }, this.run.anchor);
    this.toast('COLE IS DOWN — VOXEL can OVERCLOCK to revive him (burns a memory)', '#ff5050', 6);
    this.camera.addTrauma(1);
    audio.arcFlash();
  }

  onAnomalyKilled(a) {
    this.addScrap(a.kind === 'hound' ? 6 : a.kind === 'phantom' ? 8 : 3, a.x, a.y - 16);
  }

  onCipherSolved(term) {
    this.run.ciphers++;
    this.run.cipherFloors.add(this.run.depth);
    this.addScrap(20, term.px, term.py - 20);
    audio.synergy();
    this.particles.voxels(term.px, term.py, 50, { color: PC.GREEN, burst: 120 });
    this.narrative.event('cipher', { priority: true });
    this.toast(`SCHEMATIC CIPHER SOLVED (${this.run.ciphers}/4)`, '#ffd860', 5);
  }

  onMemoryShard(dev) {
    this.run.memoryShards++;
    const text = this.narrative.shard(this.run.memoryShards - 1, this.run.anchor);
    this.setAnchor(this.run.anchor + 10);
    if (!this.bigText || this.bigText.title !== 'MEMORY RECOVERED') {
      this.bigText = { title: 'MEMORY SHARD  +10 ANCHOR', text, t: 0, max: 5, color: '#ffe0a0', icon: 'photo' };
    }
    audio.pickup();
    audio.memoryBurn();
    this.particles.embers(dev.px, dev.py, 20, PC.WHITE);
  }

  onBossDefeated(how) {
    if (this.completed) return;
    this.completed = true;
    this.flash = 1;
    this.camera.addTrauma(1);
    audio.bossRoar();
    this.exitT = 3.2;
    this.exitKind = 'boss';
    this.bossHow = how;
  }

  completeFloor() {
    if (this.completed) return;
    this.completed = true;
    this.exitT = 2.6;
    this.exitKind = 'elevator';
    audio.elevator();
    this.voxel.releaseJumper(this);
  }

  summary() {
    const run = this.run;
    const depth = run.depth;
    const timeBonus = this.meltdownMax > 0 && this.meltdown / this.meltdownMax > 0.5 ? 1.25 : 1;
    const basePay = 30 + depth * 14;
    const pay = Math.round(basePay * run.efficiency * timeBonus * (run.workOrder === 'hot' ? 2 : 1) * (run.mutator === 'overtime' ? 1.5 : 1));
    return { depth, pay, efficiency: run.efficiency, timeBonus, time: this.time, timeLeft: this.meltdown };
  }

  objective() {
    if (this.boss) {
      const b = this.boss;
      if (b.defeated) return 'It\'s over.';
      if (b.phase === 1) return `De-energize all 3 bushings: throw + LOTO breakers 52-TA/TB/TC (dead 3s each) · ${b.failed.size}/3`;
      if (b.phase === 2) return 'VOXEL: hold NEUTRAL GROUND (north-west) · BODY: strike the exposed coil with the Hot Stick';
      return `Throw the MAIN DISCONNECT (north) while grounded · ${Math.ceil(b.meltdown)}s`;
    }
    const b = this.body;
    const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE);
    const r = this.exitRoom;
    if (r && tx > r.x0 && tx < r.x0 + 14 && ty > r.y0 && ty < r.y0 + 10) return 'Ride the freight elevator down';
    const bulk = this.devices.find((d) => d instanceof Bulkhead);
    const live = this.hazardLights.filter((g) => this.circuit.isEnergized(g.node)).length;
    const parts = [];
    if (bulk && bulk.open < 1) parts.push('Elevator bulkhead is dead — VOXEL: hold a living jumper on the blown F-200A fuse');
    else parts.push('Bulkhead open — get the Body through!');
    if (live) parts.push(`${live} live water hazard${live > 1 ? 's' : ''} on site`);
    return parts.join(' · ');
  }

  // ------------------------------------------------------------------ update
  update(dt, intents) {
    if (this.exitT > 0) {
      this.exitT -= dt;
      this.time += dt;
      this.particles.update(dt, this);
      this.updateTimers(dt);
      if (this.exitKind === 'elevator') this.camera.addTrauma(dt * 0.4);
      if (this.exitT <= 0) {
        this.run.hp = this.body.hp;
        if (this.exitKind === 'boss') this.game.onBossDefeated(this.bossHow);
        else this.game.onFloorComplete(this.summary());
      }
      return;
    }
    this.time += dt;
    this.overclockCd = Math.max(0, this.overclockCd - dt);
    this.anchorToastCd = Math.max(0, this.anchorToastCd - dt);
    this.circuit.update(dt);
    this.computeTargets();
    this.body.update(dt, intents.body, this);
    this.voxel.update(dt, intents.voxel, this);
    for (const d of this.devices) d.update(dt, this);

    this.flowT -= dt;
    if (this.flowT <= 0) { this.flowT = 0.35; this.recomputeFlow(); }
    for (const a of this.anomalies) if (a.alive) a.update(dt, this);
    this.anomalies = this.anomalies.filter((a) => a.alive);
    if (this.boss) this.boss.update(dt, this);

    for (const p of this.pads) p.t -= dt;
    this.pads = this.pads.filter((p) => p.t > 0);
    for (const d of this.decoys) d.t -= dt;
    this.decoys = this.decoys.filter((d) => d.t > 0);

    this.updateHazards(dt);
    this.updateLasso(dt);
    this.updateStress(dt);
    this.updateMeltdown(dt);
    this.updateTimers(dt);
    this.particles.update(dt, this);

    const b = this.body;
    const fpower = this.run.anchor < 30 && Math.random() < 0.05 ? 0.3 : 1;
    this.flashlight = {
      x: b.x + Math.cos(b.facing) * 6, y: b.y - 10 + Math.sin(b.facing) * 4, angle: b.facing,
      spread: 0.44, range: 330 * this.lightScale, power: fpower,
    };

    const targets = [{ x: b.x, y: b.y - 10, weight: 1.3 }];
    if (this.voxel.desyncT <= 0) targets.push({ x: this.voxel.x, y: this.voxel.y, weight: 0.8 });
    if (this.boss && !this.boss.defeated) targets.push({ x: this.boss.x, y: this.boss.y, weight: 0.25 });
    this.camera.frame(targets, dt);

    // Audio: hum follows the live copper around the Body; crackle follows live hazards.
    let crackle = 0;
    for (const g of this.hazardLights) {
      if (!this.circuit.isEnergized(g.node)) continue;
      crackle = Math.max(crackle, 1 - dist(g.x, g.y, b.x, b.y) / (TILE * 7));
    }
    for (const d of this.devices) if (d.active && d.axp !== undefined) crackle = Math.max(crackle, 1 - dist(d.px, d.py, b.x, b.y) / (TILE * 6));
    if (this.voxel.jumper) crackle = Math.max(crackle, 0.7);
    if (this.boss && this.boss.beamsActive(this)) crackle = Math.max(crackle, 0.5);
    audio.setCrackle(clamp(crackle, 0, 1));
    audio.setHum(clamp(this.circuit.liveLoadCount() / 8, 0, 1), this.circuit.stress);

    if (b.downed && b.downedT <= 0 && !this.terminated) {
      this.terminated = true;
      this.run.hp = 0;
      this.game.onShiftTerminated();
    }
  }

  updateTimers(dt) {
    this.flash = Math.max(0, this.flash - dt * 2.2);
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < e.max);
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < t.max);
    if (this.bigText) { this.bigText.t += dt; if (this.bigText.t > this.bigText.max) this.bigText = null; }
  }

  updateHazards(dt) {
    const b = this.body;
    if (b.downed) return;
    const tx = Math.floor(b.x / TILE), ty = Math.floor((b.y + 6) / TILE);
    if (this.isWaterLive(tx, ty) && !b.isPhasing(this)) {
      if (this.outOfWaterT > 1) this.markShortcut();
      this.outOfWaterT = 0;
      this.liveWaterT += dt;
      this.hurtBody(40 * dt, b.x, b.y, 'water');
      this.camera.addTrauma(dt * 1.6);
      if (Math.random() < dt * 30) this.particles.sparks(b.x + (Math.random() - 0.5) * 20, b.y + 8, 2, { speed: 140, up: 160, color: PC.WHITE });
      if (Math.random() < dt * 8) this.effects.push({ type: 'bolt', pts: lightningPath(b.x, b.y - 20, b.x + (Math.random() - 0.5) * 50, b.y + 10, 5, 8), t: 0, max: 0.08, color: 'rgba(200,230,255,0.9)' });
      if (Math.random() < dt * 4) audio.spark(0.6);
    } else {
      this.outOfWaterT += dt;
    }
  }

  updateLasso(dt) {
    const b = this.body, v = this.voxel;
    this.lassoOn = this.stats.arcLasso && !b.downed && v.desyncT <= 0 && dist(b.x, b.y, v.x, v.y) < 460;
    if (!this.lassoOn) { this.lasso.inited = false; return; }
    this.lasso.update(dt, b.x, b.y - 14, v.x, v.y - 10, 4, 0, 1.02);
    for (const a of this.anomalies) {
      if (!a.alive) continue;
      if (distToSegmentPts(a.x, a.y, this.lasso) < a.r + 6) {
        if (a.kind === 'phantom') a.measuredT = Math.max(a.measuredT, 0.2);
        a.hit(110 * dt, this, (b.x + v.x) / 2, (b.y + v.y) / 2);
        if (Math.random() < dt * 20) this.particles.sparks(a.x, a.y, 3, { color: PC.CYAN, speed: 160 });
      }
    }
  }

  updateStress(dt) {
    if (this.isBoss) return;
    this.stressSpawnT -= dt;
    if (this.circuit.stress > 0.35 && this.stressSpawnT <= 0) {
      this.stressSpawnT = 13;
      const pl = this.circuit.phaseLoad;
      const low = ['A', 'B', 'C'].reduce((m, p) => (pl[p] < pl[m] ? p : m), 'A');
      this.narrative.event('imbalance', { phase: low }, this.run.anchor);
      this.spawnAnomalyNear('phantom', this.body.x, this.body.y, 3, TILE * 8);
      this.toast('PHASE IMBALANCE — harmonics manifest. (Balance your lockouts across A/B/C)', '#9dffd0', 4);
    }
  }

  updateMeltdown(dt) {
    if (this.isBoss || this.meltdownMax <= 0) return;
    this.meltdown = Math.max(0, this.meltdown - dt);
    if (!this.warned && this.meltdown <= 30) {
      this.warned = true;
      this.narrative.event('meltdownWarn', { priority: true }, this.run.anchor);
    }
    if (this.meltdown <= 0) {
      this.meltdownTick -= dt;
      if (this.meltdownTick <= 0) {
        if (!this.meltedOnce) { this.meltedOnce = true; this.narrative.event('meltdown', { priority: true }, this.run.anchor); }
        this.meltdownTick = 2;
        this.hurtBody(6, this.body.x, this.body.y, 'flash');
        this.drainAnchor(1, 'The load spike hums through your teeth. The Timex skips a beat.');
        this.camera.addTrauma(0.3);
        if (Math.random() < 0.3) this.spawnAnomalyNear('hound', this.body.x, this.body.y, 6, TILE * 8);
      }
    }
  }

  // ------------------------------------------------------------------ rendering
  buildStaticLayer() {
    const W = this.w, H = this.h;
    const c = document.createElement('canvas');
    c.width = W * TILE; c.height = H * TILE;
    const g = c.getContext('2d');
    g.fillStyle = '#050607';
    g.fillRect(0, 0, c.width, c.height);
    const seed = this.level.seed & 0xffff;
    const floorLike = (t) => t === T.FLOOR || t === T.FENCE;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = this.tiles[this.idx(x, y)];
        const px = x * TILE, py = y * TILE;
        if (floorLike(t) || t === T.CABINET) {
          const n = noise2(x * 0.35, y * 0.35, seed);
          const v = 38 + n * 14 + hashNoise(x, y, seed) * 5;
          g.fillStyle = `rgb(${v | 0},${(v + 3) | 0},${(v + 6) | 0})`;
          g.fillRect(px, py, TILE, TILE);
          for (let k = 0; k < 10; k++) {
            const h = hashNoise(x * 13 + k, y * 7 - k, seed);
            g.fillStyle = h > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
            g.fillRect(px + hashNoise(k, x, y) * 31, py + hashNoise(y, k, x) * 31, 1, 1);
          }
          if (x % 4 === 0) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py, 1, TILE); }
          if (y % 4 === 0) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py, TILE, 1); }
          const h = hashNoise(x, y, seed + 9);
          if (h > 0.965) {
            g.fillStyle = 'rgba(12,10,6,0.45)';
            g.beginPath(); g.ellipse(px + 16, py + 16, 10 + h * 8, 5 + h * 4, h * 6, 0, Math.PI * 2); g.fill();
          } else if (h < 0.025) {
            g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1;
            g.beginPath(); g.moveTo(px + 2, py + 5); g.lineTo(px + 12, py + 14); g.lineTo(px + 18, py + 12); g.lineTo(px + 30, py + 26); g.stroke();
          } else if (h > 0.93 && h < 0.94) {
            g.fillStyle = '#1c1e20'; g.fillRect(px + 6, py + 6, 20, 20);
            g.fillStyle = '#2e3236'; for (let k = 0; k < 5; k++) g.fillRect(px + 8 + k * 4, py + 7, 2, 18);
          }
        } else if (t === T.WALL) {
          const nearFloor = DIRS.some((d) => floorLike(this.tileAt(x + d.dx, y + d.dy))) ||
            floorLike(this.tileAt(x + 1, y + 1)) || floorLike(this.tileAt(x - 1, y - 1)) || floorLike(this.tileAt(x + 1, y - 1)) || floorLike(this.tileAt(x - 1, y + 1));
          if (!nearFloor) continue;
          g.fillStyle = '#16181b';
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle = 'rgba(255,255,255,0.05)';
          g.fillRect(px, py, TILE, 2);
          if (floorLike(this.tileAt(x, y + 1))) {
            const grad = g.createLinearGradient(0, py + 14, 0, py + TILE);
            grad.addColorStop(0, '#40454b'); grad.addColorStop(1, '#2a2d31');
            g.fillStyle = grad;
            g.fillRect(px, py + 14, TILE, TILE - 14);
            g.fillStyle = 'rgba(0,0,0,0.35)';
            g.fillRect(px, py + 14, TILE, 2);
            if (hashNoise(x, y, seed + 3) > 0.7) {
              g.fillStyle = 'rgba(120,60,20,0.35)';
              g.fillRect(px + hashNoise(x, y, 4) * 26, py + 16, 2, 8 + hashNoise(y, x, 5) * 8);
            }
            if (x % 6 === 0) { g.fillStyle = '#5a5f66'; g.fillRect(px, py + 18, TILE, 3); }
          }
        }
        if (t === T.CABINET) {
          const right = this.tileAt(x + 1, y) === T.CABINET, below = this.tileAt(x, y + 1) === T.CABINET;
          const left = this.tileAt(x - 1, y) === T.CABINET, above = this.tileAt(x, y - 1) === T.CABINET;
          g.fillStyle = 'rgba(0,0,0,0.45)';
          g.fillRect(px + 3, py + 6, TILE, TILE);
          g.fillStyle = '#4b5258';
          g.fillRect(px + (left ? 0 : 2), py + (above ? 0 : 1), TILE - (left ? 0 : 2) - (right ? 0 : 2), TILE - (above ? 0 : 1) - (below ? 0 : 0));
          g.fillStyle = '#5e666d';
          g.fillRect(px + (left ? 0 : 2), py + (above ? 0 : 1), TILE - (left ? 0 : 2) - (right ? 0 : 2), 10);
          if (!below) {
            g.fillStyle = '#383d42';
            g.fillRect(px + (left ? 0 : 2), py + 22, TILE - (left ? 0 : 2) - (right ? 0 : 2), 10);
            for (let k = 0; k < 4; k++) { g.fillStyle = '#25292d'; g.fillRect(px + 6 + k * 5, py + 25, 3, 1); }
          }
          if (!left) {
            g.fillStyle = '#e0c020';
            g.beginPath(); g.moveTo(px + 9, py + 12); g.lineTo(px + 15, py + 21); g.lineTo(px + 3, py + 21); g.closePath(); g.fill();
            g.fillStyle = '#111'; g.fillRect(px + 8.5, py + 15, 1, 4);
          }
          g.fillStyle = '#9aa2a8';
          g.fillRect(px + TILE - 7, py + 14, 2, 5);
        }
      }
    }
    // Conduit base: dull copper channels cut into concrete and walls.
    g.strokeStyle = 'rgba(70,110,120,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const m = this.conduit[this.idx(x, y)];
      if (!m) continue;
      const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
      if (m & 2) { g.moveTo(cx, cy); g.lineTo(cx + TILE, cy); }
      if (m & 4) { g.moveTo(cx, cy); g.lineTo(cx, cy + TILE); }
    }
    g.stroke();
    // Safety paint & stencils
    g.font = 'bold 14px "IBM Plex Mono", ui-monospace, monospace';
    g.textAlign = 'center';
    for (const r of this.level.rooms) {
      if (this.isBoss) break;
      g.strokeStyle = 'rgba(210,170,40,0.18)';
      g.lineWidth = 2;
      g.strokeRect((r.x0 + 1.5) * TILE, (r.y0 + 1.5) * TILE, 12 * TILE, 8 * TILE);
      if (r.isStart) {
        g.fillStyle = 'rgba(220,200,150,0.12)';
        g.fillText(`SUBSTATION ZERO · DEPTH ${this.run.depth}`, (r.cx + 0.5) * TILE, (r.cy - 2) * TILE);
      } else if (hashNoise(r.gx, r.gy, seed) > 0.6) {
        g.fillStyle = 'rgba(200,40,30,0.13)';
        g.fillText('DANGER · 480V', (r.cx + 0.5) * TILE, (r.cy + 3.5) * TILE);
      }
    }
    if (this.isBoss) {
      g.fillStyle = 'rgba(200,40,30,0.15)';
      g.fillText('DANGER · 13,800 VOLTS · AUTHORISED PERSONNEL ONLY', (this.level.center.x + 0.5) * TILE, (this.level.center.y + 8) * TILE);
    }
    return c;
  }

  render(ctx, t) {
    const cam = this.camera;
    const view = cam.visibleRect(64);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, cam.w, cam.h);
    cam.apply(ctx);

    // Static layer (only the visible sub-rect).
    const sx = clamp(Math.floor(view.x0), 0, this.staticLayer.width);
    const sy = clamp(Math.floor(view.y0), 0, this.staticLayer.height);
    const sw = clamp(Math.ceil(view.x1), 0, this.staticLayer.width) - sx;
    const sh = clamp(Math.ceil(view.y1), 0, this.staticLayer.height) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(this.staticLayer, sx, sy, sw, sh, sx, sy, sw, sh);

    const tx0 = Math.max(0, Math.floor(view.x0 / TILE)), ty0 = Math.max(0, Math.floor(view.y0 / TILE));
    const tx1 = Math.min(this.w - 1, Math.floor(view.x1 / TILE)), ty1 = Math.min(this.h - 1, Math.floor(view.y1 / TILE));
    this.renderWater(ctx, t, tx0, ty0, tx1, ty1);
    this.renderFences(ctx, tx0, ty0, tx1, ty1);
    this.renderPads(ctx, t);

    for (const d of this.devices) d.render(ctx, this, t);
    if (this.boss) this.boss.render(ctx, this, t);

    const actors = [this.body, ...this.anomalies.filter((a) => a.kind !== 'phantom')];
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) {
      if (a === this.body) this.renderBody(ctx, t);
      else a.render(ctx, this, t);
    }

    // Darkness (uses last frame's dynamic lights).
    this.dynLights = this.dynLightsPrev;
    this.lighting.render(ctx, cam, this, t);
    this.dynLights = [];
    cam.apply(ctx);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.renderReflections(ctx, t, tx0, ty0, tx1, ty1, view);
    this.renderSchematic(ctx, t, tx0, ty0, tx1, ty1);
    for (const d of this.devices) d.renderGlow(ctx, this, t);
    for (const a of this.anomalies) a.renderGlow(ctx, this, t);
    if (this.boss) this.boss.renderGlow(ctx, this, t);
    this.voxel.renderGlow(ctx, this);
    this.renderLasso(ctx);
    this.particles.renderGlow(ctx, view);
    ctx.restore();

    this.particles.render(ctx, view);
    for (const a of this.anomalies) if (a.kind === 'phantom') a.render(ctx, this, t);
    for (const d of this.decoys) this.renderDecoy(ctx, d, t);
    this.voxel.render(ctx, t, this);
    this.renderEffects(ctx);
    this.renderPrompts(ctx, t);
    if (this.body.skill) this.body.skill.render(ctx, this.body.x, this.body.y - 62);
    this.dynLightsPrev = this.dynLights;

    if (this.exitT > 0 && this.exitKind === 'elevator') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(0,0,0,${clamp(1 - this.exitT / 2.6, 0, 1)})`;
      ctx.fillRect(0, 0, cam.w, cam.h);
    }
  }

  renderBody(ctx, t) {
    if (this.exitT > 0 && this.exitKind === 'elevator') {
      ctx.save();
      ctx.globalAlpha = clamp(this.exitT / 2.6, 0, 1);
      this.body.render(ctx, t, this);
      ctx.restore();
      return;
    }
    this.body.render(ctx, t, this);
  }

  renderWater(ctx, t, tx0, ty0, tx1, ty1) {
    // Batched: one path per layer instead of a fill (and a colour string) per tile.
    const dead = new Path2D(), live = new Path2D(), ripples = new Path2D(), rims = new Path2D();
    const sparks = [];
    let any = false;
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      if (!this.isWater(x, y)) continue;
      any = true;
      const px = x * TILE, py = y * TILE;
      const isLive = this.isWaterLive(x, y);
      (isLive ? live : dead).rect(px, py, TILE, TILE);
      const w = Math.sin(t * 1.6 + x * 0.9 + y * 0.6);
      ripples.rect(px + 4 + w * 2, py + 10 + w * 3, 18, 1);
      ripples.rect(px + 12 - w * 2, py + 22 - w * 2, 14, 1);
      if (!this.isWater(x, y - 1)) rims.rect(px, py, TILE, 1);
      if (isLive && hashNoise(x, y, Math.floor(t * 18)) > 0.9) sparks.push(px, py);
    }
    if (!any) return;
    ctx.fillStyle = 'rgba(14,26,34,0.78)'; ctx.fill(dead);
    ctx.fillStyle = 'rgba(30,60,90,0.82)'; ctx.fill(live);
    ctx.fillStyle = 'rgba(150,190,210,0.08)'; ctx.fill(ripples);
    ctx.fillStyle = 'rgba(160,200,220,0.12)'; ctx.fill(rims);
    ctx.strokeStyle = 'rgba(200,230,255,0.8)'; ctx.lineWidth = 1;
    for (let i = 0; i < sparks.length; i += 2) {
      const px = sparks[i], py = sparks[i + 1];
      strokePath(ctx, lightningPath(px + 4, py + 6 + Math.random() * 20, px + 28, py + 6 + Math.random() * 20, 4, 5));
    }
  }

  renderReflections(ctx, t, tx0, ty0, tx1, ty1, view) {
    ctx.save();
    ctx.beginPath();
    let any = false;
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      if (this.isWater(x, y)) { ctx.rect(x * TILE, y * TILE, TILE, TILE); any = true; }
    }
    if (!any) { ctx.restore(); return; }
    ctx.clip();
    for (const b of this.bulbs) {
      if (!b.current || b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
      const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, 46);
      g.addColorStop(0, `rgba(255,200,130,${0.45 * b.current})`);
      g.addColorStop(1, 'rgba(255,160,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x - 8, b.y - 46, 16, 92);
    }
    const fl = this.flashlight;
    if (fl && !this.body.downed) {
      const rx = fl.x + Math.cos(fl.angle) * 90, ry = fl.y + Math.sin(fl.angle) * 90;
      const g = ctx.createRadialGradient(rx, ry, 1, rx, ry, 40);
      g.addColorStop(0, `rgba(255,240,210,${0.35 * fl.power})`);
      g.addColorStop(1, 'rgba(255,240,210,0)');
      ctx.fillStyle = g;
      ctx.fillRect(rx - 40, ry - 40, 80, 80);
    }
    const v = this.voxel;
    ctx.fillStyle = 'rgba(80,240,255,0.25)';
    ctx.fillRect(v.x - 6, v.y + 4, 12, 22);
    for (const g of this.hazardLights) {
      if (!this.circuit.isEnergized(g.node)) continue;
      const k = 0.25 + 0.2 * Math.random();
      const gr = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, 90);
      gr.addColorStop(0, `rgba(140,190,255,${k})`);
      gr.addColorStop(1, 'rgba(140,190,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(g.x - 90, g.y - 90, 180, 180);
      this.dynLights.push({ x: g.x, y: g.y, r: 120, i: 0.5, color: `rgba(140,190,255,${k * 0.4})` });
    }
    this.particles.renderReflections(ctx, this, view);
    ctx.restore();
  }

  renderSchematic(ctx, t, tx0, ty0, tx1, ty1) {
    // P2's schematic overlay: faint everywhere, bright near the Voxel; travelling packets.
    // Brightness is bucketed by distance to the Voxel so each bucket is one stroke.
    const v = this.voxel;
    const B = 4;
    const lines = Array.from({ length: B }, () => new Path2D());
    const packets = Array.from({ length: B }, () => new Path2D());
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const m = this.conduitAt(x, y);
      if (!m) continue;
      const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
      const near = clamp(1 - dist(cx, cy, v.x, v.y) / (TILE * 7), 0, 1);
      const k = Math.min(B - 1, Math.floor(near * B));
      if (m & 2) { lines[k].moveTo(cx, cy); lines[k].lineTo(cx + TILE, cy); }
      if (m & 4) { lines[k].moveTo(cx, cy); lines[k].lineTo(cx, cy + TILE); }
      if (((x * 7 + y * 3) & 7) === 0) {
        const phase = (t * 1.5 + (x + y) * 0.13) % 1;
        if (m & 2) packets[k].rect(cx + phase * TILE - 1.5, cy - 1.5, 3, 3);
        else if (m & 4) packets[k].rect(cx - 1.5, cy + phase * TILE - 1.5, 3, 3);
      }
    }
    ctx.lineWidth = 1.5;
    for (let k = 0; k < B; k++) {
      const near = (k + 0.5) / B;
      ctx.strokeStyle = `rgba(80,240,255,${0.06 + near * 0.3})`;
      ctx.stroke(lines[k]);
      ctx.fillStyle = `rgba(255,190,80,${0.12 + near * 0.4})`;
      ctx.fill(packets[k]);
    }
  }

  renderFences(ctx, tx0, ty0, tx1, ty1) {
    ctx.strokeStyle = 'rgba(150,158,165,0.55)';
    ctx.lineWidth = 1;
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      if (this.tileAt(x, y) !== T.FENCE) continue;
      const px = x * TILE, py = y * TILE;
      ctx.beginPath();
      for (let k = -TILE; k < TILE; k += 6) {
        ctx.moveTo(px + Math.max(0, k), py + Math.max(0, -k)); ctx.lineTo(px + Math.min(TILE, k + TILE), py + Math.min(TILE, TILE - k));
        ctx.moveTo(px + Math.max(0, k), py + TILE - Math.max(0, -k)); ctx.lineTo(px + Math.min(TILE, k + TILE), py + TILE - Math.min(TILE, TILE - k));
      }
      ctx.stroke();
      ctx.fillStyle = '#7d858c';
      ctx.fillRect(px, py, 3, 3); ctx.fillRect(px + TILE - 3, py + TILE - 3, 3, 3);
    }
  }

  renderPads(ctx, t) {
    for (const p of this.pads) {
      const blink = p.t < 2 && Math.sin(t * 25) > 0;
      if (blink) continue;
      for (let dy = -p.r; dy <= p.r; dy++) for (let dx = -p.r; dx <= p.r; dx++) {
        const x = (p.tx + dx) * TILE, y = (p.ty + dy) * TILE;
        ctx.fillStyle = 'rgba(10,40,50,0.85)';
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        ctx.strokeStyle = 'rgba(80,240,255,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 3.5, y + 3.5, TILE - 7, TILE - 7);
        ctx.fillStyle = 'rgba(80,240,255,0.18)';
        ctx.fillRect(x + 8, y + 8, 6, 6);
      }
    }
  }

  renderDecoy(ctx, d, t) {
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.25 * Math.sin(t * 20);
    this.body.drawSprite(ctx, 'down', Math.round(d.x - 12), Math.round(d.y - 30), 0, t, true, false);
    ctx.restore();
  }

  renderLasso(ctx) {
    if (!this.lassoOn) return;
    const pts = this.lasso.points();
    for (let k = 0; k < 2; k++) {
      const jag = [];
      for (let i = 0; i < pts.length; i += 2) jag.push(pts[i] + (Math.random() - 0.5) * 6, pts[i + 1] + (Math.random() - 0.5) * 6);
      ctx.strokeStyle = k === 0 ? 'rgba(80,240,255,0.25)' : 'rgba(220,255,255,0.8)';
      ctx.lineWidth = k === 0 ? 8 : 1.5;
      strokePath(ctx, jag);
    }
  }

  renderEffects(ctx) {
    for (const e of this.effects) {
      const k = e.t / e.max;
      if (e.type === 'ring') {
        ctx.strokeStyle = `rgba(${e.color},${(1 - k) * 0.8})`;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.r0 + (e.r1 - e.r0) * k, 0, Math.PI * 2); ctx.stroke();
      } else if (e.type === 'bolt') {
        ctx.strokeStyle = e.color; ctx.lineWidth = 2;
        strokePath(ctx, e.pts);
      } else if (e.type === 'text') {
        ctx.font = 'bold 9px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = e.color;
        ctx.globalAlpha = 1 - k;
        ctx.fillText(e.text, e.x, e.y - k * 24);
        ctx.globalAlpha = 1;
      }
    }
  }

  renderPrompts(ctx, t) {
    const swapped = this.game.swapped;
    ctx.font = '8px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    const draw = (x, y, key, text, color, disabled) => {
      const s = `${key} ${text}`;
      const w = ctx.measureText(s).width + 10;
      ctx.fillStyle = 'rgba(6,8,10,0.82)';
      ctx.fillRect(x - w / 2, y - 8, w, 13);
      ctx.strokeStyle = disabled ? 'rgba(120,120,120,0.6)' : color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - w / 2 + 0.5, y - 7.5, w - 1, 12);
      ctx.fillStyle = disabled ? '#8a8a8a' : color;
      ctx.fillText(s, x, y + 1);
    };
    const bt = this.bodyTarget;
    if (bt && !swapped) draw(bt.device.px, bt.device.py - 30, '[SPACE]', bt.action.label, '#ffcf70', bt.action.disabled);
    const vt = this.voxelTarget;
    if (vt) draw(this.voxel.x, this.voxel.y - 40, swapped ? '[SPACE]' : '[ENTER]', vt.label, '#60f0ff', vt.disabled);
    if (this.body.downed) {
      const k = Math.max(0, this.body.downedT);
      draw(this.body.x, this.body.y - 40, `${k.toFixed(1)}s`, 'VOXEL: OVERCLOCK [/] TO REVIVE', '#ff6060', false);
    }
    if (this.boss && this.boss.phase === 3 && !this.boss.defeated && this.run.anchor > 0) {
      draw(this.voxel.x, this.voxel.y - 56, swapped ? '[F]' : '[/]', 'BURN EVERYTHING · END IT NOW', '#50f0ff', false);
    }
  }
}

function distToSegmentPts(px, py, rope) {
  let best = Infinity;
  for (let i = 0; i < rope.n - 1; i++) {
    const ax = rope.x[i], ay = rope.y[i], bx = rope.x[i + 1], by = rope.y[i + 1];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const tt = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    best = Math.min(best, Math.hypot(px - (ax + dx * tt), py - (ay + dy * tt)));
  }
  return best;
}
