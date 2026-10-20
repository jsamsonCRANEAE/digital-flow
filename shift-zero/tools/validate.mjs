// Headless checks: level solvability across seeds, circuit LOTO/reclose behaviour, RPG synergies.
import { generateLevel, validateLevel } from '../src/systems/LevelGen.js';
import { CircuitSim } from '../src/systems/CircuitSim.js';
import { RPGSystem } from '../src/systems/RPGSystem.js';
import { Narrative, memoriesLost, recall, determineEnding } from '../src/systems/Narrative.js';

let failures = 0;
const fail = (m) => { failures++; console.error('FAIL', m); };

// 1. Level generation
const stats = { levels: 0, attempts: 0, gates: 0 };
for (let depth = 1; depth <= 5; depth++) {
  for (let s = 0; s < 120; s++) {
    for (const wo of ['clean', 'hot']) {
      const seed = s * 2654435761 + depth;
      try {
        const L = generateLevel({ seed, depth, workOrder: wo, mutator: s % 3 === 0 ? 'flooded' : null });
        const v = validateLevel(L);
        if (!v.ok) fail(`depth ${depth} seed ${seed}: ${v.reasons.join(', ')}`);
        CircuitSim.fromSpec(L.circuit);
        stats.levels++; stats.attempts += L.attempts || 1; stats.gates += L.gates.length;
      } catch (e) { fail(`depth ${depth} seed ${seed}: ${e.message}`); }
    }
  }
}
console.log(`levels=${stats.levels} avgAttempts=${(stats.attempts / stats.levels).toFixed(2)} avgGates=${(stats.gates / stats.levels).toFixed(2)}`);

// 1b. Negative control: a breaker moved behind its own gate must make the floor unsolvable.
{
  let tested = 0;
  for (let s = 0; s < 60 && tested < 10; s++) {
    const L = generateLevel({ seed: 1000 + s, depth: 2 });
    const g = L.gates.find((q) => q.kind === 'water');
    if (!g) continue;
    const exitRoom = L.rooms.find((r) => r.isExit);
    const dev = L.devices.find((d) => d.type === 'breaker' && d.edge === g.edge);
    // Put the breaker deep in the exit room (beyond the bulkhead) and wall the bulkhead off.
    dev.x = exitRoom.cx + 3; dev.y = exitRoom.cy - 3;
    g.breaker = { x: dev.x, y: dev.y };
    for (const d of L.devices) if (d.type === 'elevator') { d.x = dev.x; d.y = dev.y + 1; }
    const bulk = L.gates.find((q) => q.kind === 'bulkhead');
    const blocks = new Set(bulk.tiles.map(([x, y]) => y * L.w + x));
    for (const i of blocks) L.tiles[i] = 2;
    if (validateLevel(L).ok) fail('validator accepted an unsolvable layout');
    tested++;
  }
  if (!tested) fail('negative control found no water gates');
}

// 2. Circuit: open → auto-reclose; open+lock → stays open; fuse bridge
{
  const L = generateLevel({ seed: 42, depth: 3 });
  const sim = CircuitSim.fromSpec(L.circuit);
  const brk = sim.breakers()[0];
  const load = sim.getNode(brk.b);
  if (!load.energized) fail('hazard should start energized');
  const bal0 = sim.imbalance;
  sim.open(brk.id);
  if (load.energized) fail('open breaker should de-energize');
  if (!(sim.imbalance > bal0)) fail('LOTO should create phase imbalance');
  for (let t = 0; t < 7; t += 0.1) sim.update(0.1);
  if (!load.energized) fail('auto-reclose should re-energize');
  sim.open(brk.id); sim.lock(brk.id);
  for (let t = 0; t < 10; t += 0.1) sim.update(0.1);
  if (load.energized) fail('locked breaker must stay open');
  if (sim.isEnergized('BULK')) fail('bulkhead starts dead (blown fuse)');
  sim.setBridge('FUSE_BULK', true);
  if (!sim.isEnergized('BULK')) fail('bridged fuse should energize bulkhead');
  sim.unlock(brk.id); sim.close(brk.id);
  sim.ghostLock(brk.id, 2);
  if (load.energized) fail('ghost lock trips breaker');
  for (let t = 0; t < 1.9; t += 0.1) sim.update(0.1);
  if (load.energized) fail('ghost lock holds');
  for (let t = 0; t < 3; t += 0.1) sim.update(0.1);
  if (!load.energized) fail('ghost lock expiry recloses');
  sim.forceOff(1);
  if (load.energized) fail('overclock forceOff');
}

// 3. RPG: purchases, synergies, stat aggregation
{
  const rpg = new RPGSystem();
  rpg.scrap = 1000;
  if (rpg.activeSynergies().length) fail('no synergies at start');
  rpg.buy('calibrated_meter');
  if (rpg.pendingSynergyFor('magnetic_coil').length !== 1) fail('shop should flag the Arc-Lasso partner');
  rpg.buy('magnetic_coil');
  if (!rpg.hasSynergy('arc_lasso') || !rpg.stats().arcLasso) fail('arc lasso synergy');
  if (rpg.buy('magnetic_coil')) fail('cannot buy owned firmware twice');
  const s0 = rpg.stats().padlocks;
  rpg.buy('spare_lock');
  if (rpg.stats().padlocks !== s0 + 1) fail('spare lock adds a padlock');
  for (const [a, b, id] of [['grounded_jacket', 'voxel_buffer', 'phaseShift'], ['discharge_hook', 'coherence_recycler', 'bleedDown'], ['lock_hasp', 'remote_loto', 'ghostLockout']]) {
    rpg.buy(a); rpg.buy(b);
    if (!rpg.stats()[id]) fail(`synergy ${id}`);
  }
  if (rpg.activeSynergies().length !== 4) fail('all four duo synergies active');
  const poor = new RPGSystem();
  if (poor.buy('coffee')) fail('cannot buy without scrap');
}

// 4. Narrative: memory thresholds, name decay, endings
{
  if (memoriesLost(100) !== 0 || memoriesLost(80) !== 1 || memoriesLost(0) !== 5) fail('memory thresholds');
  if (recall('Tess', 90) !== 'Tess') fail('names intact at high anchor');
  if (recall('Tess', 10).includes('Tess')) fail('names decay to hex at low anchor');
  if (recall('Tess', 0) !== '[NULL]') fail('names null at zero anchor');
  const base = { anchor: 90, lotoCount: 6, shortcuts: 2, ciphers: 1, burnedAll: false };
  if (determineEnding(base) !== 'union') fail('union ending');
  if (determineEnding({ ...base, anchor: 0 }) !== 'company') fail('company ending');
  if (determineEnding({ ...base, burnedAll: true, anchor: 0 }) !== 'company') fail('burn-everything ending');
  if (determineEnding({ ...base, anchor: 45 }) !== 'overtime') fail('overtime ending (mid anchor)');
  if (determineEnding({ ...base, shortcuts: 20 }) !== 'overtime') fail('overtime ending (corners cut)');
  if (determineEnding({ ...base, ciphers: 4 }) !== 'ghost') fail('ghost ending');
  const n = new Narrative(() => 0.3);
  n.event('loto', { label: '2B-01' }, 100);
  n.update(0.016, 100);
  if (!n.current || !n.current.text.includes('14%')) fail('LOTO pager message');
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('ALL CHECKS PASSED');
