// ---------------------------------------------------------------------------
// Boot: canvas scaling (integer "pixel perfect" or fill), pointer wiring and
// the frame loop.
// ---------------------------------------------------------------------------
const canvas = document.getElementById('screen');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d', { alpha: false }); ctx.imageSmoothingEnabled = false;
function fit() {
  const box = document.getElementById('stage'), r = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  let cw, ch;
  if (App.profile.settings.fit === 'fill') { const k = Math.min(r.width / W, r.height / H); cw = W * k; ch = H * k; }
  else { const s = Math.max(1, Math.floor(Math.min(r.width * dpr / W, r.height * dpr / H))); cw = W * s / dpr; ch = H * s / dpr;
    if (cw > r.width + 0.5 || ch > r.height + 0.5) { const k = Math.min(r.width / W, r.height / H); cw = W * k; ch = H * k; } }
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
  document.getElementById('rotate').hidden = !(r.height > r.width * 1.1);
}
window.addEventListener('resize', fit); window.addEventListener('orientationchange', () => setTimeout(fit, 200));
function toCanvas(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture?.(e.pointerId); const [x, y] = toCanvas(e); App.pdown(e.pointerId, x, y); });
canvas.addEventListener('pointermove', (e) => { e.preventDefault(); const [x, y] = toCanvas(e); App.pmove(e.pointerId, x, y); });
const up = (e) => { e.preventDefault(); const [x, y] = toCanvas(e); App.pup(e.pointerId, x, y); };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
document.addEventListener('visibilitychange', () => { if (document.hidden && App.screen === 'game' && App.match && !App.match.report) App.go('pause'); if (document.hidden && Audio.ctx) Audio.ctx.suspend(); else if (Audio.ctx) Audio.ctx.resume(); });
window.addEventListener('keydown', () => Audio.unlock(), { once: false });
window.addEventListener('gamepadconnected', () => { Input.device = 'pad'; });

App.init();
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  Input.frame();
  if (Input.pressed.length) Audio.unlock();
  App.update(dt);
  App.draw(ctx);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setTimeout(fit, 50);
// Pre-render the soundtrack once audio is unlocked (keeps first tap snappy).
const warmIv = setInterval(() => { if (Audio.ctx) { clearInterval(warmIv); Audio.warm(); } }, 500);
window.GS = { App, Input, Audio, DATA, Match, Play };   // handle for the automated tests
