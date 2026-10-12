// ---------------------------------------------------------------------------
// Input: touch (floating joystick + on-screen buttons), keyboard and
// Bluetooth controllers via the Gamepad API (standard mapping). Every device
// produces the same abstract buttons: A B X Y LB RB MENU and a move vector.
// Buttons are mapped by position, so muscle memory carries across brands.
// ---------------------------------------------------------------------------
const PAD_GLYPHS = {
  xbox: { A: ['A', '#3FCF6A'], B: ['B', '#E0402A'], X: ['X', '#3F8CFF'], Y: ['Y', '#FFC83C'], LB: ['LB', '#C8CCD8'], RB: ['RB', '#C8CCD8'] },
  playstation: { A: ['cross', '#8FB4FF'], B: ['circle', '#FF6A6A'], X: ['square', '#F28AD8'], Y: ['triangle', '#4FD8A8'], LB: ['L1', '#C8CCD8'], RB: ['R1', '#C8CCD8'] },
  nintendo: { A: ['B', '#E8E8F0'], B: ['A', '#E8E8F0'], X: ['Y', '#E8E8F0'], Y: ['X', '#E8E8F0'], LB: ['L', '#C8CCD8'], RB: ['R', '#C8CCD8'] },
};
const KEY_GLYPHS = { A: ['SPC', '#C8CCD8'], B: ['K', '#C8CCD8'], X: ['J', '#C8CCD8'], Y: ['L', '#C8CCD8'], LB: ['Q', '#C8CCD8'], RB: ['E', '#C8CCD8'] };

