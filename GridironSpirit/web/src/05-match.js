// ---------------------------------------------------------------------------
// Match: rules (downs, scoring, clock, overtime), play calling, Spirit Plays,
// presentation (callouts, hit-stop, shake, impact frames) and the game HUD.
// ---------------------------------------------------------------------------
const OFF_PAGES = [['hb_dive', 'slants', 'verticals'], ['toss_sweep', 'curl_flat', 'post_corner']];
const DEF_PAGES = [['cover2', 'man_press', 'lb_blitz'], ['cover3', 'prevent', 'zero_blitz']];
const TEAM_LOOK = (t, style) => ({ id: t.id, jersey: hex(t.colors.primary), trim: hex(t.colors.accent), pants: hex(t.colors.secondary),
  helmet: shade(hex(t.colors.secondary), 0.15), style });
const ARCH = { disciplined: 0, flashy: 1, powerhouse: 2 };

class Match {
  constructor(opts) {
    // opts: teams [A,B], human (0|null), difficulty, qLen, spiritBonus, mode, attract
    Object.assign(this, opts);
    this.looks = this.teams.map((t) => TEAM_LOOK(t, ARCH[t.archetype] ?? 0));
    const recv = rng.int(2);
    this.state = { score: [0, 0], poss: recv, firstPoss: recv, ballOn: 25, down: 1, toGo: 10, quarter: 1, clock: this.qLen, ot: 0, otDone: [0, 0], final: false };
    this.ballX = 26.67; this.spiritMeter = [0, 0]; this.activeSpirit = [null, null];
    this.stats = [0, 1].map(() => ({ passYds: 0, rushYds: 0, td: 0, sacks: 0, takeaways: 0, bigHits: 0, firstDowns: 0, spirits: 0, fg: 0, deficit: 0, broken: 0 }));
    this.players = {}; // name -> {yds, td, tkl, team}
    this.cam = new Camera(); this.fx = { callout: null, parts: [], bursts: [], hitstop: 0, impact: false, trail: [], flash: 0 };
    this.phase = 'call'; this.timer = 0; this.page = 0; this.log = [];
    this.spirits = Object.fromEntries(DATA.spirits.spirits.map((s) => [s.id, s]));
    this.newPlay();
  }
  get offIsHuman() { return this.human != null && this.state.poss === this.human; }
  get defIsHuman() { return this.human != null && this.state.poss !== this.human; }
  plays(id) { return DATA.plays.offense.find((p) => p.id === id) || DATA.plays.defense.find((p) => p.id === id); }

