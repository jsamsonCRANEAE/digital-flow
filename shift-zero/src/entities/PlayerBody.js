// P1 — THE BODY. Inertia movement, heavy dodge, tools, micro-skill checks, and a procedural
// pixel sprite (Eisenhower-cut work jacket, hi-vis stripe, hard hat) whose left side erodes
// into cyan voxels as Anchor drains.
import { clamp, lerpAngle, hashNoise, damp } from '../engine/Util.js';
import { audio } from '../engine/AudioSynth.js';

export const TOOLS = ['HOT STICK', 'MULTIMETER'];

const PAL = {
  H: '#e6e1d3', h: '#b3ad9c', S: '#c79572', s: '#9a6d50', B: '#5c4636', E: '#16110d',
  J: '#4d5136', j: '#33361f', R: '#d9df6a', W: '#c8d0d0', P: '#2b3444', p: '#1c2330',
  K: '#3b2a1d', G: '#8a6a3a', X: '#c7ccd2',
};

const pad = (rows) => rows.map((r) => r.padEnd(12, '.'));
const SPRITES = {
  down: pad([
    '....hHHHh...', '...hHHHHHh..', '..hHHHHHHHh.', '...BSSSSB...', '...SESSES...', '...sSSSSs...',
    '....sBBs....', '..JJJWWJJJ..', '.JJJJJJJJJJ.', '.JRRRRRRRRJ.', '.GJJJJJJJJG.', '.GjJJJJJJjG.',
    '..jjjjjjjj..', '...PPPPPP...', '...PP..PP...', '...PP..PP...', '...pp..pp...', '..KKK..KKK..',
  ]),
  up: pad([
    '....hHHHh...', '...hHHHHHh..', '...HHHHHHH..', '...BBBBBBB..', '...BBBBBB...', '....sSSs....',
    '..JJJJJJJJ..', '.JJJJJJJJJJ.', '.JRRRRRRRRJ.', '.GJJJJJJJJG.', '.GjJJJJJJjG.', '..jjjjjjjj..',
    '...PPPPPP...', '...PP..PP...', '...PP..PP...', '...pp..pp...', '..KKK..KKK..',
  ]),
  right: pad([
    '....hHHHh...', '...hHHHHHh..', '...HHHHHHHhh', '....BSSSS...', '....BSSES...', '....sSSSs...',
    '.....sBB....', '....JJJJJ...', '...JJJJJJJ..', '...JRRRRRJ..', '...JJJJJJGX.', '...jJJJJJG..',
    '....jjjjj...', '....PPPP....', '....PP.PP...', '...PP...PP..', '...pp...pp..', '..KKK...KKK.',
  ]),
};

export class SkillCheck {
  constructor({ title = 'SKILL CHECK', speed = 1.1, goodWidth = 0.22, perfectWidth = 0.06, onSuccess, onFail, device = null }) {
    this.title = title;
    this.pos = 0;
    this.dir = 1;
    this.speed = speed;
    this.sweeps = 0;
    this.goodWidth = Math.min(0.6, goodWidth);
    this.perfectWidth = Math.min(this.goodWidth, perfectWidth);
    this.goodStart = 0.32 + Math.random() * (0.6 - this.goodWidth);
    this.perfStart = this.goodStart + (this.goodWidth - this.perfectWidth) / 2;
    this.onSuccess = onSuccess;
    this.onFail = onFail;
    this.device = device;
    this.done = false;
    this.result = null;
    this.resultT = 0;
  }

  update(dt) {
    if (this.done) { this.resultT += dt; return; }
    this.pos += this.dir * this.speed * dt;
    if (this.pos >= 1) { this.pos = 1; this.dir = -1; this.sweeps++; audio.skillTick(); }
    if (this.pos <= 0) { this.pos = 0; this.dir = 1; this.sweeps++; audio.skillTick(); }
    if (this.sweeps >= 5) this.resolve('fail');
  }

