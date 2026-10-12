// Headless smoke test: loads the page like an iPhone in landscape, drives it
// with real taps, and screenshots each screen. Fails on any page error.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
const out = process.argv[2] || '/tmp/gs';
const body = readFileSync(new URL('../dist/gridiron-spirit.html', import.meta.url), 'utf8');
const page_html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${body}</body></html>`;
writeFileSync(out + '/index.html', page_html);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('file://' + out + '/index.html');
await page.waitForTimeout(1500);
const shot = async (n) => { await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n, await page.evaluate(() => GS.App.screen + (GS.App.match ? ' phase=' + GS.App.match.phase : ''))); };
// tap in canvas coordinates
const tap = async (x, y) => { const r = await page.evaluate(() => { const b = document.getElementById('screen').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
  await page.touchscreen.tap(r[0] + x / 640 * r[2], r[1] + y / 296 * r[3]); await page.waitForTimeout(120); };
const tapId = async (id) => { const h = await page.evaluate((id) => GS.App.hits.find((h) => h.id === id), id); if (!h) throw new Error('no hit ' + id + ' on ' + await page.evaluate(() => GS.App.screen)); await tap(h.x + h.w / 2, h.y + h.h / 2); };
const mode = process.argv[3] || 'tour';
process.on('unhandledRejection', async (e) => { console.log('STEP FAILED:', e.message); console.log(errors.join('\n')); await browser.close(); process.exit(1); });
await shot('01-title');
await tap(320, 150); await page.waitForTimeout(400); await shot('02-main');
if (mode === 'tour') {
  await tapId('exhibition'); await page.waitForTimeout(300); await shot('03-team');
  await tapId('back'); await tapId('settings'); await page.waitForTimeout(300); await shot('04-settings');
  await tapId('back'); await page.evaluate(() => { GS.App.profile.coins = 900; }); await tapId('shop'); await page.waitForTimeout(300);
  await tapId('item.cleat2'); await tapId('buy'); await tapId('item.helm5'); await tapId('buy'); await page.waitForTimeout(300); await shot('05-shop');
  await tapId('back'); await tapId('exhibition'); await page.waitForTimeout(200); await tapId('play'); await page.waitForTimeout(800); await shot('06-playcall');
  await tapId('card.1'); await page.waitForTimeout(700); await shot('07-presnap');
  const onOff = await page.evaluate(() => GS.App.match.offIsHuman); console.log('human on offense:', onOff);
  if (onOff) await tapId('act.snap');
  await page.waitForTimeout(1200); await shot('08-live');
  // throw to receiver 1
  const hits = await page.evaluate(() => GS.App.hits.map((h) => h.id)); console.log('hits', hits.join(','));
  if (hits.includes('recv.0')) { await tapId('recv.0'); }
  await page.waitForTimeout(900); await shot('09-afterthrow');
  await page.waitForTimeout(2500); await shot('10-next');
  // Simulate a whole game quickly: CPU plays our side via the attract AI, check it reaches FINAL without errors.
  const res = await page.evaluate(async () => { const A = GS.App; const m = A.match; m.human = null; let n = 0;
    while (!m.report && n < 60 * 60 * 25) { m.update(1 / 60, null); n++; }
    return { report: !!m.report, score: m.state.score, q: m.state.quarter, ot: m.state.ot, log: m.log.slice(-12), stats: m.stats }; });
  console.log('fullgame', JSON.stringify(res));
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
await browser.close();
process.exit(errors.length ? 1 : 0);