  // --- play calling ---------------------------------------------------------
  newPlay() {
    this.phase = 'call'; this.timer = 0; this.page = 0; this.offCall = null; this.defCall = null;
    this.play = null; this.fx.trail = [];
    // Show the formation of a neutral play behind the cards.
    const s = this.state;
    this.cam.snap(this.ballX, 10 + s.ballOn);
    if (this.human == null) { this.cpuCalls(); return; }
  }
  cardsFor() {
    const s = this.state, pages = this.offIsHuman ? OFF_PAGES.map((p) => p.slice()) : DEF_PAGES.map((p) => p.slice());
    if (this.offIsHuman && s.down === 4 && !s.ot) pages.unshift(['punt', 'field_goal', 'hb_dive'].filter((id) => id !== 'field_goal' || 100 - s.ballOn + 17 <= 60));
    return pages;
  }
  humanCall(id) {
    if (this.phase !== 'call') return;
    if (this.offIsHuman) this.offCall = id; else this.defCall = id;
    this.cpuCalls();
  }
  cpuCalls() {
    const s = this.state, off = this.teams[s.poss];
    if (!this.offCall) this.offCall = this.cpuOffense(off);
    if (!this.defCall) {
      const r = rng(); this.defCall = s.toGo >= 9 && s.down >= 3 ? (r < 0.5 ? 'prevent' : 'cover3') : s.toGo <= 3 ? (r < 0.45 ? 'lb_blitz' : r < 0.8 ? 'man_press' : 'zero_blitz')
        : rng.pick(['cover2', 'cover3', 'man_press', 'lb_blitz', 'cover2', 'zero_blitz']);
    }
    if (this.offCall === 'punt' || this.offCall === 'field_goal') { this.startKick(this.offCall); return; }
    this.cpuSpirit();
    this.play = new Play(this, this.plays(this.offCall), this.plays(this.defCall));
    this.phase = 'pre'; this.timer = 0;
  }
  cpuOffense(team) {
    const s = this.state, fgDist = 100 - s.ballOn + 17, late = s.quarter >= 4 && s.clock < 60;
    if (s.down === 4 && !s.ot) {
      const trailing = s.score[s.poss] < s.score[1 - s.poss];
      if (fgDist <= 52 && !(late && trailing && s.score[1 - s.poss] - s.score[s.poss] > 3)) return 'field_goal';
      if (s.toGo <= 2 && s.ballOn > 40 || (late && trailing)) return s.toGo <= 2 ? 'hb_dive' : 'verticals';
      return 'punt';
    }
    const a = team.archetype; let pass = s.toGo >= 8 ? 0.72 : s.toGo <= 3 ? 0.35 : 0.52;
    if (a === 'powerhouse') pass -= 0.15; if (a === 'flashy') pass += 0.08;
    if (rng() < pass) { const deep = (s.toGo >= 12 ? 0.6 : 0.3) + (a === 'flashy' ? 0.15 : 0);
      return rng() < deep ? rng.pick(['verticals', 'post_corner']) : rng.pick(['slants', 'curl_flat']); }
    return rng() < (a === 'powerhouse' ? 0.65 : 0.5) ? 'hb_dive' : 'toss_sweep';
  }
  // --- Spirit --------------------------------------------------------------
  star(team, side, playType) {
    const ids = this.teams[team].roster.filter((p) => p.spiritPlay).map((p) => [p, this.spirits[p.spiritPlay]]).filter(([, s]) => s && s.side === side);
    return ids.find(([, s]) => s.playType === playType) || ids.find(([, s]) => s.playType === 'any') || ids[0];
  }
  canSpirit(team) { return this.spiritMeter[team] >= 1 && this.phase === 'pre' && !this.activeSpirit[team]; }
  activateSpirit(team) {
    if (!this.canSpirit(team)) return false;
    const side = team === this.state.poss ? 'offense' : 'defense';
    const pt = this.plays(this.offCall).category === 'run' ? 'run' : 'pass';
    const st = this.star(team, side, side === 'offense' ? pt : 'any'); if (!st) return false;
    const [player, sp] = st;
    this.spiritMeter[team] = 0; this.activeSpirit[team] = sp; this.stats[team].spirits++;
    this.cutin = { team, player, sp, t: 0 }; this.phase = 'cutin'; this.timer = 0;
    Audio.sfx('spirit'); Audio.crowd(0.9); haptic(30);
    // rebuild the play so the effects apply
    this.play = new Play(this, this.plays(this.offCall), this.plays(this.defCall));
    this.play.starId = player.id;
    return true;
  }
  cpuSpirit() {
    const s = this.state;
    for (const t of [0, 1]) { if (t === this.human || this.spiritMeter[t] < 1) continue;
      const critical = s.down >= 3 || s.ballOn > 75 || (s.quarter >= 4 && s.score[t] < s.score[1 - t]);
      if (critical) this.pendingCpuSpirit = t; }
  }
  charge(team, amt) { const trailing = this.state.score[team] < this.state.score[1 - team];
    this.spiritMeter[team] = Math.min(1, this.spiritMeter[team] + amt * 0.5 * (trailing ? 1.35 : 1) * (1 + (team === this.human ? this.spiritBonus || 0 : 0))); }

