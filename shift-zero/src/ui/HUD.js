// Diegetic HUD on its own canvas layer: a portrait of Cole that pixelates as Anchor burns,
// a phosphor oscilloscope of the three phases, analog gauges, his father's Timex as the
// meltdown clock, memory icons, Solo-Swap indicator — plus the DOM corporate pager.
import { clamp, hashNoise, damp } from '../engine/Util.js';
import { memoriesLost, MEMORIES, recall } from '../systems/Narrative.js';
import { audio } from '../engine/AudioSynth.js';

const FONT = '"IBM Plex Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
const AMBER = '#ffcf70', CYAN = '#50f0ff', PAPER = '#e8e0c8';

function buildFace() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  px(0, 0, 32, 32, '#0d1418');
  for (let y = 0; y < 32; y += 3) px(0, y, 32, 1, '#111b20');
  px(3, 26, 26, 6, '#4d5136'); px(3, 29, 26, 1, '#d9df6a'); px(12, 25, 8, 3, '#c8d0d0');
  px(13, 22, 6, 4, '#9a6d50');
  px(9, 10, 14, 13, '#c79572'); px(10, 23, 12, 1, '#a87a5c'); px(19, 11, 4, 12, '#ad7f60');
  px(8, 14, 1, 4, '#b5865f'); px(23, 14, 1, 4, '#9a6d50');
  px(8, 4, 16, 6, '#e6e1d3'); px(10, 3, 12, 1, '#e6e1d3'); px(6, 9, 20, 2, '#d6d0c0'); px(6, 10, 20, 1, '#a9a393');
  px(18, 5, 3, 2, '#b8402a'); px(9, 5, 2, 3, '#ffffff');
  px(11, 13, 4, 1, '#5c4636'); px(17, 13, 4, 1, '#5c4636');
  px(12, 15, 2, 1, '#16110d'); px(18, 15, 2, 1, '#16110d');
  px(11, 16, 4, 1, '#a07258'); px(17, 16, 4, 1, '#a07258');
  px(15, 15, 2, 4, '#ad7f60'); px(15, 19, 2, 1, '#8a5e44');
  px(13, 21, 6, 1, '#7a4a3a');
  for (let y = 19; y < 23; y++) for (let x = 10; x < 22; x++) if (hashNoise(x, y, 3) > 0.55) px(x, y, 1, 1, '#7d604c');
  return { canvas: c, data: g.getImageData(0, 0, 32, 32).data };
}

export class HUD {
  constructor(canvas, pagerEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = canvas.width; this.h = canvas.height;
    this.face = buildFace();
    this.portrait = document.createElement('canvas');
    this.portrait.width = 32; this.portrait.height = 32;
    this.pctx = this.portrait.getContext('2d');
    this.pimg = this.pctx.createImageData(32, 32);
    this.portraitT = 0;
    this.scope = document.createElement('canvas');
    this.scope.width = 220; this.scope.height = 92;
    this.sctx = this.scope.getContext('2d');
    this.needles = { hp: 1, sig: 1 };
    this.pager = pagerEl;
    this.pagerText = pagerEl && pagerEl.querySelector('#pager-text');
    this.pagerFrom = pagerEl && pagerEl.querySelector('#pager-from');
    this.typeT = 0;
    this.typeTarget = '';
  }

