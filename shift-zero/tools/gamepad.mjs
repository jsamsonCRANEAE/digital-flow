// Gamepad support test: mocks navigator.getGamepads with two standard-mapping controllers
// and drives title → intro → work order → gameplay with sticks and buttons only.
import { launch } from './harness.mjs';

const { page, errors, close } = await launch('?seed=5');
await page.evaluate(() => {
  const mk = (index) => ({
    index, id: `Mock Pad ${index}`, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    vibrationActuator: { playEffect: () => { window.__rumbles = (window.__rumbles || 0) + 1; return Promise.resolve('complete'); } },
  });
  window.__pads = [mk(0), mk(1)];
  navigator.getGamepads = () => window.__pads;
  window.__btn = (p, b, on) => { window.__pads[p].buttons[b] = { pressed: on, value: on ? 1 : 0 }; };
  window.__axis = (p, a, v) => { window.__pads[p].axes[a] = v; };
});
const wait = (ms) => page.waitForTimeout(ms);
const tap = async (p, b) => { await page.evaluate(([p, b]) => window.__btn(p, b, true), [p, b]); await wait(80); await page.evaluate(([p, b]) => window.__btn(p, b, false), [p, b]); await wait(80); };
const state = () => page.evaluate(() => window.__shiftZero.state);
const out = [];
const ok = (c, m) => out.push(`${c ? 'PASS' : 'FAIL'} ${m}`);

await wait(300);
const titleHtml = await page.evaluate(() => document.getElementById('overlay').textContent);
ok(titleHtml.includes('2 controllers connected'), 'title detects 2 controllers');
await tap(0, 0); await wait(200);
ok(await state() === 'intro', 'Ⓐ on controller 1 clocks in');
await tap(0, 9); await wait(300); // START = Escape skips intro
ok(await state() === 'workorder', 'START skips the intro');
await page.evaluate(() => window.__axis(0, 0, 1)); await wait(120); await page.evaluate(() => window.__axis(0, 0, 0)); await wait(100);
ok(await page.evaluate(() => window.__shiftZero.cardSel) === 1, 'left stick selects the Hot-Work card');
await tap(1, 0); await wait(400);
ok(await state() === 'playing', 'Ⓐ on controller 2 signs the work order');

const b0 = await page.evaluate(() => ({ x: window.__shiftZero.world.body.x, y: window.__shiftZero.world.body.y }));
await page.evaluate(() => window.__axis(0, 1, -1)); await wait(500); await page.evaluate(() => window.__axis(0, 1, 0));
const b1 = await page.evaluate(() => ({ x: window.__shiftZero.world.body.x, y: window.__shiftZero.world.body.y }));
ok(Math.hypot(b1.x - b0.x, b1.y - b0.y) > 20, 'controller 1 stick moves the BODY');
const v0 = await page.evaluate(() => window.__shiftZero.world.voxel.x);
await page.evaluate(() => window.__btn(1, 15, true)); await wait(500); await page.evaluate(() => window.__btn(1, 15, false));
await page.evaluate(() => window.__btn(1, 14, true)); await wait(1);
await page.evaluate(() => window.__btn(1, 14, false));
const v1 = await page.evaluate(() => window.__shiftZero.world.voxel.x);
ok(v1 !== v0, 'controller 2 D-pad moves the VOXEL');
await tap(0, 1); await wait(50);
ok(await page.evaluate(() => window.__shiftZero.world.body.dodgeCd > 0), 'Ⓑ on controller 1 dodges');
await tap(0, 3); await wait(50);
ok(await page.evaluate(() => window.__shiftZero.world.body.toolIndex === 1), 'Ⓨ cycles tool');
await tap(0, 8); await wait(100);
ok(await page.evaluate(() => window.__shiftZero.swapped), 'BACK toggles Solo-Swap');
await tap(0, 8);
await page.evaluate(() => { const w = window.__shiftZero.world; w.arcFlash(w.body.x, w.body.y, 1); });
await wait(300);
ok((await page.evaluate(() => window.__rumbles || 0)) > 0, 'arc flash rumbles the controllers');
await tap(0, 9); await wait(150);
ok(await page.evaluate(() => window.__shiftZero.paused), 'START pauses');
console.log(out.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
await close();
process.exit(errors.length || out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