  // --- kicks ---------------------------------------------------------------
  startKick(kind) {
    this.kick = { kind, t: 0, stopped: null, human: this.offIsHuman && kind === 'field_goal' };
    this.phase = 'kick'; this.timer = 0;
  }
  kickTap() { if (this.phase === 'kick' && this.kick.human && this.kick.stopped == null) { this.kick.stopped = this.kickNeedle(); Audio.sfx('kick'); } }
  kickNeedle() { return Math.sin(this.kick.t * 3.4) ; }
  resolveKick() {
    const s = this.state, k = this.kick, team = s.poss;
    if (k.kind === 'punt') {
      Audio.sfx('kick');
      const net = 36 + rng() * 12 + (this.teams[team].roster.find((p) => p.position === 'k')?.ratings.throwPower || 70) / 99 * 4;
      const land = s.ballOn + net;
      this.say(land >= 100 ? 'TOUCHBACK' : `PUNT ${Math.round(net)} YDS`, 'chrome', 1.4);
      this.changePoss(land >= 100 ? 20 : clamp(100 - land, 1, 99));
      return;
    }
    const dist = Math.round(100 - s.ballOn + 17);
    let good;
    if (k.human) { const zone = clamp(0.32 - (dist - 20) * 0.0055, 0.08, 0.3); good = k.stopped != null && Math.abs(k.stopped) < zone; }
    else good = rng() < clamp(1.04 - (dist - 20) * 0.017, 0.15, 0.97);
    if (good) { s.score[team] += 3; this.stats[team].fg++; this.say(`${dist} YD FIELD GOAL!`, 'fire', 1.8); Audio.crowd(0.8);
      this.log.push(`${this.teams[team].abbreviation} FG ${dist}`); this.kickoff(1 - team); }
    else { this.say('NO GOOD!', 'chrome', 1.6); this.changePoss(Math.max(20, 100 - (s.ballOn - 7))); }
  }

