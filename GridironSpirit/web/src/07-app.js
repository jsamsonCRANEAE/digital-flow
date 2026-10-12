// ---------------------------------------------------------------------------
// App: screens, immediate-mode buttons with focus navigation, portraits,
// the in-game HUD, gear shop, Spirit Cup and save data.
// ---------------------------------------------------------------------------
const GEAR = DATA.gear.items.map((it) => ({ ...it, price: DATA.gear.tierPrices[it.tier - 1] }));
const CATS = ['cleats', 'gloves', 'helmets', 'training'];
const STAT_SHORT = { speed: 'SPD', acceleration: 'ACC', agility: 'AGI', strength: 'STR', balance: 'BAL', catching: 'CTH', throwPower: 'THP', throwAccuracy: 'THA' };
const TIER_COL = ['#C8CCD8', '#4CC38A', '#3FA7FF', '#B06BFF', '#FFC83C'].map(hex);
const boostLine = (it) => Object.entries(it.boost).map(([k, v]) => `${STAT_SHORT[k]}+${v}`).join(' ') + (it.spiritCharge ? ` SPIRIT+${Math.round(it.spiritCharge * 100)}%` : '');

function defaultProfile() { return { coins: 0, games: 0, wins: 0, best: '-', owned: [], equipped: {}, teamId: DATA.teams.teams[0].id, cup: null, trophies: [],
  settings: { music: 7, sfx: 8, haptics: true, difficulty: 'pro', qLen: 120, fit: 'fill' } }; }
function loadProfile() { try { const p = JSON.parse(localStorage.getItem('gs.profile.v1')); if (p && p.settings) return Object.assign(defaultProfile(), p); } catch (e) {} return defaultProfile(); }

function boostedTeam(team, equipped) {
  const t = JSON.parse(JSON.stringify(team));
  for (const id of Object.values(equipped)) { const it = GEAR.find((g) => g.id === id); if (!it) continue;
    for (const p of t.roster) if (it.appliesTo.includes(p.position)) for (const [k, v] of Object.entries(it.boost)) p.ratings[k] = Math.min(99, p.ratings[k] + v); }
  return t;
}
function shadowTeam(base) {
  const t = JSON.parse(JSON.stringify(base));
  t.id = 'shadow_' + base.id; t.city = 'SHADOW'; t.abbreviation = ('S' + base.abbreviation).slice(0, 4);
  t.colors = { primary: '#2A1B3D', secondary: '#0E0B14', accent: '#C23BFF' };
  for (const p of t.roster) { p.id = 'sh_' + p.id; for (const k of Object.keys(STAT_SHORT)) p.ratings[k] = Math.min(99, p.ratings[k] + 4); }
  return t;
}
const teamById = (id) => id.startsWith('shadow_') ? shadowTeam(DATA.teams.teams.find((t) => t.id === id.slice(7))) : DATA.teams.teams.find((t) => t.id === id);
const CUP_ROUNDS = ['QUARTERFINAL', 'SEMIFINAL', 'SHADOW FINAL'];

