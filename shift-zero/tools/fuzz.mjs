// Fuzz: drive the real game loop with random intents (all items/synergies owned) across
// every depth and the boss, at accelerated speed, to flush out rare-path exceptions.
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
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = path.join(root, u === '/' ? 'index.html' : u);
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
await page.goto(`http://localhost:${server.address().port}/?seed=99`);
await page.waitForTimeout(500);

const result = await page.evaluate(async () => {
  const g = window.__shiftZero;
  const STEP = 1 / 60;
  const log = [];
  let rngState = 7;
  const r = () => ((rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const randIntent = () => ({
    body: { x: Math.round(r() * 2 - 1), y: Math.round(r() * 2 - 1), interact: r() < 0.05, interactHeld: r() < 0.3, cycle: r() < 0.01, use: r() < 0.05, dodge: r() < 0.02, overclock: false },
    voxel: { x: Math.round(r() * 2 - 1), y: Math.round(r() * 2 - 1), hackPressed: r() < 0.04, hackHeld: r() < 0.5, hackReleased: r() < 0.04, materialize: r() < 0.01, overclock: r() < 0.002 },
  });
  for (const allItems of [false, true]) {
    for (let depth = 1; depth <= 5; depth++) {
      g.newRun();
      g.run.seed = 1000 + depth * 17 + (allItems ? 5 : 0);
      g.run.depth = depth;
      if (allItems) for (const id of ['calibrated_meter', 'magnetic_coil', 'grounded_jacket', 'voxel_buffer', 'discharge_hook', 'coherence_recycler', 'lock_hasp', 'remote_loto', 'proto_tesla', 'proto_qfuse', 'heavy_stick', 'watchdog_timer']) g.run.rpg.grant(id);
      g.run.workOrder = depth % 2 ? 'hot' : 'clean';
      g.run.mutator = ['flooded', 'brownout', 'harmonic', 'overtime', 'audit', 'rust'][depth % 6];
      if (depth === 5) g.startBoss(); else g.startFloor();
      const w = g.world;
      let frames = 0;
      for (let i = 0; i < 60 * 90 && g.world === w && g.state === 'playing'; i++) {
        const intents = randIntent();
        // Keep the body alive so we explore more code (but let it go down sometimes).
        if (i % 600 === 0) { w.body.hp = w.body.maxHp; if (w.body.downed) w.body.revive(1); }
        w.update(STEP, intents);
        g.narrative.update(STEP, g.run.anchor);
        if (i % 6 === 0) { w.render(g.ctx, i * STEP); g.hud.render(g, w, STEP * 6, i * STEP); }
        frames++;
        if (depth === 5 && i === 60 * 20) { for (const ph of ['A', 'B', 'C']) if (!w.boss.failed.has(ph)) w.boss.ruptureBushing(w, ph); }
        if (depth === 5 && w.boss.phase === 2 && i % 60 === 0) { w.circuit.setBridge('GND', true); w.boss.hitCore(60, w); }
      }
      log.push(`depth ${depth}${allItems ? ' [all items]' : ''}: ${frames} frames, state=${g.state}, hp=${Math.round(w.body.hp)}, anchor=${g.run.anchor}, anomalies=${w.anomalies.length}, particles=${g.particles.count}, boss=${w.boss ? w.boss.phase : '-'}`);
      g.terminateT = undefined;
    }
  }
  return log;
});
console.log(result.join('\n'));
console.log(errors.length ? `ERRORS:\n${[...new Set(errors)].slice(0, 10).join('\n---\n')}` : 'NO ERRORS');
await browser.close(); server.close();
process.exit(errors.length ? 1 : 0);
