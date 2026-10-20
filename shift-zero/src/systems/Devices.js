// Interactive substation hardware. Each device exposes:
//   bodyAction(world)  -> { label, run(), disabled? } | null   (P1, SPACE)
//   voxelAction(world) -> { label, run() | hold:true, disabled? } | null (P2, ENTER)
// plus update/render/renderGlow hooks called by World.
import { TILE, distToSegment, lightningPath, strokePath, clamp, dist } from '../engine/Util.js';
import { PC } from '../engine/ParticlePool.js';
import { audio } from '../engine/AudioSynth.js';
import { T } from './LevelGen.js';

const BODY_REACH = 48;

function panel(ctx, x, y, w, h, base = '#5b6168', edge = '#2a2e33') {
  ctx.fillStyle = edge;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x, y + h - 2, w, 2);
}

function label(ctx, text, x, y, color = '#d8d2c0', size = 7) {
  ctx.font = `${size}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function wallOffset(wall) {
  return { N: [0, -4], S: [0, 4], E: [4, 0], W: [-4, 0] }[wall] || [0, 0];
}

class Device {
  constructor(spec) {
    Object.assign(this, spec);
    if (spec.x !== undefined) {
      this.px = (spec.x + 0.5) * TILE;
      this.py = (spec.y + 0.5) * TILE;
    }
    this.solid = false;
    this.reach = BODY_REACH;
    this.flash = 0;
  }
  bodyAction() { return null; }
  voxelAction() { return null; }
  update(dt) { this.flash = Math.max(0, this.flash - dt * 3); }
  render() {}
  renderGlow() {}
  inBodyReach(body) { return dist(body.x, body.y, this.px, this.py) < this.reach; }
}

// ------------------------------------------------------------------ Breaker
export class BreakerBox extends Device {
  constructor(spec) {
    super(spec);
    this.solid = true;
    this.lever = 1; // 1 = closed (up), 0 = open
  }

  bodyAction(world) {
    const e = world.circuit.getEdge(this.edge);
    if (!e || e.removed) return null;
    if (e.closed) {
      return {
        label: `THROW ${this.label}`,
        run: () => world.startSkillCheck({
          device: this,
          title: `${this.label} · 480V DISCONNECT`,
          onSuccess: (grade) => this.onThrown(world, grade),
          onFail: () => world.arcFlash(this.px, this.py, 18),
        }),
      };
    }
    if (e.locked) {
      return {
        label: 'REMOVE LOTO LOCK',
        run: () => {
          world.circuit.unlock(e.id);
          world.body.padlocks++;
          world.circuit.close(e.id, 'body');
          audio.clunk();
          world.particles.sparks(this.px, this.py, 14, { speed: 160 });
          world.toast('Lock removed — circuit re-energized', '#ffb040');
        },
      };
    }
    if (world.body.padlocks > 0) {
      return {
        label: e.ghostT > 0 ? 'HANG BRASS LOCK (GHOST HOLDING)' : 'APPLY LOTO LOCK',
        run: () => world.applyLoto(this, e),
      };
    }
    return { label: 'NO PADLOCKS LEFT', disabled: true, run: () => audio.deny() };
  }

  onThrown(world, grade) {
    const e = world.circuit.getEdge(this.edge);
    world.circuit.open(e.id, 'body');
    this.flash = 1;
    const dx = world.body.x - this.px, dy = world.body.y - this.py;
    world.camera.addTrauma(grade === 'perfect' ? 0.45 : 0.3, dx, dy);
    world.particles.sparks(this.px, this.py, grade === 'perfect' ? 46 : 24, { speed: 260, up: 260 });
    if (grade === 'perfect') {
      world.camera.hitStop(50);
      world.camera.punch(0.04);
      world.addScrap(6, this.px, this.py - 10);
      audio.skillPerfect();
    } else {
      audio.skillGood();
    }
  }

  voxelAction(world) {
    const e = world.circuit.getEdge(this.edge);
    if (!e || e.removed) return null;
    if (!e.closed) return { label: e.locked ? 'LOCKED OUT' : `OPEN · RECLOSE ${Math.ceil(e.recloseT)}s`, disabled: true, run: () => {} };
    const cost = world.stats.remoteCost;
    return {
      label: world.stats.ghostLockout ? `REMOTE TRIP + GHOST LOCK (${cost})` : `REMOTE TRIP (${cost})`,
      run: () => {
        if (!world.voxel.spend(cost)) return;
        if (world.stats.ghostLockout) world.circuit.ghostLock(e.id, 8);
        else world.circuit.open(e.id, 'voxel');
        audio.clunk();
        this.flash = 1;
        world.particles.voxels(this.px, this.py, 18);
      },
    };
  }

  update(dt, world) {
    super.update(dt);
    const e = world.circuit.getEdge(this.edge);
    const target = e && e.closed && !e.removed ? 1 : 0;
    this.lever += (target - this.lever) * Math.min(1, dt * 18);
  }

  render(ctx, world, t) {
    const e = world.circuit.getEdge(this.edge);
    const [ox, oy] = wallOffset(this.wall);
    const x = this.px + ox - 11, y = this.py + oy - 13;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 2, y + 24, 22, 5);
    panel(ctx, x, y, 22, 26, '#6a7078', '#24282c');
    ctx.fillStyle = '#3a3f45';
    ctx.fillRect(x + 3, y + 4, 16, 18);
    // Lever
    const ly = y + 7 + (1 - this.lever) * 10;
    ctx.fillStyle = '#1b1d20';
    ctx.fillRect(x + 9, y + 6, 4, 14);
    ctx.fillStyle = e && e.closed ? '#c43b2b' : '#2f8f4f';
    ctx.fillRect(x + 6, ly - 2, 10, 5);
    // Status LED
    const live = e && world.circuit.isEnergized(e.b);
    ctx.fillStyle = live ? (Math.sin(t * 10) > 0 ? '#ff4530' : '#a02010') : '#30ff70';
    ctx.fillRect(x + 17, y + 2, 3, 3);
    label(ctx, this.label, this.px + ox, y - 5, '#c9c2a8', 6);
    if (e && e.locked) {
      // Brass padlock + DANGER tag
      ctx.fillStyle = '#d8b04a';
      ctx.fillRect(x + 6, y + 17, 9, 7);
      ctx.strokeStyle = '#a07a20'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + 10.5, y + 17, 3, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#f2efe6';
      ctx.fillRect(x + 14, y + 22, 7, 10);
      ctx.fillStyle = '#c42020';
      ctx.fillRect(x + 14, y + 22, 7, 3);
    }
    if (e && e.ghostT > 0) {
      ctx.strokeStyle = `rgba(80,240,255,${0.5 + 0.4 * Math.sin(t * 12)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 5, y + 15, 11, 9);
      ctx.beginPath(); ctx.arc(x + 10.5, y + 15, 3.5, Math.PI, 0); ctx.stroke();
      label(ctx, `${Math.ceil(e.ghostT)}s`, x + 11, y + 34, '#50f0ff', 6);
    }
    if (e && !e.closed && !world.circuit.isLocked(e) && e.autoReclose && e.recloseT > 0) {
      const k = e.recloseT / world.circuit.recloseDelay;
      ctx.strokeStyle = '#ffb040';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.px + ox, y - 14, 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.stroke();
      label(ctx, 'SCADA', this.px + ox, y - 24, '#ffb040', 5);
    }
  }

  renderGlow(ctx, world) {
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,200,120,${this.flash * 0.5})`;
      ctx.beginPath(); ctx.arc(this.px, this.py, 30 * this.flash + 8, 0, Math.PI * 2); ctx.fill();
    }
    const e = world.circuit.getEdge(this.edge);
    if (e && world.circuit.isEnergized(e.b)) world.dynLights.push({ x: this.px, y: this.py, r: 26, i: 0.35, color: 'rgba(255,60,40,0.12)' });
  }
}

// ------------------------------------------------------------------ Fuse (living jumper)
export class FuseHolder extends Device {
  constructor(spec) {
    super(spec);
    this.solid = true;
    this.bridged = false;
  }

  voxelAction(world) {
    return { label: 'HOLD — LIVING JUMPER', hold: true };
  }

  bodyAction() { return { label: 'BLOWN 200A FUSE — NEEDS A JUMPER', disabled: true, run: () => audio.deny() }; }

  setBridged(world, on) {
    if (this.bridged === on) return;
    this.bridged = on;
    world.circuit.setBridge(this.edge, on);
    if (on) {
      audio.zap();
      world.camera.addTrauma(0.35);
      world.particles.sparks(this.px, this.py, 30, { color: PC.CYAN, speed: 200 });
    }
  }

  render(ctx, world, t) {
    const [ox, oy] = wallOffset(this.wall);
    const x = this.px + ox, y = this.py + oy;
    panel(ctx, x - 12, y - 9, 24, 18, '#d8d0bc', '#5a5446'); // porcelain base
    ctx.fillStyle = '#7a6c50';
    ctx.fillRect(x - 11, y - 3, 5, 6);
    ctx.fillRect(x + 6, y - 3, 5, 6);
    // Blown cartridge: cracked + scorched
    ctx.fillStyle = '#2b2622';
    ctx.fillRect(x - 6, y - 4, 12, 8);
    ctx.fillStyle = '#100c0a';
    ctx.fillRect(x - 2, y - 4, 3, 8);
    label(ctx, this.edge === 'GND' ? 'NEUTRAL GND' : 'F-200A', x, y - 15, '#e0c890', 6);
    if (!this.bridged && Math.sin(t * 3) > 0.6) label(ctx, 'OPEN', x, y + 16, '#ff5040', 6);
  }

  renderGlow(ctx, world, t) {
    if (!this.bridged) return;
    const x = this.px, y = this.py;
    ctx.strokeStyle = 'rgba(120,250,255,0.85)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) strokePath(ctx, lightningPath(x - 10, y, x + 10, y, 6, 5));
    world.dynLights.push({ x, y, r: 90, i: 0.7, color: 'rgba(80,240,255,0.25)' });
  }
}

// ------------------------------------------------------------------ Powered bulkhead
export class Bulkhead extends Device {
  constructor(spec) {
    super(spec);
    this.open = 0;
    this.isSolidNow = true;
    const xs = spec.tiles.map((p) => p[0]), ys = spec.tiles.map((p) => p[1]);
    this.x0 = Math.min(...xs) * TILE; this.y0 = Math.min(...ys) * TILE;
    this.x1 = (Math.max(...xs) + 1) * TILE; this.y1 = (Math.max(...ys) + 1) * TILE;
    this.px = (this.x0 + this.x1) / 2; this.py = (this.y0 + this.y1) / 2;
  }

  update(dt, world) {
    const powered = world.circuit.isEnergized(this.node);
    const prev = this.open;
    this.open = clamp(this.open + (powered ? 2.6 : -3.2) * dt, 0, 1);
    if (prev === 0 && this.open > 0) audio.bulkhead(true);
    if (prev === 1 && this.open < 1) audio.bulkhead(false);
    const solid = this.open < 0.7;
    if (solid !== this.isSolidNow) {
      this.isSolidNow = solid;
      world.rebuildSolid();
      if (solid) world.ejectBodyFrom(this);
    }
    if (powered && this.open < 1) world.camera.addTrauma(dt * 0.6);
  }

  render(ctx, world, t) {
    const vertical = this.orient === 'v';
    const w = this.x1 - this.x0, h = this.y1 - this.y0;
    const slide = this.open * (vertical ? h / 2 : w / 2);
    const drawHalf = (x, y, hw, hh) => {
      if (hw <= 0 || hh <= 0) return;
      ctx.fillStyle = '#3e4247';
      ctx.fillRect(x, y, hw, hh);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, hw, hh); ctx.clip();
      ctx.fillStyle = '#d9a920';
      for (let s = -h - w; s < w + h; s += 12) {
        ctx.beginPath();
        ctx.moveTo(x + s, y); ctx.lineTo(x + s + 6, y); ctx.lineTo(x + s + 6 + hh, y + hh); ctx.lineTo(x + s + hh, y + hh);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = '#1a1c1f'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, hw - 2, hh - 2);
    };
    if (vertical) {
      drawHalf(this.x0 + 6, this.y0, w - 12, h / 2 - slide);
      drawHalf(this.x0 + 6, this.y0 + h / 2 + slide, w - 12, h / 2 - slide);
    } else {
      drawHalf(this.x0, this.y0 + 6, w / 2 - slide, h - 12);
      drawHalf(this.x0 + w / 2 + slide, this.y0 + 6, w / 2 - slide, h - 12);
    }
    const powered = world.circuit.isEnergized(this.node);
    ctx.fillStyle = powered ? '#40ff80' : (Math.sin(t * 4) > 0 ? '#ff3020' : '#601010');
    const lx = vertical ? this.px : this.x0 - 6, ly = vertical ? this.y0 - 6 : this.py;
    ctx.fillRect(lx - 3, ly - 3, 6, 6);
    if (!powered && this.open === 0) label(ctx, 'NO POWER', this.px, this.py, '#ffdd88', 7);
  }
}

// ------------------------------------------------------------------ Live arc beam across a doorway
export class ArcEmitter extends Device {
  constructor(spec) {
    super(spec);
    this.axp = (spec.ax + 0.5) * TILE; this.ayp = (spec.ay + 0.5) * TILE;
    this.bxp = (spec.bx + 0.5) * TILE; this.byp = (spec.by + 0.5) * TILE;
    this.px = (this.axp + this.bxp) / 2; this.py = (this.ayp + this.byp) / 2;
    this.cycle = Math.random() * 3;
    this.onTime = 2.4; this.offTime = 0.9;
    this.hitCd = 0;
    this.paths = [];
  }

  get period() { return this.onTime + this.offTime; }

  state(world) {
    const powered = world.circuit.isEnergized(this.node);
    const ph = this.cycle % this.period;
    return { powered, active: powered && ph < this.onTime, warning: powered && ph > this.period - 0.35 };
  }

  update(dt, world) {
    this.cycle += dt;
    this.hitCd = Math.max(0, this.hitCd - dt);
    const s = this.state(world);
    this.active = s.active;
    this.warning = s.warning;
    if (s.active && Math.random() < dt * 20) {
      this.paths = [0, 1, 2].map(() => lightningPath(this.axp, this.ayp, this.bxp, this.byp, 9, 9));
    }
    if (s.active) {
      const b = world.body;
      if (!b.downed && this.hitCd <= 0 && !b.isPhasing(world) && distToSegment(b.x, b.y, this.axp, this.ayp, this.bxp, this.byp) < b.r + 5) {
        this.hitCd = 0.6;
        const nx = this.orient === 'v' ? Math.sign(b.x - this.px) || 1 : 0;
        const ny = this.orient === 'h' ? Math.sign(b.y - this.py) || 1 : 0;
        world.hurtBody(28, this.px, this.py, 'arc');
        b.knock(nx * 380, ny * 380);
        world.particles.sparks(b.x, b.y, 30, { speed: 300, color: PC.WHITE });
        audio.zap();
      }
      if (Math.random() < dt * 6) world.particles.sparks(this.axp, this.ayp, 2, { speed: 120 });
    }
  }

  render(ctx) {
    for (const [x, y] of [[this.axp, this.ayp], [this.bxp, this.byp]]) {
      ctx.fillStyle = '#2a2420';
      ctx.fillRect(x - 7, y - 7, 14, 14);
      ctx.fillStyle = '#c8bca0';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x, y, 6 - i * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = i % 2 ? '#c8bca0' : '#8a806a'; }
    }
  }

  renderGlow(ctx, world, t) {
    if (this.active) {
      ctx.lineCap = 'round';
      for (let i = 0; i < this.paths.length; i++) {
        ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(150,200,255,0.55)';
        ctx.lineWidth = i === 0 ? 2.5 : 1.5;
        strokePath(ctx, this.paths[i]);
      }
      ctx.strokeStyle = 'rgba(120,170,255,0.15)';
      ctx.lineWidth = 16;
      ctx.beginPath(); ctx.moveTo(this.axp, this.ayp); ctx.lineTo(this.bxp, this.byp); ctx.stroke();
      world.dynLights.push({ x: this.px, y: this.py, r: 140, i: 0.8, color: 'rgba(130,180,255,0.22)' });
    } else if (this.warning && Math.sin(t * 60) > 0) {
      ctx.strokeStyle = 'rgba(180,210,255,0.5)';
      ctx.lineWidth = 1;
      strokePath(ctx, lightningPath(this.axp, this.ayp, this.px, this.py, 4, 6));
    }
  }
}

// ------------------------------------------------------------------ Capacitor bank
export class CapacitorBank extends Device {
  constructor(spec) {
    super(spec);
    this.solid = true;
    this.charge = 1;
    this.arcT = 1.5;
    this.arcPath = null;
    this.arcLife = 0;
  }

  bodyAction(world) {
    if (this.charge <= 0.05) return null;
    return {
      label: 'BLEED DOWN CAPACITOR BANK',
      run: () => world.startSkillCheck({
        device: this,
        title: 'STORED ENERGY · GROUNDING STICK',
        speedMult: 1.15,
        onSuccess: (grade) => {
          this.charge = 0;
          world.camera.addTrauma(0.5, world.body.x - this.px, world.body.y - this.py);
          world.particles.sparks(this.px, this.py, 60, { speed: 320, up: 300 });
          world.particles.smoke(this.px, this.py, 6);
          audio.zap();
          grade === 'perfect' ? audio.skillPerfect() : audio.skillGood();
          if (grade === 'perfect') world.camera.hitStop(50);
          world.addScrap((grade === 'perfect' ? 14 : 9) * world.stats.capScrap, this.px, this.py - 12);
          if (world.stats.bleedDown) {
            world.body.heal(30);
            world.voxel.coherence = Math.min(100, world.voxel.coherence + 40);
            world.toast('REGENERATIVE BLEED-DOWN: +30 BODY · +40 SIGNAL', '#7dffb0');
          }
        },
        onFail: () => world.arcFlash(this.px, this.py, 22),
      }),
    };
  }

  update(dt, world) {
    super.update(dt);
    this.arcLife = Math.max(0, this.arcLife - dt);
    if (this.charge < 1 && this.charge > 0) this.charge = Math.min(1, this.charge + dt * 0.002);
    if (this.charge <= 0.3) return;
    const b = world.body;
    const d = dist(b.x, b.y, this.px, this.py);
    if (d < 92 && !b.downed) {
      this.arcT -= dt;
      if (this.arcT <= 0) {
        this.arcT = 1.6;
        this.arcPath = lightningPath(this.px, this.py - 10, b.x, b.y - 8, 8, 10);
        this.arcLife = 0.18;
        if (!b.isPhasing(world)) world.hurtBody(10, this.px, this.py, 'cap');
        audio.zap();
      }
    } else {
      this.arcT = Math.min(this.arcT + dt, 0.7);
    }
  }

  render(ctx, world, t) {
    const x = this.px, y = this.py;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x - 14, y + 6, 28, 6);
    panel(ctx, x - 14, y - 12, 28, 22, '#40464c', '#1d2023');
    for (let i = 0; i < 3; i++) {
      const cx = x - 9 + i * 9;
      ctx.fillStyle = '#7f8a94';
      ctx.fillRect(cx - 3, y - 10, 6, 16);
      ctx.fillStyle = '#b8c2cc';
      ctx.fillRect(cx - 3, y - 10, 6, 2);
    }
    ctx.fillStyle = '#e0c020';
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x + 6, y - 13); ctx.lineTo(x - 6, y - 13); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillRect(x - 0.5, y - 19, 1, 4);
    const k = this.charge;
    ctx.fillStyle = k > 0.3 ? `rgba(160,210,255,${0.5 + 0.5 * Math.sin(t * 15)})` : '#2a4030';
    ctx.fillRect(x - 12, y + 7, 24 * Math.max(0.04, k), 2);
  }

  renderGlow(ctx, world, t) {
    if (this.charge > 0.3) {
      world.dynLights.push({ x: this.px, y: this.py, r: 60, i: 0.4, color: `rgba(140,190,255,${0.08 + 0.05 * Math.sin(t * 9)})` });
      if (Math.random() < 0.1) {
        ctx.strokeStyle = 'rgba(200,230,255,0.7)'; ctx.lineWidth = 1;
        strokePath(ctx, lightningPath(this.px - 9, this.py - 10, this.px + 9, this.py - 10, 4, 4));
      }
    }
    if (this.arcLife > 0 && this.arcPath) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2.5;
      strokePath(ctx, this.arcPath);
      ctx.strokeStyle = 'rgba(140,190,255,0.4)'; ctx.lineWidth = 7;
      strokePath(ctx, this.arcPath);
    }
  }
}

// ------------------------------------------------------------------ Elevator
export class Elevator extends Device {
  constructor(spec) { super(spec); this.reach = 26; }
  bodyAction(world) {
    return { label: 'RIDE THE FREIGHT ELEVATOR DOWN', run: () => world.completeFloor() };
  }
  render(ctx, world, t) {
    const x = this.px - 28, y = this.py - 28;
    ctx.fillStyle = '#25282b';
    ctx.fillRect(x, y, 56, 56);
    ctx.fillStyle = '#d9a920';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x + 8 + i * 12, y + 4); ctx.lineTo(x + 14 + i * 12, y + 10); ctx.lineTo(x + 8 + i * 12, y + 16);
      ctx.lineTo(x + 5 + i * 12, y + 16); ctx.lineTo(x + 11 + i * 12, y + 10); ctx.lineTo(x + 5 + i * 12, y + 4);
      ctx.fill();
    }
    ctx.strokeStyle = '#6c7177'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * 14, y + 20); ctx.lineTo(x + i * 14, y + 56); ctx.stroke(); }
    ctx.strokeRect(x + 1, y + 1, 54, 54);
    label(ctx, '▼ FREIGHT', this.px, y + 40, `rgba(120,255,150,${0.6 + 0.4 * Math.sin(t * 3)})`, 8);
  }
  renderGlow(ctx, world, t) {
    world.dynLights.push({ x: this.px, y: this.py, r: 90, i: 0.6, color: `rgba(90,255,140,${0.08 + 0.04 * Math.sin(t * 3)})` });
  }
}

// ------------------------------------------------------------------ Cipher terminal + relay bank
export class CipherTerminal extends Device {
  constructor(spec) {
    super(spec);
    this.solid = true;
    this.revealed = false;
    this.solved = false;
    this.seenByBody = 0;
  }
  voxelAction(world) {
    if (this.solved) return { label: 'CIPHER SOLVED', disabled: true, run: () => {} };
    if (this.revealed) return { label: `KEY: 0x${this.value.toString(16).toUpperCase()} — BODY SETS RELAYS`, disabled: true, run: () => {} };
    return {
      label: 'DECRYPT SCHEMATIC CIPHER',
      run: () => {
        this.revealed = true;
        audio.materialize();
        world.particles.voxels(this.px, this.py, 30, { color: PC.GREEN });
        world.toast('CIPHER KEY: 0x' + this.value.toString(16).toUpperCase() + '  ·  relays read 8·4·2·1', '#7dffb0');
      },
    };
  }
  bodyAction(world) {
    if (this.solved || !this.revealed) return null;
    return { label: `TERMINAL READS 0x${this.value.toString(16).toUpperCase()}`, disabled: true, run: () => {} };
  }
  check(world) {
    if (this.solved || !this.revealed) return;
    const relays = world.devices.filter((d) => d instanceof Relay && d.group === this.group);
    const sum = relays.reduce((s, r) => s + (r.on ? r.bit : 0), 0);
    if (sum === this.value) {
      this.solved = true;
      relays.forEach((r) => { r.solved = true; });
      world.onCipherSolved(this);
    }
  }
  visibleTo(world) {
    const v = world.voxel;
    return this.revealed || this.seenByBody > 0 || dist(v.x, v.y, this.px, this.py) < TILE * 4;
  }
  update(dt) { super.update(dt); this.seenByBody = Math.max(0, this.seenByBody - dt); }
  render(ctx, world, t) {
    const [ox, oy] = wallOffset(this.wall);
    const x = this.px + ox, y = this.py + oy;
    panel(ctx, x - 12, y - 11, 24, 22, '#4a4f45', '#1a1c18');
    ctx.fillStyle = '#071208';
    ctx.fillRect(x - 9, y - 8, 18, 12);
    if (this.visibleTo(world)) {
      const col = this.solved ? '#ffd860' : '#60ff90';
      if (this.revealed) label(ctx, '0x' + this.value.toString(16).toUpperCase(), x, y - 2, col, 8);
      else {
        ctx.fillStyle = 'rgba(96,255,144,0.6)';
        for (let i = 0; i < 6; i++) ctx.fillRect(x - 8 + ((i * 7 + t * 40) % 16), y - 7 + i * 2, 2 + (i % 3), 1);
      }
    }
  }
  renderGlow(ctx, world) {
    if (this.visibleTo(world)) world.dynLights.push({ x: this.px, y: this.py, r: 40, i: 0.4, color: this.solved ? 'rgba(255,210,90,0.15)' : 'rgba(90,255,140,0.12)' });
  }
}

export class Relay extends Device {
  constructor(spec) {
    super(spec);
    this.solid = true;
    this.on = false;
    this.solved = false;
    this.reach = 40;
  }
  bodyAction(world) {
    if (this.solved) return null;
    return {
      label: `FLIP RELAY [${this.bit}] ${this.on ? 'ON→OFF' : 'OFF→ON'}`,
      run: () => {
        this.on = !this.on;
        audio.lockClick();
        world.particles.sparks(this.px, this.py, 5, { speed: 80 });
        for (const d of world.devices) if (d instanceof CipherTerminal && d.group === this.group) d.check(world);
      },
    };
  }
  render(ctx, world) {
    const [ox, oy] = wallOffset(this.wall);
    const x = this.px + ox, y = this.py + oy;
    panel(ctx, x - 9, y - 10, 18, 20, '#555b52', '#1d1f1b');
    ctx.fillStyle = '#222';
    ctx.fillRect(x - 2, y - 6, 4, 12);
    ctx.fillStyle = '#b0a080';
    ctx.fillRect(x - 5, this.on ? y - 7 : y + 2, 10, 4);
    ctx.fillStyle = this.solved ? '#ffd860' : this.on ? '#50ff80' : '#3a1a1a';
    ctx.fillRect(x + 5, y - 9, 3, 3);
    label(ctx, String(this.bit), x - 5, y - 6, '#d8d0b0', 6);
  }
}

// ------------------------------------------------------------------ Cage lock (Voxel opens chain-link)
export class CageLock extends Device {
  constructor(spec) { super(spec); this.solid = true; this.opened = false; }
  voxelAction(world) {
    if (this.opened) return null;
    return {
      label: 'OVERRIDE CAGE MAGLOCK',
      run: () => {
        this.opened = true;
        for (const [x, y] of this.cage) world.setTile(x, y, T.FLOOR);
        world.rebuildSolid();
        audio.clunk();
        world.particles.voxels(this.px, this.py, 20);
        for (const [x, y] of this.cage) world.particles.sparks((x + 0.5) * TILE, (y + 0.5) * TILE, 3, { speed: 90 });
        world.toast('Cage maglock released', '#50f0ff');
      },
    };
  }
  bodyAction() {
    if (this.opened) return null;
    return { label: 'MAGLOCK · NEEDS A HACK', disabled: true, run: () => audio.deny() };
  }
  render(ctx, world, t) {
    const [ox, oy] = wallOffset(this.wall);
    const x = this.px + ox, y = this.py + oy;
    panel(ctx, x - 8, y - 10, 16, 20, '#3d4248', '#16181a');
    ctx.fillStyle = this.opened ? '#40ff80' : (Math.sin(t * 5) > 0 ? '#ff3a20' : '#701810');
    ctx.fillRect(x - 2, y - 7, 4, 4);
    ctx.fillStyle = '#20252a';
    for (let i = 0; i < 6; i++) ctx.fillRect(x - 6 + (i % 3) * 4, y + (i < 3 ? 0 : 4), 3, 3);
  }
}

// ------------------------------------------------------------------ Pickups
export class ScrapPickup extends Device {
  update(dt, world) {
    if (this.taken) return;
    const b = world.body;
    if (!b.downed && dist(b.x, b.y, this.px, this.py) < 22) {
      this.taken = true;
      world.addScrap(this.amount, this.px, this.py);
      audio.pickup();
      world.particles.sparks(this.px, this.py, 8, { color: PC.BRASS, speed: 90 });
    }
  }
  render(ctx, world, t) {
    if (this.taken) return;
    const bob = Math.sin(t * 3 + this.px) * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(this.px - 7, this.py + 5, 14, 3);
    ctx.strokeStyle = '#c87533'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(this.px, this.py - 2 + bob, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(this.px, this.py - 2 + bob, 2.5, 0, Math.PI * 2); ctx.stroke();
  }
  renderGlow(ctx, world, t) {
    if (this.taken) return;
    if (Math.sin(t * 2 + this.px) > 0.95) {
      ctx.fillStyle = 'rgba(255,200,120,0.6)';
      ctx.fillRect(this.px + 2, this.py - 7, 2, 2);
    }
  }
}

export class MemoryShard extends Device {
  update(dt, world) {
    if (this.taken) return;
    const b = world.body;
    if (!b.downed && dist(b.x, b.y, this.px, this.py) < 22) {
      this.taken = true;
      world.onMemoryShard(this);
    }
  }
  render(ctx, world, t) {
    if (this.taken) return;
    const bob = Math.sin(t * 2) * 2;
    ctx.save();
    ctx.translate(this.px, this.py - 4 + bob);
    ctx.rotate(0.2);
    ctx.fillStyle = '#efe9dc';
    ctx.fillRect(-7, -8, 14, 16);
    ctx.fillStyle = '#5a6b78';
    ctx.fillRect(-5, -6, 10, 9);
    ctx.fillStyle = '#e8b878';
    ctx.fillRect(-3, -4, 3, 3);
    ctx.fillRect(1, -3, 2, 2);
    ctx.restore();
  }
  renderGlow(ctx, world, t) {
    if (this.taken) return;
    world.dynLights.push({ x: this.px, y: this.py, r: 50, i: 0.6, color: `rgba(255,240,210,${0.12 + 0.06 * Math.sin(t * 2)})` });
  }
}

// ------------------------------------------------------------------ Decor: feeder switchgear
export class Feeder extends Device {
  constructor(spec) { super(spec); this.solid = true; }
  render(ctx, world, t) {
    const [ox, oy] = wallOffset(this.wall);
    const x = this.px + ox, y = this.py + oy;
    panel(ctx, x - 14, y - 14, 28, 28, '#4c545c', '#1a1d20');
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#f2ecd8';
      ctx.beginPath(); ctx.arc(x - 8 + i * 8, y - 5, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c42020'; ctx.lineWidth = 1;
      const a = -Math.PI / 2 + Math.sin(t * 2 + i) * 0.4 + world.circuit.stress;
      ctx.beginPath(); ctx.moveTo(x - 8 + i * 8, y - 5); ctx.lineTo(x - 8 + i * 8 + Math.cos(a) * 3, y - 5 + Math.sin(a) * 3); ctx.stroke();
    }
    label(ctx, 'FEEDER 13.8kV', x, y + 7, '#d8d0b0', 5);
  }
}

// ------------------------------------------------------------------ Boss: main disconnect + ground node
export class MainDisconnect extends Device {
  constructor(spec) { super(spec); this.solid = true; this.progress = 0; this.reach = 52; }
  bodyAction(world) {
    const boss = world.boss;
    if (!boss || boss.phase !== 3) return { label: 'MAIN DISCONNECT · INTERLOCKED', disabled: true, run: () => audio.deny() };
    if (!world.circuit.getEdge('GND').bridged) return { label: 'BACK-FEED! VOXEL MUST GROUND THE CORE', disabled: true, run: () => audio.deny() };
    return {
      label: `THROW MAIN DISCONNECT (${this.progress}/3)`,
      run: () => world.startSkillCheck({
        device: this,
        title: `MAIN TIE DISCONNECT · STAGE ${this.progress + 1}/3`,
        speedMult: 1.2 + this.progress * 0.25,
        widthMult: 0.85,
        onSuccess: () => {
          this.progress++;
          world.camera.addTrauma(0.6);
          world.camera.hitStop(70);
          world.particles.sparks(this.px, this.py, 70, { speed: 360, up: 320 });
          audio.skillPerfect();
          if (this.progress >= 3) boss.defeat('disconnect');
        },
        onFail: () => world.arcFlash(this.px, this.py, 24),
      }),
    };
  }
  render(ctx, world, t) {
    const x = this.px, y = this.py;
    panel(ctx, x - 22, y - 16, 44, 30, '#5a5f66', '#16181a');
    ctx.fillStyle = '#1b1d20';
    ctx.fillRect(x - 3, y - 12, 6, 22);
    const k = this.progress / 3;
    ctx.fillStyle = '#c43b2b';
    ctx.fillRect(x - 14, y - 12 + k * 16, 28, 6);
    label(ctx, 'MAIN TIE DISCONNECT', x, y - 24, '#ffd890', 7);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < this.progress ? '#40ff80' : '#401010';
      ctx.fillRect(x - 18 + i * 14, y + 10, 8, 3);
    }
  }
}

export class GroundNode extends FuseHolder {
  voxelAction(world) {
    if (!world.boss || world.boss.phase < 2) return { label: 'NEUTRAL GROUND · NOT YET', disabled: true, run: () => {} };
    return { label: 'HOLD — GROUND THE CORE', hold: true };
  }
  bodyAction() { return { label: 'NEUTRAL GROUND · VOXEL ONLY', disabled: true, run: () => audio.deny() }; }
}

export function createDevice(spec) {
  switch (spec.type) {
    case 'breaker': return new BreakerBox(spec);
    case 'fuse': return new FuseHolder(spec);
    case 'bulkhead': return new Bulkhead(spec);
    case 'arc': return new ArcEmitter(spec);
    case 'capacitor': return new CapacitorBank(spec);
    case 'elevator': return new Elevator(spec);
    case 'terminal': return new CipherTerminal(spec);
    case 'relay': return new Relay(spec);
    case 'cagelock': return new CageLock(spec);
    case 'scrap': return new ScrapPickup(spec);
    case 'memory': return new MemoryShard(spec);
    case 'feeder': return new Feeder(spec);
    case 'disconnect': return new MainDisconnect(spec);
    case 'ground': return new GroundNode(spec);
    case 'transformer': return null; // handled by the boss entity
    default: return null;
  }
}