const Input = {
  move: { x: 0, y: 0 }, keyMove: { x: 0, y: 0 }, padMove: { x: 0, y: 0 },
  joy: null, held: new Set(), pressed: [], released: [], device: 'touch', padStyle: 'xbox', padOK: true,
  prevPad: new Set(), keysDown: new Set(),
  glyph(btn) { if (this.device === 'pad') return PAD_GLYPHS[this.padStyle][btn]; if (this.device === 'keys') return KEY_GLYPHS[btn]; return null; },
  press(b) { this.pressed.push(b); this.held.add(b); }, release(b) { this.released.push(b); this.held.delete(b); },
  frame() { // call once per frame, before the app reads input
    this.pressed.length = 0; this.released.length = 0;
    // keyboard edges were queued by listeners into kq
    for (const [t, b] of this.kq) t ? this.press(b) : this.release(b); this.kq.length = 0;
    this.pollPad();
    const k = this.keyMove, p = this.padMove, j = this.joy ? this.joyValue() : { x: 0, y: 0 };
    this.move = Math.hypot(p.x, p.y) > 0 ? p : Math.hypot(k.x, k.y) > 0 ? k : j;
  },
  kq: [],
  joyValue() { const j = this.joy, dx = j.kx - j.bx, dy = j.ky - j.by, m = Math.min(1, Math.hypot(dx, dy) / 22);
    if (m < 0.14) return { x: 0, y: 0 }; const s = (m - 0.14) / 0.86, d = Math.hypot(dx, dy); return { x: dx / d * s, y: -dy / d * s }; },
  pollPad() {
    let gps = []; try { gps = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch (e) { this.padOK = false; return; }
    const g = gps.find((x) => x && x.connected); const now = new Set();
    if (!g) { this.padMove = { x: 0, y: 0 }; for (const b of this.prevPad) this.release(b); this.prevPad = now; return; }
    const id = g.id.toLowerCase();
    this.padStyle = /054c|dualshock|dualsense|playstation|wireless controller/.test(id) ? 'playstation' : /057e|nintendo|pro controller|joy-con/.test(id) ? 'nintendo' : 'xbox';
    const bt = (i) => g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > 0.5);
    const map = [[0, 'A'], [1, 'B'], [2, 'X'], [3, 'Y'], [4, 'LB'], [5, 'RB'], [6, 'LT'], [7, 'RT'], [9, 'MENU'], [8, 'MENU'], [12, 'UP'], [13, 'DOWN'], [14, 'LEFT'], [15, 'RIGHT']];
    for (const [i, n] of map) if (bt(i)) now.add(n);
    let sx = g.axes[0] || 0, sy = -(g.axes[1] || 0);
    let dx = (now.has('RIGHT') ? 1 : 0) - (now.has('LEFT') ? 1 : 0), dy = (now.has('UP') ? 1 : 0) - (now.has('DOWN') ? 1 : 0);
    let mv;
    if (dx || dy) { const l = Math.hypot(dx, dy); mv = { x: dx / l, y: dy / l }; }
    else { const m = Math.min(1, Math.hypot(sx, sy)); mv = m > 0.18 ? { x: sx / Math.hypot(sx, sy) * (m - 0.18) / 0.82, y: sy / Math.hypot(sx, sy) * (m - 0.18) / 0.82 } : { x: 0, y: 0 }; }
    // stick flicks count as directional presses for menus
    if (mv.x > 0.6) now.add('SRIGHT'); if (mv.x < -0.6) now.add('SLEFT'); if (mv.y > 0.6) now.add('SUP'); if (mv.y < -0.6) now.add('SDOWN');
    this.padMove = mv;
    for (const b of now) if (!this.prevPad.has(b)) { this.press(b); this.device = 'pad'; }
    for (const b of this.prevPad) if (!now.has(b)) this.release(b);
    if (Math.hypot(mv.x, mv.y) > 0.3) this.device = 'pad';
    this.prevPad = now;
  },
  dirPressed() { // menu directions from d-pad, stick flicks or arrow keys
    const p = this.pressed;
    if (p.includes('UP') || p.includes('SUP')) return [0, -1]; if (p.includes('DOWN') || p.includes('SDOWN')) return [0, 1];
    if (p.includes('LEFT') || p.includes('SLEFT')) return [-1, 0]; if (p.includes('RIGHT') || p.includes('SRIGHT')) return [1, 0];
    return null;
  },
};
const KEYMAP = { ' ': 'A', Enter: 'A', j: 'X', k: 'B', l: 'Y', q: 'LB', e: 'RB', Escape: 'MENU', p: 'MENU', Backspace: 'B',
  1: 'A', 2: 'B', 3: 'X', 4: 'Y', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', w: 'UP', s: 'DOWN', a: 'LEFT', d: 'RIGHT' };
function updateKeyMove() { const k = Input.keysDown; const x = (k.has('ArrowRight') || k.has('d') ? 1 : 0) - (k.has('ArrowLeft') || k.has('a') ? 1 : 0);
  const y = (k.has('ArrowUp') || k.has('w') ? 1 : 0) - (k.has('ArrowDown') || k.has('s') ? 1 : 0); const l = Math.hypot(x, y) || 1; Input.keyMove = { x: x / l, y: y / l }; }
window.addEventListener('keydown', (e) => { const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; const b = KEYMAP[key]; if (!b) return;
  e.preventDefault(); if (e.repeat) return; Input.keysDown.add(key); Input.kq.push([true, b]); Input.device = 'keys'; updateKeyMove(); });
window.addEventListener('keyup', (e) => { const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; const b = KEYMAP[key]; if (!b) return;
  Input.keysDown.delete(key); Input.kq.push([false, b]); updateKeyMove(); });

function haptic(ms) { try { if (App.screen === 'game' && App.profile.settings.haptics && navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

// Small round badge showing which button to press.
function glyphBadge(ctx, x, y, g) {
  if (!g) return; const [t, col] = g, c = hex(col);
  ellipse(ctx, x + 6.5, y + 6.5, 6.5, 6.5, PAL.outline); ellipse(ctx, x + 6.5, y + 6.5, 5.5, 5.5, hex('#1A1838'));
  ctx.fillStyle = col; const cx = x + 6, cy = y + 6;
  if (t === 'cross') for (let i = -2; i <= 2; i++) { ctx.fillRect(cx + i, cy + i, 1, 1); ctx.fillRect(cx + i, cy - i, 1, 1); }
  else if (t === 'circle') { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx + 0.5, cy + 0.5, 2.5, 0, TAU); ctx.stroke(); }
  else if (t === 'square') { ctx.strokeStyle = col; ctx.strokeRect(cx - 1.5, cy - 1.5, 5, 5); }
  else if (t === 'triangle') { ctx.fillRect(cx, cy - 2, 1, 1); ctx.fillRect(cx - 1, cy - 1, 1, 2); ctx.fillRect(cx + 1, cy - 1, 1, 2); ctx.fillRect(cx - 2, cy + 1, 5, 1); }
  else textC(ctx, t, x + 7, y + 3, c, null);
}
