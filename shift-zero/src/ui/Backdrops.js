// Procedural scenes behind the DOM screens: the substation in the rain (title), the arc
// flash (intro), blueprint grid (work orders), the breakroom, and the dawn of each ending.
import { hashNoise, lightningPath, strokePath, clamp } from '../engine/Util.js';
import { PlayerBody } from '../entities/PlayerBody.js';

export class Backdrops {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.drops = Array.from({ length: 260 }, () => this.newDrop(true));
    this.flashT = 0;
    this.boltT = 3;
    this.bolt = null;
    this.dummy = new PlayerBody(0, 0, { maxHp: 100, padlocks: 0 });
    this.walkX = -60;
  }

  newDrop(anywhere) {
    return { x: Math.random() * (this.w + 200) - 100, y: anywhere ? Math.random() * this.h : -20, len: 8 + Math.random() * 18, speed: 600 + Math.random() * 500, a: 0.15 + Math.random() * 0.3 };
  }

  rain(ctx, dt, color = '160,180,200', wind = -0.18) {
    ctx.lineWidth = 1;
    for (const d of this.drops) {
      d.y += d.speed * dt;
      d.x += d.speed * wind * dt;
      if (d.y > this.h + 20) Object.assign(d, this.newDrop(false));
      ctx.strokeStyle = `rgba(${color},${d.a})`;
      ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.len * wind, d.y - d.len); ctx.stroke();
    }
  }

  sky(ctx, top, bottom) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  substation(ctx, horizon, t, tint = '#06080b') {
    ctx.fillStyle = tint;
    // Lattice pylons
    for (const [px, ph] of [[150, 300], [520, 360], [980, 320], [1210, 260]]) {
      ctx.strokeStyle = tint; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px - 30, horizon); ctx.lineTo(px - 6, horizon - ph); ctx.lineTo(px + 6, horizon - ph); ctx.lineTo(px + 30, horizon);
      for (let k = 0; k < 8; k++) {
        const y1 = horizon - (ph / 8) * k, y2 = horizon - (ph / 8) * (k + 1);
        const w1 = 30 - (24 * k) / 8, w2 = 30 - (24 * (k + 1)) / 8;
        ctx.moveTo(px - w1, y1); ctx.lineTo(px + w2, y2); ctx.moveTo(px + w1, y1); ctx.lineTo(px - w2, y2);
      }
      ctx.moveTo(px - 50, horizon - ph + 30); ctx.lineTo(px + 50, horizon - ph + 30);
      ctx.stroke();
    }
    // Catenary wires
    ctx.strokeStyle = 'rgba(6,8,11,0.9)'; ctx.lineWidth = 1.2;
    const tops = [[150, 270], [520, 330], [980, 290], [1210, 230]];
    for (let i = 0; i < tops.length - 1; i++) {
      for (const off of [-40, 0, 40]) {
        const [x1, h1] = tops[i], [x2, h2] = tops[i + 1];
        ctx.beginPath();
        ctx.moveTo(x1 + off, horizon - h1);
        ctx.quadraticCurveTo((x1 + x2) / 2, horizon - (h1 + h2) / 2 + 60, x2 + off, horizon - h2);
        ctx.stroke();
      }
    }
    // Transformer blocks + fence
    for (const [x, w, h] of [[300, 120, 90], [440, 80, 120], [700, 160, 110], [880, 90, 80]]) {
      ctx.fillRect(x, horizon - h, w, h);
      for (let k = 0; k < 3; k++) ctx.fillRect(x + 15 + k * (w / 3), horizon - h - 26, 8, 26);
    }
    ctx.fillRect(0, horizon, this.w, this.h - horizon);
    ctx.strokeStyle = 'rgba(40,46,52,0.6)'; ctx.lineWidth = 1;
    for (let x = 0; x < this.w; x += 10) { ctx.beginPath(); ctx.moveTo(x, horizon - 40); ctx.lineTo(x + 10, horizon); ctx.moveTo(x + 10, horizon - 40); ctx.lineTo(x, horizon); ctx.stroke(); }
    ctx.fillStyle = 'rgba(40,46,52,0.8)';
    ctx.fillRect(0, horizon - 42, this.w, 2);
    // Sodium lamp
    const flick = hashNoise(Math.floor(t * 12), 0, 3) > 0.12 ? 1 : 0.2;
    const lg = ctx.createRadialGradient(610, horizon - 150, 2, 610, horizon - 150, 220);
    lg.addColorStop(0, `rgba(255,170,70,${0.35 * flick})`);
    lg.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(390, horizon - 370, 440, 440);
    ctx.fillStyle = `rgba(255,200,120,${flick})`;
    ctx.fillRect(604, horizon - 152, 12, 4);
    ctx.fillStyle = tint;
    ctx.fillRect(608, horizon - 150, 3, 150);
  }

  storm(ctx, dt) {
    this.boltT -= dt;
    if (this.boltT <= 0) {
      this.boltT = 4 + Math.random() * 7;
      this.flashT = 0.35;
      const x = 200 + Math.random() * 900;
      this.bolt = lightningPath(x, 0, x + (Math.random() - 0.5) * 300, 380, 14, 50);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      ctx.fillStyle = `rgba(200,210,255,${this.flashT * 0.5})`;
      ctx.fillRect(0, 0, this.w, this.h);
      if (this.bolt) { ctx.strokeStyle = `rgba(230,235,255,${this.flashT * 2.5})`; ctx.lineWidth = 2; strokePath(ctx, this.bolt); }
    }
  }

  title(ctx, t, dt) {
    this.sky(ctx, '#03050a', '#121a26');
    const glow = ctx.createLinearGradient(0, 380, 0, 520);
    glow.addColorStop(0, 'rgba(255,140,60,0)'); glow.addColorStop(1, 'rgba(255,140,60,0.12)');
    ctx.fillStyle = glow; ctx.fillRect(0, 380, this.w, 140);
    this.storm(ctx, dt);
    this.substation(ctx, 520, t);
    // Cole, tiny, under the lamp — his left side drifting upward as pixels.
    this.dummy.facing = Math.PI / 2;
    ctx.save();
    ctx.translate(596, 476);
    ctx.scale(1.4, 1.4);
    this.dummy.drawSprite(ctx, 'down', 0, 0, 0.35, t, false, false);
    ctx.restore();
    for (let i = 0; i < 18; i++) {
      const k = (t * 0.25 + i / 18) % 1;
      ctx.fillStyle = `rgba(80,240,255,${(1 - k) * 0.8})`;
      ctx.fillRect(626 + Math.sin(i * 7 + t) * 8 + k * 20, 486 - k * 160, 3, 3);
    }
    this.rain(ctx, dt);
  }

  intro(ctx, t, dt, line) {
    ctx.fillStyle = '#030304';
    ctx.fillRect(0, 0, this.w, this.h);
    if (line === 3 && this.lastLine !== 3) this.flashT = 1;
    this.lastLine = line;
    if (this.flashT > 0) {
      this.flashT -= dt * 0.8;
      ctx.fillStyle = `rgba(255,250,235,${this.flashT})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    for (let i = 0; i < 40; i++) {
      const k = (t * 0.05 + hashNoise(i, 0, 1)) % 1;
      ctx.fillStyle = `rgba(255,170,80,${(1 - k) * 0.4})`;
      ctx.fillRect(hashNoise(i, 1, 2) * this.w, this.h - k * this.h, 2, 2);
    }
    if (line >= 5) {
      for (let i = 0; i < 60; i++) {
        const k = (t * 0.08 + hashNoise(i, 5, 2)) % 1;
        ctx.fillStyle = `rgba(80,240,255,${(1 - k) * 0.5})`;
        ctx.fillRect(this.w * 0.5 + (hashNoise(i, 3, 3) - 0.3) * 500, this.h * (1 - k), 3, 3);
      }
    }
  }

  blueprint(ctx, t) {
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = 'rgba(80,160,200,0.08)'; ctx.lineWidth = 1;
    for (let x = 0; x < this.w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.h); ctx.stroke(); }
    for (let y = 0; y < this.h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(80,240,255,0.18)'; ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      let x = Math.floor(hashNoise(i, 0, 9) * 40) * 32, y = Math.floor(hashNoise(i, 1, 9) * 22) * 32;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        if (hashNoise(i, k, 4) > 0.5) x += (hashNoise(k, i, 5) > 0.5 ? 1 : -1) * 32 * (1 + Math.floor(hashNoise(i, k, 6) * 6));
        else y += (hashNoise(k, i, 7) > 0.5 ? 1 : -1) * 32 * (1 + Math.floor(hashNoise(i, k, 8) * 4));
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const p = (t * 0.3) % 1;
    ctx.fillStyle = 'rgba(255,190,80,0.7)';
    ctx.fillRect(p * this.w, 320, 4, 4);
  }

  breakroom(ctx, t, dt, anchor) {
    // Cinderblock wall
    ctx.fillStyle = '#262a25';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
    for (let y = 0; y < 520; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke();
      for (let x = (y / 40) % 2 ? 0 : 60; x < this.w; x += 120) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 40); ctx.stroke(); }
    }
    // Linoleum
    for (let y = 520; y < this.h; y += 40) for (let x = 0; x < this.w; x += 40) {
      ctx.fillStyle = ((x + y) / 40) % 2 ? '#2e2a24' : '#3a352c';
      ctx.fillRect(x, y, 40, 40);
    }
    // Fluorescent tube
    const fl = hashNoise(Math.floor(t * 9), 0, 4) > 0.06 ? 1 : 0.3;
    ctx.fillStyle = `rgba(230,245,235,${0.9 * fl})`;
    ctx.fillRect(500, 10, 280, 8);
    const g = ctx.createRadialGradient(640, 14, 10, 640, 14, 700);
    g.addColorStop(0, `rgba(210,240,220,${0.18 * fl})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
    // Vending machine (buzzing)
    const vf = 0.75 + 0.25 * Math.sin(t * 120) * (hashNoise(Math.floor(t * 3), 1, 1) > 0.7 ? 1 : 0.1);
    ctx.fillStyle = '#1b1d22'; ctx.fillRect(40, 220, 170, 310);
    ctx.fillStyle = `rgba(190,220,255,${0.55 * vf})`; ctx.fillRect(55, 240, 110, 230);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      ctx.fillStyle = ['#c43b2b', '#e0c020', '#3a8fd8', '#f2f2f2'][(r + c) % 4];
      ctx.fillRect(62 + c * 26, 250 + r * 44, 18, 24);
    }
    ctx.fillStyle = '#444'; ctx.fillRect(175, 300, 22, 60);
    ctx.fillStyle = '#000'; ctx.fillRect(60, 488, 100, 28);
    const vg = ctx.createRadialGradient(110, 360, 10, 110, 360, 260);
    vg.addColorStop(0, `rgba(170,210,255,${0.16 * vf})`); vg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vg; ctx.fillRect(0, 100, 400, 500);
    // Counter + microwave
    ctx.fillStyle = '#3d3a33'; ctx.fillRect(900, 380, 360, 150);
    ctx.fillStyle = '#5a564c'; ctx.fillRect(890, 370, 380, 14);
    ctx.fillStyle = '#d8d4c8'; ctx.fillRect(950, 280, 170, 92);
    ctx.fillStyle = '#1b1a18'; ctx.fillRect(962, 292, 110, 68);
    const mw = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.fillStyle = `rgba(255,190,90,${0.35 + 0.2 * mw})`; ctx.fillRect(966, 296, 102, 60);
    ctx.fillStyle = 'rgba(255,240,200,0.5)';
    ctx.beginPath(); ctx.ellipse(1017, 345, 30, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5ac85a'; ctx.font = 'bold 12px ui-monospace, monospace'; ctx.textAlign = 'left';
    ctx.fillText(`0${Math.floor(t / 60) % 10}:${String(Math.floor(t) % 60).padStart(2, '0')}`, 1080, 312);
    // Workbench with vise
    ctx.fillStyle = '#5a4630'; ctx.fillRect(560, 440, 260, 18);
    ctx.fillStyle = '#3a2e20'; ctx.fillRect(570, 458, 12, 70); ctx.fillRect(800, 458, 12, 70);
    ctx.fillStyle = '#4a5560'; ctx.fillRect(590, 412, 50, 28);
    ctx.fillStyle = '#d8b04a'; ctx.fillRect(690, 428, 12, 10); // a padlock on the bench
    ctx.strokeStyle = '#a07a20'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(696, 428, 4, Math.PI, 0); ctx.stroke();
    // Safety poster
    ctx.fillStyle = '#e8e0c8'; ctx.fillRect(300, 120, 150, 110);
    ctx.fillStyle = '#c42020'; ctx.fillRect(300, 120, 150, 26);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText('SAFETY FIRST', 375, 138);
    ctx.fillStyle = '#222'; ctx.font = 'bold 34px ui-monospace, monospace';
    ctx.fillText('0', 375, 190);
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('DAYS WITHOUT INCIDENT', 375, 214);
    // Cole on the bench, hard hat in his lap.
    ctx.fillStyle = '#4a3a28'; ctx.fillRect(250, 500, 260, 14);
    ctx.save();
    ctx.translate(345, 418);
    ctx.scale(3, 3);
    this.dummy.facing = Math.PI / 2;
    this.dummy.drawSprite(ctx, 'down', 0, 0, clamp(1 - anchor / 100, 0, 1), t, false, false);
    ctx.restore();
    // The Voxel flickers above an outlet.
    ctx.fillStyle = '#d8d4c8'; ctx.fillRect(860, 300, 18, 26);
    for (let i = 0; i < 26; i++) {
      const a = hashNoise(i, Math.floor(t * 10), 2) * Math.PI * 2, r = hashNoise(i, Math.floor(t * 10), 3) * 26;
      ctx.fillStyle = i % 3 ? 'rgba(80,240,255,0.8)' : 'rgba(200,255,255,0.9)';
      ctx.fillRect(869 + Math.cos(a) * r, 260 + Math.sin(a) * r * 1.2, 4, 4);
    }
    this.rainWindow(ctx, t, dt);
  }

  rainWindow(ctx, t, dt) {
    ctx.save();
    ctx.beginPath(); ctx.rect(560, 90, 200, 140); ctx.clip();
    ctx.fillStyle = '#0a121c'; ctx.fillRect(560, 90, 200, 140);
    ctx.fillStyle = 'rgba(255,170,70,0.25)'; ctx.fillRect(600, 190, 6, 40);
    this.rain(ctx, dt * 0.5, '160,190,220', -0.1);
    ctx.restore();
    ctx.strokeStyle = '#555'; ctx.lineWidth = 6; ctx.strokeRect(560, 90, 200, 140);
    ctx.beginPath(); ctx.moveTo(660, 90); ctx.lineTo(660, 230); ctx.stroke();
  }

  ending(ctx, t, dt, id) {
    const palettes = {
      union: ['#2a2638', '#d89070'], company: ['#0c1012', '#3a4844'], overtime: ['#141a24', '#6a7480'],
      ghost: ['#06121c', '#2a6a80'], terminated: ['#050203', '#2a0606'],
    };
    const [top, bottom] = palettes[id] || palettes.overtime;
    const k = clamp(t / 20, 0, 1);
    this.sky(ctx, top, bottom);
    if (id === 'union') {
      const sun = ctx.createRadialGradient(1000, 520, 10, 1000, 520, 500 * k + 100);
      sun.addColorStop(0, 'rgba(255,200,140,0.5)'); sun.addColorStop(1, 'rgba(255,160,100,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, this.w, this.h);
    }
    if (id === 'terminated') {
      ctx.fillStyle = `rgba(255,30,20,${0.12 + 0.12 * Math.sin(t * 5)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    this.substation(ctx, 560, t, id === 'union' ? '#1a1418' : '#05070a');
    if (id !== 'terminated') {
      this.walkX += dt * 26;
      if (this.walkX > this.w + 80) this.walkX = -60;
      const erosion = id === 'company' ? 1 : id === 'overtime' ? 0.45 : 0;
      this.dummy.facing = 0;
      this.dummy.moving = true;
      this.dummy.walk += dt * 6;
      ctx.save();
      ctx.translate(this.walkX, 500 + Math.round(Math.abs(Math.sin(this.dummy.walk))) * -2);
      ctx.scale(2.2, 2.2);
      this.dummy.drawSprite(ctx, 'right', 0, 0, erosion, t, false, false);
      ctx.restore();
      if (id === 'ghost') {
        for (let i = 0; i < 30; i++) {
          const a = hashNoise(i, Math.floor(t * 6), 1);
          ctx.fillStyle = `rgba(80,240,255,${0.3 + a * 0.5})`;
          ctx.fillRect(430 + hashNoise(i, 2, 2) * 400, 440 + hashNoise(i, 3, 3) * 80 + Math.sin(t + i) * 4, 3, 3);
        }
      }
      if (id === 'union') {
        ctx.fillStyle = `rgba(255,200,120,${0.6 + 0.3 * Math.sin(t * 2)})`;
        ctx.fillRect(1180, 520, 6, 6); // the porch light, far off
      }
    }
    this.rain(ctx, dt, id === 'union' ? '220,200,190' : '160,180,200');
  }
}
