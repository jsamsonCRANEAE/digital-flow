// ---------------------------------------------------------------------------
// Simulation: one play of 7v7 football at 120 Hz. Canonical frame: the
// offense drives toward +y; x is 0..53.33 across the field. Formations,
// routes and assignments come from the real playbook (plays.json).
// ---------------------------------------------------------------------------
const G = 10.7;                       // gravity, yd/s^2
const OFF_SLOTS = ['QB', 'RB', 'WR1', 'WR2', 'C', 'LG', 'RG'];
const DEF_SLOTS = ['DL1', 'DL2', 'LB1', 'LB2', 'CB1', 'CB2', 'S'];
const POS_SLOTS = { qb: ['QB'], rb: ['RB'], wr: ['WR1', 'WR2'], c: ['C'], og: ['LG', 'RG'], dl: ['DL1', 'DL2'], lb: ['LB1', 'LB2'], cb: ['CB1', 'CB2'], s: ['S'] };
const DIFF = {
  rookie: { name: 'ROOKIE', runRead: 0.75, react: 0.45, read: 1.6, open: 3.2, pursuit: 0.62, tackle: 0.82, cover: 1.6 },
  pro: { name: 'PRO', runRead: 0.55, react: 0.25, read: 1.15, open: 2.5, pursuit: 0.92, tackle: 1.0, cover: 1.15 },
  legend: { name: 'LEGEND', runRead: 0.35, react: 0.12, read: 0.8, open: 2.0, pursuit: 1.0, tackle: 1.12, cover: 0.85 },
};

function slotRoster(team) {
  const out = {}; const used = {};
  for (const p of team.roster) { const list = POS_SLOTS[p.position] || []; const i = used[p.position] || 0;
    if (list[i]) { out[list[i]] = p; used[p.position] = i + 1; } }
  return out;
}

class Player {
  constructor(id, side, teamIdx, slot, data, look) {
    Object.assign(this, { id, side, teamIdx, slot, data, look });
    const r = data.ratings;
    this.top = 5.4 + r.speed / 99 * 4.3; this.acc = 7 + r.acceleration / 99 * 11; this.agi = r.agility / 99;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.z = 0; this.vz = 0;
    this.state = 'ok'; this.timer = 0; this.anim = 0; this.move = null; this.moveT = 0; this.engaged = null;
    this.big = ['c', 'og', 'dl'].includes(data.position);
    this.skin = (data.number * 7 + id) % 5; this.contact = {}; this.react = 0; this.reactTarget = null;
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get up() { return this.state === 'ok' || this.state === 'engaged'; }
}

class Play {
  // human: team index the human controls (or null), off: offense team index.
  constructor(match, offPlay, defPlay) {
    const m = this.m = match; this.offPlay = offPlay; this.defPlay = defPlay;
    this.diff = DIFF[m.difficulty]; this.time = 0; this.phase = 'pre'; this.events = [];
    this.los = 10 + m.state.ballOn; this.ballX = m.ballX;
    const off = m.state.poss, def = 1 - off;
    this.offTeam = off; this.defTeam = def;
    this.players = [];
    const oR = slotRoster(m.teams[off]), dR = slotRoster(m.teams[def]);
    let id = 0;
    for (const s of OFF_SLOTS) { const p = new Player(id++, 'off', off, s, oR[s], m.looks[off]); const f = offPlay.formation[s] || [0, -2];
      p.x = clamp(this.ballX + f[0], 1, FIELD_W - 1); p.y = this.los + f[1]; p.homeX = p.x; p.homeY = p.y; this.players.push(p); }
    for (const s of DEF_SLOTS) { const p = new Player(id++, 'def', def, s, dR[s], m.looks[def]); const f = defPlay.formation[s] || [0, 5];
      p.x = clamp(this.ballX + f[0], 1, FIELD_W - 1); p.y = this.los + f[1]; p.homeX = p.x; p.homeY = p.y; this.players.push(p); }
    this.by = {}; for (const p of this.players) this.by[(p.side === 'off' ? 'o' : 'd') + p.slot] = p;
    this.qb = this.by.oQB;
    this.ball = { state: 'held', holder: this.by.oC.id, x: this.ballX, y: this.los, z: 0.3, vx: 0, vy: 0, vz: 0, target: null, lob: false, tried: {} };
    this.carrier = null;
    this.isRun = offPlay.category === 'run';
    this.spirit = { off: m.activeSpirit[off] || null, def: m.activeSpirit[def] || null };
    // Human control.
    this.human = m.human; this.humanSide = m.human == null ? null : (m.human === off ? 'off' : 'def');
    if (this.humanSide === 'off') this.controlled = this.isRun ? this.by.oRB : this.qb;
    else if (this.humanSide === 'def') this.controlled = this.by.dS;
    this.idleT = 0;
    this.result = null;
    this.stats = { passYds: 0, rushYds: 0 };
    for (const p of this.players) { if (p.side === 'def') p.vy = 0; p.facing = p.side === 'off' ? 1 : -1; }
    // Spirit effects on ratings for this play.
    const sp = (side) => this.spirit[side] && this.spirit[side].effects || {};
    this.fx = { off: sp('off'), def: sp('def') };
    for (const p of this.players) { const e = this.fx[p.side]; if (e.speed) p.top *= e.speed; }
  }