  // --- rules -----------------------------------------------------------------
  changePoss(newBallOn) {
    const s = this.state;
    if (s.ot) this.otPossessionDone();
    s.poss = 1 - s.poss; s.ballOn = newBallOn; s.down = 1; s.toGo = Math.min(10, 100 - newBallOn);
    if (s.ot && !s.final) { s.ballOn = 75; s.toGo = 10; }
  }
  kickoff(receiver) {
    const s = this.state; if (s.ot) { this.otPossessionDone(); if (s.final) return; }
    s.poss = receiver; s.ballOn = s.ot ? 75 : 25; s.down = 1; s.toGo = 10; this.ballX = 26.67;
  }
  otPossessionDone() {
    const s = this.state; s.otDone[s.poss]++;
    if (s.otDone[0] === s.otDone[1] && s.score[0] !== s.score[1]) s.final = true;
  }
  applyResult(r) {
    const s = this.state, p = this.play, team = s.poss, def = 1 - team, st = this.stats;
    const spotY = r.y ?? p.ball.y, newOn = clamp(spotY - 10, 0.5, 109.5), gain = newOn - s.ballOn;
    this.ballX = clamp(r.x ?? 26.67, 20, 33.33);
    const carrier = p.ballCarrier, name = carrier ? carrier.data.lastName.toUpperCase() : '';
    const credit = (n, k, v) => { if (!n) return; const e = this.players[n] || (this.players[n] = { yds: 0, td: 0, tkl: 0, sacks: 0, picks: 0, team: k }); for (const key in v) e[key] += v[key]; };
    const yardsTo = (kindPass) => { if (kindPass) st[team].passYds += gain; else st[team].rushYds += gain; credit(name, team, { yds: gain }); };
    const passPlay = !!p.thrown && !p.handedOff;
    const stopsClock = ['incomplete', 'touchdown', 'interception', 'fumbleLost', 'safety'].includes(r.kind) || (r.kind === 'outOfBounds' && s.clock < 60);
    let runoff = stopsClock ? 0 : 6;
    switch (r.kind) {
      case 'touchdown': {
        yardsTo(passPlay); st[team].td++; credit(name, team, { td: 1 }); s.score[team] += 6;
        if (this.activeSpirit[team]) st[team].spiritTD = (st[team].spiritTD || 0) + 1;
        this.say('TOUCHDOWN!', 'rainbow', 2.4, 4); Audio.play('touchdown'); Audio.crowd(1); haptic([20, 40, 60]);
        this.charge(team, 0.25); this.log.push(`${this.teams[team].abbreviation} TD ${name}`);
        const pat = rng() < 0.94; if (pat) s.score[team] += 1;
        this.pat = pat ? 'EXTRA POINT GOOD' : 'EXTRA POINT MISSED';
        this.kickoff(def); break; }
      case 'safety': s.score[def] += 2; this.say('SAFETY!', 'fire', 1.8); this.kickoff(def); break;
      case 'interception': case 'fumbleLost': {
        st[def].takeaways++; if (r.by) credit(r.by.data.lastName.toUpperCase(), def, { picks: r.kind === 'interception' ? 1 : 0 });
        this.say(r.kind === 'interception' ? 'INTERCEPTION!' : 'FUMBLE LOST!', 'fire', 2); Audio.crowd(0.9); this.charge(def, 0.3);
        this.changePoss(clamp(100 - newOn, 1, 99)); break; }
      case 'incomplete': this.advanceDown(0, false); break;
      default: { // tackled, sack, out of bounds
        if (newOn <= 0.5) { s.score[def] += 2; this.say('SAFETY!', 'fire', 1.8); this.kickoff(def); break; }
        if (r.kind === 'sack') { st[def].sacks++; if (r.by) credit(r.by.data.lastName.toUpperCase(), def, { sacks: 1 }); this.say('SACK!', 'fire', 1.6, 4); this.charge(def, 0.18); }
        else yardsTo(passPlay);
        if (r.by) credit(r.by.data.lastName.toUpperCase(), def, { tkl: 1 });
        if (r.big) { st[def].bigHits++; this.charge(def, 0.1); }
        if (gain >= 20) this.charge(team, 0.15);
        if (gain > 0) this.charge(team, gain * 0.012); else this.charge(def, 0.05);
        s.ballOn = newOn; this.advanceDown(gain, true);
      }
    }
    // clock
    if (!s.ot) { s.clock = Math.max(0, s.clock - runoff); }
    st[team].deficit = Math.max(st[team].deficit, s.score[def] - s.score[team]);
    st[def].deficit = Math.max(st[def].deficit, s.score[team] - s.score[def]);
    this.activeSpirit = [null, null];
  }
  advanceDown(gain, moved) {
    const s = this.state;
    if (moved && gain >= s.toGo) { s.down = 1; s.toGo = Math.min(10, 100 - s.ballOn); this.stats[s.poss].firstDowns++;
      if (!this.fx.callout || this.fx.callout.big < 3) this.say('FIRST DOWN!', 'chrome', 1.5, 3); this.charge(s.poss, 0.06); return; }
    if (moved) s.toGo -= gain;
    s.toGo = Math.max(0.5, s.toGo);
    s.down++;
    if (s.down > 4) { this.say('TURNOVER ON DOWNS', 'chrome', 1.6); this.changePoss(clamp(100 - s.ballOn, 1, 99)); }
  }
  endQuarterIfNeeded() {
    const s = this.state; if (s.ot || s.clock > 0) return false;
    if (s.quarter === 2) { s.quarter = 3; s.clock = this.qLen; s.poss = 1 - s.firstPoss; s.ballOn = 25; s.down = 1; s.toGo = 10; this.banner = 'HALFTIME'; return true; }
    if (s.quarter < 4) { s.quarter++; s.clock = this.qLen; this.banner = `END OF Q${s.quarter - 1}`; return true; }
    if (s.score[0] === s.score[1]) { s.ot = 1; s.poss = s.firstPoss; s.ballOn = 75; s.down = 1; s.toGo = 10; this.banner = 'OVERTIME!'; return true; }
    s.final = true; return true;
  }