  press() {
    if (this.done) return null;
    const p = this.pos;
    const grade = p >= this.perfStart && p <= this.perfStart + this.perfectWidth ? 'perfect'
      : p >= this.goodStart && p <= this.goodStart + this.goodWidth ? 'good' : 'fail';
    this.resolve(grade);
    return grade;
  }

  resolve(grade) {
    this.done = true;
    this.result = grade;
    if (grade === 'fail') { audio.skillFail(); this.onFail && this.onFail(); }
    else this.onSuccess && this.onSuccess(grade);
  }

  render(ctx, x, y) {
    const w = 110, h = 12;
    const x0 = x - w / 2, y0 = y;
    ctx.fillStyle = 'rgba(8,10,12,0.85)';
    ctx.fillRect(x0 - 4, y0 - 16, w + 8, h + 22);
    ctx.font = '7px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#d8d0b0';
    ctx.fillText(this.title, x, y0 - 8);
    ctx.fillStyle = '#2a2e32';
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = '#b8862a';
    ctx.fillRect(x0 + this.goodStart * w, y0, this.goodWidth * w, h);
    ctx.fillStyle = '#fff1b0';
    ctx.fillRect(x0 + this.perfStart * w, y0, this.perfectWidth * w, h);
    ctx.fillStyle = this.done ? (this.result === 'fail' ? '#ff4030' : '#60ff90') : '#ffffff';
    ctx.fillRect(x0 + this.pos * w - 1.5, y0 - 3, 3, h + 6);
    if (this.done) {
      ctx.fillStyle = this.result === 'fail' ? '#ff5040' : this.result === 'perfect' ? '#fff1b0' : '#9dff9d';
      ctx.font = 'bold 9px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(this.result === 'fail' ? 'ARC FLASH!' : this.result === 'perfect' ? 'PERFECT · MUSCLE MEMORY' : 'CLEAN THROW', x, y0 + h + 10);
    }
  }
}