  emit(type, data = {}) { this.events.push(Object.assign({ type }, data)); }
  get ballCarrier() { return this.ball.state === 'held' ? this.players[this.ball.holder] : null; }
  get canThrow() { const c = this.ballCarrier; return c === this.qb && this.phase === 'live' && !this.thrown && !this.handedOff && c.y < this.los + 0.5; }

  snap() { if (this.phase !== 'pre') return; this.phase = 'live'; this.time = 0;
    this.ball.holder = this.qb.id; this.emit('snap'); this.assignBlocks(); }
  // Pair blockers with defenders by repeatedly taking the closest remaining
  // pair (a far better match than first-come-first-served in roster order).
  assignBlocks() {
    const blockers = this.players.filter((p) => ['C', 'LG', 'RG'].includes(p.slot) || (this.isRun && (this.offPlay.blockers || []).includes(p.slot)));
    const rushers = (this.defPlay.assignments || {}), defs = this.players.filter((d) => d.side === 'def' && (this.isRun || (rushers[d.slot] || {}).role === 'rush' || d.slot.startsWith('DL')));
    const pairs = []; for (const b of blockers) for (const d of defs) pairs.push([Math.hypot(b.x - d.x, b.y - d.y) + (b.slot.startsWith('WR') && d.slot.startsWith('DL') ? 20 : 0), b, d]);
    pairs.sort((a, c) => a[0] - c[0]); const usedB = new Set(), usedD = new Set();
    for (const [, b, d] of pairs) { if (usedB.has(b) || usedD.has(d)) continue; b.blockTarget = d; usedB.add(b); usedD.add(d); }
  }

  // --- per-step update -------------------------------------------------------
  step(dt, input) {
    if (this.phase === 'pre') { this.preSnapIdle(dt); return; }
    if (this.phase !== 'live') { this.settle(dt); return; }
    this.time += dt;
    const carrier = this.ballCarrier;
    // Run-play exchange.
    if (this.isRun && !this.handedOff && carrier === this.qb) {
      const rb = this.by.oRB;
      if (this.offPlay.exchange === 'pitch' && this.time > 0.28) this.pitchTo(rb);
      else if (this.offPlay.exchange !== 'pitch' && this.time > 0.25 && Math.hypot(rb.x - this.qb.x, rb.y - this.qb.y) < 1.3) { this.ball.holder = rb.id; this.handedOff = true; this.emit('handoff'); }
    }
    // Intents.
    for (const p of this.players) {
      if (p.state === 'down') { p.timer -= dt; if (p.timer <= 0) p.state = 'ok'; p.vx *= 0.85; p.vy *= 0.85; continue; }
      if (p.state === 'dive') { p.timer -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; if (p.timer <= 0) { p.state = 'down'; p.timer = 0.7; } continue; }
      let ix = 0, iy = 0, sprint = 1;
      if (p === this.controlled && input) {
        const mv = input.move; const mag = Math.hypot(mv.x, mv.y);
        if (mag > 0.05) { ix = mv.x; iy = mv.y; this.idleT = 0; }
        else { this.idleT += dt; [ix, iy] = this.ai(p);
          if (p === this.ballCarrier && p !== this.qb && this.idleT < 0.6) { ix = 0; iy = 0.75; }
          else if (this.idleT < 0.6 && p.side === 'def') { ix = 0; iy = 0; } }
      } else [ix, iy] = this.ai(p);
      if (p.move && p.moveT > 0) { p.moveT -= dt; if (p.move === 'juke') ix += p.jukeDir * 1.8; if (p.moveT <= 0) p.move = null; }
      const m = Math.hypot(ix, iy); if (m > 1) { ix /= m; iy /= m; }
      let top = p.top * sprint;
      if (p.engaged) top *= 0.25;
      if (p === this.ballCarrier && p !== this.qb) top *= 1.0; else if (p === this.qb && this.ballCarrier === p) top *= 0.88;
      const dvx = ix * top - p.vx, dvy = iy * top - p.vy, dv = Math.hypot(dvx, dvy), maxDv = p.acc * dt * (0.6 + p.agi * 0.6);
      if (dv > maxDv) { p.vx += dvx / dv * maxDv; p.vy += dvy / dv * maxDv; } else { p.vx += dvx; p.vy += dvy; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (Math.abs(p.vy) > 0.4) p.facing = p.vy > 0 ? 1 : -1;
      p.anim += p.speed * dt * 1.1;
    }
    this.cpuDives(dt);
    this.blocking(dt);
    this.separate();
    this.updateBall(dt);
    if (this.phase === 'live') this.tackles(dt);
    if (this.phase === 'live') this.boundaries();
  }

  preSnapIdle(dt) { for (const p of this.players) { p.anim = 0; } }
  settle(dt) { for (const p of this.players) { if (p.state === 'dive') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; }
    else { p.vx *= 0.9; p.vy *= 0.9; p.x += p.vx * dt; p.y += p.vy * dt; } p.anim += p.speed * dt; }
    if (this.ball.state === 'air' || this.ball.state === 'loose') this.ballPhysics(dt); }

