// ---------------------------------------------------------------------------
// Screens. Each draws itself and registers hit regions in the same pass, so
// layout and hit-testing can never drift apart (same design as GSUI).
// ---------------------------------------------------------------------------
let bgCache = null;
function menuBackground(ctx, t, accent) {
  const key = ((t * 12) | 0) + '|' + accent.join(',');
  if (!bgCache || bgCache.key !== key) {
    const c = bgCache?.c || makeCanvas(W, H), x = c.x, top = hex('#0B0A1E'), mid = hex('#1C1846'), low = shade(accent, -0.75);
    for (let y = 0; y < H; y++) { const u = y / (H - 1); rect(x, 0, y, W, 1, u < 0.6 ? mix(top, mid, Math.floor(u / 0.6 * 6) / 6) : mix(mid, low, Math.floor((u - 0.6) / 0.4 * 6) / 6)); }
    x.fillStyle = css(accent, 0.09); const sh = (t * 40) % 48;
    for (let k = -H; k < W + H; k += 48) { x.beginPath(); x.moveTo(k + sh, 0); x.lineTo(k + sh + 10, 0); x.lineTo(k + sh + 10 - H, H); x.lineTo(k + sh - H, H); x.fill(); }
    for (const fx of [70, 570]) { x.fillStyle = 'rgba(255,246,192,0.10)'; x.beginPath(); x.ellipse(fx, 34, 70, 34, 0, 0, TAU); x.fill(); rect(x, fx - 10, 30, 20, 6, hex('#FFF6C0')); rect(x, fx - 1, 36, 2, 40, hex('#2A2850')); }
    rect(x, 0, 250, W, H - 250, shade(PAL.turfSide, -0.5));
    for (let y = 250; y < H; y++) for (let k = 0; k < W + 120; k += 40) rect(x, k - (y - 250) * 2, y, 40, 1, ((k / 40 | 0) & 1) ? shade(PAL.turfB, -0.5) : shade(PAL.turfSide, -0.5));
    rect(x, 0, 250, W, 1, shade(PAL.line, -0.4));
    bgCache = { c, key };
  }
  ctx.drawImage(bgCache.c, 0, 0);
}
function logo(ctx, cx, y, k = 4) {
  const a = callout('GRIDIRON', k, 'chrome'), b = callout('SPIRIT', k + 1, 'fire');
  ctx.drawImage(a, Math.round(cx - a.width / 2), y); ctx.drawImage(b, Math.round(cx - b.width / 2), y + a.height - 4);
  const sy = y + a.height + b.height / 2 - 6;
  for (let i = 0; i < 3; i++) { const l = 18 - i * 5; rect(ctx, cx - b.width / 2 - 4 - l - i * 2, sy + i * 4, l, 2, PAL.gold); rect(ctx, cx + b.width / 2 + 4 + i * 2, sy + i * 4, l, 2, PAL.gold); }
  return a.height + b.height;
}
function teamRatings(t) {
  const avg = (ps, f) => ps.length ? Math.round(ps.reduce((a, p) => a + f(p.ratings), 0) / ps.length) : 50;
  const off = t.roster.filter((p) => ['qb', 'rb', 'wr', 'c', 'og'].includes(p.position)), def = t.roster.filter((p) => ['dl', 'lb', 'cb', 's'].includes(p.position));
  return { off: avg(off, (r) => (r.speed + r.strength + r.catching + r.agility) / 4), def: avg(def, (r) => (r.speed + r.strength + r.balance + r.agility) / 4),
    spd: avg(t.roster.filter((p) => ['rb', 'wr', 'cb', 's'].includes(p.position)), (r) => r.speed) };
}
function bar(ctx, label, v, x, y, w, col) { text(ctx, label, x, y, PAL.soft, null); rect(ctx, x + 22, y + 1, w - 40, 5, PAL.outline); rect(ctx, x + 23, y + 2, (w - 42) * v / 99, 3, col); text(ctx, v, x + w - 13, y, PAL.white, null); }
const BLURB = { disciplined: 'PRECISE ROUTES. SURE TACKLES.', flashy: 'BLAZING SPEED. BIG PLAYS.', powerhouse: 'GIANT LINES. POWER RUNNING.' };

