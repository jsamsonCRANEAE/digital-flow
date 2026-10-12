// ---------------------------------------------------------------------------
// In-game HUD and overlays.
// ---------------------------------------------------------------------------
const CAT_LABEL = { run: 'RUN', shortPass: 'SHORT PASS', deepPass: 'DEEP PASS', zone: 'ZONE', man: 'MAN', pressure: 'PRESSURE', kick: 'SPECIAL TEAMS' };
const ordinal = (n) => ['1ST', '2ND', '3RD', '4TH'][n - 1] || n + 'TH';
function fieldPos(on) { const v = Math.round(on); return v === 50 ? 'MIDFIELD' : v < 50 ? 'OWN ' + v : 'OPP ' + (100 - v); }
function clockStr(s) { s = Math.ceil(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

const BTN_COL = { A: hex('#3FCF6A'), B: hex('#E0402A'), X: hex('#3F8CFF'), Y: hex('#FFC83C') };
function roundButton(ctx, cx, cy, r, label, col, enabled, pressed, glyph) {
  const base = enabled ? col : hex('#6A6E80'), dy = pressed ? 1 : 0;
  ellipse(ctx, cx, cy + 2, r, r, PAL.ink); ellipse(ctx, cx, cy + dy, r, r, PAL.outline);
  ellipse(ctx, cx, cy + dy, r - 1, r - 1, shade(base, -0.5)); ellipse(ctx, cx - 0.5, cy + dy - 0.8, r - 2, r - 2.2, pressed ? shade(base, -0.3) : base);
  ellipse(ctx, cx - r * 0.3, cy + dy - r * 0.45, r * 0.35, r * 0.18, shade(base, 0.55));
  textC(ctx, label, cx + 1, cy + dy - 3, enabled ? PAL.white : hex('#B0B4C4'), shade(base, -0.8));
  if (glyph) glyphBadge(ctx, cx - r - 2, cy - r - 2, glyph);
}

function drawCard(ctx, play, x, y, accent, glyph, offense) {
  const w = 150, h = 118;
  rect(ctx, x, y, w, h, PAL.outline); rect(ctx, x + 1, y + 1, w - 2, h - 2, hex('#F2E3C8')); rect(ctx, x + 3, y + 3, w - 6, 14, accent);
  text(ctx, CAT_LABEL[play.category] || '', x + 7, y + 7, PAL.white, shade(accent, -0.6));
  const fx = x + 6, fy = y + 20, fw = w - 12, fh = 70; rect(ctx, fx, fy, fw, fh, hex('#2E7D3A'));
  for (let i = 0; i < fh; i += 2) if ((i / 2) % 2 === 0) rect(ctx, fx, fy + i, fw, 1, hex('#2B7536'));
  const losY = fy + fh - 16; for (let xx = fx; xx < fx + fw; xx += 3) rect(ctx, xx, losY, 2, 1, PAL.white);
  const sx = (v) => fx + fw / 2 + v * (fw / 34), sy = (v) => losY - v * (fh - 20) / 22;
  if (play.kind === 'kick') { textC(ctx, play.id === 'punt' ? 'BOOT IT AWAY' : 'SPLIT THE POSTS', fx + fw / 2, fy + 30, PAL.white, PAL.ink); }
  else if (offense) {
    const path = (pts, ox, oy, col) => { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(sx(ox), sy(oy)); for (const [a, b] of pts) ctx.lineTo(sx(ox + a), sy(oy + b)); ctx.stroke(); };
    for (const [slot, r] of Object.entries(play.routes || {})) { const f = play.formation[slot]; path(r.points.map(([a, b]) => [a, Math.min(b, 20)]), f[0], f[1], slot === play.progression[0] ? '#FFE45C' : '#FFFFFF'); }
    if (play.runPath) path(play.runPath.points.map(([a, b]) => [a - play.formation.RB[0], Math.min(b, 20) - play.formation.RB[1]]), play.formation.RB[0], play.formation.RB[1], '#FFE45C');
    for (const [, [a, b]] of Object.entries(play.formation)) { rect(ctx, sx(a) - 1, sy(b) - 1, 3, 3, PAL.white); }
  } else {
    for (const [slot, [a, b]] of Object.entries(play.formation)) { const as = play.assignments[slot] || {};
      if (as.role === 'zone' && as.zone) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(sx(as.zone[0]), sy(as.zone[1]), 8, 5, 0, 0, TAU); ctx.stroke(); }
      if (as.role === 'rush') { ctx.strokeStyle = '#FF5A3C'; ctx.beginPath(); ctx.moveTo(sx(a), sy(b)); ctx.lineTo(sx(a * 0.3), sy(-4)); ctx.stroke(); }
      rect(ctx, sx(a) - 1, sy(b) - 1, 3, 3, hex('#FF5A3C')); }
  }
  rect(ctx, x + 3, y + h - 24, w - 6, 20, hex('#23213F')); textC(ctx, play.name, x + w / 2, y + h - 18, PAL.white, null);
  if (glyph) glyphBadge(ctx, x - 5, y - 5, glyph);
}

Object.assign(App, {
  drawGame(ctx) {
    const m = this.match; if (!m) return;
    m.draw(ctx, this.field, this);
    if (m.fx.impact) { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; m.fx.impact = false; }
    const s = m.state, top = 3, left = 6;
    const pd = this.screen === 'pause';
    // scorebug
    const a = m.teams.map((t) => t.abbreviation), per = s.ot ? 'OT' : `Q${s.quarter} ${clockStr(s.clock)}`;
    const line = `${s.poss === 0 ? '>' : ' '}${a[0]} ${String(s.score[0]).padStart(2)}  ${per}  ${String(s.score[1]).padStart(2)} ${a[1]}${s.poss === 1 ? '<' : ' '}`;
    const bw = textW(line) + 10, bx = (W - bw) >> 1; panel(ctx, bx, top, bw, 14, hex(m.teams[0].colors.primary)); text(ctx, line, bx + 5, top + 4, PAL.white, null);
    [0, 1].forEach((t) => { const v = m.spiritMeter[t], x = bx + (t ? bw / 2 + 2 : 0), w = bw / 2 - 2, full = v >= 1 && ((this.t * 6) | 0) % 2 === 0;
      rect(ctx, x, top + 16, w, 9, PAL.outline); rect(ctx, x + 1, top + 17, (w - 2) * v, 7, full ? PAL.gold : hex(m.teams[t].colors.primary)); textC(ctx, 'SPIRIT', x + w / 2, top + 18, v > 0.5 ? PAL.ink : PAL.white, null); });
    // down & distance
    const goal = s.ballOn + s.toGo >= 100, dd = s.ot && m.phase === 'call' ? 'OVERTIME' : `${ordinal(s.down)} & ${goal ? 'GOAL' : Math.max(1, Math.round(s.toGo))}`;
    panel(ctx, left, top, 76, 22); text(ctx, dd, left + 5, top + 4, PAL.white, null); text(ctx, fieldPos(s.ballOn), left + 5, top + 13, PAL.soft, null);
    if (!pd && !m.report) this.btn(ctx, 'pause', 'II', left + 80, top, 20, 16);
    // play call
    if (m.phase === 'call' && m.human != null && !pd) {
      const off = m.offIsHuman, hdr = `${off ? 'OFFENSE' : 'DEFENSE'}  ${dd}  ${fieldPos(s.ballOn)}`;
      panel(ctx, (W - textW(hdr) - 12) / 2, 70, textW(hdr) + 12, 16, hex(m.teams[m.human].colors.primary)); textC(ctx, hdr, W / 2, 75, PAL.white, null);
      const pages = m.cardsFor(), ids = pages[m.page];
      ids.forEach((id, i) => { const pl = id === 'punt' ? { id, kind: 'kick', category: 'kick', name: 'PUNT' } : id === 'field_goal' ? { id, kind: 'kick', category: 'kick', name: `FIELD GOAL ${Math.round(100 - s.ballOn + 17)}` } : m.plays(id);
        const x = 81 + i * 164, y = 92; drawCard(ctx, pl, x, y, hex(m.teams[m.human].colors.primary), Input.glyph(['X', 'A', 'B'][i]), off); this.hit('card.' + i, x, y, 150, 118); });
      if (pages.length > 1) { const l = Input.glyph('LB') ? Input.glyph('LB')[0] + ' <' : '<', r = Input.glyph('RB') ? '> ' + Input.glyph('RB')[0] : '>';
        this.btn(ctx, 'page.prev', l, W / 2 - 96, 216, 40, 18); textC(ctx, `${m.page + 1}/${pages.length}  SWIPE`, W / 2, 221, PAL.white); this.btn(ctx, 'page.next', r, W / 2 + 56, 216, 40, 18); }
    }
    // context buttons (diamond: A bottom, B right, X left, Y top)
    const pl = m.play, ctxB = [];
    if (m.human != null && !pd && !m.report) {
      if (m.phase === 'pre' && m.offIsHuman) ctxB.push(['A', 'SNAP', 'snap', true], ['Y', 'SPRT', 'spirit', m.canSpirit(m.human)]);
      else if (m.phase === 'pre') ctxB.push(['Y', 'SPRT', 'spirit', m.canSpirit(m.human)], ['B', 'SWTCH', 'switch', true]);
      else if (m.phase === 'live' && pl && pl.ballCarrier && pl.ballCarrier === pl.controlled && !pl.canThrow)
        ctxB.push(['X', 'JUKE', 'juke', true], ['B', 'SPIN', 'spin', true], ['Y', 'STIFF', 'stiff', true], ['A', 'DIVE', 'dive', true]);
      else if (m.phase === 'live' && pl && pl.humanSide === 'def') ctxB.push(['A', 'DIVE', 'dive', true], ['B', 'SWTCH', 'switch', true]);
    }
    const cx = W - 58, cy = H - 56, o = 30, pos = { A: [0, o * 0.75], B: [o, 0], X: [-o, 0], Y: [0, -o * 0.75] };
    for (const [b, label, act, en] of ctxB) { const [dx, dy] = pos[b], x = cx + dx, y = cy + dy;
      if (en) this.hit('act.' + act, x - 17, y - 17, 34, 34);
      roundButton(ctx, x, y, 16, label, BTN_COL[b], en, this.pressed === 'act.' + act, Input.glyph(b)); }
    // receiver icons
    if (pl && pl.canThrow && pl.humanSide === 'off' && m.phase === 'live' && !pd) {
      this.receivers().forEach((r, i) => { if (!r.screen) return; const g = Input.glyph(['A', 'B', 'X'][i]), x = r.screen.x, y = r.screen.y - 12;
        const charging = (this.charge && this.charge.recv === i) || (this.padCharge && this.padCharge.i === i), col = g ? hex(g[1]) : [hex('#FFD23F'), hex('#3FD8FF'), hex('#FF5AB4')][i];
        if (charging) ellipse(ctx, x, y, 9, 9, PAL.white); ellipse(ctx, x, y, 7, 7, PAL.outline); ellipse(ctx, x, y, 6, 6, col);
        if (g && ['cross', 'circle', 'square', 'triangle'].includes(g[0])) glyphBadge(ctx, x - 6.5, y - 6.5, [g[0], '#16102A']); else textC(ctx, g ? g[0] : String(i + 1), x + 1, y - 3, PAL.outline, null);
        this.hit('recv.' + i, x - 15, y - 15, 30, 30); });
      if (this.st < 30 && pl.time < 2.5) textC(ctx, Input.device === 'touch' ? 'TAP A RECEIVER - HOLD TO LOB' : 'PRESS A RECEIVER BUTTON - HOLD TO LOB', W / 2, H - 14, PAL.white);
    }
    // joystick
    if (Input.joy) { const j = Input.joy; ctx.globalAlpha = 0.5; ellipse(ctx, j.bx, j.by, 22, 22, hex('#1A1838')); ctx.globalAlpha = 0.85; ellipse(ctx, j.kx, j.ky, 9, 9, hex('#C8CCD8')); ctx.globalAlpha = 1; }
    else if (m.phase === 'live' && m.human != null && this.st < 20 && Input.device === 'touch' && !pd) textC(ctx, 'DRAG LEFT SIDE TO RUN', 110, H - 14, PAL.dim, null);
    // kick meter
    if (m.phase === 'kick') { const k = m.kick, dist = Math.round(100 - s.ballOn + 17), bw2 = 180, bx2 = (W - bw2) / 2, by2 = H - 60;
      const title = k.kind === 'punt' ? 'PUNT' : `FIELD GOAL  ${dist} YDS`; const c = callout(title, 2, 'chrome'); ctx.drawImage(c, (W - c.width) / 2, 100);
      if (k.human) { panel(ctx, bx2 - 4, by2 - 4, bw2 + 8, 22); const zone = clamp(0.32 - (dist - 20) * 0.0055, 0.08, 0.3);
        rect(ctx, bx2, by2, bw2, 14, hex('#3A1E2A')); rect(ctx, bx2 + bw2 / 2 - zone * bw2 / 2, by2, zone * bw2, 14, PAL.green);
        const nv = k.stopped != null ? k.stopped : m.kickNeedle(); rect(ctx, bx2 + bw2 / 2 + nv * bw2 / 2 - 1, by2 - 3, 3, 20, PAL.white);
        textC(ctx, k.stopped != null ? (Math.abs(k.stopped) < zone ? 'GOOD CONTACT!' : 'SHANKED IT...') : (Input.glyph('A') ? 'PRESS ' + Input.glyph('A')[0] : 'TAP') + ' IN THE GREEN!', W / 2, by2 + 24, PAL.white);
        this.hit('act.kick', 0, 40, W, H - 40); } }
    // Spirit cut-in
    if (m.phase === 'cutin' && m.cutin) this.drawCutin(ctx, m);
    // callout
    const f = m.fx.callout;
    if (f && !(m.phase === 'cutin')) { const life = f.life, age = f.age; if (!(age > life - 0.18 && ((age * 30) | 0) % 2 === 0)) {
      const base = f.big >= 3 ? 4 : 3, k = age < 0.05 ? Math.max(1, base - 2) : age < 0.12 ? base + 1 : base; const c = callout(f.t, k, f.style); ctx.drawImage(c, (W - c.width) >> 1, 52); } }
    if (m.banner) { const c = callout(m.banner, 5, m.banner === 'FINAL' ? 'fire' : 'chrome'); ctx.drawImage(c, (W - c.width) >> 1, 100); }
    // final
    if (m.report) { m.finalT = (m.finalT || 0) + 1 / 60; ctx.fillStyle = 'rgba(14,11,28,0.55)'; ctx.fillRect(0, 0, W, H);
      const c = callout(m.report.won ? 'VICTORY!' : m.report.tie ? 'TIE GAME' : 'DEFEAT', 4, m.report.won ? 'rainbow' : 'chrome'); ctx.drawImage(c, (W - c.width) >> 1, 80);
      textC(ctx, `${m.report.abbr[0]} ${m.report.score[0]}  -  ${m.report.score[1]} ${m.report.abbr[1]}`, W / 2, 140, PAL.white, PAL.ink, 2);
      if (m.finalT > 2) this.btn(ctx, 'continue', 'CONTINUE', (W - 140) / 2, 230, 140, 24, { primary: true }); }
    if (pd) { ctx.fillStyle = 'rgba(14,11,28,0.6)'; ctx.fillRect(0, 0, W, H);
      const pw = 220, px = (W - pw) / 2, py = 66; panel(ctx, px, py, pw, 150); const c = callout('PAUSED', 3, 'chrome'); ctx.drawImage(c, (W - c.width) / 2, py + 8);
      this.btn(ctx, 'resume', 'RESUME', px + 30, py + 48, pw - 60, 24, { primary: true }); this.btn(ctx, 'pause.settings', 'SETTINGS', px + 30, py + 80, pw - 60);
      this.btn(ctx, 'quit', 'QUIT TO MENU', px + 30, py + 112, pw - 60, 24, { danger: true }); }
  },
  drawCutin(ctx, m) {
    const c = m.cutin, t = m.timer, team = m.teams[c.team], J = hex(team.colors.primary), A = hex(team.colors.accent);
    ctx.fillStyle = 'rgba(14,11,28,0.55)'; ctx.fillRect(0, 0, W, H);
    const slide = Math.min(1, t / 0.18), y0 = 70, bh = 120;
    ctx.save(); ctx.beginPath(); ctx.moveTo(-40 + (1 - slide) * -600, y0 + 20); ctx.lineTo(W + 40, y0 - 10); ctx.lineTo(W + 40, y0 + bh - 10); ctx.lineTo(-40 + (1 - slide) * -600, y0 + bh + 20); ctx.closePath(); ctx.clip();
    rect(ctx, 0, 0, W, H, J);
    ctx.fillStyle = css(A, 0.35); for (let i = 0; i < 18; i++) { const yy = y0 + ((i * 37 + (t * 300 | 0)) % bh); ctx.fillRect(((i * 97) % W), yy, 60 + (i * 13) % 80, 2); }
    ctx.fillStyle = css(shade(J, -0.5), 0.6); for (let i = 0; i < 5; i++) ctx.fillRect(380 + i * 46, y0 - 10, 18, bh + 40);
    ctx.restore();
    const p = portrait(c.player, team, 'confident'); ctx.drawImage(p, 40 + (1 - slide) * -200, y0 - 4, 128, 128);
    const nm = callout(c.sp.name, 3, 'fire'); ctx.drawImage(nm, Math.min(190, 190 + (1 - slide) * 400), y0 + 22);
    text(ctx, c.player.lastName + '  #' + c.player.number, 194, y0 + 64, PAL.white, PAL.ink);
    wrap(c.sp.flavor, 380).forEach((l, i) => text(ctx, l, 194, y0 + 78 + i * 10, A, PAL.ink));
    if (t > 1.45) { ctx.fillStyle = `rgba(255,255,255,${(t - 1.45) / 0.15})`; ctx.fillRect(0, 0, W, H); }
  },
});