  // --- AI ----------------------------------------------------------------
  ai(p) {
    const b = this.ball, carrier = this.ballCarrier;
    const to = (tx, ty, slow = 1) => { const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy); if (d < 0.25) return [0, 0];
      const k = d < 1.5 ? d / 1.5 : 1; return [dx / d * k * slow, dy / d * k * slow]; };
    if (p.side === 'off') {
      if (p === carrier) return this.carrierAI(p);
      if (p === this.qb) { // after the handoff: carry out the fake
        return to(p.x - 2, this.los - 4, 0.4); }
      if (b.state === 'air' && b.target === p.id) return to(b.tx, b.ty);
      if (carrier && carrier !== this.qb) {   // downfield: only nearby teammates can screen pursuers
        if (Math.hypot(carrier.x - p.x, carrier.y - p.y) < 8) return this.blockAI(p, true);
        return to(carrier.x, carrier.y + 3, 0.7); }
      if (['C', 'LG', 'RG'].includes(p.slot) || (this.isRun && (this.offPlay.blockers || []).includes(p.slot))) return this.blockAI(p, this.isRun);
      if (this.isRun && p.slot === 'RB') return this.runPathAI(p);
      return this.routeAI(p);
    }
    // Defense.
    const react = this.time > this.diff.react || this.humanSide !== 'off';
    const front = p.slot.startsWith('DL');
    const readRun = !this.isRun || front || this.time > this.diff.runRead || (carrier && carrier.y > this.los + 1);
    if (carrier && (carrier !== this.qb || carrier.y > this.los) && react && readRun) return this.pursue(p, carrier);
    if (b.state === 'air' && react) { const d = Math.hypot(b.tx - p.x, b.ty - p.y); if (d < 9 || (this.fx.def.instantReads && d < 16)) return to(b.tx, b.ty); }
    if (p.engaged) { const c = this.ballCarrier || this.qb; return to(c.x, c.y); }
    const as = (this.defPlay.assignments || {})[p.slot] || { role: 'zone', zone: [0, 8] };
    if (as.role === 'rush') return to(this.qb.x, this.qb.y - 0.5);
    if (as.role === 'man') { const t = this.by['o' + as.target]; if (!t) return [0, 0];
      const lag = this.diff.cover * 0.6, inside = t.x > this.ballX ? -0.9 : 0.9;
      return to(t.x + inside - t.vx * lag * 0.15, t.y - 0.4 + t.vy * 0.15); }
    if (as.role === 'spy') { const z = as.zone || [0, 5]; if (this.qb.y > this.los) return this.pursue(p, this.qb); return to(this.qb.x, this.los + z[1]); }
    // zone: drop, then sit on the nearest receiver in the area
    const z = as.zone || [0, 8], zx = clamp(this.ballX + z[0], 2, FIELD_W - 2), zy = this.los + z[1];
    const deep = z[1] >= 12, recv = ['WR1', 'WR2', 'RB'].map((s) => this.by['o' + s]);
    if (deep) { // stay over the top of the deepest receiver in this third of the field
      let t = null; for (const r of recv) if (Math.abs(r.x - zx) < 13 && (!t || r.y > t.y)) t = r;
      if (t && this.time > 0.4) return to(lerp(zx, t.x, 0.65), Math.max(zy, t.y + 2.5 + t.vy * 0.2));
      return to(zx, zy); }
    let best = null, bd = 7;
    for (const r of recv) { const d = Math.hypot(r.x - zx, r.y - zy); if (d < bd) { bd = d; best = r; } }
    if (best && this.time > 0.6) return to(lerp(zx, best.x, 0.75), Math.min(lerp(zy, best.y + 1, 0.75), zy + 5));
    return to(zx, zy);
  }
  // Intercept course: solve |c + v t - p| = speed * t for the earliest t. If
  // the runner is faster, aim at a point ahead of him toward the goal line.
  pursue(p, c) {
    const rx = c.x - p.x, ry = c.y - p.y, s = p.top * 0.98, a = c.vx * c.vx + c.vy * c.vy - s * s, b = 2 * (rx * c.vx + ry * c.vy), cc = rx * rx + ry * ry;
    let t = null;
    if (Math.abs(a) < 1e-6) t = b < 0 ? -cc / b : null;
    else { const disc = b * b - 4 * a * cc; if (disc >= 0) { const r1 = (-b - Math.sqrt(disc)) / (2 * a), r2 = (-b + Math.sqrt(disc)) / (2 * a); t = [r1, r2].filter((x) => x > 0).sort((x, y) => x - y)[0] ?? null; } }
    if (t == null) t = clamp(Math.sqrt(cc) / s, 0, 2.5);
    t = Math.min(t, 3) * this.diff.pursuit + (1 - this.diff.pursuit) * Math.min(t, 0.4);
    const tx = c.x + c.vx * t, ty = Math.min(c.y + c.vy * t, 112), dx = tx - p.x, dy = ty - p.y, dd = Math.hypot(dx, dy) || 1;
    return [dx / dd, dy / dd];
  }
  // Where a route runner will be after T seconds (walks his remaining route).
  predict(r, T) {
    const route = (this.offPlay.routes || {})[r.slot];
    if (!route || r !== this.ballCarrier && r.slot === 'QB') return [r.x + r.vx * T, r.y + r.vy * T];
    let x = r.x, y = r.y, left = T * r.top * 0.95, wp = r.wp ?? 0; const pts = route.points;
    while (left > 0 && wp < pts.length) { const tx = clamp(r.homeX + pts[wp][0], 5, FIELD_W - 5), ty = r.homeY + pts[wp][1], d = Math.hypot(tx - x, ty - y);
      if (d >= left) { x += (tx - x) / d * left; y += (ty - y) / d * left; left = 0; break; }
      x = tx; y = ty; left -= d; wp++; }
    if (left > 0) { if (route.settle) return [x, y]; const l = pts[pts.length - 1], pv = pts[pts.length - 2] || [0, 0], lx = l[0] - pv[0], ly = l[1] - pv[1], ll = Math.hypot(lx, ly) || 1; x += lx / ll * left; y += ly / ll * left; }
    return [x, y];
  }
  routeAI(p) {
    const r = (this.offPlay.routes || {})[p.slot];
    if (!r) { // check-down: drift to the flat
      return [Math.sign(p.homeX - this.ballX || 1) * 0.3, 0.2]; }
    if (p.wp == null) p.wp = 0;
    const pts = r.points; const tx = clamp(p.homeX + pts[Math.min(p.wp, pts.length - 1)][0], 5, FIELD_W - 5), ty = p.homeY + pts[Math.min(p.wp, pts.length - 1)][1];
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d < 0.8 && p.wp < pts.length - 1) p.wp++;
    if (p.wp >= pts.length - 1 && d < 0.8) { if (r.settle) return [0, 0]; const last = pts[pts.length - 1], prev = pts[pts.length - 2] || [0, 0];
      const lx = last[0] - prev[0], ly = last[1] - prev[1], ll = Math.hypot(lx, ly) || 1; return [lx / ll, ly / ll]; }
    return [dx / (d || 1), dy / (d || 1)];
  }
  runPathAI(p) {
    const pts = (this.offPlay.runPath || { points: [[0, 5]] }).points;
    if (p.wp == null) p.wp = 0;
    const pt = pts[Math.min(p.wp, pts.length - 1)], tx = this.ballX + pt[0], ty = this.los + pt[1];
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy); if (d < 1 && p.wp < pts.length - 1) p.wp++;
    return [dx / (d || 1), dy / (d || 1)];
  }
  carrierAI(p) {
    if (p === this.qb && !this.handedOff) return this.qbAI(p);
    if (p.lane && this.time < p.laneUntil) return p.lane;
    // Follow the designed path for the first beats of a run, then find daylight.
    if (this.isRun && p.slot === 'RB' && (p.wp ?? 0) < 2 && this.time < 1.4) return this.runPathAI(p);
    let best = [0, 1], bs = -1e9;
    for (let a = -70; a <= 70; a += 14) { const r = a * Math.PI / 180, dx = Math.sin(r), dy = Math.cos(r);
      let score = dy * 3; const lx = p.x + dx * 4, ly = p.y + dy * 4;
      if (lx < 1.5 || lx > FIELD_W - 1.5) score -= 6;
      for (const d of this.players) { if (d.side !== 'def' || !d.up) continue; const dd = Math.hypot(d.x - lx, d.y - ly); if (dd < 5) score -= (5 - dd) * 1.1; }
      if (score > bs) { bs = score; best = [dx, dy]; } }
    p.lane = best; p.laneUntil = this.time + 0.18;
    return best;
  }
  qbAI(p) {
    // Drop back, scan the progression, throw to the first open man.
    const human = this.humanSide === 'off' && this.controlled === p;
    if (this.time < 0.6) return [0, -0.8];
    if (human) return [0, 0];
    const prog = this.offPlay.progression.length ? this.offPlay.progression : ['WR1', 'WR2', 'RB'];
    const pressure = this.players.some((d) => d.side === 'def' && d.up && !d.engaged && Math.hypot(d.x - p.x, d.y - p.y) < 2.3);
    if (this.time > this.diff.read || pressure || this.time > 3.8) {
      let bestR = null, bestO = -1;
      for (const s of prog) { const r = this.by['o' + s]; if (!r.up) continue; const o = this.openness(r); if (o > bestO) { bestO = o; bestR = r; }
        if (o >= this.diff.open && !pressure) break; }
      if (bestR && (bestO >= this.diff.open || pressure || this.time > 3.8)) { this.throwTo(bestR, bestR.y - p.y > 18); return [0, 0]; }
    }
    if (pressure) return [Math.sign(p.x - this.ballX || 1), 0.2];
    return [0, 0];
  }
  openness(r) { let m = 99; for (const d of this.players) if (d.side === 'def' && d.up) m = Math.min(m, Math.hypot(d.x - r.x, d.y - r.y)); return m; }
  blockAI(p, drive) {
    // Find a target: unique per blocker, nearest threat to the ball.
    const carrier = this.ballCarrier || this.qb;
    if (!p.blockTarget || !p.blockTarget.up || Math.hypot(p.blockTarget.x - p.x, p.blockTarget.y - p.y) > 12) {
      let best = null, bd = 1e9; const taken = new Set(this.players.filter((q) => q.side === 'off' && q.blockTarget && q !== p).map((q) => q.blockTarget));
      for (const d of this.players) { if (d.side !== 'def' || !d.up || taken.has(d)) continue;
        const dd = Math.hypot(d.x - p.x, d.y - p.y) + Math.hypot(d.x - carrier.x, d.y - carrier.y) * 0.5; if (dd < bd) { bd = dd; best = d; } }
      p.blockTarget = best;
    }
    const t = p.blockTarget; if (!t) return [0, drive ? 0.5 : 0];
    const gx = (t.x + carrier.x) / 2 * 0.3 + t.x * 0.7, gy = drive ? t.y : Math.min(t.y, carrier.y + 1.5);
    const dx = gx - p.x, dy = gy - p.y - (drive ? 0 : 0.6), d = Math.hypot(dx, dy) || 1;
    return [dx / d, dy / d];
  }
  blocking(dt) {
    for (const p of this.players) {
      if (p.side !== 'off' || !p.blockTarget || p.state !== 'ok') continue;
      const t = p.blockTarget; const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d < 1.05 && t.up && !t.engaged && !(t.shedT > 0)) {
        t.engaged = p; t.state = 'engaged';
        const ratio = (t.data.ratings.strength + 30) / (p.data.ratings.strength + 30);
        const line = ['C', 'LG', 'RG'].includes(p.slot) && Math.abs(t.y - this.los) < 4;
        t.shed = this.fx.def.blockWin ? 0.35 : (line ? rng.range(0.9, 2.4) : rng.range(0.25, 0.8)) / ratio;
        if (this.fx.off.blockWin) t.shed *= 1.6;
      }
    }
    for (const t of this.players) {
      if (t.shedT > 0) t.shedT -= dt;
      if (!t.engaged) continue;
      t.shed -= dt; const b = t.engaged;
      if (t.shed <= 0 || b.state !== 'ok' || Math.hypot(t.x - b.x, t.y - b.y) > 1.8) { t.engaged = null; if (t.state === 'engaged') t.state = 'ok'; t.shedT = 0.8; continue; }
      // the pair shoves: stronger player wins ground
      const push = (b.data.ratings.strength - t.data.ratings.strength) / 99 * 0.6;
      t.y += push * dt * (this.isRun ? 1.4 : 0.6);
    }
  }
  separate() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j]; if (!a.up || !b.up) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = 0.75;
      if (d > 0 && d < min) { const c = this.ballCarrier;
        if ((a === c && b.side === 'off') || (b === c && a.side === 'off')) continue;   // carrier slips past teammates
        const k = (min - d) / d * 0.5; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k; }
    }
  }

  // --- passing -----------------------------------------------------------
  throwTo(r, lob) {
    if (!this.canThrow) return;
    const q = this.qb, rr = q.data.ratings, eff = this.fx.off;
    let speed = (19 + rr.throwPower / 99 * 7) * (eff.throwSpeed || 1); if (lob) speed *= 0.74;
    let tx = r.x, ty = r.y, T = 0;
    for (let k = 0; k < 4; k++) { T = Math.hypot(tx - q.x, ty - q.y) / speed * (lob ? 1.25 : 1); [tx, ty] = this.predict(r, T); }
    const pressure = this.players.some((d) => d.side === 'def' && d.up && Math.hypot(d.x - q.x, d.y - q.y) < 2.2) ? 1 : 0;
    const dist0 = Math.hypot(tx - q.x, ty - q.y);
    const sigma = eff.perfectPass ? 0 : ((1 - rr.throwAccuracy / 99) * 2.4 + pressure * 1.1 + (lob ? 0.4 : 0)) * (0.55 + dist0 / 28);
    tx += (rng() * 2 - 1) * sigma; ty += (rng() * 2 - 1) * sigma;
    tx = clamp(tx, -2, FIELD_W + 2); T = Math.max(0.25, Math.hypot(tx - q.x, ty - q.y) / speed) * (lob ? 1.25 : 1);
    const b = this.ball; b.state = 'air'; b.holder = null; b.x = q.x; b.y = q.y + 0.3; b.z = 2.1; b.target = r.id; b.lob = lob; b.tx = tx; b.ty = ty;
    b.vx = (tx - b.x) / T; b.vy = (ty - b.y) / T; b.vz = (1.5 - b.z + 0.5 * G * T * T) / T; b.tried = {}; b.from = q.y;
    b.passer = q.id; b.flight = 0; this.thrown = true; q.throwT = 0.25; this.emit('throw', { lob });
  }
  pitchTo(rb) {
    const b = this.ball, q = this.qb; const T = 0.32;
    const tx = rb.x + rb.vx * T, ty = rb.y + rb.vy * T;
    b.state = 'air'; b.holder = null; b.x = q.x; b.y = q.y; b.z = 1.5; b.target = rb.id; b.lob = false; b.tx = tx; b.ty = ty;
    b.vx = (tx - b.x) / T; b.vy = (ty - b.y) / T; b.vz = (1.2 - 1.5 + 0.5 * G * T * T) / T; b.tried = {}; b.pitch = true; b.passer = q.id; b.flight = 0; this.handedOff = true;
  }
  ballPhysics(dt) { const b = this.ball; b.vz -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z <= 0) { b.z = 0; if (b.state === 'loose') { b.vx *= 0.6; b.vy *= 0.6; b.vz = Math.abs(b.vz) * 0.4; } } }
  updateBall(dt) {
    const b = this.ball;
    if (b.state === 'held') { const h = this.players[b.holder]; b.x = h.x + 0.25; b.y = h.y + 0.1 * h.facing; b.z = 1.1; return; }
    if (b.state !== 'air') return;
    this.ballPhysics(dt); b.flight = (b.flight || 0) + dt;
    // Catch window: closest approach to each player near the ball.
    if (b.z < 3 && b.z > 0.2) {
      const cands = this.players.filter((p) => p.up && !b.tried[p.id] && !(p.id === b.passer && b.flight < 0.4) && Math.hypot(p.x - b.x, p.y - b.y) < (p.id === b.target ? 1.6 : 1.05) && (p.side === 'def' || p.id === b.target || b.target === -1 || b.pitch));
      cands.sort((a, c) => (a.side === 'def' ? 0 : 1) - (c.side === 'def' ? 0 : 1));
      for (const p of cands) {
        b.tried[p.id] = true;
        if (b.pitch) { if (p.side === 'off') { this.giveBall(p); return; } continue; }
        const nearDef = Math.min(...this.players.filter((d) => d.side !== p.side && d.up).map((d) => Math.hypot(d.x - p.x, d.y - p.y)));
        if (p.side === 'def') {
          if (b.flight < 0.2) { if (rng() < 0.12) { this.emit('tip', { x: b.x, y: b.y, z: b.z }); b.vx *= 0.25; b.vy *= 0.25; b.vz = 2.5; b.target = -1; return; } continue; }   // at the line: rare batted ball
          const tgt = this.players[b.target], recvNear = tgt ? Math.hypot(tgt.x - b.x, tgt.y - b.y) : 9;   // tipped balls have no target
          let pi = 0.05 + p.data.ratings.catching / 99 * 0.2 + (this.fx.def.instantReads ? 0.12 : 0) + (recvNear > 3 ? 0.12 : 0);
          if (this.fx.off.perfectPass) pi *= 0.3;
          if (rng() < pi) { this.giveBall(p); this.endPlay('interception', { by: p }); this.emit('pick', { p }); return; }
          if (rng() < 0.35) { this.emit('tip', { x: b.x, y: b.y, z: b.z }); b.vx *= 0.3; b.vy *= 0.3; b.vz = 3; b.target = -1; return; }
        } else {
          let pc = 0.5 + p.data.ratings.catching / 99 * 0.42 + (this.fx.off.catchBonus || 0) - (nearDef < 1.8 ? (1.8 - nearDef) / 1.8 * 0.5 : 0);
          if (this.fx.off.perfectPass) pc += 0.15;
          if (rng() < pc) { this.giveBall(p); this.emit('catch', { p, contested: nearDef < 1.4 }); this.stats.passFrom = this.los; return; }
          this.emit('drop', { p });
        }
      }
    }
    if (b.z <= 0) { this.endPlay('incomplete'); }
  }
  giveBall(p) { const b = this.ball; b.state = 'held'; b.holder = p.id; b.pitch = false;
    if (this.humanSide === 'off' && p.side === 'off') this.controlled = p; }

  // --- contact -----------------------------------------------------------
  doMove(kind) {
    const c = this.ballCarrier, me = this.controlled;
    if (kind === 'dive' && me) { const dir = me === c ? [0, 1] : [me.vx, me.vy]; const l = Math.hypot(dir[0], dir[1]) || 1;
      me.state = 'dive'; me.timer = 0.45; me.vx = dir[0] / l * (me.top + 1.5); me.vy = dir[1] / l * (me.top + 1.5); this.emit('move');
      if (me === c) { this.diveForward = true; } return; }
    if (!c || c !== me || c === this.qb) return;
    if (c.moveCool > this.time) return;
    c.move = kind; c.moveT = kind === 'stiff' ? 0.45 : 0.32; c.moveCool = this.time + 0.7;
    c.jukeDir = (c.vx >= 0 ? 1 : -1) * (kind === 'juke' ? 1 : 0);
    if (kind === 'spin') { c.vx *= 0.9; c.vy *= 0.9; }
    this.emit('move', { kind, p: c });
  }
  // CPU pursuers lunge when the runner is just out of reach: long reach,
  // but a miss leaves them on the turf.
  cpuDives(dt) {
    const c = this.ballCarrier; if (!c || (c === this.qb && c.y < this.los)) return;
    for (const d of this.players) {
      if (d.side !== 'def' || d.state !== 'ok' || d === this.controlled) continue;
      const tx = c.x + c.vx * 0.15, ty = c.y + c.vy * 0.15, dist = Math.hypot(tx - d.x, ty - d.y);
      if (dist > 1.1 && dist < 2.5 && rng() < dt * 6) {
        d.state = 'dive'; d.timer = 0.4; const k = (d.top + 1.5) / dist; d.vx = (tx - d.x) * k; d.vy = (ty - d.y) * k; }
    }
  }
  tackles(dt) {
    const c = this.ballCarrier; if (!c) return;
    if (c.state === 'dive' && this.diveForward && c.timer < 0.1) { this.endPlay('tackled', { x: c.x, y: c.y + 0.6 }); return; }
    for (const d of this.players) {
      if (d.side !== 'def' || d === c) continue;
      if (!(d.state === 'ok' || d.state === 'dive' || d.state === 'engaged')) continue;
      const reach = d.state === 'dive' ? 1.6 : d.engaged ? 0.75 : 1.15;
      const dist = Math.hypot(d.x - c.x, d.y - c.y);
      if (dist > reach || (d.contact[c.id] || 0) > this.time) continue;
      d.contact[c.id] = this.time + 0.6;
      const r = d.data.ratings, cr = c.data.ratings, eo = this.fx.off, ed = this.fx.def;
      const rvx = d.vx - c.vx, rvy = d.vy - c.vy, closing = Math.hypot(rvx, rvy);
      const impact = closing * (0.6 + (r.strength + d.data.ratings.weightLbs / 3) / 160);
      let power = 0.45 + r.strength / 99 * 0.3 + Math.min(closing, 10) * 0.025 + (d.state === 'dive' ? 0.15 : 0) + (ed.tacklePower || 0) - (d.engaged ? 0.65 : 0);
      let resist = 0.2 + cr.strength / 99 * 0.2 + cr.balance / 99 * 0.3 + (eo.tackleResist || 0);
      if (c.move && c.moveT > 0) resist += eo.unbreakableMoves ? 9 : c.move === 'stiff' ? 0.45 : 0.55;
      if (c === this.qb) resist -= 0.2;
      let p = clamp(power - resist * 0.85 + 0.42, 0.12, 0.96);
      if (this.humanSide === 'off' && c === this.controlled) p *= this.diff.tackle; else if (this.humanSide === 'def') p /= this.diff.tackle * 0.95;
      if (rng() < p) {
        const big = closing > 13 && r.strength >= 60 && d.state !== 'dive' && rng() < 0.55;
        const fumble = big && c !== this.qb && rng() < clamp((impact - 7) * 0.02, 0, 0.07);
        const fx = c.x, fy = c.y + (c.vy > 1 ? 0.6 : 0);
        c.state = 'down'; c.timer = 1.2; d.state = d.state === 'dive' ? 'dive' : 'ok';
        this.emit('tackle', { x: fx, y: fy, big, impact, by: d, carrier: c });
        if (fumble) { const defRec = rng() < 0.55; this.emit('fumble', { x: fx, y: fy }); this.endPlay(defRec ? 'fumbleLost' : 'tackled', { x: fx, y: fy, fumble: true }); }
        else this.endPlay(c === this.qb && fy < this.los ? 'sack' : 'tackled', { x: fx, y: fy, big, by: d });
        return;
      } else {
        d.state = 'down'; d.timer = 0.8; if (d.engaged) d.engaged = null;
        c.vx *= 0.85; c.vy *= 0.85;
        this.emit('broken', { p: c, by: d, kind: c.move });
      }
    }
  }
  boundaries() {
    const c = this.ballCarrier; if (!c) return;
    if (c.y >= 110 && c.side === 'off') { this.endPlay('touchdown', { x: c.x, y: c.y }); return; }
    if (c.x < 0 || c.x > FIELD_W) { this.endPlay('outOfBounds', { x: clamp(c.x, 0, FIELD_W), y: c.y }); return; }
    if (c.y < 10 && c.y < this.los - 0.5 && c.state === 'down') this.endPlay('safety', { x: c.x, y: c.y });
  }
  endPlay(kind, info = {}) {
    if (this.phase !== 'live') return;
    this.phase = 'dead'; this.result = Object.assign({ kind, x: this.ball.x, y: this.ball.y }, info);
    if (kind === 'touchdown' || kind === 'incomplete' || kind === 'outOfBounds' || kind === 'safety' || kind === 'interception') this.emit('whistle', { kind });
    if (this.ball.state === 'air') { this.ball.state = 'loose'; }
  }
}