Object.assign(App, {
  drawTitle(ctx) {
    const m = this.attract;
    if (m) {
      if (!this.attractField) { this.attractField = new FieldRenderer(); this.attractField.backdrops = this.field.backdrops; }
      const af = this.attractField, key = m.teams[0].id + m.teams[1].id;
      if (af.teamsKey !== key) { af.setTeams(hex(m.teams[0].colors.primary), hex(m.teams[1].colors.primary)); af.teamsKey = key; }
      m.draw(ctx, af, this); }
    ctx.fillStyle = 'rgba(14,11,28,0.35)'; ctx.fillRect(0, 0, W, H);
    logo(ctx, W / 2, 26);
    if (((this.t * 2) | 0) % 2 === 0) { const g = Input.device === 'pad' ? Input.glyph('A') : null; const t = g ? 'PRESS START' : 'TAP TO START';
      const c = callout(t, 2, 'chrome'); ctx.drawImage(c, (W - c.width) / 2, 214); }
    textC(ctx, 'ORIGINAL GAME - ALL TEAMS FICTIONAL', W / 2, 270, PAL.soft);
    textC(ctx, 'BEST IN LANDSCAPE  -  TOUCH, KEYBOARD OR CONTROLLER', W / 2, 282, PAL.dim);
  },
  drawMain(ctx) {
    const team = DATA.teams.teams[this.pickTeam], p = this.profile;
    menuBackground(ctx, this.t, this.accent());
    logo(ctx, W / 2, 8, 3);
    const bx = (W - 180) / 2;
    this.btn(ctx, 'exhibition', 'EXHIBITION', bx, 112, 180, 24, { primary: true });
    this.btn(ctx, 'cup', p.cup ? `SPIRIT CUP - ROUND ${p.cup.round + 1}` : 'SPIRIT CUP', bx, 144, 180);
    this.btn(ctx, 'shop', 'GEAR SHOP', bx, 176, 180);
    this.btn(ctx, 'settings', 'SETTINGS', bx, 208, 180);
    textC(ctx, (team.city + ' ' + team.name), 70, 104, PAL.gold);
    framedPortrait(ctx, portrait(starOf(team), team), 34, 114, starOf(team).lastName, hex(team.colors.primary));
    panel(ctx, W - 206, 120, 180, 96);
    text(ctx, 'DAILY TRIALS', W - 198, 126, PAL.gold);
    dailyTrials().forEach((t, i) => { wrap(t.text, 128).slice(0, 2).forEach((l, j) => text(ctx, l, W - 198, 140 + i * 25 + j * 9, PAL.white, null));
      coinIcon(ctx, W - 62, 139 + i * 25); text(ctx, t.reward, W - 50, 140 + i * 25, PAL.gold, null); });
    panel(ctx, W - 96, 6, 88, 17, hex('#B9832A')); coinIcon(ctx, W - 92, 10); text(ctx, grouped(p.coins), W - 79, 11, PAL.gold);
    text(ctx, `RECORD ${p.wins}-${p.games - p.wins}   BEST ${p.best}`, 10, 284, PAL.soft);
    if (p.trophies.length) text(ctx, `TROPHIES X${p.trophies.length}`, W - 100, 284, PAL.gold);
  },
  drawTeam(ctx) {
    menuBackground(ctx, this.t, this.accent());
    const h = callout(this.mode === 'cup' ? 'SPIRIT CUP - PICK TEAM' : 'CHOOSE YOUR TEAM', 2, this.mode === 'cup' ? 'fire' : 'chrome'); ctx.drawImage(h, (W - h.width) / 2, 4);
    const cw = 190, ch = 190, gap = 13, x0 = (W - (cw * 3 + gap * 2)) / 2;
    DATA.teams.teams.forEach((t, i) => {
      const x = x0 + i * (cw + gap), y = 30, you = i === this.pickTeam, them = this.mode === 'exhibition' && i === this.pickOpp;
      panel(ctx, x, y, cw, ch, you ? PAL.gold : them ? PAL.red : hex(t.colors.primary));
      if (this.showFocus && this.curFocus() === 'team.' + i) { ctx.strokeStyle = css(PAL.gold); ctx.strokeRect(x - 1.5, y - 1.5, cw + 3, ch + 3); }
      framedPortrait(ctx, portrait(starOf(t), t), x + (cw - 72) / 2, y + 6, starOf(t).lastName, hex(t.colors.primary));
      textC(ctx, t.city, x + cw / 2, y + 98, PAL.soft); textC(ctx, t.name, x + cw / 2, y + 108, PAL.white);
      const r = teamRatings(t); bar(ctx, 'OFF', r.off, x + 10, y + 124, cw - 20, hex('#FF9A3C')); bar(ctx, 'DEF', r.def, x + 10, y + 135, cw - 20, hex('#3FA7FF')); bar(ctx, 'SPD', r.spd, x + 10, y + 146, cw - 20, PAL.green);
      textC(ctx, BLURB[t.archetype], x + cw / 2, y + 162, PAL.dim, null);
      if (you || them) { const tag = callout(you ? 'YOU' : 'VS', 2, you ? 'chrome' : 'fire'); ctx.drawImage(tag, x + cw - tag.width, y - 6); }
      this.hit('team.' + i, x, y, cw, ch);
    });
    const y = 236, s = this.profile.settings;
    this.btn(ctx, 'back', 'BACK', 20, y, 80);
    this.btn(ctx, 'diff', 'LEVEL: ' + DIFF[s.difficulty].name, 110, y, 130);
    if (this.mode === 'exhibition') this.btn(ctx, 'opp', 'VS: ' + DATA.teams.teams[this.pickOpp].abbreviation + ' >', 250, y, 120);
    else { text(ctx, '3 ROUNDS. WIN THEM ALL.', 252, y + 4, PAL.soft, null); text(ctx, 'FINAL: YOUR SHADOW.', 252, y + 14, PAL.violet, null); }
    this.btn(ctx, 'play', this.mode === 'cup' ? 'START CUP' : 'KICK OFF!', W - 170, y, 150, 24, { primary: true });
    const gear = Object.values(this.profile.equipped).map((id) => GEAR.find((g) => g.id === id)?.name).filter(Boolean).join(', ');
    text(ctx, gear ? 'GEAR: ' + gear : 'NO GEAR EQUIPPED - VISIT THE SHOP', 20, 268, PAL.dim, null);
  },
  drawSettings(ctx) {
    menuBackground(ctx, this.t, this.accent());
    const h = callout('SETTINGS', 3, 'chrome'); ctx.drawImage(h, (W - h.width) / 2, 6);
    const pw = 380, px = (W - pw) / 2, py = 44, s = this.profile.settings; panel(ctx, px, py, pw, 196);
    const rows = [['music', 'MUSIC', '#' + s.music], ['sfx', 'SOUND FX', '#' + s.sfx], ['haptics', 'VIBRATION', s.haptics ? 'ON' : 'OFF'],
      ['difficulty', 'DIFFICULTY', DIFF[s.difficulty].name], ['qlen', 'QUARTER', s.qLen / 60 + ' MIN'], ['fit', 'SCREEN', s.fit === 'pixel' ? 'PIXEL PERFECT' : 'FILL SCREEN']];
    rows.forEach(([k, label, v], i) => { const y = py + 10 + i * 30;
      text(ctx, label, px + 16, y + 8, PAL.soft, null); this.btn(ctx, `set.${k}.-1`, '<', px + 160, y, 28); this.btn(ctx, `set.${k}.1`, '>', px + pw - 44, y, 28);
      const cx = px + 160 + 28 + 80;
      if (v[0] === '#') { const n = +v.slice(1); if (!n) textC(ctx, 'OFF', cx, y + 8, PAL.white); else for (let j = 0; j < 10; j++) rect(ctx, cx - 55 + j * 11, y + 18 - (4 + j), 8, 4 + j, j < n ? mix(PAL.green, PAL.gold, j / 12) : hex('#2C2F5E')); }
      else textC(ctx, v, cx, y + 8, PAL.white); });
    textC(ctx, s.fit === 'pixel' ? 'EXACT INTEGER PIXELS, THIN BORDERS' : 'FILLS THE SCREEN, SLIGHTLY UNEVEN PIXELS', W / 2, py + 186, PAL.dim, null);
    this.btn(ctx, 'back', 'BACK', (W - 120) / 2, 252, 120, 24, { primary: true });
  },
  drawShop(ctx) {
    const p = this.profile, leftW = 364;
    if (!this.shopRoom) this.shopRoom = buildShopRoom(leftW);
    ctx.drawImage(this.shopRoom, 0, 0);
    // trophies
    DATA.teams.teams.forEach((t, i) => { const n = p.trophies.filter((x) => x === t.id).length, x = 70 + i * 100, y = 36;
      drawTrophy(ctx, x, y, n ? hex(t.colors.primary) : null); if (n > 1) text(ctx, 'X' + n, x + 20, y + 12, PAL.gold);
      textC(ctx, t.abbreviation, x + 9, 66, hex('#F2E3C8'), null); });
    // pegboard: owned gear
    const owned = p.owned.map((id) => GEAR.find((g) => g.id === id)).filter(Boolean).sort((a, b) => b.tier - a.tier);
    owned.slice(0, 12).forEach((it, i) => { const x = leftW - 128 + (i % 4) * 28, y = 82 + ((i / 4) | 0) * 30; rect(ctx, x + 10, y - 3, 2, 4, hex('#3A2A1E')); ctx.drawImage(gearIcon(it), x, y); });
    if (!owned.length) textC(ctx, 'EMPTY', leftW - 74, 118, hex('#7A5A3A'), null);
    // shopkeeper Goro
    const mood = this.keeper.t < 2.5 ? this.keeper.mood : 'neutral';
    const goro = portrait({ id: 'goro77', number: 77, position: 'og' }, { id: 'shop', colors: { primary: '#8E2A2A', accent: '#F2E3C8' }, archetype: 'disciplined' }, mood, false, false);
    ctx.drawImage(goro, 0, 0, 64, 64, 104, H - 50 - 112, 128, 128);   // exact 2x: crisp pixels
    drawCounter(ctx, leftW);
    const lines = wrap(this.keeper.line, 104), bw = Math.max(...lines.map(textW)) + 12, bh = lines.length * 9 + 8, bxx = 12, byy = 120;
    rect(ctx, bxx, byy, bw, bh, PAL.outline); rect(ctx, bxx + 1, byy + 1, bw - 2, bh - 2, hex('#FFF6E0'));
    for (let k = 0; k < 5; k++) rect(ctx, bxx + bw - 1, byy + 6 + k, 6 - k, 1, hex('#FFF6E0'));
    lines.forEach((l, i) => text(ctx, l, bxx + 6, byy + 5 + i * 9, hex('#2A1A10'), null)); text(ctx, 'GORO', bxx + 2, byy + bh + 3, hex('#F2E3C8'));
    // right panel
    const rx = leftW + 2, rw = W - rx - 4; panel(ctx, rx, 4, rw, H - 8);
    const tw = (rw - 12) / 4;
    CATS.forEach((c, i) => { const x = rx + 6 + i * tw, sel = c === this.shopCat; this.hit('tab.' + c, x, 8, tw - 2, 16);
      rect(ctx, x, 8, tw - 2, 16, PAL.outline); rect(ctx, x + 1, 9, tw - 4, sel ? 15 : 14, sel ? hex('#2C2F5E') : hex('#14122C'));
      if (sel) rect(ctx, x + 1, 9, tw - 4, 1, PAL.gold); textC(ctx, c, x + (tw - 2) / 2, 13, sel ? PAL.gold : PAL.dim, null); });
    text(ctx, 'GEAR SHOP', rx + 8, 32, PAL.white);
    const coins = grouped(p.coins); panel(ctx, rx + rw - textW(coins) - 32, 28, textW(coins) + 26, 17, hex('#B9832A')); coinIcon(ctx, rx + rw - textW(coins) - 28, 32); text(ctx, coins, rx + rw - textW(coins) - 14, 33, PAL.gold);
    const it = GEAR.find((g) => g.id === this.shopSel);
    panel(ctx, rx + 8, 48, 52, 52, TIER_COL[it.tier - 1], hex('#0E0C22')); ctx.drawImage(gearIcon(it), rx + 12, 52, 44, 44);
    const ix = rx + 66; text(ctx, it.name, ix, 50, PAL.white); text(ctx, 'TIER ' + ['I', 'II', 'III', 'IV', 'V'][it.tier - 1] + (it.tier === 5 ? ' LEGENDARY' : ''), ix, 60, TIER_COL[it.tier - 1]);
    wrap(boostLine(it), rw - 74).slice(0, 2).forEach((l, j) => text(ctx, l, ix, 71 + j * 9, PAL.soft));
    const own = p.owned.includes(it.id), eq = p.equipped[it.category] === it.id;
    if (!own) { coinIcon(ctx, ix, 90); text(ctx, grouped(it.price), ix + 12, 91, p.coins >= it.price ? PAL.gold : PAL.red); } else text(ctx, eq ? 'EQUIPPED' : 'OWNED', ix, 91, eq ? PAL.green : PAL.soft);
    panel(ctx, rx + 6, 106, rw - 12, 40, hex('#2C2F5E'), hex('#100E26')); text(ctx, 'BEST FOR:', rx + 12, 111, PAL.gold, null);
    wrap(it.bestFor, rw - 26).slice(0, 3).forEach((l, j) => text(ctx, l, rx + 12, 121 + j * 8, PAL.white, null));
    this.btn(ctx, 'buy', eq ? 'UNEQUIP' : own ? 'EQUIP' : 'BUY', rx + rw - 106, 156, 100, 24, { primary: !eq && (own || p.coins >= it.price), disabled: !own && p.coins < it.price });
    const gx2 = rx + 8, gy2 = 152, cs = 27;
    CATS.forEach((c, r) => { if (c === this.shopCat) rect(ctx, gx2 - 3, gy2 + r * cs + 2, 2, cs - 4, PAL.gold);
      GEAR.filter((g) => g.category === c).sort((a, b) => a.tier - b.tier).forEach((g, col) => { const x = gx2 + col * cs, y = gy2 + r * cs, sel = g.id === this.shopSel;
        rect(ctx, x, y, cs - 2, cs - 2, sel ? PAL.gold : PAL.outline); rect(ctx, x + 1, y + 1, cs - 4, cs - 4, shade(TIER_COL[g.tier - 1], -0.85));
        ctx.globalAlpha = !p.owned.includes(g.id) && p.coins < g.price ? 0.45 : 1; ctx.drawImage(gearIcon(g), x + 2, y + 2); ctx.globalAlpha = 1;
        if (p.equipped[g.category] === g.id) { rect(ctx, x + cs - 9, y + cs - 10, 7, 8, PAL.green); text(ctx, 'E', x + cs - 8, y + cs - 10, PAL.ink, null); }
        else if (p.owned.includes(g.id)) rect(ctx, x + cs - 7, y + cs - 7, 3, 3, PAL.green);
        if (this.showFocus && this.curFocus() === 'item.' + g.id) { ctx.strokeStyle = css(PAL.white); ctx.strokeRect(x - 1.5, y - 1.5, cs + 1, cs + 1); }
        this.hit('item.' + g.id, x, y, cs - 2, cs - 2); }); });
    const lx = rx + rw - 106; text(ctx, 'LOADOUT', lx, 190, PAL.soft);
    CATS.forEach((c, i) => { const x = lx + (i % 2) * 26, y = 200 + ((i / 2) | 0) * 26; rect(ctx, x, y, 24, 24, PAL.outline); rect(ctx, x + 1, y + 1, 22, 22, hex('#100E26'));
      const id = p.equipped[c]; if (id) ctx.drawImage(gearIcon(GEAR.find((g) => g.id === id)), x + 1, y + 1); });
    const bonus = Object.values(p.equipped).reduce((a, id) => a + (GEAR.find((g) => g.id === id)?.spiritCharge || 0), 0);
    if (bonus) { text(ctx, 'SPIRIT', lx + 56, 208, PAL.violet); text(ctx, '+' + Math.round(bonus * 100) + '%', lx + 56, 218, PAL.violet); }
    this.btn(ctx, 'back', 'BACK', lx, 258, 100);
  },
  drawCup(ctx) {
    menuBackground(ctx, this.t, this.accent());
    const h = callout('SPIRIT CUP', 3, 'fire'); ctx.drawImage(h, (W - h.width) / 2, 4);
    const run = this.profile.cup; if (!run) { this.btn(ctx, 'back', 'BACK', 20, 256, 90); return; }
    const me = teamById(run.teamId), pw = 176, gap = 26, x0 = (W - (pw * 3 + gap * 2)) / 2, y = 46;
    for (let i = 0; i < 3; i++) { const x = x0 + i * (pw + gap), opp = teamById(run.opponents[i]), shadow = run.opponents[i].startsWith('shadow_'), done = i < run.round, cur = i === run.round;
      panel(ctx, x, y, pw, 180, cur ? PAL.gold : done ? PAL.green : PAL.edge);
      textC(ctx, CUP_ROUNDS[i], x + pw / 2, y + 6, cur ? PAL.gold : PAL.soft);
      const star = starOf(shadow ? me : opp); framedPortrait(ctx, portrait(star, shadow ? me : opp, shadow ? 'confident' : 'neutral', shadow), x + (pw - 72) / 2, y + 18, star.lastName, hex(opp.colors.primary));
      if (!done && !cur) { ctx.fillStyle = 'rgba(14,11,28,0.6)'; ctx.fillRect(x + 4, y + 18, pw - 8, 86); if (!shadow) { const q = callout('?', 4, 'chrome'); ctx.drawImage(q, x + (pw - q.width) / 2, y + 44); } }
      textC(ctx, shadow ? 'SHADOW ' + me.abbreviation : (opp.city + ' ' + opp.name).slice(0, 27), x + pw / 2, y + 112, PAL.white);
      textC(ctx, done ? run.results[i] || 'CLEARED' : cur ? 'NEXT MATCH' : 'LOCKED', x + pw / 2, y + 126, done ? PAL.green : cur ? PAL.gold : PAL.dim);
      if (shadow) textC(ctx, 'RATINGS +4', x + pw / 2, y + 140, PAL.violet);
      if (i < 2) { rect(ctx, x + pw + 4, y + 90, gap - 10, 3, done ? PAL.green : PAL.dim); for (let k = 0; k < 4; k++) rect(ctx, x + pw + gap - 6 + k, y + 87 + k, 1, 9 - 2 * k, done ? PAL.green : PAL.dim); } }
    textC(ctx, `PLAYING AS ${me.city} ${me.name}   WIN BONUS +500 + TROPHY`, W / 2, 236, PAL.soft);
    this.btn(ctx, 'back', 'BACK', 20, 252, 90); this.btn(ctx, 'cup.forfeit', 'FORFEIT', 120, 252, 90, 24, { danger: true });
    this.btn(ctx, 'cup.play', 'PLAY ' + CUP_ROUNDS[run.round], W - 220, 252, 200, 24, { primary: true });
  },
  drawPost(ctx) {
    menuBackground(ctx, this.t, this.accent());
    const { r, before, cup } = this.post, p = this.profile;
    const hd = callout(r.won ? 'VICTORY!' : r.tie ? 'TIE GAME' : 'DEFEAT', 4, r.won ? 'rainbow' : 'chrome'); ctx.drawImage(hd, (W - hd.width) / 2, 4);
    textC(ctx, `${r.abbr[0]} ${r.score[0]}  -  ${r.score[1]} ${r.abbr[1]}`, W / 2, 46, PAL.white);
    panel(ctx, 30, 62, 96, 96, r.won ? PAL.gold : PAL.edge); text(ctx, 'GRADE', 63, 68, PAL.soft);
    const g = callout(r.grade, 8, r.grade === 'S' ? 'rainbow' : r.grade === 'A' ? 'fire' : 'chrome'); ctx.drawImage(g, 78 - g.width / 2, 80);
    panel(ctx, 136, 62, 330, 130);
    text(ctx, r.mvp ? `MVP  ${r.mvp[0]}  ${Math.round(r.mvp[1].yds)} YDS ${r.mvp[1].td} TD ${r.mvp[1].tkl} TKL` : 'MVP  TEAM EFFORT', 144, 68, PAL.gold);
    text(ctx, `PASS ${Math.round(r.st.passYds)} YDS   RUSH ${Math.round(r.st.rushYds)} YDS`, 144, 80, PAL.white);
    text(ctx, `TAKEAWAYS ${r.st.takeaways}   SACKS ${r.st.sacks}   BIG HITS ${r.st.bigHits}`, 144, 90, PAL.white);
    text(ctx, 'TRIALS', 144, 106, PAL.soft);
    r.trials.forEach((t, i) => { text(ctx, t.passed ? '+' : '-', 144, 117 + i * 10, t.passed ? PAL.green : PAL.red); text(ctx, t.text, 152, 117 + i * 10, t.passed ? PAL.white : PAL.dim); if (t.passed) text(ctx, '+' + t.reward, 432, 117 + i * 10, PAL.gold); });
    if (cup) { const [k, n] = cup; text(ctx, k === 'next' ? 'CUP: ADVANCED TO ' + CUP_ROUNDS[n] + '!' : k === 'champ' ? 'SPIRIT CUP CHAMPIONS! +500 + TROPHY' : 'CUP: ELIMINATED IN ' + CUP_ROUNDS[n], 144, 160, k === 'out' ? PAL.red : k === 'champ' ? PAL.gold : PAL.green); }
    const earned = p.coins - before, shown = before + Math.round(earned * clamp(this.st / 1.5, 0, 1));
    panel(ctx, 476, 62, textW(grouped(shown)) + 26, 17, hex('#B9832A')); coinIcon(ctx, 480, 66); text(ctx, grouped(shown), 493, 67, PAL.gold); text(ctx, '+' + earned, 476 + textW(grouped(shown)) + 32, 67, PAL.gold);
    const next = GEAR.filter((g) => !p.owned.includes(g.id)).sort((a, b) => a.price - b.price)[0];
    if (next) { panel(ctx, 476, 88, 150, 100, TIER_COL[next.tier - 1]); text(ctx, p.coins >= next.price ? 'YOU CAN AFFORD:' : 'NEXT UNLOCK:', 484, 94, PAL.soft);
      ctx.drawImage(gearIcon(next), 484, 106, 44, 44); text(ctx, next.name, 484, 156, PAL.white); const need = next.price - p.coins;
      text(ctx, need <= 0 ? 'VISIT THE SHOP!' : need + ' MORE COINS', 484, 168, need <= 0 ? PAL.green : PAL.gold); }
    this.btn(ctx, 'post.shop', 'GEAR SHOP', 30, 250, 140);
    this.btn(ctx, 'post.again', this.mode === 'cup' ? (p.cup ? 'BRACKET' : 'MENU') : 'REMATCH', 250, 250, 140, 24, { primary: true });
    this.btn(ctx, 'post.menu', 'MAIN MENU', 470, 250, 140);
  },
});

