// Solver bot: plays floors using ONLY player intents (no teleports, no state edits beyond
// keeping the Body alive). Proves each floor is completable by two cooperating players:
// the Body paths to each gate breaker, nails the skill check, hangs LOTO locks; the Voxel
// rides the conduit graph to the blown fuse and holds a living jumper while the Body walks
// through the bulkhead and rides the elevator.
import { launch } from './harness.mjs';

const { page, errors, close } = await launch('?seed=7');
if (process.env.ONLY) await page.evaluate((o) => { globalThis.__only = o; globalThis.__trace = true; }, JSON.parse(process.env.ONLY));
const out = await page.evaluate(() => {
  const g = window.__shiftZero;
  const TILE = 32, STEP = 1 / 60;
  const results = [];

  function bfs(w, sx, sy, goal, passable, neighbors) {
    const W = w.w, prev = new Int32Array(W * w.h).fill(-2);
    const s = sy * W + sx;
    prev[s] = -1;
    const q = [s];
    while (q.length) {
      const i = q.shift();
      const x = i % W, y = (i / W) | 0;
      if (goal(x, y)) {
        const path = [];
        for (let k = i; k !== -1; k = prev[k]) path.unshift([k % W, (k / W) | 0]);
        return path;
      }
      for (const [nx, ny] of neighbors(x, y)) {
        if (!w.inBounds(nx, ny)) continue;
        const j = ny * W + nx;
        if (prev[j] !== -2 || !passable(nx, ny)) continue;
        prev[j] = i;
        q.push(j);
      }
    }
    return null;
  }
  const four = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];

  for (const seed of (globalThis.__seeds || [7, 21, 99, 314, 2718])) for (const [depth, wo] of (globalThis.__only || [[1, 'clean'], [2, 'hot'], [3, 'clean'], [4, 'hot']])) {
    g.forcedSeed = seed;
    g.newRun();
    g.run.depth = depth;
    g.run.workOrder = wo;
    g.run.mutator = 'audit';
    g.startFloor();
    const w = g.world;
    const gates = w.level.gates.filter((q) => q.kind !== 'bulkhead');
    const fuse = w.devices.find((d) => d.constructor.name === 'FuseHolder');
    let phase = 'gates', gateIdx = 0, frames = 0, locks = 0, perfect = 0, fails = 0, cornersCut = 0;
    // Out of padlocks, the bot does what a tired tech does: throws the breaker and runs.
    const walkable = (x, y) => !w.isSolidTile(x, y) && (!w.isWaterLive(x, y) || w.body.padlocks === 0);

    const bodyToward = (path) => {
      const b = w.body;
      if (!path || !path.length) return { x: 0, y: 0 };
      const [nx, ny] = path[Math.min(1, path.length - 1)];
      const tx = (nx + 0.5) * TILE, ty = (ny + 0.5) * TILE;
      const dx = tx - b.x, dy = ty - b.y;
      return { x: Math.abs(dx) > 3 ? Math.sign(dx) : 0, y: Math.abs(dy) > 3 ? Math.sign(dy) : 0 };
    };

    while (frames < 60 * 240 && g.world === w && !w.completed) {
      frames++;
      const b = w.body, v = w.voxel;
      b.hp = b.maxHp; b.iframes = 1; // the bot is testing solvability, not combat
      const body = { x: 0, y: 0, interact: false, interactHeld: false, cycle: false, use: false, dodge: false };
      const voxel = { x: 0, y: 0, hackPressed: false, hackHeld: false, hackReleased: false, materialize: false, overclock: false };
      const btx = Math.floor(b.x / TILE), bty = Math.floor(b.y / TILE);

      if (b.skill) {
        const s = b.skill;
        if (!s.done && s.pos >= s.perfStart + 0.005 && s.pos <= s.perfStart + s.perfectWidth - 0.005) body.interact = true;
      } else if (phase === 'gates') {
        const gate = gates[gateIdx];
        if (!gate) phase = 'exit';
        else {
          const e = w.circuit.getEdge(gate.edge);
          const dev = w.devices.find((d) => d.edge === gate.edge);
          const near = w.bodyTarget && w.bodyTarget.device === dev;
          if (b.padlocks === 0 && !e.locked) { gateIdx++; cornersCut++; }
          else if (near && (e.closed || (!e.locked && b.padlocks > 0))) {
            if (frames % 20 === 0) body.interact = true; // throw, then lock
          } else if (e.locked) { gateIdx++; locks++; }
          else {
            // Approach a wall-mounted box from the front, then face it.
            const [fx, fy] = { N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0] }[dev.wall] || [0, 1];
            const path = bfs(w, btx, bty, (x, y) => x === dev.x + fx && y === dev.y + fy, walkable, four);
            if (path && path.length === 1 && Math.hypot(b.x - (dev.x + fx + 0.5) * TILE, b.y - (dev.y + fy + 0.5) * TILE) < 6) { body.x = -fx; body.y = -fy; }
            else Object.assign(body, bodyToward(path));
          }
        }
      }
      if (phase === 'exit' && !b.skill) {
        const exit = w.level.exit;
        if (btx === exit.x && bty === exit.y && Math.hypot(b.x - (exit.x + 0.5) * TILE, b.y - (exit.y + 0.5) * TILE) < 20) body.interact = frames % 10 === 0;
        else {
          const path = bfs(w, btx, bty, (x, y) => x === exit.x && y === exit.y, walkable, four);
          Object.assign(body, bodyToward(path));
          if (!path && frames % 120 === 0) results.push(`depth ${depth}: waiting for bulkhead at frame ${frames}`);
        }
      }
      // Voxel: ride conduits to the fuse, then hold the jumper.
      // Good P2 discipline: wait on the fuse (regenerating) until the Body heads for the exit.
      if (v.jumper) voxel.hackHeld = true;
      else if (v.tx === fuse.x && v.ty === fuse.y && !v.moving) {
        if (phase === 'exit' && v.coherence > 60) { voxel.hackPressed = true; voxel.hackHeld = true; }
      }
      else {
        const path = bfs(w, v.tx, v.ty, (x, y) => x === fuse.x && y === fuse.y, () => true,
          (x, y) => [[1, 0, 2], [-1, 0, 8], [0, 1, 4], [0, -1, 1]].filter(([, , bit]) => w.conduitAt(x, y) & bit).map(([dx, dy]) => [x + dx, y + dy]));
        if (path && path.length > 1) { voxel.x = path[1][0] - v.tx; voxel.y = path[1][1] - v.ty; }
      }
      // P2 defends itself: tap a shunt pulse when Bit-Rot gets close (but never on the fuse tile).
      if (!v.jumper && !(v.tx === fuse.x && v.ty === fuse.y) && w.anomalies.some((a) => a.kind === 'crawler' && Math.hypot(a.x - v.x, a.y - v.y) < 70)) {
        if (frames % 2 === 0) { voxel.hackPressed = true; voxel.hackHeld = true; } else voxel.hackReleased = true;
      }

      if (globalThis.__trace && frames % 300 === 0) results.push(`  t${(frames/60)|0} phase=${phase} body=${btx},${bty} vox=${v.tx},${v.ty} fuse=${fuse.x},${fuse.y} coh=${v.coherence|0} desync=${v.desyncT>0} jumper=${!!v.jumper} moving=${v.moving}`);
      const skillBefore = b.skill;
      w.update(STEP, { body, voxel });
      if (skillBefore && skillBefore.done && skillBefore.resultT === 0) { if (skillBefore.result === 'perfect') perfect++; else if (skillBefore.result === 'fail') fails++; }
      g.input.consume();
    }
    results.push(`seed ${seed} depth ${depth} (${wo}): ${w.completed ? 'SOLVED' : 'STUCK in phase ' + phase + ' gate ' + gateIdx}` +
      ` in ${(frames / 60).toFixed(1)}s · gates ${gates.length} · locks hung ${locks} · corners cut ${cornersCut} · perfect checks ${perfect} · fails ${fails} · bulkhead ${w.devices.find((d) => d.constructor.name === 'Bulkhead').open.toFixed(2)}`);
  }
  // ---------------------------------------------------------------- the boss, legitimately
  for (const seed of (globalThis.__seeds || [7, 21, 99])) {
    g.forcedSeed = seed;
    g.newRun();
    g.run.depth = 5;
    g.run.lotoCount = 3;
    g.startBoss();
    const w = g.world, boss = w.boss;
    const ground = w.devices.find((d) => d.constructor.name === 'GroundNode');
    const disc = w.devices.find((d) => d.constructor.name === 'MainDisconnect');
    let frames = 0, hits = 0;
    const walkable = (x, y) => !w.isSolidTile(x, y);
    const toward = (path) => {
      if (!path || !path.length) return { x: 0, y: 0 };
      const [nx, ny] = path[Math.min(1, path.length - 1)];
      const dx = (nx + 0.5) * TILE - w.body.x, dy = (ny + 0.5) * TILE - w.body.y;
      return { x: Math.abs(dx) > 3 ? Math.sign(dx) : 0, y: Math.abs(dy) > 3 ? Math.sign(dy) : 0 };
    };
    const nearTile = (dx0, dy0) => (x, y) => Math.abs(x - dx0) <= 1 && Math.abs(y - dy0) <= 1 && !(x === dx0 && y === dy0);
    while (frames < 60 * 300 && !boss.defeated) {
      frames++;
      const b = w.body, v = w.voxel;
      b.hp = b.maxHp; b.iframes = 1;
      const body = { x: 0, y: 0, interact: false, use: false };
      const voxel = { x: 0, y: 0, hackPressed: false, hackHeld: false, hackReleased: false };
      const btx = Math.floor(b.x / TILE), bty = Math.floor(b.y / TILE);
      if (b.skill) {
        const s = b.skill;
        if (!s.done && s.pos >= s.perfStart + 0.005 && s.pos <= s.perfStart + s.perfectWidth - 0.005) body.interact = true;
      } else if (boss.phase === 1) {
        const ph = ['A', 'B', 'C'].find((p) => !boss.failed.has(p) && w.circuit.isEnergized('BUSH_' + p));
        if (ph) {
          const dev = w.devices.find((d) => d.edge === 'BRK_' + ph);
          if (w.bodyTarget && w.bodyTarget.device === dev) body.interact = frames % 20 === 0;
          else Object.assign(body, toward(bfs(w, btx, bty, nearTile(dev.x, dev.y), walkable, four)));
        }
      } else if (boss.phase === 2) {
        const c = w.level.center;
        const path = bfs(w, btx, bty, (x, y) => x === c.x && y === c.y + 2, walkable, four);
        if (path && path.length > 1) Object.assign(body, toward(path));
        else { body.y = -1; if (w.circuit.getEdge('GND').bridged && frames % 27 === 0) { body.use = true; hits++; } }
      } else if (boss.phase === 3) {
        if (w.bodyTarget && w.bodyTarget.device === disc) body.interact = frames % 15 === 0 && w.circuit.getEdge('GND').bridged;
        else Object.assign(body, toward(bfs(w, btx, bty, nearTile(disc.x, disc.y), walkable, four)));
      }
      if (boss.phase >= 2) {
        if (v.jumper) voxel.hackHeld = true;
        else if (v.tx === ground.x && v.ty === ground.y) { if (v.coherence > 50) { voxel.hackPressed = true; voxel.hackHeld = true; } }
        else {
          const path = bfs(w, v.tx, v.ty, (x, y) => x === ground.x && y === ground.y, () => true,
            (x, y) => [[1, 0, 2], [-1, 0, 8], [0, 1, 4], [0, -1, 1]].filter(([, , bit]) => w.conduitAt(x, y) & bit).map(([dx, dy]) => [x + dx, y + dy]));
          if (path && path.length > 1) { voxel.x = path[1][0] - v.tx; voxel.y = path[1][1] - v.ty; }
        }
      }
      w.update(STEP, { body, voxel });
      g.input.consume();
    }
    results.push(`seed ${seed} BOSS: ${boss.defeated ? 'DEFEATED via ' + boss.how : 'STUCK in phase ' + boss.phase} in ${(frames / 60).toFixed(1)}s · core ${boss.coreHp}/${boss.maxCoreHp} · stick swings ${hits} · disconnect ${disc.progress}/3 · ending → ${g.state === 'ending' ? g.endingId : '(pending ' + w.exitT.toFixed(1) + 's)'}`);
  }
  return results;
});
console.log(out.join('\n'));
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 5).join('\n') : 'NO ERRORS');
await close();
process.exit(errors.length || out.some((l) => l.includes('STUCK')) ? 1 : 0);
