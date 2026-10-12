import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message + (e.stack || '').split('\n')[1]));
await page.goto('file://' + out + '/index.html'); await page.waitForTimeout(800);
const r = async () => page.evaluate(() => { const b = document.getElementById('screen').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
const tap = async (x, y) => { const b = await r(); await page.touchscreen.tap(b[0] + x / 640 * b[2], b[1] + y / 296 * b[3]); await page.waitForTimeout(100); };
const tapId = async (id) => { const h = await page.evaluate((id) => GS.App.hits.find((h) => h.id === id), id); if (!h) throw new Error('no hit ' + id); await tap(h.x + h.w / 2, h.y + h.h / 2); };
const shot = async (n) => page.screenshot({ path: `${out}/${n}.png` });
await tap(320, 150); await page.waitForTimeout(300); await tapId('exhibition'); await page.waitForTimeout(200); await tapId('play'); await page.waitForTimeout(400);
// force our ball, full spirit meter
await page.evaluate(() => { const m = GS.App.match; m.state.poss = 0; m.spiritMeter[0] = 1; m.newPlay(); });
await page.waitForTimeout(300); await shot('o1-call');
await tapId('card.1'); await page.waitForTimeout(400); await tapId('act.spirit'); await page.waitForTimeout(500); await shot('o2-cutin');
await page.waitForTimeout(1400); await shot('o3-presnap');
await tapId('act.snap'); await page.waitForTimeout(1300); await shot('o4-passing');
const hits = await page.evaluate(() => GS.App.hits.map((h) => h.id)); console.log(hits.join(','));
if (hits.includes('recv.0')) await tapId('recv.0');
await page.waitForTimeout(700); await shot('o5-flight'); await page.waitForTimeout(900); await shot('o6-after');
// field goal
await page.evaluate(() => { const m = GS.App.match; m.state.poss = 0; m.state.ballOn = 70; m.state.down = 4; m.phase = 'call'; m.newPlay(); m.page = 0; });
await page.waitForTimeout(300); await shot('o7-4th');
await tapId('card.1'); await page.waitForTimeout(600); await shot('o8-kick');
const b = await r(); await page.touchscreen.tap(b[0] + b[2] / 2, b[1] + b[3] / 2); await page.waitForTimeout(1600); await shot('o9-kickresult');
console.log(errs.length ? errs.join('\n') : 'NO ERRORS'); await browser.close();