// --- shop art --------------------------------------------------------------
function buildShopRoom(w) {
  const c = makeCanvas(w, H), x = c.x, woods = ['#8A5A34', '#7E5230', '#94643A', '#845632'].map(hex), r = RNG(5409);
  for (let px = 0; px < w; px += 22) { const col = woods[r.int(4)];
    for (let y = 0; y < H; y++) { rect(x, px, y, 22, 1, col); if (((Math.sin(y * 0.21 + px) * 3) | 0) % 7 === 0) rect(x, px + ((y * 7 + px) % 20), y, 2, 1, shade(col, -0.25)); }
    rect(x, px, 0, 1, H, shade(col, -0.8)); rect(x, px + 1, 0, 1, H, shade(col, 0.3)); }
  const g = x.createRadialGradient(w / 2, 0, 20, w / 2, 0, w * 0.9); g.addColorStop(0, 'rgba(255,220,150,0.18)'); g.addColorStop(1, 'rgba(20,10,30,0.45)'); x.fillStyle = g; x.fillRect(0, 0, w, H);
  rect(x, 16, 58, w - 32, 5, hex('#5A3A22')); rect(x, 16, 58, w - 32, 1, hex('#B07A4A')); rect(x, 16, 63, w - 32, 2, hex('#2A1A10'));
  textC(x, 'SPIRIT CUP', w / 2, 6, hex('#F2E3C8'), hex('#2A1A10'));
  const pbx = w - 132; rect(x, pbx - 2, 74, 120, 96, hex('#3A2A1E')); rect(x, pbx, 76, 116, 92, hex('#C89A64'));
  for (let yy = 80; yy < 168; yy += 8) for (let xx = pbx + 4; xx < pbx + 116; xx += 8) rect(x, xx, yy, 1, 1, hex('#7A5A3A'));
  for (let i = 0; i < 30; i++) rect(x, 22 + i, 80 + i / 5, 1, Math.max(1, 14 - i * 14 / 30), hex('#E0402A')); rect(x, 22, 80, 2, 16, hex('#3A2A1E')); text(x, 'GO!', 28, 83, PAL.white, null);
  rect(x, 64, 78, 52, 40, hex('#3A2A1E')); rect(x, 67, 81, 46, 34, PAL.sky2); rect(x, 67, 103, 46, 12, PAL.turfA); ellipse(x, 90, 96, 5, 3, hex('#8A4A24'));
  return c;
}
function drawCounter(ctx, w) { const cy = H - 50; rect(ctx, 0, cy, w, 6, hex('#B07A4A')); rect(ctx, 0, cy, w, 1, hex('#E0B07A')); rect(ctx, 0, cy + 6, w, H - cy - 6, hex('#5A3A22'));
  for (let px = 8; px < w; px += 48) { rect(ctx, px, cy + 12, 36, 30, hex('#4A2E1A')); rect(ctx, px, cy + 12, 36, 1, hex('#7A5232')); } }
