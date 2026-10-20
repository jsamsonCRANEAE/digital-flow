// Measures average update+render cost per frame for a mid-depth floor and the boss.
import { launch } from './harness.mjs';
const { page, errors, close } = await launch('?seed=11');
const res = await page.evaluate(() => {
  const g = window.__shiftZero;
  const out = [];
  for (const depth of [4, 5]) {
    g.newRun(); g.run.depth = depth; g.run.workOrder = 'hot'; g.run.mutator = 'flooded';
    if (depth === 5) g.startBoss(); else g.startFloor();
    const w = g.world;
    const intents = { body: { x: 1, y: 0, use: false }, voxel: { x: 1, y: 0 } };
    for (let i = 0; i < 60; i++) { w.update(1 / 60, intents); w.render(g.ctx, i / 60); g.hud.render(g, w, 1 / 60, i / 60); }
    const N = 300, t0 = performance.now();
    for (let i = 0; i < N; i++) {
      intents.body.x = Math.sin(i / 40) > 0 ? 1 : -1; intents.body.use = i % 20 === 0;
      w.update(1 / 60, intents); w.render(g.ctx, i / 60); g.hud.render(g, w, 1 / 60, i / 60);
    }
    out.push(`depth ${depth}: ${((performance.now() - t0) / N).toFixed(2)} ms/frame (update+world render+HUD), particles ${g.particles.count}`);
  }
  return out;
});
console.log(res.join('\n'), errors.length ? errors : '');
await close();