  // --- presentation -------------------------------------------------------
  say(t, style = 'chrome', life = 1.4, big = 1) { if (this.fx.callout && this.fx.callout.big > big && this.fx.callout.age < 0.8) return;
    this.fx.callout = { t, style, life, age: 0, big }; }
  burst(x, y, z, r) { this.fx.bursts.push({ x, y, z, r, age: 0 }); }
  dust(x, y, n) { for (let i = 0; i < n; i++) this.fx.parts.push({ x, y, z: 0.1, vx: rng.range(-2, 2), vy: rng.range(-2, 2), vz: rng.range(1, 3), life: rng.range(0.3, 0.6) }); }
  handleEvents(evs) {
    for (const e of evs) {
      switch (e.type) {
        case 'snap': Audio.sfx('snap'); haptic(8); break;
        case 'throw': Audio.sfx('whoosh'); break;
        case 'handoff': break;
        case 'catch': Audio.sfx('catch'); this.fx.hitstop = e.contested ? 0.08 : 0.05; this.fx.flash = 0.15; Audio.crowd(e.contested ? 0.7 : 0.45);
          this.say(e.contested ? 'WHAT A CATCH!' : 'CATCH!', e.contested ? 'fire' : 'chrome', 1.1); haptic(15); break;
        case 'drop': this.say('DROPPED!', 'chrome', 1.1); break;
        case 'tip': this.say('TIPPED!', 'chrome', 1); Audio.sfx('hit', 0.4); this.burst(e.x, e.y, e.z, 1.1); break;
        case 'pick': Audio.sfx('catch'); break;
        case 'move': Audio.sfx('step', 1); this.dust(this.play.controlled?.x ?? 26, this.play.controlled?.y ?? 50, 5); haptic(6); break;
        case 'broken': this.say(e.kind === 'stiff' ? 'STIFF ARM!' : 'BROKEN TACKLE!', 'fire', 1.2, 2); Audio.sfx('hit', 0.5); this.stats[this.state.poss].broken++; break;
        case 'tackle': {
          Audio.sfx('hit', clamp(e.impact / 9, 0.3, 1.5)); this.burst(e.x, e.y, 1.1, e.big ? 2.6 : 1.5); this.dust(e.x, e.y, e.big ? 14 : 7);
          this.cam.shake = e.big ? 0.22 : 0.12; haptic(e.big ? 35 : 12);
          if (e.big) { this.fx.hitstop = 0.1; this.fx.impact = true; this.say('BIG HIT!', 'fire', 1.4, 3); Audio.crowd(0.9); }
          break; }
        case 'fumble': this.say('FUMBLE!', 'fire', 1.6, 4); break;
        case 'whistle': Audio.sfx('whistle'); break;
      }
    }
  }

