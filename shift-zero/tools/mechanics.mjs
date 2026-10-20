// Browser mechanics assertions for the co-op systems (runs the real World in Chromium).
import { launch } from './harness.mjs';

const { page, errors, close } = await launch('?seed=4242');
const res = await page.evaluate(() => {
  const g = window.__shiftZero;
  const out = [];
  const ok = (cond, msg) => out.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  const idle = { body: { x: 0, y: 0 }, voxel: { x: 0, y: 0 } };
  const tick = (w, n = 1, intents = idle) => { for (let i = 0; i < n; i++) w.update(1 / 60, intents); };
  const fresh = (items = []) => {
    g.newRun(); g.run.depth = 2; g.run.workOrder = 'clean'; g.run.mutator = 'rust';
    for (const id of items) g.run.rpg.grant(id);
    g.startFloor();
    g.world.anomalies = [];
    return g.world;
  };

  // 1. Cipher: Voxel decrypts, Body sets relays in binary, cipher solves.
  let w = fresh();
  const term = w.devices.find((d) => d.constructor.name === 'CipherTerminal');
  const relays = w.devices.filter((d) => d.constructor.name === 'Relay');
  ok(term && relays.length === 4, 'floor has a cipher terminal and 4 relays');
  ok(!term.voxelAction(w).disabled, 'terminal offers DECRYPT to the Voxel');
  term.voxelAction(w).run();
  ok(term.revealed, 'decrypt reveals the hex key');
  for (const r of relays) if (term.value & r.bit) r.bodyAction(w).run();
  ok(term.solved && g.run.ciphers === 1, `relays set to 0x${term.value.toString(16)} solve the cipher`);

  // 2. LOTO + Try: lock costs efficiency (not under audit), multimeter verifies dead.
  w = fresh();
  const br = w.devices.find((d) => d.constructor.name === 'BreakerBox');
  const edge = w.circuit.getEdge(br.edge);
  w.circuit.open(edge.id);
  const eff = g.run.efficiency;
  br.bodyAction(w).run();
  ok(edge.locked && w.body.padlocks === 1, 'APPLY LOTO LOCK hangs a brass padlock');
  ok(g.run.efficiency < eff, 'corporate docks 14% efficiency for the lock');
  tick(w, 60 * 12);
  ok(!edge.closed, 'locked breaker survives SCADA auto-reclose');
  w.body.x = br.px; w.body.y = br.py + 34; w.body.toolIndex = 1; w.body.scanCd = 0;
  w.useTool(w.body);
  ok(br.verified && g.run.verified === 1, 'multimeter TRY verifies zero energy');

  // 3. Unlocked breaker auto-recloses.
  br.bodyAction(w).run();
  ok(!edge.locked && edge.closed, 'removing the lock re-energizes');
  w.circuit.open(edge.id);
  tick(w, 60 * (w.circuit.recloseDelay + 0.5));
  ok(edge.closed, 'unlocked breaker auto-recloses');

  // 4. Voxel pad insulates live water.
  const gate = w.level.gates.find((q) => q.kind === 'water');
  if (gate) {
    const [tx, ty] = gate.tiles[Math.floor(gate.tiles.length / 2)];
    ok(w.isWaterLive(tx, ty), 'gate water is live');
    w.voxel.tx = tx; w.voxel.ty = ty; w.voxel.coherence = 100; w.voxel.materializeCd = 0;
    w.voxelMaterialize(w.voxel);
    ok(!w.isWaterLive(tx, ty), 'materialized voxel pad insulates the water');
  }

  // 5. Ghost Lockout synergy.
  w = fresh(['lock_hasp', 'remote_loto']);
  ok(w.stats.ghostLockout, 'Ghost Lockout synergy active');
  const fired = w.ghostLockoutNearest();
  const ghosted = w.circuit.breakers().find((e) => e.ghostT > 0);
  ok(fired && ghosted && !ghosted.closed, 'ghost lock trips + holds the nearest breaker remotely');
  tick(w, 60 * 9);
  ok(ghosted.ghostT === 0, 'ghost lock expires after 8s');

  // 6. Solo latch: jumper keeps holding with no input after latch.
  const fuse = w.devices.find((d) => d.constructor.name === 'FuseHolder');
  w.voxel.tx = fuse.x; w.voxel.ty = fuse.y; w.voxel.x = fuse.px; w.voxel.y = fuse.py; w.voxel.moving = false;
  tick(w, 1);
  tick(w, 1, { body: {}, voxel: { hackPressed: true, hackHeld: true } });
  ok(!!w.voxel.jumper && w.circuit.getEdge('FUSE_BULK').bridged, 'holding HACK on the fuse bridges it');
  w.voxel.latch(w);
  tick(w, 60 * 2);
  ok(w.circuit.getEdge('FUSE_BULK').bridged, 'latched jumper holds with no input (solo-swap)');
  tick(w, 1, { body: {}, voxel: { x: 1, y: 0 } });
  ok(!w.circuit.getEdge('FUSE_BULK').bridged, 'moving releases a latched jumper');

  // 7. Overclock revives a downed Body and burns a memory.
  w.body.hurt(999, 0, 0, 'bite', w);
  ok(w.body.downed, 'body goes down');
  const a0 = g.run.anchor;
  w.overclockCd = 0;
  w.overclock();
  ok(!w.body.downed && g.run.anchor === a0 - w.stats.overclockCost, 'OVERCLOCK revives and burns Anchor');
  ok(w.bigText && w.bigText.title === 'MEMORY BURNED', 'a named memory is burned on screen');

  // 8. Phase imbalance summons Harmonic Phantoms.
  w = fresh();
  const brs = w.circuit.breakers();
  for (const e of brs) { w.circuit.open(e.id); w.circuit.lock(e.id); }
  tick(w, 60 * 25);
  ok(w.circuit.stress > 0.35 || brs.length === 0, `lockouts on one phase create imbalance (stress ${w.circuit.stress.toFixed(2)})`);
  ok(w.anomalies.some((a) => a.kind === 'phantom'), 'harmonics manifest as phantoms');
  return out;
});
console.log(res.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
await close();
process.exit(errors.length || res.some((l) => l.startsWith('FAIL')) ? 1 : 0);
