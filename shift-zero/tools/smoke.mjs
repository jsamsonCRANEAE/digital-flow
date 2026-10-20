// Headless browser smoke test: boots the game, drives every state, captures errors + screenshots.
// Usage: node tools/smoke.mjs [outDir]   (serves the project on a local port)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'tools', 'shots'));
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(`http://localhost:${port}/?seed=1234`);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: path.join(out, `${n}.png`) });
const state = () => page.evaluate(() => window.__shiftZero.state);
const press = async (k, ms = 60) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); };

await wait(800); await shot('01-title');
await press('Enter'); await wait(400);
await press('Space'); await press('Space'); await press('Space'); await wait(300); await shot('02-intro');
await press('Escape'); await wait(500); await shot('03-workorder');
await press('KeyD'); await wait(200); await press('Enter'); await wait(1500);
console.log('state after workorder:', await state());
await shot('04-playing-start');

// Wander: P1 + P2 random input for a while
const keys1 = ['KeyW', 'KeyA', 'KeyS', 'KeyD'], keys2 = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
for (let i = 0; i < 30; i++) {
  const a = keys1[i % 4], b = keys2[(i * 3) % 4];
  await page.keyboard.down(a); await page.keyboard.down(b);
  await wait(180);
  if (i % 5 === 0) await press('KeyE', 30);
  if (i % 7 === 0) await press('Space', 30);
  if (i % 9 === 0) await press('KeyQ', 30);
  if (i % 6 === 0) await press('Enter', 30);
  if (i % 11 === 0) await press('ShiftLeft', 30);
  await page.keyboard.up(a); await page.keyboard.up(b);
}
await shot('05-playing-wander');

// Teleport body next to the first breaker and run a skill check; P2 to the fuse and jumper.
const info = await page.evaluate(() => {
  const g = window.__shiftZero, w = g.world;
  const br = w.devices.find((d) => d.constructor.name === 'BreakerBox');
  const fuse = w.devices.find((d) => d.constructor.name === 'FuseHolder');
  w.body.x = br.px + (br.wall === 'E' ? -34 : br.wall === 'W' ? 34 : 0);
  w.body.y = br.py + (br.wall === 'N' ? 34 : br.wall === 'S' ? -34 : 0);
  w.voxel.tx = fuse.x; w.voxel.ty = fuse.y; w.voxel.x = fuse.px; w.voxel.y = fuse.py; w.voxel.moving = false;
  return { br: br.label, fuse: !!fuse };
});
console.log('teleported', info);
await wait(300);
await press('Space'); await wait(250); await shot('06-skillcheck');
await press('Space'); await wait(700);
await page.keyboard.down('Enter'); await wait(900); await shot('07-jumper'); await page.keyboard.up('Enter');
const circ = await page.evaluate(() => {
  const w = window.__shiftZero.world;
  return w.circuit.breakers().map((e) => `${e.label}:${e.closed ? 'closed' : 'open'}${e.locked ? '+lock' : ''}`).join(' ');
});
console.log('breakers:', circ);
// Overclock + multimeter
await press('Slash'); await wait(400); await shot('08-overclock');
await press('KeyQ'); await press('KeyE'); await wait(300);
// Solo swap
await press('Tab'); await page.keyboard.down('KeyD'); await wait(400); await page.keyboard.up('KeyD'); await press('Tab');
// Force floor complete → breakroom
await page.evaluate(() => window.__shiftZero.world.completeFloor());
await wait(3200);
console.log('state after elevator:', await state());
await shot('09-breakroom');
await press('Space'); await press('Enter'); await press('ArrowDown'); await press('Enter'); await wait(200);
await shot('10-breakroom-bought');
await press('Tab'); await wait(600);
console.log('state after breakroom:', await state());
await shot('11-workorder2');
// Jump to boss
await page.evaluate(() => { const g = window.__shiftZero; g.run.depth = 5; g.startBoss(); });
await wait(1500); await shot('12-boss');
await page.evaluate(() => {
  const w = window.__shiftZero.world;
  for (const ph of ['A', 'B', 'C']) w.boss.ruptureBushing(w, ph);
  w.boss.enterPhase(w, 2);
  w.circuit.setBridge('GND', true);
});
await wait(1200); await shot('13-boss-phase2');
await page.evaluate(() => { const w = window.__shiftZero.world; w.boss.coreHp = 1; w.boss.hitCore(10, w); });
await wait(1200); await shot('14-boss-phase3');
await page.evaluate(() => { const g = window.__shiftZero; g.run.anchor = 85; g.run.lotoCount = 5; g.world.boss.defeat('disconnect'); g.world.onBossDefeated('disconnect'); });
await wait(5000);
console.log('state after boss:', await state());
await shot('15-ending');
// Low-anchor visuals
await page.evaluate(() => { const g = window.__shiftZero; g.newRun(); g.run.anchor = 15; g.run.depth = 3; g.run.workOrder = 'hot'; g.run.mutator = 'brownout'; g.startFloor(); });
await wait(2500); await shot('16-low-anchor');
// Terminated
await page.evaluate(() => { const w = window.__shiftZero.world; w.body.hp = 1; w.body.hurt(999, w.body.x, w.body.y, 'bite', w); w.body.downedT = 0.1; });
await wait(4000);
console.log('state after death:', await state());
await shot('17-terminated');

console.log(errors.length ? `ERRORS (${errors.length}):\n` + [...new Set(errors)].slice(0, 15).join('\n---\n') : 'NO PAGE ERRORS');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