// --- Procedural anime portraits ---------------------------------------------
const portraitCache = new Map();
function portrait(player, team, mood = 'neutral', shadow = false, bg = true) {
  const key = player.id + team.id + mood + shadow + bg; let c = portraitCache.get(key); if (c) return c;
  const r = RNG(player.id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0) | 0, 7));
  const n = 64; c = makeCanvas(n, n); const x = c.x;
  const J = shadow ? hex('#2A1B3D') : hex(team.colors.primary), T = shadow ? hex('#C23BFF') : hex(team.colors.accent);
  // background rays
  if (bg) rect(x, 0, 0, n, n, shade(J, -0.55));
  x.fillStyle = css(shade(J, -0.3)); if (bg) for (let i = 0; i < 12; i += 2) { x.beginPath(); x.moveTo(32, 30); const a0 = i / 12 * TAU, a1 = (i + 1) / 12 * TAU; x.lineTo(32 + Math.cos(a0) * 70, 30 + Math.sin(a0) * 70); x.lineTo(32 + Math.cos(a1) * 70, 30 + Math.sin(a1) * 70); x.fill(); }
  const fig = makeCanvas(n, n), f = fig.x;
  const skins = SKIN; const skin = shadow ? shade(skins[r.int(5)], -0.6) : skins[r.int(5)], skinS = shade(skin, -0.45);
  const hairs = ['#1A1420', '#3B2416', '#6B4A2A', '#E8D27A', '#F2F2F2', '#C0392B', '#2E86DE', '#8E44AD'].map(hex);
  const hair = shadow ? hex('#120E1A') : r() < 0.25 ? T : hairs[r.int(hairs.length)];
  const big = ['c', 'og', 'dl'].includes(player.position);
  // shoulders + jersey
  for (let y = 46; y < n; y++) { const hw = 20 + (y - 46) * 0.7 + (big ? 4 : 0); rect(f, 32 - hw, y, hw * 2, 1, y < 49 ? T : J); }
  rect(f, 26, 46, 12, 4, skinS); // collar shadow
  text(f, String(player.number), 38, 52, T, null);
  // neck + head
  rect(f, 27, 38, 10, 10, skinS);
  const jaw = big ? 0.85 : 0.35;
  for (let y = 14; y < 44; y++) { const t = (y - 14) / 30; const hw = t < 0.6 ? 12 : lerp(12, 12 * (1 - jaw) * 0.55 + 4 * jaw + 3, (t - 0.6) / 0.4); rect(f, 32 - hw, y, hw * 2, 1, skin); }
  rect(f, 39, 20, 4, 22, skinS);
  // hair styles
  const style = r.int(5); f.fillStyle = css(hair);
  if (style === 0) { for (let i = 0; i < 7; i++) { f.beginPath(); f.moveTo(18 + i * 4.5, 20); f.lineTo(16 + i * 4.8, 4 + (i % 2) * 4); f.lineTo(24 + i * 4.5, 18); f.fill(); } rect(f, 18, 12, 28, 8, hair); }
  else if (style === 1) { rect(f, 18, 9, 28, 9, hair); rect(f, 18, 17, 6, 10, hair); rect(f, 40, 17, 6, 8, hair); rect(f, 24, 17, 10, 5, hair); }
  else if (style === 2) { rect(f, 19, 11, 26, 6, hair); }
  else if (style === 3) { rect(f, 28, 3, 8, 14, hair); rect(f, 20, 13, 24, 3, shade(hair, -0.3)); }
  else { rect(f, 17, 9, 30, 9, hair); rect(f, 16, 17, 5, 22, hair); rect(f, 43, 17, 5, 22, hair); }
  if (team.archetype === 'disciplined' && !shadow) { rect(f, 18, 17, 28, 3, hex('#FFFFFF')); rect(f, 44, 18, 6, 2, hex('#FFFFFF')); }
  // eyes
  const iris = shadow ? hex('#FF3BD8') : ['#6B3E1E', '#C8902A', '#3A7BD5', '#2E9E5B', '#C0392B', '#8E44AD'].map(hex)[r.int(6)];
  const ey = mood === 'shocked' ? 25 : 26;
  for (const ex of [23, 35]) { rect(f, ex, ey, 7, 5, [255, 255, 255]); rect(f, ex + (mood === 'shocked' ? 2 : 2), ey + (mood === 'shocked' ? 1 : 0), mood === 'shocked' ? 2 : 4, mood === 'shocked' ? 2 : 5, iris);
    if (mood !== 'shocked') rect(f, ex + 2, ey, 1, 1, [255, 255, 255]); rect(f, ex - 1, ey - 1, 9, 1, PAL.outline); }
  rect(f, 22, ey - 4 - (mood === 'confident' ? 1 : 0), 8, 2, shade(hair, -0.4)); rect(f, 34, ey - 4, 8, 2, shade(hair, -0.4));
  if (r() < 0.6 && !shadow) { rect(f, 23, ey + 6, 6, 1, PAL.ink); rect(f, 35, ey + 6, 6, 1, PAL.ink); }   // eye black
  rect(f, 31, 32, 2, 3, skinS);                                         // nose
  if (mood === 'shocked') { rect(f, 29, 38, 6, 3, hex('#5A1E2A')); }
  else if (mood === 'confident') { rect(f, 27, 38, 10, 1, PAL.ink); rect(f, 36, 37, 1, 1, PAL.ink); }
  else rect(f, 28, 38, 8, 1, shade(skin, -0.6));
  outline(fig, PAL.outline);
  x.drawImage(fig, 0, 0);
  if (mood === 'shocked') { rect(x, 50, 12, 3, 5, hex('#9AD8FF')); }
  if (mood === 'confident') { for (let i = -2; i <= 2; i++) { rect(x, 10 + i, 20, 1, 1, [255, 255, 255]); rect(x, 10, 20 + i, 1, 1, [255, 255, 255]); } }
  portraitCache.set(key, c); return c;
}
function framedPortrait(ctx, p, x, y, name, accent) {
  panel(ctx, x, y, 72, 86, accent, PAL.panel); ctx.drawImage(p, x + 4, y + 4);
  rect(ctx, x + 2, y + 70, 68, 14, hex('#14162E')); rect(ctx, x + 2, y + 70, 68, 1, accent);
  textC(ctx, name.slice(0, 11), x + 36, y + 74, PAL.white, null);
}
const starOf = (team) => team.roster.find((p) => p.spiritPlay && p.position === 'qb') || team.roster.find((p) => p.spiritPlay) || team.roster[0];