  // --- frame ----------------------------------------------------------------
  update(dt, input) {
    const s = this.state; this.timer += dt;
    const f = this.fx; f.flash = Math.max(0, f.flash - dt);
    if (f.callout) { f.callout.age += dt; if (f.callout.age > f.callout.life) f.callout = null; }
    for (const b of f.bursts) b.age += dt; f.bursts = f.bursts.filter((b) => b.age < 0.22);
    for (const p of f.parts) { p.vz -= 9 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.max(0, p.z + p.vz * dt); p.life -= dt; } f.parts = f.parts.filter((p) => p.life > 0);
    if (this.phase === 'final') return;
    if (this.banner) { this.bannerT = (this.bannerT || 0) + dt; if (this.bannerT > 2.2) { this.banner = null; this.bannerT = 0; if (s.final) this.finish(); else this.newPlay(); } return; }
    switch (this.phase) {
      case 'call': if (this.human == null && this.timer > 0.4) this.cpuCalls(); break;
      case 'cutin': if (this.timer > 1.6) { this.phase = 'pre'; this.timer = 0; this.cutin = null; } break;
      case 'kick':
        this.kick.t += dt;
        if (this.kick.human ? (this.kick.stopped != null && this.timer > this.kick.stopT + 0.9) || this.timer > 6 : this.timer > 1.6) { this.resolveKick(); this.afterPlay(); }
        if (this.kick.human && this.kick.stopped != null && this.kick.stopT == null) this.kick.stopT = this.timer;
        break;
      case 'pre': {
        if (this.pendingCpuSpirit != null) { const t = this.pendingCpuSpirit; this.pendingCpuSpirit = null; if (this.activateSpirit(t)) break; }
        this.play.step(dt, null);
        const cpuSnap = !this.offIsHuman && this.timer > (this.human == null ? 0.9 : 1.6);
        if (cpuSnap) this.snap();
        this.followCam(dt);
        break; }
      case 'live': {
        if (f.hitstop > 0) { f.hitstop -= dt; break; }
        const sub = 4, h = dt / sub;
        for (let i = 0; i < sub; i++) { this.play.step(h, input); if (this.play.phase !== 'live') break; }
        if (!s.ot) s.clock = Math.max(0, s.clock - dt);
        this.handleEvents(this.play.events.splice(0));
        const b = this.play.ball; if (b.state === 'air' && !b.pitch) { f.trail.push([b.x, b.y, b.z]); if (f.trail.length > 10) f.trail.shift(); } else if (f.trail.length) f.trail.shift();
        if (this.play.phase === 'dead') { this.phase = 'post'; this.timer = 0; }
        this.followCam(dt);
        break; }
      case 'post':
        this.play.step(dt, null); this.handleEvents(this.play.events.splice(0)); this.followCam(dt);
        if (this.timer > 1.5) { this.applyResult(this.play.result); this.afterPlay(); }
        break;
    }
  }
  snap() { if (this.phase !== 'pre') return; this.play.snap(); this.phase = 'live'; this.timer = 0; }
  afterPlay() { const s = this.state;
    if (this.pat) { this.say(this.pat, 'chrome', 1.3); this.pat = null; }
    if (s.final) { this.banner = 'FINAL'; return; }
    if (this.endQuarterIfNeeded()) { if (s.final) this.banner = 'FINAL'; return; }
    this.newPlay(); }
  followCam(dt) {
    const p = this.play; if (!p) return;
    const c = p.ballCarrier, b = p.ball;
    let fx = b.x, fy = b.y;
    if (c) { fx = c.x + c.vx * 0.35; fy = c.y + Math.min(5, c.vy * 0.35); }
    if (b.state === 'air') { fx = lerp(b.x, b.tx, 0.4); fy = lerp(b.y, b.ty, 0.4); }
    if (this.phase === 'pre') { fx = this.ballX; fy = p.los + 3; }
    this.cam.follow(fx, fy, dt, b.state === 'air' && b.lob ? 1.15 : 1);
  }
  finish() {
    this.phase = 'final';
    const me = this.human ?? 0, them = 1 - me, s = this.state, st = this.stats[me];
    const won = s.score[me] > s.score[them];
    let pts = (s.score[me] - s.score[them]) / 7 + st.rushYds / 60 + st.passYds / 120 + st.takeaways * 0.7;
    let grade = pts >= 5 ? 'S' : pts >= 3 ? 'A' : pts >= 1.5 ? 'B' : pts >= 0 ? 'C' : 'D';
    if (!won && 'SA'.includes(grade)) grade = 'B';
    const trials = dailyTrials().map((t) => ({ ...t, passed: t.test(st, this.stats[them], s.score[me], s.score[them]) }));
    let coins = won ? 150 : s.score[me] === s.score[them] ? 90 : 60;
    coins += 15 * st.td + Math.min(60, 10 * (st.takeaways + st.sacks + st.bigHits)) + trials.filter((t) => t.passed).reduce((a, t) => a + t.reward, 0);
    const mvp = Object.entries(this.players).filter(([, v]) => v.team === me).map(([n, v]) => [n, v, v.yds / 10 + v.td * 6 + v.tkl * 0.8 + v.sacks * 3 + v.picks * 5]).sort((a, b) => b[2] - a[2])[0];
    this.report = { won, tie: s.score[me] === s.score[them], grade, coins, trials, mvp, score: s.score.slice(), st, abbr: this.teams.map((t) => t.abbreviation) };
  }

