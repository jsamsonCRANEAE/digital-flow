import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const page = await (await browser.newContext()).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + process.argv[2] + '/index.html'); await page.waitForTimeout(500);
console.log(await page.evaluate(async () => { const A = GS.Audio; A.unlock(); const out = {};
  for (const n of ['menu', 'game', 'title', 'touchdown']) { const t0 = performance.now(); const b = await A.load(n); const d = b.getChannelData(0);
    let pk = 0, s2 = 0; for (let i = 0; i < d.length; i++) { pk = Math.max(pk, Math.abs(d[i])); s2 += d[i] * d[i]; }
    out[n] = { renderMs: Math.round(performance.now() - t0), seconds: +(b.duration).toFixed(1), peak: +pk.toFixed(2), rms: +Math.sqrt(s2 / d.length).toFixed(3) }; }
  for (const k of ['snap', 'hit', 'whistle', 'catch', 'buy']) A.sfx(k, 1);
  return out; }));
console.log(errs.join('\n') || 'NO ERRORS'); await browser.close();