  clear() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.w, this.h); }

  // ------------------------------------------------------------------ pager (DOM)
  updatePager(narrative, dt, started) {
    if (!this.pager) return;
    const msg = narrative.current;
    if (started) {
      this.typeTarget = msg.text;
      this.typeT = 0;
      this.pagerFrom.textContent = msg.from === 'unknown' ? '???? · UNREGISTERED' : 'DISPATCH · GRIDCORP';
      this.pager.classList.remove('buzz');
      void this.pager.offsetWidth;
      this.pager.classList.add('buzz');
      this.pager.classList.toggle('unknown', msg.from === 'unknown');
      this.pager.classList.remove('idle');
      audio.pager();
    }
    if (msg) {
      this.typeT += dt * 55;
      this.pagerText.textContent = this.typeTarget.slice(0, Math.floor(this.typeT)) + (Math.floor(this.typeT * 0.2) % 2 ? '▌' : '');
    } else if (!this.pager.classList.contains('idle')) {
      this.pager.classList.add('idle');
      this.pagerFrom.textContent = 'GRIDCORP PAGER';
      this.pagerText.textContent = 'NO NEW MESSAGES';
    }
  }

  showPager(on) { if (this.pager) this.pager.style.display = on ? '' : 'none'; }

  // ------------------------------------------------------------------ main draw
  render(game, world, dt, t) {
    const ctx = this.ctx;
    this.clear();
    if (!world) return;
    const run = game.run;
    const body = world.body, voxel = world.voxel;

    // Screen-space feedback: flash, damage vignette, downed.
    if (world.flash > 0) {
      ctx.fillStyle = `rgba(255,250,235,${world.flash * 0.7})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    const hurt = 1 - body.hp / body.maxHp;
    if (hurt > 0.4 || body.hurtFlash > 0 || body.downed) {
      const a = body.downed ? 0.55 + 0.15 * Math.sin(t * 4) : Math.max(body.hurtFlash * 0.4, (hurt - 0.4) * 0.6);
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.35, this.w / 2, this.h / 2, this.h * 0.85);
      g.addColorStop(0, 'rgba(120,0,0,0)');
      g.addColorStop(1, `rgba(140,10,10,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    this.drawTopLeft(ctx, game, world);
    this.drawScope(ctx, world, dt, t);
    if (world.boss) this.drawBoss(ctx, world, t);
    else this.drawWatch(ctx, world, t);

    // Bottom console strip
    const y0 = this.h - 132;
    const grad = ctx.createLinearGradient(0, y0 - 20, 0, this.h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0 - 20, this.w, 152);

    this.portraitT -= dt;
    if (this.portraitT <= 0) { this.portraitT = 1 / 15; this.updatePortrait(run.anchor, body.hurtFlash, t); }
    this.drawPortrait(ctx, 16, this.h - 140, 124, run.anchor, t);

    this.needles.hp += (body.hp / body.maxHp - this.needles.hp) * damp(6, dt);
    this.needles.sig += (voxel.coherence / 100 - this.needles.sig) * damp(6, dt);
    this.drawGauge(ctx, 196, this.h - 70, 38, this.needles.hp, 'BODY', `${Math.ceil(body.hp)}`, AMBER, t, body.downed);
    this.drawGauge(ctx, 286, this.h - 70, 38, this.needles.sig, 'SIGNAL', voxel.desyncT > 0 ? 'DESYNC' : `${Math.ceil(voxel.coherence)}`, CYAN, t, voxel.desyncT > 0);
    this.drawAnchor(ctx, 340, this.h - 112, run.anchor, t);
    this.drawKit(ctx, 340, this.h - 52, game, world);
    this.drawSwap(ctx, game, t);
    this.drawToasts(ctx, world);
    if (world.bigText) this.drawBigText(ctx, world.bigText, t);
    this.drawOffscreen(ctx, world, t);
  }

  drawTopLeft(ctx, game, world) {
    const run = game.run;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = PAPER;
    const title = world.boss ? 'DEPTH 5 · MAIN TIE YARD' : `DEPTH ${run.depth} · ${run.workOrder === 'hot' ? 'HOT-WORK EMERGENCY' : 'CLEAN MAINTENANCE'}`;
    ctx.fillText(title, 16, 14);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = '#b8b0a0';
    const mut = run.mutatorName ? ` · ${run.mutatorName}` : '';
    ctx.fillText(`EFFICIENCY BONUS ${Math.round(run.efficiency * 100)}%${mut}`, 16, 32);
    ctx.fillStyle = AMBER;
    ctx.font = `11px ${FONT}`;
    this.wrap(ctx, '▸ ' + world.objective(), 16, 50, world.boss ? 390 : 560, 14);
  }

  wrap(ctx, text, x, y, maxW, lh) {
    const words = text.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lh; line = w; }
      else line = test;
    }
    if (line) ctx.fillText(line, x, y);
    return y + lh;
  }

  updatePortrait(anchor, hurtFlash, t) {
    const src = this.face.data, out = this.pimg.data;
    const e = clamp(1 - anchor / 100, 0, 1);
    const block = e > 0.75 ? 4 : e > 0.45 ? 3 : 2;
    const tick = Math.floor(t * 6);
    const rowShift = anchor < 40 ? (y) => (hashNoise(y, tick, 9) > 0.93 ? Math.round((hashNoise(y, tick, 2) - 0.5) * 8) : 0) : () => 0;
    for (let y = 0; y < 32; y++) {
      const shift = rowShift(y);
      for (let x = 0; x < 32; x++) {
        const sx = clamp(x + shift, 0, 31);
        let i = (y * 32 + sx) * 4;
        const o = (y * 32 + x) * 4;
        // Cole's left = viewer's right; outer edges and the face go first.
        const v = (x / 31) * 0.9 + hashNoise(x, y, 7) * 0.35 + (y > 8 && y < 24 ? 0.1 : 0);
        const eroded = v > 1.45 - e * 1.55;
        let r = src[i], g = src[i + 1], b = src[i + 2];
        if (eroded) {
          const bx = Math.floor(sx / block) * block, by = Math.floor(y / block) * block;
          i = (by * 32 + bx) * 4;
          r = src[i]; g = src[i + 1]; b = src[i + 2];
          const mix = 0.35 + e * 0.5;
          const fl = hashNoise(bx, by, tick);
          r = r * (1 - mix) + 40 * mix;
          g = g * (1 - mix) + (fl > 0.8 ? 255 : 220) * mix;
          b = b * (1 - mix) + 255 * mix;
          if (fl < 0.06 * e) { r = 0; g = 0; b = 0; }
        }
        if (hurtFlash > 0) { r = r + (255 - r) * hurtFlash * 0.5; g *= 1 - hurtFlash * 0.4; b *= 1 - hurtFlash * 0.4; }
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
      }
    }
    this.pctx.putImageData(this.pimg, 0, 0);
  }

  drawPortrait(ctx, x, y, s, anchor, t) {
    ctx.fillStyle = '#0a0c0e';
    ctx.fillRect(x - 4, y - 4, s + 8, s + 24);
    ctx.strokeStyle = '#3a3f44';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 4, y - 4, s + 8, s + 24);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.portrait, x, y, s, s);
    ctx.imageSmoothingEnabled = true;
    for (let yy = y; yy < y + s; yy += 3) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, yy, s, 1); }
    ctx.font = `bold 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = anchor > 30 ? PAPER : CYAN;
    ctx.fillText(anchor > 30 ? 'COLE · TECH II' : anchor > 0 ? 'C0LE · 0x1A' : 'ASSET #4471', x + s / 2, y + s + 10);
  }

  drawGauge(ctx, cx, cy, r, v, label, readout, color, t, alarm) {
    ctx.fillStyle = '#121416';
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e9e2cf';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r - 6, a0, a0 + (a1 - a0) * 0.2); ctx.stroke();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (a1 - a0) * (i / 10);
      const l = i % 5 === 0 ? 9 : 5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
      ctx.lineTo(cx + Math.cos(a) * (r - 2 - l), cy + Math.sin(a) * (r - 2 - l));
      ctx.stroke();
    }
    const wob = alarm ? Math.sin(t * 40) * 0.05 : Math.sin(t * 9) * 0.006;
    const a = a0 + (a1 - a0) * clamp(v + wob, 0, 1);
    ctx.strokeStyle = '#b01e10';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8)); ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = `bold 8px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#333';
    ctx.fillText(label, cx, cy + 14);
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = alarm && Math.sin(t * 8) > 0 ? '#ff4030' : color;
    ctx.fillText(readout, cx, cy + r + 14);
  }

  drawAnchor(ctx, x, y, anchor, t) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = anchor > 30 ? PAPER : CYAN;
    ctx.fillText(`ANCHOR · ${anchor}%`, x, y);
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = '#8a8478';
    ctx.fillText('humanity / memory — OVERCLOCK burns it', x + 118, y);
    const lost = memoriesLost(anchor);
    const segW = 64;
    for (let i = 0; i < 5; i++) {
      const sx = x + i * (segW + 6), sy = y + 8;
      const segFill = clamp((anchor - i * 20) / 20, 0, 1);
      ctx.fillStyle = '#1a1d20';
      ctx.fillRect(sx, sy, segW, 10);
      ctx.fillStyle = anchor > 30 ? '#e0c890' : CYAN;
      ctx.fillRect(sx, sy, segW * segFill, 10);
      const memIndex = 4 - i;
      const burned = memIndex < lost;
      this.drawMemoryIcon(ctx, MEMORIES[memIndex].icon, sx + 4, sy + 16, burned, t, memIndex);
      ctx.font = `8px ${FONT}`;
      ctx.fillStyle = burned ? '#3a6670' : '#b8b0a0';
      const title = burned ? hexish(MEMORIES[memIndex].title) : MEMORIES[memIndex].title.replace('{WIFE}', recall('Mara', anchor)).replace('{KID}', recall('Tess', anchor));
      ctx.fillText(title.slice(0, 13), sx + 22, sy + 27);
    }
  }

  drawMemoryIcon(ctx, icon, x, y, burned, t, seed) {
    const col = (a, b) => (burned ? (hashNoise(seed, Math.floor(t * 8), 3) > 0.5 ? '#50f0ff' : '#1f5b66') : a || b);
    if (icon === 'watch') {
      ctx.strokeStyle = col('#c8b080'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + 7, y + 7, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 7, y + 7); ctx.lineTo(x + 7, y + 3); ctx.moveTo(x + 7, y + 7); ctx.lineTo(x + 10, y + 7); ctx.stroke();
    } else if (icon === 'key') {
      ctx.fillStyle = col('#d8b04a');
      ctx.beginPath(); ctx.arc(x + 4, y + 7, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x + 7, y + 6, 8, 2); ctx.fillRect(x + 12, y + 8, 2, 3);
    } else {
      ctx.fillStyle = col('#efe9dc');
      ctx.fillRect(x, y, 14, 14);
      ctx.fillStyle = burned ? '#0a2a30' : '#5a6b78';
      ctx.fillRect(x + 2, y + 2, 10, 8);
      if (!burned) { ctx.fillStyle = '#e8b878'; ctx.fillRect(x + 4, y + 4, 2, 2); ctx.fillRect(x + 8, y + 5, 2, 2); }
    }
  }

  drawKit(ctx, x, y, game, world) {
    const body = world.body;
    ctx.textAlign = 'left';
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = AMBER;
    ctx.fillText(`TOOL ▸ ${body.tool}`, x, y + 12);
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = '#8a8478';
    ctx.fillText('[Q] cycle  [E] use', x + 4, y + 25);
    ctx.fillStyle = PAPER;
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillText('LOTO', x + 170, y + 12);
    for (let i = 0; i < body.padlocks; i++) {
      const lx = x + 206 + i * 16;
      ctx.fillStyle = '#d8b04a'; ctx.fillRect(lx, y + 6, 11, 9);
      ctx.strokeStyle = '#a07a20'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(lx + 5.5, y + 6, 3.5, Math.PI, 0); ctx.stroke();
    }
    if (!body.padlocks) { ctx.fillStyle = '#ff6050'; ctx.font = `9px ${FONT}`; ctx.fillText('NONE — throw & run · Voxel pads · buy more', x + 206, y + 13); }
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillStyle = '#e09a50';
    ctx.fillText(`Cu ${game.run.rpg.scrap}`, x + 170, y + 30);
    const syn = game.run.rpg.activeSynergies();
    ctx.font = `9px ${FONT}`;
    syn.forEach((s, i) => {
      ctx.fillStyle = CYAN;
      ctx.fillText(`⚡ ${s.name}`, x + 260 + (i % 2) * 170, y + 26 + Math.floor(i / 2) * 11 - (syn.length > 2 ? 6 : 0));
    });
  }

  drawSwap(ctx, game, t) {
    const x = this.w - 236, y = this.h - 48;
    ctx.fillStyle = 'rgba(10,12,14,0.8)';
    ctx.fillRect(x, y, 220, 34);
    ctx.strokeStyle = game.swapped ? CYAN : '#3a3f44';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, 219, 33);
    ctx.textAlign = 'left';
    ctx.font = `bold 10px ${FONT}`;
    if (game.swapped) {
      ctx.fillStyle = Math.sin(t * 4) > 0 ? CYAN : '#2a9cb8';
      ctx.fillText('SOLO-SWAP ▸ WASD DRIVES VOXEL', x + 8, y + 14);
      ctx.font = `9px ${FONT}`; ctx.fillStyle = '#8a8478';
      ctx.fillText('[TAB/BACK] back to Body · Body idle', x + 8, y + 27);
    } else {
      ctx.fillStyle = AMBER; ctx.fillText('WASD ▸ BODY', x + 8, y + 14);
      ctx.fillStyle = CYAN; ctx.fillText('ARROWS ▸ VOXEL', x + 100, y + 14);
      ctx.font = `9px ${FONT}`; ctx.fillStyle = '#8a8478';
      ctx.fillText('[TAB/BACK] Solo-Swap · [ESC/START] pause', x + 8, y + 27);
    }
  }

  drawScope(ctx, world, dt, t) {
    const s = this.sctx, W = 220, H = 92;
    s.fillStyle = 'rgba(4,14,8,0.35)';
    s.fillRect(0, 0, W, H);
    s.strokeStyle = 'rgba(60,140,80,0.25)';
    s.lineWidth = 1;
    for (let x = 0; x <= W; x += 22) { s.beginPath(); s.moveTo(x, 0); s.lineTo(x, H); s.stroke(); }
    for (let y = 0; y <= H; y += 23) { s.beginPath(); s.moveTo(0, y); s.lineTo(W, y); s.stroke(); }
    const pl = world.circuit.phaseLoad;
    const max = Math.max(1, pl.A, pl.B, pl.C);
    const stress = world.circuit.stress;
    const cols = ['rgba(255,190,90,0.9)', 'rgba(120,255,140,0.9)', 'rgba(90,220,255,0.9)'];
    ['A', 'B', 'C'].forEach((p, k) => {
      const amp = (pl[p] / max) * 34;
      s.strokeStyle = cols[k];
      s.lineWidth = 1.4;
      s.beginPath();
      for (let x = 0; x <= W; x += 2) {
        const ph = (x / W) * Math.PI * 4 + t * 6 + (k * Math.PI * 2) / 3;
        const harm = Math.sin(ph * 3) * stress * 0.35 + Math.sin(ph * 5) * stress * 0.2;
        const y = H / 2 - (Math.sin(ph) + harm) * amp + (Math.random() - 0.5) * stress * 3;
        if (x === 0) s.moveTo(x, y); else s.lineTo(x, y);
      }
      s.stroke();
    });
    const x0 = this.w - W - 16, y0 = 14;
    ctx.fillStyle = '#0b0d0e';
    ctx.fillRect(x0 - 6, y0 - 6, W + 12, H + 34);
    ctx.strokeStyle = '#3a3f44';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 - 6, y0 - 6, W + 12, H + 34);
    ctx.drawImage(this.scope, x0, y0);
    ctx.font = `9px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ['A', 'B', 'C'].forEach((p, k) => {
      ctx.fillStyle = cols[k];
      ctx.fillText(`Ø${p} ${Math.round(pl[p])}A`, x0 + k * 62, y0 + H + 13);
    });
    ctx.fillStyle = stress > 0.35 ? (Math.sin(t * 8) > 0 ? '#ff6050' : '#a03020') : '#7da080';
    ctx.fillText(`IMBALANCE ${Math.round(world.circuit.imbalance * 100)}%  THD ${Math.round(stress * 40)}%`, x0, y0 + H + 24);
    if (world.circuit.forcedT > 0) { ctx.fillStyle = CYAN; ctx.fillText(`SURGE ${Math.ceil(world.circuit.forcedT)}s`, x0 + 158, y0 + H + 24); }
  }

  drawWatch(ctx, world, t) {
    if (world.meltdownMax <= 0) return;
    const cx = this.w / 2, cy = 52, r = 34;
    const k = world.meltdown / world.meltdownMax;
    const danger = world.meltdown <= 30;
    ctx.fillStyle = '#2b2620';
    ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = danger && Math.sin(t * 8) > 0 ? '#f0d8c8' : '#efe7d2';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(200,40,30,0.25)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#222';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.lineWidth = i % 3 === 0 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3)); ctx.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8)); ctx.stroke();
    }
    const ma = -Math.PI / 2 + Math.PI * 2 * (1 - k);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ma) * (r - 10), cy + Math.sin(ma) * (r - 10)); ctx.stroke();
    const sa = -Math.PI / 2 + ((world.time % 60) / 60) * Math.PI * 2;
    ctx.strokeStyle = '#b01e10'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sa) * (r - 5), cy + Math.sin(sa) * (r - 5)); ctx.stroke();
    ctx.font = `bold 7px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6a5a40';
    ctx.fillText('TIMEX', cx, cy - 12);
    const m = Math.floor(world.meltdown / 60), s = Math.floor(world.meltdown % 60);
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = danger ? '#ff5040' : PAPER;
    ctx.fillText(world.meltdown <= 0 ? 'LOAD SPIKE!' : `LOAD SPIKE ${m}:${String(s).padStart(2, '0')}`, cx, cy + r + 18);
  }

  drawBoss(ctx, world, t) {
    const b = world.boss;
    const x = this.w / 2 - 220, y = 16, w = 440;
    ctx.textAlign = 'center';
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#ffd890';
    ctx.fillText('THE MAIN TIE TRANSFORMER', this.w / 2, y + 10);
    ctx.font = `9px ${FONT}`;
    ctx.fillStyle = '#b8b0a0';
    const phaseName = ['', 'PHASE I · ENERGIZED', 'PHASE II · BACK-FEED', 'PHASE III · LOAD SPIKE'][b.phase];
    ctx.fillText(phaseName, this.w / 2, y + 24);
    ctx.fillStyle = '#1a1d20';
    ctx.fillRect(x, y + 30, w, 10);
    let k;
    if (b.phase === 1) k = 1 - b.failed.size / 3;
    else if (b.phase === 2) k = b.coreHp / b.maxCoreHp;
    else k = b.meltdown / b.meltdownMax;
    ctx.fillStyle = b.phase === 3 ? (Math.sin(t * 10) > 0 ? '#ff4030' : '#a02010') : b.phase === 2 ? '#ff9040' : '#90b8ff';
    ctx.fillRect(x, y + 30, w * clamp(k, 0, 1), 10);
    if (b.phase === 2) {
      const g = world.circuit.getEdge('GND');
      ctx.fillStyle = g && g.bridged ? CYAN : '#ff6050';
      ctx.fillText(g && g.bridged ? 'CORE GROUNDED — STRIKE NOW' : 'CORE UNGROUNDED — VOXEL TO NEUTRAL GROUND', this.w / 2, y + 54);
    }
  }

  drawToasts(ctx, world) {
    ctx.textAlign = 'center';
    ctx.font = `bold 12px ${FONT}`;
    let y = this.h - 170;
    for (let i = world.toasts.length - 1; i >= 0; i--) {
      const tt = world.toasts[i];
      const a = clamp(Math.min(tt.t * 6, (tt.max - tt.t) * 2), 0, 1);
      const w = ctx.measureText(tt.text).width + 20;
      ctx.fillStyle = `rgba(6,8,10,${0.8 * a})`;
      ctx.fillRect(this.w / 2 - w / 2, y - 12, w, 18);
      ctx.globalAlpha = a;
      ctx.fillStyle = tt.color;
      ctx.fillText(tt.text, this.w / 2, y + 1);
      ctx.globalAlpha = 1;
      y -= 22;
    }
  }

  drawBigText(ctx, bt, t) {
    const a = clamp(Math.min(bt.t * 2, (bt.max - bt.t) * 1.5), 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, this.h / 2 - 70, this.w, 120);
    this.drawMemoryIcon(ctx, bt.icon || 'photo', this.w / 2 - 7, this.h / 2 - 60, bt.title.includes('BURN'), t, 1);
    ctx.textAlign = 'center';
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = bt.color;
    const jitter = bt.title.includes('BURN') ? (Math.random() - 0.5) * 3 : 0;
    ctx.fillText(bt.title, this.w / 2 + jitter, this.h / 2 - 16);
    ctx.font = `italic 14px Georgia, "Times New Roman", serif`;
    ctx.fillStyle = PAPER;
    const shown = bt.text.slice(0, Math.floor(bt.t * 45));
    this.wrap(ctx, shown, this.w / 2, this.h / 2 + 8, 760, 18);
    ctx.globalAlpha = 1;
  }

  drawOffscreen(ctx, world, t) {
    const v = world.voxel;
    const p = world.camera.worldToScreen(v.x, v.y);
    const m = 30;
    if (p.x > m && p.x < this.w - m && p.y > m && p.y < this.h - 150) return;
    const cx = clamp(p.x, m, this.w - m), cy = clamp(p.y, m + 70, this.h - 160);
    const a = Math.atan2(p.y - cy, p.x - cx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.fillStyle = Math.sin(t * 6) > 0 ? CYAN : '#2a9cb8';
    ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = `bold 9px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = CYAN;
    ctx.fillText('VOXEL', cx, cy + 18);
  }
}

function hexish(s) {
  return [...s.replace(/\{.*?\}/g, 'X')].slice(0, 3).map((c) => c.charCodeAt(0).toString(16).toUpperCase()).join(' ');
}