  // --- drawing -------------------------------------------------------------
  draw(ctx, field, ui) {
    const p = this.play, cam = this.cam, s = this.state;
    const los = p ? p.los : 10 + s.ballOn, ltg = s.down && !s.ot || s.ot ? los + s.toGo : null;
    field.render(ctx, cam, (performance.now() / 400) & 1, this.phase === 'kick' ? null : los, this.phase === 'kick' ? null : (s.ballOn + s.toGo < 100 ? ltg : null));
    // goal posts (far)
    for (const gy of [120]) { const a = cam.project(26.67 - 3.1, gy, 3.3), b = cam.project(26.67 + 3.1, gy, 3.3), base = cam.project(26.67, gy, 0), top = cam.project(26.67, gy, 3.3);
      if (a && b && base) { ctx.fillStyle = '#FFD23F'; const w = Math.max(1, a.k * 0.15);
        ctx.fillRect(base.x - w / 2, top.y, w, base.y - top.y); ctx.fillRect(a.x, a.y - w / 2, b.x - a.x, w);
        const up = cam.project(26.67, gy, 9.5); ctx.fillRect(a.x - w / 2, up.y, w, a.y - up.y); ctx.fillRect(b.x - w / 2, up.y, w, b.y - up.y); } }
    if (!p) return;
    // entities, far to near
    const ents = [];
    for (const pl of p.players) { const q = cam.project(pl.x, pl.y, 0); if (q) ents.push([q.Z, 'p', pl, q]); }
    const b = p.ball; if (b.state !== 'held') { const q = cam.project(b.x, b.y, b.z); if (q) ents.push([q.Z - 0.01, 'b', b, q]); }
    for (const pr of this.fx.parts) { const q = cam.project(pr.x, pr.y, pr.z); if (q) ents.push([q.Z, 'd', pr, q]); }
    ents.sort((a, c) => c[0] - a[0]);
    // shadows first
    ctx.fillStyle = 'rgba(11,36,16,0.45)';
    for (const [, kind, e, q] of ents) { if (kind !== 'p') continue; const w = Math.max(3, q.k * 1.0); ctx.fillRect(Math.round(q.x - w / 2), Math.round(q.y - 1), Math.round(w), Math.max(1, Math.round(q.k * 0.25))); }
    if (b.state !== 'held') { const q = cam.project(b.x, b.y, 0); if (q) { ctx.fillStyle = 'rgba(11,36,16,0.5)'; const w = Math.max(2, q.k * 0.5 / (1 + b.z * 0.15)); ctx.fillRect(Math.round(q.x - w / 2), Math.round(q.y), Math.round(w), 1); } }
    // ball trail
    for (let i = 0; i < this.fx.trail.length; i++) { const [x, y, z] = this.fx.trail[i], q = cam.project(x, y, z); if (!q) continue;
      ctx.fillStyle = `rgba(255,246,192,${(i + 1) / this.fx.trail.length * 0.6})`; const r = Math.max(1, q.k * 0.12); ctx.fillRect(q.x - r / 2, q.y - r / 2, r, r); }
    const human = p.controlled;
    for (const [, kind, e, q] of ents) {
      if (kind === 'p') {
        const hpx = Math.round(q.k * (e.big ? 2.05 : 1.95)), view = e.side === 'off' ? 'back' : 'front';
        let pose = e.state === 'down' ? 'down' : e.state === 'dive' ? 'dive' : p.phase === 'pre' && ['C', 'LG', 'RG', 'DL1', 'DL2'].includes(e.slot) ? 'stance'
          : e.throwT > 0 ? 'throw' : e.speed > 0.6 ? 'run' + (Math.floor(e.anim * 1.6) & 3) : 'idle';
        if (e.throwT > 0) e.throwT -= 1 / 60;
        const aura = p.starId === e.data.id ? (Math.floor(performance.now() / 80) & 1 ? css(this.looks[e.teamIdx].trim) : '#FFE45C') : null;
        const spr = playerSprite(this.looks[e.teamIdx], hpx, view, pose, e.data.number, e.skin, e.big, aura && rgbHex(aura));
        const x0 = Math.round(q.x - spr.width / 2), y0 = Math.round(q.y - spr.height + 1);
        ctx.drawImage(spr, x0, y0);   // never mirrored: jersey numbers must read correctly
        if (e === p.ballCarrier && e.state === 'ok') { const bs = ballSprite(clamp(Math.round(q.k * 0.55), 3, 10), 0.5); ctx.drawImage(bs, Math.round(q.x + spr.width * 0.18), Math.round(q.y - spr.height * 0.55)); }
        if (e === human && this.human != null) { const my = y0 - 6; ctx.fillStyle = '#FFE45C';
          ctx.beginPath(); ctx.moveTo(q.x - 4, my - 4); ctx.lineTo(q.x + 4, my - 4); ctx.lineTo(q.x, my); ctx.fill(); }
        e.screen = { x: q.x, y: y0 };
      } else if (kind === 'b') {
        const l = clamp(Math.round(q.k * 0.6), 3, 12); ctx.drawImage(ballSprite(l, Math.atan2(-e.vz, e.vx || 0.01) * 0.6 + (performance.now() / 60 % 3) * 0.1), Math.round(q.x - l / 2 - 2), Math.round(q.y - l / 2 - 2));
      } else { ctx.fillStyle = '#C8A070'; const r = Math.max(1, q.k * 0.12); ctx.fillRect(Math.round(q.x), Math.round(q.y), r, r); }
    }
    for (const bu of this.fx.bursts) { const q = cam.project(bu.x, bu.y, bu.z); if (q) starburst(ctx, q.x, q.y, Math.max(5, q.k * bu.r * (0.6 + bu.age * 2)), Math.floor(bu.age / 0.07)); }
    if (this.fx.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${this.fx.flash * 1.5})`; ctx.fillRect(0, 0, W, H); }
    // speed lines when the carrier is flying
    const c = p.ballCarrier; if (c && c.speed > c.top * 0.92 && c.vy > 6 && p.phase === 'live') { ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU + (performance.now() / 90 | 0) * 0.37, r0 = 150 + (i * 37 % 60);
        ctx.fillRect(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0 * 0.5, Math.cos(a) * 30 || 1, 1); } }
  }
}
function rgbHex(c) { if (c[0] === '#') return c; const m = c.match(/\d+/g).map(Number); return '#' + m.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''); }

// --- Daily Spirit Trials (same pool as the iOS build) ------------------------
const TRIAL_POOL = [
  ['WIN THE GAME', 0, (m, t, a, b) => a > b], ['SCORE 14+ POINTS', 0, (m, t, a) => a >= 14], ['RECORD 2 SACKS', 0, (m) => m.sacks >= 2],
  ['RUSH FOR 40+ YARDS', 0, (m) => m.rushYds >= 40], ['PASS FOR 100+ YARDS', 0, (m) => m.passYds >= 100], ['FORCE A TURNOVER', 0, (m) => m.takeaways >= 1],
  ['RUSH FOR 80+ YARDS', 1, (m) => m.rushYds >= 80], ['PASS FOR 180+ YARDS', 1, (m) => m.passYds >= 180], ['KICK A FIELD GOAL', 1, (m) => m.fg >= 1],
  ['HOLD THEM TO 10 OR LESS', 1, (m, t, a, b) => b <= 10], ['LAND 3 BIG HITS', 1, (m) => m.bigHits >= 3], ['SCORE DURING A SPIRIT PLAY', 1, (m) => (m.spiritTD || 0) >= 1],
  ['WIN BY 21+', 2, (m, t, a, b) => a - b >= 21], ['SHUT THEM OUT', 2, (m, t, a, b) => b === 0 && a > 0], ['WIN AFTER TRAILING BY 10+', 2, (m, t, a, b) => a > b && m.deficit >= 10],
  ['SCORE 5 TOUCHDOWNS', 2, (m) => m.td >= 5], ['BREAK 5 TACKLES', 2, (m) => m.broken >= 5],
];
function dayKey() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function dailyTrials() { const r = RNG(dayKey()); return [0, 1, 2].map((tier) => { const pool = TRIAL_POOL.filter((t) => t[1] === tier); const t = pool[r.int(pool.length)];
  return { text: t[0], tier, reward: [50, 100, 200][tier], test: t[2] }; }); }