function drawTrophy(ctx, x, y, col) {
  const g = col ? hex('#FFC83C') : hex('#4A3A30'), d = col ? hex('#B9832A') : hex('#3A2C24');
  ellipse(ctx, x + 9, y + 5, 6.5, 5, g); rect(ctx, x + 2, y + 1, 14, 4, g); ellipse(ctx, x + 2, y + 5, 1.5, 2.5, d); ellipse(ctx, x + 16, y + 5, 1.5, 2.5, d);
  rect(ctx, x + 7, y + 10, 4, 5, d); rect(ctx, x + 4, y + 15, 10, 3, g); rect(ctx, x + 3, y + 18, 12, 3, col || hex('#4A3A30'));
  if (col) rect(ctx, x + 4, y + 2, 2, 5, hex('#FFF6C0')); else text(ctx, '?', x + 6, y + 3, hex('#6A5444'), null);
}
const iconCache = new Map();
function gearIcon(it) {
  let c = iconCache.get(it.id); if (c) return c; c = makeCanvas(22, 22); const x = c.x;
  const base = TIER_COL[it.tier - 1], trim = shade(base, -0.6), hi = shade(base, 0.6), lo = shade(base, -0.5);
  if (it.category === 'cleats') { ellipse(x, 13, 12, 7.5, 4.5, base); rect(x, 4, 6, 7, 9, base); rect(x, 4, 5, 7, 2, trim); rect(x, 4, 15, 17, 2, lo); for (const s of [5, 9, 14, 18]) rect(x, s, 17, 2, 2, hex('#E8E8F0')); rect(x, 9, 9, 8, 1, trim); }
  else if (it.category === 'gloves') { rect(x, 6, 9, 10, 9, base); [7, 8, 8, 6].forEach((hh, i) => rect(x, 6 + i * 2 + (i > 0 ? i >> 1 : 0), 10 - hh, 2, hh, base)); rect(x, 15, 10, 3, 5, base); rect(x, 6, 17, 10, 3, trim); rect(x, 8, 12, 5, 3, hi); }
  else if (it.category === 'helmets') { ellipse(x, 10, 10, 8.5, 8, base); rect(x, 2, 10, 6, 7, base); x.clearRect(14, 12, 8, 8); rect(x, 8, 11, 3, 3, lo); const m = hex('#E8E8F0');
    rect(x, 14, 12, 7, 1, m); rect(x, 14, 15, 7, 1, m); rect(x, 20, 12, 1, 6, m); rect(x, 13, 17, 8, 1, m); rect(x, 6, 3, 3, 1, hi); }
  else { rect(x, 6, 10, 10, 2, hex('#E8E8F0')); for (const xx of [2, 16]) { rect(x, xx, 5, 4, 12, base); rect(x, xx + 1, 6, 1, 10, hi); } rect(x, 0, 8, 2, 6, trim); rect(x, 20, 8, 2, 6, trim); }
  outline(c, PAL.outline); if (it.tier === 5) for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) rect(x, 19 + dx, 2 + dy, 1, 1, PAL.white);
  iconCache.set(it.id, c); return c;
}