// --- App ------------------------------------------------------------------
const App = {
  screen: 'title', t: 0, st: 0, hits: [], focus: null, pressed: null, profile: loadProfile(), match: null, attract: null,
  pickTeam: 0, pickOpp: 1, mode: 'exhibition', shopCat: 'cleats', shopSel: 'cleat1', keeper: { line: 'WELCOME! TAP AN ITEM.', mood: 'confident', t: 0 }, post: null,
  save() { try { localStorage.setItem('gs.profile.v1', JSON.stringify(this.profile)); } catch (e) {} },
  init() {
    this.field = new FieldRenderer(); this.field.buildBackdrops();
    const i = DATA.teams.teams.findIndex((t) => t.id === this.profile.teamId); this.pickTeam = Math.max(0, i); this.pickOpp = (this.pickTeam + 1) % 3;
    this.applySettings(); this.go('title');
  },
  applySettings() { const s = this.profile.settings; Audio.setVolumes(s.music / 10 * 0.8, s.sfx / 10); fit(); },
  go(s) { this.screen = s; this.st = 0; this.focus = null; this.pressed = null;
    if (s === 'title') { this.startAttract(); Audio.play('title'); Audio.crowd(0.12); }
    else if (s === 'game' || s === 'pause') { Audio.play('game'); }
    else { this.attract = null; Audio.play('menu'); Audio.crowd(0.02); } },
  startAttract() { const a = rng.int(3), b = (a + 1 + rng.int(2)) % 3;
    this.attract = new Match({ teams: [DATA.teams.teams[a], DATA.teams.teams[b]], human: null, difficulty: 'pro', qLen: 45 }); },

  // --- immediate-mode widgets -------------------------------------------------
  hit(id, x, y, w, h) { this.hits.push({ id, x, y, w, h }); },
  btn(ctx, id, label, x, y, w, h = 24, o = {}) { this.hit(id, x, y, w, h);
    button(ctx, label, x, y, w, h, Object.assign({ pressed: this.pressed === id, focus: this.showFocus && this.curFocus() === id, accent: this.accent() }, o)); },
  accent() { return hex(DATA.teams.teams[this.pickTeam].colors.primary); },
  get showFocus() { return Input.device !== 'touch'; },
  curFocus() { if (this.focus && this.hits.some((h) => h.id === this.focus)) return this.focus;
    const d = { main: 'exhibition', team: 'play', settings: 'set.music.1', shop: 'item.' + this.shopSel, cup: 'cup.play', post: 'post.again', pause: 'resume', final: 'continue' }[this.screen];
    this.focus = this.hits.some((h) => h.id === d) ? d : this.hits[0]?.id; return this.focus; },
  moveFocus(dx, dy) {
    const f = this.curFocus(), from = this.hits.find((h) => h.id === f); if (!from) return;
    const cx = from.x + from.w / 2, cy = from.y + from.h / 2; let best = null, bs = 1e9;
    for (const h of this.hits) { if (h.id === f) continue; const vx = h.x + h.w / 2 - cx, vy = h.y + h.h / 2 - cy, along = vx * dx + vy * dy;
      if (along <= 2) continue; const sc = along + Math.abs(vx * dy - vy * dx) * 2; if (sc < bs) { bs = sc; best = h.id; } }
    if (best) { this.focus = best; Audio.sfx('tap'); if (best.startsWith('item.')) { this.shopSel = best.slice(5); this.shopCat = GEAR.find((g) => g.id === this.shopSel).category; } }
  },
  hitAt(x, y) { for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]; if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h.id; }
    // pad small targets to a 44px-ish touch size
    let best = null, bd = 1e9; for (const h of this.hits) { const px = Math.max(0, (34 - h.w) / 2), py = Math.max(0, (34 - h.h) / 2);
      if (x >= h.x - px && x < h.x + h.w + px && y >= h.y - py && y < h.y + h.h + py) { const d = Math.hypot(x - h.x - h.w / 2, y - h.y - h.h / 2); if (d < bd) { bd = d; best = h.id; } } }
    return best; },

  // --- pointer input -----------------------------------------------------
  pdown(id, x, y) {
    Audio.unlock(); Input.device = 'touch';
    if (this.screen === 'title') { if (this.st > 0.3) { Audio.sfx('tap'); this.go('main'); } return; }
    const h = this.hitAt(x, y);
    if (this.screen === 'game') {
      const m = this.match;
      if (h && h.startsWith('recv.')) { this.charge = { id, recv: +h.slice(5), t: performance.now() }; return; }
      if (m && m.phase === 'call' && !(h && h.startsWith('page.')) && h !== 'pause') { this.swipe = { id, x, y }; return; }   // tap or swipe the cards
      if (h) { this.pressed = h; this.pressedPtr = id; if (h.startsWith('act.')) this.act(h); return; }
      if (x < W * 0.5 && !Input.joy) { Input.joy = { id, bx: clamp(x, 26, W / 2 - 26), by: clamp(y, 26, H - 26), kx: x, ky: y }; }
      return;
    }
    this.pressed = h; this.pressedPtr = id;
  },
  pmove(id, x, y) {
    if (Input.joy && Input.joy.id === id) { const j = Input.joy; j.kx = x; j.ky = y; const dx = x - j.bx, dy = y - j.by, d = Math.hypot(dx, dy);
      if (d > 22) { j.bx += dx / d * (d - 22); j.by += dy / d * (d - 22); } }
    if (this.swipe && this.swipe.id === id && Math.abs(x - this.swipe.x) > 40) { this.page(x < this.swipe.x ? 1 : -1); this.swipe = null; }
    if (this.pressedPtr === id && this.pressed && this.hitAt(x, y) !== this.pressed && !this.pressed.startsWith('act.')) this.pressed = null;
  },
  pup(id, x, y) {
    if (Input.joy && Input.joy.id === id) Input.joy = null;
    if (this.charge && this.charge.id === id) { const lob = performance.now() - this.charge.t > 180; this.throwSlot(this.charge.recv, lob); this.charge = null; return; }
    if (this.swipe && this.swipe.id === id) { const h = this.hitAt(this.swipe.x, this.swipe.y); if (h) this.activate(h); this.swipe = null; return; }
    if (this.pressedPtr === id) { const h = this.hitAt(x, y); if (this.pressed && h === this.pressed && !h.startsWith('act.')) this.activate(h); this.pressed = null; this.pressedPtr = null; }
  },

  // --- actions -----------------------------------------------------------
  activate(id) {
    const p = this.profile; let save = false;
    const sfx = (k) => Audio.sfx(k);
    if (id === 'exhibition') { sfx('tap'); this.mode = 'exhibition'; this.go('team'); }
    else if (id === 'cup') { sfx('tap'); this.mode = 'cup'; this.go(p.cup ? 'cup' : 'team'); }
    else if (id === 'shop') { sfx('tap'); this.say('WELCOME! TAP AN ITEM.', 'confident'); this.go('shop'); }
    else if (id === 'settings') { sfx('tap'); this.settingsBack = this.screen; this.go('settings'); }
    else if (id === 'back') { sfx('back'); this.go(this.screen === 'settings' && this.settingsBack === 'pause' ? 'pause' : this.screen === 'shop' && this.post ? 'post' : 'main'); }
    else if (id.startsWith('team.')) { sfx('tap'); this.pickTeam = +id.slice(5); if (this.pickOpp === this.pickTeam) this.pickOpp = (this.pickTeam + 1) % 3; p.teamId = DATA.teams.teams[this.pickTeam].id; save = true; }
    else if (id === 'opp') { sfx('tap'); do this.pickOpp = (this.pickOpp + 1) % 3; while (this.pickOpp === this.pickTeam); }
    else if (id === 'diff') { sfx('tap'); const d = ['rookie', 'pro', 'legend']; p.settings.difficulty = d[(d.indexOf(p.settings.difficulty) + 1) % 3]; save = true; }
    else if (id === 'play') { sfx('buy'); const me = DATA.teams.teams[this.pickTeam].id; p.teamId = me;
      if (this.mode === 'cup') { const others = DATA.teams.teams.map((t) => t.id).filter((t) => t !== me); if (rng() < 0.5) others.reverse();
        p.cup = { teamId: me, opponents: [...others, 'shadow_' + me], round: 0, results: [] }; save = true; this.go('cup'); }
      else this.startMatch(me, DATA.teams.teams[this.pickOpp].id); }
    else if (id === 'cup.play') { sfx('buy'); this.startMatch(p.cup.teamId, p.cup.opponents[p.cup.round]); }
    else if (id === 'cup.forfeit') { sfx('error'); p.cup = null; save = true; this.go('main'); }
    else if (id.startsWith('set.')) { const [, k, d] = id.split('.'); const s = p.settings, dd = +d;
      if (k === 'music') s.music = clamp(s.music + dd, 0, 10); if (k === 'sfx') s.sfx = clamp(s.sfx + dd, 0, 10); if (k === 'haptics') s.haptics = !s.haptics;
      if (k === 'difficulty') { const o = ['rookie', 'pro', 'legend']; s.difficulty = o[(o.indexOf(s.difficulty) + dd + 3) % 3]; }
      if (k === 'qlen') { const o = [120, 180, 300]; s.qLen = o[(o.indexOf(s.qLen) + dd + 3) % 3]; }
      if (k === 'fit') s.fit = s.fit === 'pixel' ? 'fill' : 'pixel';
      this.applySettings(); sfx('tap'); save = true; }
    else if (id.startsWith('tab.')) { sfx('tap'); this.shopCat = id.slice(4); this.shopSel = GEAR.find((g) => g.category === this.shopCat).id; }
    else if (id.startsWith('item.')) { sfx('tap'); this.shopSel = id.slice(5); const it = GEAR.find((g) => g.id === this.shopSel); this.shopCat = it.category; this.say(it.tier === 5 ? 'OHO! A LEGEND PIECE.' : 'GOOD EYE.', 'neutral'); }
    else if (id === 'buy') { const it = GEAR.find((g) => g.id === this.shopSel);
      if (p.owned.includes(it.id)) { if (p.equipped[it.category] === it.id) { delete p.equipped[it.category]; sfx('back'); this.say('BACK ON THE HOOK.', 'neutral'); } else { p.equipped[it.category] = it.id; sfx('tap'); this.say('SUITS YOU.', 'confident'); } }
      else if (p.coins >= it.price) { p.coins -= it.price; p.owned.push(it.id); p.equipped[it.category] = it.id; sfx('buy'); this.say(it.tier >= 4 ? "NOW THAT'S SPIRIT!" : 'FINE CHOICE, KID!', 'confident'); }
      else { sfx('error'); this.say('NOT ENOUGH COIN!', 'shocked'); }
      save = true; }
    else if (id === 'pause') { sfx('tap'); Input.joy = null; this.go('pause'); }
    else if (id === 'resume') { sfx('tap'); this.go('game'); }
    else if (id === 'pause.settings') { sfx('tap'); this.settingsBack = 'pause'; this.go('settings'); }
    else if (id === 'quit') { sfx('back'); this.match = null; this.go('main'); }
    else if (id === 'continue') this.finishMatch();
    else if (id === 'post.menu') { sfx('tap'); this.post = null; this.go('main'); }
    else if (id === 'post.shop') { sfx('tap'); this.say('SPEND IT WELL!', 'confident'); this.go('shop'); }
    else if (id === 'post.again') { sfx('buy'); if (this.mode === 'cup') { this.post = null; this.go(p.cup ? 'cup' : 'main'); } else if (this.last) { this.post = null; this.startMatch(...this.last); } }
    else if (id.startsWith('card.')) this.callCard(+id.slice(5));
    else if (id === 'page.next') this.page(1); else if (id === 'page.prev') this.page(-1);
    else if (id === 'kicktap') this.match?.kickTap();
    if (save) this.save();
  },
  say(line, mood) { this.keeper = { line, mood, t: 0 }; },
  act(id) { // in-game context buttons: act.<action>
    const m = this.match; if (!m) return; const a = id.slice(4), pl = m.play;
    if (a === 'kick') { m.kickTap(); return; }
    if (a === 'snap') m.snap();
    else if (a === 'spirit') m.activateSpirit(m.human);
    else if (a === 'switch' && pl) { const ds = pl.players.filter((q) => q.side === 'def' && q.up); const b = pl.ball;
      ds.sort((u, v) => Math.hypot(u.x - b.x, u.y - b.y) - Math.hypot(v.x - b.x, v.y - b.y)); const next = ds.find((q) => q !== pl.controlled) || ds[0]; if (next) pl.controlled = next; Audio.sfx('tap'); }
    else if (pl && ['juke', 'spin', 'stiff', 'dive'].includes(a)) pl.doMove(a);
  },
  page(d) { const m = this.match; if (!m || m.phase !== 'call') return; const n = m.cardsFor().length; m.page = (m.page + d + n) % n; Audio.sfx('tap'); },
  callCard(i) { const m = this.match; if (!m || m.phase !== 'call') return; const id = m.cardsFor()[m.page][i]; if (!id) return; Audio.sfx('tap'); m.humanCall(id); },
  throwSlot(slot, lob) { const pl = this.match?.play; if (!pl || !pl.canThrow || !(pl.humanSide === 'off')) return; const r = this.receivers()[slot]; if (r) pl.throwTo(r, lob); },
  receivers() { const pl = this.match?.play; if (!pl) return []; return ['WR1', 'WR2', 'RB'].map((s) => pl.by['o' + s]).filter((r) => r.up); },

  startMatch(meId, oppId) {
    const p = this.profile, me = boostedTeam(teamById(meId), p.equipped), opp = teamById(oppId);
    const bonus = Object.values(p.equipped).reduce((a, id) => a + (GEAR.find((g) => g.id === id)?.spiritCharge || 0), 0);
    this.match = new Match({ teams: [me, opp], human: 0, difficulty: p.settings.difficulty, qLen: p.settings.qLen, spiritBonus: bonus });
    this.last = [meId, oppId]; this.field.setTeams(hex(me.colors.primary), hex(opp.colors.primary));
    Audio.crowd(0.25); this.go('game');
  },
  finishMatch() {
    const m = this.match, r = m.report, p = this.profile; if (!r) return;
    Audio.sfx('tap');
    const before = p.coins; p.coins += r.coins; p.games++; if (r.won) p.wins++;
    const order = 'SABCD-'; if (order.indexOf(r.grade) < order.indexOf(p.best)) p.best = r.grade;
    let cup = null;
    if (this.mode === 'cup' && p.cup) { const round = p.cup.round; p.cup.results.push((r.won ? 'W ' : 'L ') + `${r.score[0]}-${r.score[1]}`);
      if (!r.won) { cup = ['out', round]; p.cup = null; }
      else if (++p.cup.round >= 3) { cup = ['champ', round]; p.trophies.push(p.cup.teamId); p.coins += 500; p.cup = null; }
      else cup = ['next', p.cup.round]; }
    this.post = { r, before, cup }; this.save(); this.match = null; this.go('post');
    if (r.won) Audio.play('touchdown');
  },

  // --- frame ---------------------------------------------------------------
  update(dt) {
    this.t += dt; this.st += dt; this.keeper.t += dt;
    // pad / keyboard navigation
    const pr = Input.pressed;
    if (this.screen === 'title') { if (this.st > 0.4 && (pr.includes('A') || pr.includes('MENU'))) { Audio.unlock(); Audio.sfx('tap'); this.go('main'); } }
    else if (this.screen === 'game') this.gameInput();
    else {
      if (this.screen === 'pause' && (pr.includes('MENU') || pr.includes('B'))) { this.activate('resume'); return; }
      const dir = Input.dirPressed();
      if (this.screen === 'settings' && dir && dir[1] === 0 && this.curFocus()?.startsWith('set.')) { const k = this.curFocus().split('.')[1]; this.activate(`set.${k}.${dir[0]}`); this.focus = `set.${k}.1`; }
      else if (dir) this.moveFocus(dir[0], dir[1]);
      if (this.screen === 'shop' && (pr.includes('LB') || pr.includes('RB'))) { const i = CATS.indexOf(this.shopCat); this.activate('tab.' + CATS[(i + (pr.includes('RB') ? 1 : 3)) % 4]); this.focus = 'item.' + this.shopSel; }
      if (pr.includes('A') && this.curFocus()) this.activate(this.curFocus());
      if (pr.includes('B')) { if (this.hits.some((h) => h.id === 'back')) this.activate('back'); else if (this.screen === 'post') this.activate('post.menu'); }
    }
    if (this.screen === 'title' && this.attract) { this.attract.update(dt, null); if (this.attract.phase === 'final' || this.attract.banner === 'FINAL') { this.attractEnd = (this.attractEnd || 0) + dt; if (this.attractEnd > 3) { this.attractEnd = 0; this.startAttract(); } } }
    if (this.screen === 'game' && this.match) this.match.update(dt, { move: Input.move });
  },
  gameInput() {
    const m = this.match; if (!m) return; const pr = Input.pressed, rel = Input.released, pl = m.play;
    if (m.report) { if (this.st > 0 && (pr.includes('A') || pr.includes('MENU')) && m.finalT > 2) this.activate('continue'); return; }
    if (pr.includes('MENU')) { this.activate('pause'); return; }
    if (m.phase === 'call') {
      if (pr.includes('LB') || pr.includes('LEFT') || pr.includes('SLEFT')) this.page(-1);
      if (pr.includes('RB') || pr.includes('RIGHT') || pr.includes('SRIGHT')) this.page(1);
      ['X', 'A', 'B'].forEach((b, i) => { if (pr.includes(b)) this.callCard(i); });
      return;
    }
    if (m.phase === 'kick') { if (pr.includes('A')) m.kickTap(); return; }
    if (m.phase === 'pre') { if (pr.includes('Y') || pr.includes('RB')) m.activateSpirit(m.human); if (pr.includes('A') && m.offIsHuman) m.snap(); if (pr.includes('B') && m.defIsHuman) this.act('act.switch'); return; }
    if (!pl || m.phase !== 'live') return;
    if (pl.canThrow && pl.humanSide === 'off') {
      ['A', 'B', 'X'].forEach((b, i) => { if (pr.includes(b)) this.padCharge = { b, i, t: performance.now() }; });
      if (this.padCharge && rel.includes(this.padCharge.b)) { this.throwSlot(this.padCharge.i, performance.now() - this.padCharge.t > 180); this.padCharge = null; }
      return;
    }
    this.padCharge = null;
    const carrierMine = pl.ballCarrier && pl.ballCarrier === pl.controlled;
    if (carrierMine) { if (pr.includes('X')) pl.doMove('juke'); if (pr.includes('B')) pl.doMove('spin'); if (pr.includes('Y')) pl.doMove('stiff'); if (pr.includes('A')) pl.doMove('dive'); }
    else if (pl.humanSide === 'def') { if (pr.includes('A')) pl.doMove('dive'); if (pr.includes('B')) this.act('act.switch'); }
  },
  draw(ctx) {
    this.hits = [];
    rect(ctx, 0, 0, W, H, PAL.letterbox);
    switch (this.screen) {
      case 'title': this.drawTitle(ctx); break;
      case 'main': this.drawMain(ctx); break;
      case 'team': this.drawTeam(ctx); break;
      case 'settings': this.drawSettings(ctx); break;
      case 'shop': this.drawShop(ctx); break;
      case 'cup': this.drawCup(ctx); break;
      case 'post': this.drawPost(ctx); break;
      case 'game': case 'pause': this.drawGame(ctx); break;
    }
    if (this.showFocus && this.screen !== 'game' && this.screen !== 'title') {
      const g = Input.glyph('A'), b = Input.glyph('B'); if (g) { glyphBadge(ctx, 262, 281, g); text(ctx, 'SELECT', 277, 284, PAL.white); glyphBadge(ctx, 326, 281, b); text(ctx, 'BACK', 341, 284, PAL.white); }
    }
  },
};