export class PlayerBody {
  constructor(x, y, stats) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = 10;
    this.facing = -Math.PI / 2;
    this.maxHp = stats.maxHp;
    this.hp = stats.maxHp;
    this.padlocks = stats.padlocks;
    this.toolIndex = 0;
    this.dodgeT = 0; this.dodgeCd = 0; this.dodgeDir = { x: 0, y: 0 };
    this.iframes = 0;
    this.downed = false; this.downedT = 0;
    this.skill = null;
    this.stickCd = 0; this.scanCd = 0; this.swingT = 0;
    this.hurtFlash = 0;
    this.stepAcc = 0;
    this.inWater = false;
    this.walk = 0;
    this.moving = false;
    this.waterContact = 0;
  }

  get tool() { return TOOLS[this.toolIndex]; }

  isPhasing(world) { return this.dodgeT > 0 && world.stats.phaseShift; }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  knock(vx, vy) { this.vx += vx; this.vy += vy; }

  hurt(amount, sx, sy, kind, world) {
    if (this.downed) return 0;
    const elec = kind === 'water' || kind === 'arc' || kind === 'cap' || kind === 'flash' || kind === 'beam';
    if (kind !== 'water' && this.iframes > 0) return 0;
    let dmg = amount * (elec ? world.stats.elecResist : 1);
    if (this.isPhasing(world) && elec) dmg = 0;
    if (dmg <= 0) return 0;
    this.hp -= dmg;
    this.hurtFlash = 1;
    if (kind !== 'water') {
      this.iframes = 0.4;
      const dx = this.x - sx, dy = this.y - sy;
      world.camera.addTrauma(0.35 + Math.min(0.4, dmg / 60), dx, dy);
      audio.hurt();
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.downed = true;
      this.downedT = 14;
      this.skill = null;
      world.onBodyDowned();
    }
    return dmg;
  }

  revive(fraction) {
    this.downed = false;
    this.hp = Math.max(1, this.maxHp * fraction);
    this.iframes = 1.5;
  }

  update(dt, intent, world) {
    this.iframes = Math.max(0, this.iframes - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.stickCd = Math.max(0, this.stickCd - dt);
    this.scanCd = Math.max(0, this.scanCd - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    const stats = world.stats;

    if (this.downed) {
      this.downedT -= dt;
      this.vx *= 0.9; this.vy *= 0.9;
      if (Math.random() < dt * 20) world.particles.voxels(this.x, this.y, 1, { rise: 30 });
      return;
    }

    let ix = intent.x, iy = intent.y;
    if (this.skill) {
      ix = 0; iy = 0;
      this.skill.update(dt);
      if (intent.interact && !this.skill.done) this.skill.press();
      if (this.skill.done && this.skill.resultT > 0.45) this.skill = null;
    } else {
      if (intent.cycle) {
        this.toolIndex = (this.toolIndex + 1) % TOOLS.length;
        audio.uiMove();
        world.toast(`TOOL: ${this.tool}`, '#d8d0b0');
      }
      if (intent.use) world.useTool(this);
      if (intent.interact) world.bodyInteract();
      if (intent.dodge && this.dodgeCd <= 0) this.startDodge(ix, iy, world);
    }

    const il = Math.hypot(ix, iy);
    if (il > 0) { ix /= il; iy /= il; }
    this.inWater = world.isWaterPx(this.x, this.y + 6);
    const waterMul = this.inWater ? stats.waterSlow : 1;
    const maxSpeed = 175 * stats.moveSpeed * waterMul;

    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const s = 520 * (0.35 + this.dodgeT / 0.3);
      this.vx = this.dodgeDir.x * s;
      this.vy = this.dodgeDir.y * s;
      if (this.isPhasing(world)) world.particles.voxels(this.x, this.y - 10, 3, { burst: 60, life: 0.4 });
      else if (Math.random() < 0.5) world.particles.smoke(this.x, this.y + 6, 1, { size: 4 });
    } else {
      // Inertia: heavy accel, heavier friction when you let go.
      const accel = il > 0 ? 1500 : 1900;
      const tx = ix * maxSpeed, ty = iy * maxSpeed;
      const ddx = tx - this.vx, ddy = ty - this.vy;
      const dl = Math.hypot(ddx, ddy);
      const step = accel * dt;
      if (dl <= step) { this.vx = tx; this.vy = ty; } else { this.vx += (ddx / dl) * step; this.vy += (ddy / dl) * step; }
    }

    const ox = this.x, oy = this.y;
    world.moveEntity(this, this.vx * dt, this.vy * dt, this.r, this.isPhasing(world));
    const moved = Math.hypot(this.x - ox, this.y - oy);
    this.moving = moved > 0.3;
    if (il > 0 && !this.skill) this.facing = lerpAngle(this.facing, Math.atan2(iy, ix), damp(14, dt));
    if (this.moving) {
      this.walk += moved * 0.12;
      this.stepAcc += moved;
      if (this.stepAcc > 34) {
        this.stepAcc = 0;
        audio.footstep(this.inWater);
        if (this.inWater) world.particles.splash(this.x, this.y + 8, 8);
      }
    }

    const erosion = 1 - world.run.anchor / 100;
    if (Math.random() < dt * erosion * 9) {
      const side = this.erodeSide();
      world.particles.voxels(this.x + side * 7, this.y - 22 + Math.random() * 14, 1, { rise: 25, spread: 3 });
    }
  }

  startDodge(ix, iy, world) {
    let dx = ix, dy = iy;
    if (!dx && !dy) { dx = Math.cos(this.facing); dy = Math.sin(this.facing); }
    const l = Math.hypot(dx, dy) || 1;
    this.dodgeDir = { x: dx / l, y: dy / l };
    this.dodgeT = 0.3;
    this.dodgeCd = 0.85;
    this.iframes = Math.max(this.iframes, 0.24);
    world.camera.addTrauma(0.12, dx, dy);
    if (world.stats.phaseShift) { audio.materialize(); world.particles.voxels(this.x, this.y - 12, 16, { burst: 80 }); }
    else audio.footstep(this.inWater);
  }

  /** Sprite direction from facing angle. */
  dir() {
    const a = this.facing;
    const c = Math.cos(a), s = Math.sin(a);
    if (Math.abs(c) > Math.abs(s)) return c > 0 ? 'right' : 'left';
    return s > 0 ? 'down' : 'up';
  }

  /** Screen side (−1 left, +1 right) where Cole's *left* side is visible. */
  erodeSide() {
    const d = this.dir();
    return d === 'down' ? 1 : d === 'up' ? -1 : d === 'right' ? -1 : 1;
  }

  render(ctx, t, world) {
    const anchor = world.run.anchor;
    const erosion = clamp(1 - anchor / 100, 0, 1);
    const phasing = this.isPhasing(world);
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(this.x, this.y + 8, 11, 4.5, 0, 0, Math.PI * 2); ctx.fill();

    if (this.downed) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(Math.PI / 2);
      this.drawSprite(ctx, 'right', -12, -18, erosion, t, false, 0);
      ctx.restore();
      return;
    }

    const d = this.dir();
    const bob = this.moving ? Math.round(Math.abs(Math.sin(this.walk)) * 1) * -2 : 0;
    const flash = this.iframes > 0 && this.hurtFlash > 0 && Math.sin(t * 50) > 0;
    this.drawSprite(ctx, d, Math.round(this.x - 12), Math.round(this.y - 30 + bob), erosion, t, phasing, flash);

    // Hot stick swing: 8ft fiberglass pole sweeping an arc.
    if (this.swingT > 0) {
      const k = 1 - this.swingT / 0.22;
      const a = this.facing - 1.1 + k * 2.2;
      const reach = world.stats.stickReach;
      const hx = this.x + Math.cos(this.facing) * 6, hy = this.y - 12;
      ctx.strokeStyle = 'rgba(255,220,140,0.25)';
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(hx, hy, reach * 0.8, this.facing - 1.1, a); ctx.stroke();
      ctx.strokeStyle = '#d9a12a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * reach, hy + Math.sin(a) * reach); ctx.stroke();
      ctx.fillStyle = '#c9c9c9';
      ctx.fillRect(hx + Math.cos(a) * reach - 2, hy + Math.sin(a) * reach - 2, 4, 4);
    }
  }

  drawSprite(ctx, d, ox, oy, erosion, t, phasing, flash) {
    const mirror = d === 'left';
    const rows = SPRITES[mirror ? 'right' : d];
    const side = this.erodeSide();
    const P = 2;
    const tick = Math.floor(t * 8);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < 12; c++) {
        const ch = row[mirror ? 11 - c : c];
        if (ch === '.') continue;
        let color = flash ? '#ffffff' : PAL[ch];
        let dx = 0, dy = 0;
        // Erosion: Cole's left side dissolves outward-first; the face goes early.
        const sideFactor = (side > 0 ? c - 5.5 : 5.5 - c) / 6;
        const headBias = r < 7 ? 0.25 : 0;
        const h = hashNoise(c, r, 77);
        const threshold = erosion * (sideFactor > 0 ? 0.55 + sideFactor * 1.1 + headBias : 0.08);
        if (phasing || h < threshold) {
          const flick = hashNoise(c, r, tick);
          if (!phasing && h < threshold * 0.35 && flick < 0.6) continue; // missing voxels
          color = flick < 0.5 ? '#50f0ff' : flick < 0.8 ? '#2a9cb8' : '#c8ffff';
          const drift = phasing ? 6 : 2;
          dx = Math.round((flick - 0.5) * drift) + (phasing ? 0 : (side * Math.round(h * 3)));
          dy = -Math.round(flick * drift * 0.6);
        }
        ctx.fillStyle = color;
        ctx.fillRect(ox + c * P + dx, oy + r * P + dy, P, P);
      }
    }
  }
}
