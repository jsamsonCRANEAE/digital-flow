// Seeded multi-room substation generator. Rooms sit on a grid sharing walls; a random
// spanning tree (plus a few loops) links them. Gates are placed on the critical path,
// each gate's breaker is placed strictly *before* it, and a validator proves the floor
// is solvable by two cooperating players before it is accepted. Pure module.
import { RNG } from '../engine/Util.js';

export const T = { VOID: 0, FLOOR: 1, WALL: 2, CABINET: 3, FENCE: 4 };
export const DIR = { N: 1, E: 2, S: 4, W: 8 };
export const DIRS = [
  { bit: DIR.N, dx: 0, dy: -1, opp: DIR.S },
  { bit: DIR.E, dx: 1, dy: 0, opp: DIR.W },
  { bit: DIR.S, dx: 0, dy: 1, opp: DIR.N },
  { bit: DIR.W, dx: -1, dy: 0, opp: DIR.E },
];
export const SOLID_DEVICES = new Set(['breaker', 'fuse', 'capacitor', 'terminal', 'relay', 'cagelock', 'feeder', 'transformer', 'disconnect', 'ground', 'vending']);

const RW = 15, RH = 11;
const PHASE_ORDER = ['A', 'B', 'C'];

export const DEPTH_CONFIG = [
  null,
  { cols: 3, rows: 3, hazards: 1, arcs: 0, caps: 1, hounds: 1, crawlers: 2, phantoms: 0, scrap: 4 },
  { cols: 4, rows: 3, hazards: 1, arcs: 1, caps: 1, hounds: 2, crawlers: 3, phantoms: 1, scrap: 5 },
  { cols: 4, rows: 3, hazards: 2, arcs: 1, caps: 2, hounds: 3, crawlers: 4, phantoms: 1, scrap: 5 },
  { cols: 5, rows: 3, hazards: 2, arcs: 2, caps: 2, hounds: 4, crawlers: 5, phantoms: 2, scrap: 6 },
];

export function generateLevel({ seed, depth, workOrder = 'clean', mutator = null }) {
  if (depth >= 5) return generateBoss(seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    const L = tryGenerate((seed + attempt * 7919) >>> 0, depth, workOrder, mutator);
    if (!L) continue;
    const v = validateLevel(L);
    if (v.ok) { L.attempts = attempt + 1; return L; }
  }
  throw new Error(`LevelGen: no solvable layout for seed ${seed}`);
}

function makeGrid(W, H) {
  return {
    w: W, h: H,
    tiles: new Uint8Array(W * H).fill(T.WALL),
    water: new Uint8Array(W * H),
    waterNode: new Int16Array(W * H).fill(-1),
    conduit: new Uint8Array(W * H),
  };
}

function drawConduit(L, x0, y0, x1, y1) {
  // L-shaped run: horizontal first, then vertical.
  const step = (ax, ay, bx, by) => {
    const d = DIRS.find((q) => q.dx === bx - ax && q.dy === by - ay);
    L.conduit[ay * L.w + ax] |= d.bit;
    L.conduit[by * L.w + bx] |= d.opp;
  };
  let x = x0, y = y0;
  while (x !== x1) { const nx = x + Math.sign(x1 - x); step(x, y, nx, y); x = nx; }
  while (y !== y1) { const ny = y + Math.sign(y1 - y); step(x, y, x, ny); y = ny; }
}

function tryGenerate(seed, depth, workOrder, mutator) {
  const rng = new RNG(seed);
  const cfg = { ...DEPTH_CONFIG[Math.min(4, Math.max(1, depth))] };
  if (workOrder === 'hot') { cfg.hounds = cfg.hounds * 2 + 1; cfg.crawlers += 1; cfg.caps += 1; }
  if (mutator === 'harmonic') cfg.phantoms += 2;
  const cols = cfg.cols, rows = cfg.rows;
  const W = cols * (RW - 1) + 1, H = rows * (RH - 1) + 1;
  const L = {
    seed, depth, workOrder, mutator, boss: false,
    ...makeGrid(W, H),
    rooms: [], links: [], devices: [], spawns: [], gates: [], bulbs: [],
    hazardNodes: [], circuit: { nodes: [], edges: [] },
    start: null, voxelStart: null, exit: null,
  };
  const idx = (x, y) => y * W + x;
  const occupied = new Set();
  const reserved = new Set();

  // Rooms
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = gx * (RW - 1), y0 = gy * (RH - 1);
      const room = { id: L.rooms.length, gx, gy, x0, y0, cx: x0 + 7, cy: y0 + 5, links: [], dist: -1 };
      L.rooms.push(room);
      for (let y = y0 + 1; y < y0 + RH - 1; y++) for (let x = x0 + 1; x < x0 + RW - 1; x++) L.tiles[idx(x, y)] = T.FLOOR;
    }
  }
  const roomAt = (gx, gy) => (gx >= 0 && gy >= 0 && gx < cols && gy < rows ? L.rooms[gy * cols + gx] : null);

  // Spanning tree (randomised DFS) + loops
  const startRoom = roomAt(0, rng.int(0, rows - 1));
  const linked = new Set();
  const key = (a, b) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);
  const addLink = (a, b) => {
    const k = key(a, b);
    if (linked.has(k)) return;
    linked.add(k);
    const link = { a, b, id: L.links.length };
    L.links.push(link); a.links.push(link); b.links.push(link);
  };
  const seen = new Set([startRoom.id]);
  const stack = [startRoom];
  while (stack.length) {
    const r = stack[stack.length - 1];
    const nbrs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => roomAt(r.gx + dx, r.gy + dy)).filter((n) => n && !seen.has(n.id)));
    if (!nbrs.length) { stack.pop(); continue; }
    const n = nbrs[0];
    seen.add(n.id);
    addLink(r, n);
    stack.push(n);
  }
  for (const r of L.rooms) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const n = roomAt(r.gx + dx, r.gy + dy);
      if (n && !linked.has(key(r, n)) && rng.chance(0.16)) addLink(r, n);
    }
  }

  // Doors (3 wide) through shared walls; record door tiles and reserve their surroundings.
  for (const link of L.links) {
    const { a, b } = link;
    const tiles = [];
    if (a.gy === b.gy) {
      const left = a.gx < b.gx ? a : b;
      const wx = left.x0 + RW - 1;
      for (let y = left.cy - 1; y <= left.cy + 1; y++) { L.tiles[idx(wx, y)] = T.FLOOR; tiles.push([wx, y]); }
      link.door = { orient: 'v', x: wx, y: left.cy, tiles };
    } else {
      const top = a.gy < b.gy ? a : b;
      const wy = top.y0 + RH - 1;
      for (let x = top.cx - 1; x <= top.cx + 1; x++) { L.tiles[idx(x, wy)] = T.FLOOR; tiles.push([x, wy]); }
      link.door = { orient: 'h', x: top.cx, y: wy, tiles };
    }
    for (const [tx, ty] of tiles) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) reserved.add(idx(tx + dx, ty + dy));
    }
  }

  // Room graph distances from start
  const bfsRooms = (from, blocked = new Set()) => {
    const dist = new Map([[from.id, 0]]);
    const parent = new Map();
    const q = [from];
    while (q.length) {
      const r = q.shift();
      for (const link of r.links) {
        if (blocked.has(link.id)) continue;
        const n = link.a === r ? link.b : link.a;
        if (dist.has(n.id)) continue;
        dist.set(n.id, dist.get(r.id) + 1);
        parent.set(n.id, { room: r, link });
        q.push(n);
      }
    }
    return { dist, parent };
  };
  const { dist, parent } = bfsRooms(startRoom);
  for (const r of L.rooms) r.dist = dist.get(r.id) ?? -1;
  let exitRoom = startRoom;
  for (const r of L.rooms) if (r.dist > exitRoom.dist || (r.dist === exitRoom.dist && rng.chance(0.5))) exitRoom = r;
  if (exitRoom === startRoom) return null;
  const path = [exitRoom];
  const pathLinks = [];
  while (path[0] !== startRoom) {
    const p = parent.get(path[0].id);
    pathLinks.unshift(p.link);
    path.unshift(p.room);
  }
  startRoom.isStart = true;
  exitRoom.isExit = true;

  // Conduit trunk between linked room centres (passes exactly through door centres).
  for (const link of L.links) drawConduit(L, link.a.cx, link.a.cy, link.b.cx, link.b.cy);

  // Player starts + reserve the centre cross for movement
  L.start = { x: startRoom.cx, y: startRoom.cy + 2 };
  L.voxelStart = { x: startRoom.cx, y: startRoom.cy };
  for (const r of L.rooms) {
    for (let x = r.x0 + 1; x < r.x0 + RW - 1; x++) reserved.add(idx(x, r.cy));
    for (let y = r.y0 + 1; y < r.y0 + RH - 1; y++) reserved.add(idx(r.cx, y));
  }
  reserved.add(idx(L.start.x, L.start.y));

  const isFree = (x, y) => L.tiles[idx(x, y)] === T.FLOOR && !occupied.has(idx(x, y)) && !L.water[idx(x, y)];
  const clearAround = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (occupied.has(idx(x + dx, y + dy))) return false;
    }
    return true;
  };

  // Interior tile adjacent to the room's own boundary wall, away from doors.
  const wallSpot = (room) => {
    const cands = [];
    for (let y = room.y0 + 1; y < room.y0 + RH - 1; y++) {
      for (let x = room.x0 + 1; x < room.x0 + RW - 1; x++) {
        let wall = null;
        if (y === room.y0 + 1) wall = 'N';
        else if (y === room.y0 + RH - 2) wall = 'S';
        else if (x === room.x0 + 1) wall = 'W';
        else if (x === room.x0 + RW - 2) wall = 'E';
        if (!wall) continue;
        if (reserved.has(idx(x, y)) || !isFree(x, y) || !clearAround(x, y)) continue;
        cands.push({ x, y, wall });
      }
    }
    return cands.length ? rng.pick(cands) : null;
  };
  const interiorSpot = (room, margin = 2) => {
    for (let i = 0; i < 80; i++) {
      const x = rng.int(room.x0 + margin, room.x0 + RW - 1 - margin);
      const y = rng.int(room.y0 + margin, room.y0 + RH - 1 - margin);
      if (isFree(x, y) && !reserved.has(idx(x, y)) && clearAround(x, y)) return { x, y };
    }
    return null;
  };
  const place = (spec) => {
    L.devices.push(spec);
    if (spec.x !== undefined) occupied.add(idx(spec.x, spec.y));
    return spec;
  };
  const branch = (room, x, y) => drawConduit(L, room.cx, room.cy, x, y);

  // Circuit skeleton
  const C = L.circuit;
  for (const ph of PHASE_ORDER) {
    C.nodes.push({ id: `SRC_${ph}`, type: 'source', phase: ph, voltage: 480, label: `FEEDER ${ph}` });
    C.nodes.push({ id: `LIGHT_${ph}`, type: 'load', load: 10, label: `LIGHTING ${ph}` });
    C.edges.push({ id: `W_LIGHT_${ph}`, a: `SRC_${ph}`, b: `LIGHT_${ph}`, type: 'wire' });
  }
  const feederSpot = wallSpot(startRoom);
  if (feederSpot) place({ type: 'feeder', ...feederSpot });

  // Gates on the critical path (last door is always the powered bulkhead).
  const nDoors = pathLinks.length;
  const candidates = rng.shuffle([...Array(Math.max(0, nDoors - 1)).keys()]);
  const nHaz = Math.min(cfg.hazards, candidates.length);
  const nArc = Math.min(cfg.arcs, candidates.length - nHaz);
  const gateKinds = new Map();
  candidates.slice(0, nHaz).forEach((k) => gateKinds.set(k, 'water'));
  candidates.slice(nHaz, nHaz + nArc).forEach((k) => gateKinds.set(k, 'arc'));
  gateKinds.set(nDoors - 1, 'bulkhead');
  const gateLinkIds = new Map([...gateKinds.keys()].map((k) => [pathLinks[k].id, k]));

  let hz = 0;
  const loadPerPhase = { A: 0, B: 0, C: 0 };
  for (let k = 0; k < nDoors; k++) {
    const kind = gateKinds.get(k);
    if (!kind) continue;
    const link = pathLinks[k];
    const door = link.door;
    // Region reachable before this gate: block it and every later gate.
    const blocked = new Set([...gateLinkIds].filter(([, gk]) => gk >= k).map(([id]) => id));
    const region = [...bfsRooms(startRoom, blocked).dist.keys()].map((id) => L.rooms[id]);

    if (kind === 'bulkhead') {
      const nodeId = 'BULK';
      C.nodes.push({ id: nodeId, type: 'load', load: 8, role: 'bulkhead', label: 'BULKHEAD ACTUATOR' });
      C.edges.push({ id: 'FUSE_BULK', a: 'SRC_A', b: nodeId, type: 'fuse', blown: true, label: 'F-200A' });
      const fuseRooms = rng.shuffle(L.rooms.filter((r) => !r.isExit && !r.isStart));
      let spot = null, fr = null;
      for (const r of fuseRooms.length ? fuseRooms : [startRoom]) { spot = wallSpot(r); if (spot) { fr = r; break; } }
      if (!spot) return null;
      place({ type: 'fuse', ...spot, edge: 'FUSE_BULK' });
      branch(fr, spot.x, spot.y);
      L.devices.push({ type: 'bulkhead', tiles: door.tiles, orient: door.orient, node: nodeId });
      L.gates.push({ kind, k, link: link.id, tiles: door.tiles, node: nodeId, fuse: { x: spot.x, y: spot.y } });
      continue;
    }

    const phase = PHASE_ORDER[hz % 3];
    const nodeId = kind === 'water' ? `HAZ_${hz}` : `ARC_${hz}`;
    const edgeId = `BRK_${hz}`;
    const load = kind === 'water' ? 20 : 15;
    loadPerPhase[phase] += load;
    C.nodes.push({ id: nodeId, type: 'load', load, role: kind === 'water' ? 'hazard' : 'arc', label: kind === 'water' ? `SUMP PUMP ${hz + 1}` : `ARC BUS ${hz + 1}` });
    C.edges.push({ id: edgeId, a: `SRC_${phase}`, b: nodeId, type: 'breaker', label: `${depth}${phase}-${String(hz + 1).padStart(2, '0')}` });

    let spot = null, br = null;
    for (const r of rng.shuffle(region.slice())) { spot = wallSpot(r); if (spot) { br = r; break; } }
    if (!spot) return null;
    place({ type: 'breaker', ...spot, edge: edgeId, phase, label: `${depth}${phase}-${String(hz + 1).padStart(2, '0')}` });
    branch(br, spot.x, spot.y);

    const gate = { kind, k, link: link.id, tiles: door.tiles.slice(), node: nodeId, edge: edgeId, breaker: { x: spot.x, y: spot.y } };
    if (kind === 'water') {
      const hi = L.hazardNodes.length;
      L.hazardNodes.push(nodeId);
      gate.waterIndex = hi;
      gate.tiles = [];
      const cx = door.x, cy = door.y;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (L.tiles[idx(x, y)] !== T.FLOOR) continue;
        L.water[idx(x, y)] = 1;
        L.waterNode[idx(x, y)] = hi;
        gate.tiles.push([x, y]);
      }
    } else {
      const [a, b] = door.orient === 'v'
        ? [[door.x, door.y - 2], [door.x, door.y + 2]]
        : [[door.x - 2, door.y], [door.x + 2, door.y]];
      L.devices.push({ type: 'arc', ax: a[0], ay: a[1], bx: b[0], by: b[1], node: nodeId, tiles: door.tiles, orient: door.orient });
    }
    L.gates.push(gate);
    hz++;
  }

  // Elevator in the exit room centre.
  C.nodes.push({ id: 'ELEV', type: 'load', load: 6, label: 'ELEVATOR' });
  C.edges.push({ id: 'W_ELEV', a: 'SRC_A', b: 'ELEV', type: 'wire' });
  loadPerPhase.A += 6;
  L.exit = { x: exitRoom.cx, y: exitRoom.cy };
  L.devices.push({ type: 'elevator', x: exitRoom.cx, y: exitRoom.cy });
  occupied.add(idx(exitRoom.cx, exitRoom.cy));

  // Ballast loads so the untouched grid is perfectly balanced (LOTO then *creates* imbalance).
  const maxLoad = Math.max(loadPerPhase.A, loadPerPhase.B, loadPerPhase.C);
  for (const ph of PHASE_ORDER) {
    const diff = maxLoad - loadPerPhase[ph];
    if (diff > 0) {
      C.nodes.push({ id: `BALLAST_${ph}`, type: 'load', load: diff, label: `HVAC ${ph}` });
      C.edges.push({ id: `W_BALLAST_${ph}`, a: `SRC_${ph}`, b: `BALLAST_${ph}`, type: 'wire' });
    }
  }

  const nonStart = L.rooms.filter((r) => !r.isStart);

  // Capacitor banks
  for (let i = 0; i < cfg.caps; i++) {
    const r = rng.pick(nonStart);
    const s = interiorSpot(r, 2);
    if (s) place({ type: 'capacitor', ...s, id: `CAP_${i}` });
  }

  // Hidden schematic cipher: a terminal only the Voxel can read + a 4-relay bank only the Body can set.
  const cipherRooms = rng.shuffle(L.rooms.filter((r) => !r.isStart && !r.isExit));
  for (const r of cipherRooms) {
    const runs = [];
    for (const y of [r.y0 + 1, r.y0 + RH - 2]) {
      for (let x = r.x0 + 1; x <= r.x0 + RW - 6; x++) {
        let ok = true;
        for (let k = 0; k < 4; k++) if (!isFree(x + k, y) || reserved.has(idx(x + k, y))) ok = false;
        if (ok) runs.push({ x, y });
      }
    }
    if (!runs.length) continue;
    const run = rng.pick(runs);
    const bits = [8, 4, 2, 1];
    for (let k = 0; k < 4; k++) place({ type: 'relay', x: run.x + k, y: run.y, bit: bits[k], group: 0, wall: run.y === r.y0 + 1 ? 'N' : 'S' });
    const ts = wallSpot(r);
    if (!ts) { L.devices = L.devices.filter((d) => d.type !== 'relay'); continue; }
    place({ type: 'terminal', ...ts, value: rng.int(1, 15), group: 0 });
    branch(r, ts.x, ts.y);
    break;
  }

  // Fenced cage: co-op loot behind chain-link that only the Voxel can unlock (or a phased dodge can pass).
  if (rng.chance(0.7)) {
    for (const r of rng.shuffle(nonStart.filter((q) => !q.isExit))) {
      const corners = rng.shuffle([[r.x0 + 1, r.y0 + 1], [r.x0 + RW - 5, r.y0 + 1], [r.x0 + 1, r.y0 + RH - 5], [r.x0 + RW - 5, r.y0 + RH - 5]]);
      let done = false;
      for (const [ax, ay] of corners) {
        let ok = true;
        for (let y = ay; y < ay + 4 && ok; y++) for (let x = ax; x < ax + 4; x++) {
          if (!isFree(x, y) || reserved.has(idx(x, y))) { ok = false; break; }
        }
        if (!ok) continue;
        const cage = [];
        for (let y = ay; y < ay + 4; y++) for (let x = ax; x < ax + 4; x++) {
          const ring = x === ax || x === ax + 3 || y === ay || y === ay + 3;
          if (ring) { L.tiles[idx(x, y)] = T.FENCE; cage.push([x, y]); }
          occupied.add(idx(x, y));
        }
        const ls = wallSpot(r);
        if (!ls) {
          for (const [x, y] of cage) L.tiles[idx(x, y)] = T.FLOOR;
          continue;
        }
        place({ type: 'cagelock', ...ls, cage });
        branch(r, ls.x, ls.y);
        const loot = rng.chance(0.45) ? { type: 'memory', x: ax + 1, y: ay + 1 } : { type: 'scrap', x: ax + 1, y: ay + 2, amount: 30 };
        L.devices.push(loot);
        done = true;
        break;
      }
      if (done) break;
    }
  }

  // Cabinets: electrical enclosures that cast hard shadows.
  for (const r of L.rooms) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const horiz = rng.chance(0.5);
      const w = horiz ? 2 : 1, h = horiz ? 1 : 2;
      for (let tries = 0; tries < 20; tries++) {
        const x = rng.int(r.x0 + 2, r.x0 + RW - 3 - w + 1);
        const y = rng.int(r.y0 + 2, r.y0 + RH - 3 - h + 1);
        let ok = true;
        for (let yy = y - 1; yy <= y + h && ok; yy++) for (let xx = x - 1; xx <= x + w; xx++) {
          const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
          if (inside && (!isFree(xx, yy) || reserved.has(idx(xx, yy)))) { ok = false; break; }
          if (!inside && occupied.has(idx(xx, yy))) { ok = false; break; }
        }
        if (!ok) continue;
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { L.tiles[idx(xx, yy)] = T.CABINET; occupied.add(idx(xx, yy)); }
        break;
      }
    }
  }

  // Decorative (safe) puddles from leaking ceilings.
  const puddleCount = (mutator === 'flooded' ? 4 : 1) * L.rooms.length;
  for (let i = 0; i < puddleCount; i++) {
    const r = rng.pick(L.rooms);
    let x = rng.int(r.x0 + 1, r.x0 + RW - 2), y = rng.int(r.y0 + 1, r.y0 + RH - 2);
    const size = rng.int(3, mutator === 'flooded' ? 14 : 8);
    for (let s = 0; s < size; s++) {
      if (L.tiles[idx(x, y)] === T.FLOOR && !occupied.has(idx(x, y)) && L.waterNode[idx(x, y)] < 0) L.water[idx(x, y)] = 1;
      const d = rng.pick(DIRS);
      const nx = x + d.dx, ny = y + d.dy;
      if (nx > r.x0 && nx < r.x0 + RW - 1 && ny > r.y0 && ny < r.y0 + RH - 1) { x = nx; y = ny; }
    }
  }

  // Bulbs
  for (const r of L.rooms) {
    if (!r.isStart && rng.chance(0.15)) continue; // a dead room
    const n = rng.int(1, 2);
    for (let i = 0; i < n; i++) {
      const roll = rng.next();
      L.bulbs.push({
        x: (rng.range(r.x0 + 3, r.x0 + RW - 3)) * 32, y: (rng.range(r.y0 + 2.5, r.y0 + RH - 2.5)) * 32,
        r: rng.range(170, 240), kind: roll < 0.55 ? 'steady' : roll < 0.85 ? 'flicker' : 'dying', seed: rng.int(0, 9999),
      });
    }
  }

  // Pickups
  const pickupRooms = nonStart.length ? nonStart : L.rooms;
  for (let i = 0; i < cfg.scrap; i++) {
    const s = interiorSpot(rng.pick(pickupRooms), 1);
    if (s) place({ type: 'scrap', ...s, amount: rng.int(6, 14) });
  }
  if (workOrder === 'clean') {
    const s = interiorSpot(rng.pick(pickupRooms), 1);
    if (s) place({ type: 'memory', ...s });
  }

  // Anomaly spawns (never in the start room)
  const spawnIn = (kind, n) => {
    for (let i = 0; i < n; i++) {
      const r = rng.pick(nonStart);
      const s = interiorSpot(r, 2);
      if (s) L.spawns.push({ kind, x: s.x, y: s.y });
    }
  };
  spawnIn('hound', cfg.hounds);
  spawnIn('crawler', cfg.crawlers);
  spawnIn('phantom', cfg.phantoms);

  return L;
}

/**
 * Proves co-op solvability: Body floods walkable space, opening any gate whose breaker it can
 * reach (open + LOTO), until a fixpoint; Voxel must reach every fuse/terminal/lock via conduit.
 */
export function validateLevel(L) {
  const W = L.w, H = L.h;
  const idx = (x, y) => y * W + x;
  const reasons = [];
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) solid[i] = L.tiles[i] === T.FLOOR ? 0 : 1;
  for (const d of L.devices) if (SOLID_DEVICES.has(d.type) && d.x !== undefined) solid[idx(d.x, d.y)] = 1;
  const gateTiles = new Map();
  for (const g of L.gates) {
    if (g.kind === 'bulkhead') continue;
    for (const [x, y] of g.tiles) gateTiles.set(idx(x, y), g);
  }
  const opened = new Set();
  let reach = null;
  for (let iter = 0; iter < L.gates.length + 2; iter++) {
    reach = new Uint8Array(W * H);
    const q = [idx(L.start.x, L.start.y)];
    reach[q[0]] = 1;
    while (q.length) {
      const i = q.pop();
      const x = i % W, y = (i / W) | 0;
      for (const d of DIRS) {
        const nx = x + d.dx, ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = idx(nx, ny);
        if (reach[j] || solid[j]) continue;
        const g = gateTiles.get(j);
        if (g && !opened.has(g)) continue;
        reach[j] = 1;
        q.push(j);
      }
    }
    let changed = false;
    for (const g of L.gates) {
      if (g.kind === 'bulkhead' || opened.has(g)) continue;
      if (adjacentReached(reach, W, H, g.breaker.x, g.breaker.y)) { opened.add(g); changed = true; }
    }
    if (!changed) break;
  }
  const exit = L.devices.find((d) => d.type === 'elevator');
  const disconnect = L.devices.find((d) => d.type === 'disconnect');
  if (exit ? !reach[idx(exit.x, exit.y)] : !(disconnect && adjacentReached(reach, W, H, disconnect.x, disconnect.y))) reasons.push('exit unreachable');
  for (const d of L.devices) {
    if (d.type === 'breaker' && !adjacentReached(reach, W, H, d.x, d.y)) reasons.push(`breaker ${d.edge} unreachable`);
    if (d.type === 'relay' && !adjacentReached(reach, W, H, d.x, d.y)) reasons.push('relay unreachable');
    if (d.type === 'capacitor' && !adjacentReached(reach, W, H, d.x, d.y)) reasons.push('capacitor unreachable');
  }
  // The secret ending needs one schematic cipher on every regular floor.
  if (!L.boss && !L.devices.some((d) => d.type === 'terminal')) reasons.push('no cipher terminal');
  // Voxel: conduit connectivity
  const creach = new Uint8Array(W * H);
  const s = idx(L.voxelStart.x, L.voxelStart.y);
  if (!L.conduit[s]) reasons.push('voxel start not on conduit');
  const q = [s];
  creach[s] = 1;
  while (q.length) {
    const i = q.pop();
    const x = i % W, y = (i / W) | 0;
    for (const d of DIRS) {
      if (!(L.conduit[i] & d.bit)) continue;
      const j = idx(x + d.dx, y + d.dy);
      if (creach[j]) continue;
      creach[j] = 1;
      q.push(j);
    }
  }
  for (const d of L.devices) {
    if (['fuse', 'terminal', 'cagelock', 'breaker', 'ground'].includes(d.type) && !creach[idx(d.x, d.y)]) reasons.push(`${d.type} off-conduit`);
  }
  return { ok: reasons.length === 0, reasons, reach, opened: opened.size };
}

function adjacentReached(reach, W, H, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H && reach[ny * W + nx]) return true;
  }
  return false;
}

/** The final arena: THE MAIN TIE TRANSFORMER. */
export function generateBoss(seed) {
  const rng = new RNG(seed ^ 0xb055);
  const W = 37, H = 27;
  const L = {
    seed, depth: 5, boss: true, workOrder: 'final', mutator: null,
    ...makeGrid(W, H),
    rooms: [], links: [], devices: [], spawns: [], gates: [], bulbs: [], hazardNodes: [],
    circuit: { nodes: [], edges: [] },
  };
  const idx = (x, y) => y * W + x;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) L.tiles[idx(x, y)] = T.FLOOR;
  const cx = 18, cy = 13;
  L.rooms.push({ id: 0, x0: 0, y0: 0, cx, cy, links: [], isStart: true, isExit: true, dist: 0 });
  L.center = { x: cx, y: cy };
  L.start = { x: cx - 4, y: H - 5 };
  L.voxelStart = { x: cx, y: H - 5 };

  // Conduit: perimeter loop + spokes
  const x0 = 4, y0 = 4, x1 = W - 5, y1 = H - 5;
  drawConduit(L, x0, y0, x1, y0); drawConduit(L, x1, y0, x1, y1);
  drawConduit(L, x0, y1, x1, y1); drawConduit(L, x0, y0, x0, y1);
  drawConduit(L, cx, y1, cx, cy + 2); // to the core's neutral
  drawConduit(L, cx, y0, cx, 2);

  const C = L.circuit;
  const bushPos = { A: [2, cy], B: [cx, H - 3], C: [W - 3, cy] };
  for (const ph of PHASE_ORDER) {
    C.nodes.push({ id: `SRC_${ph}`, type: 'source', phase: ph, voltage: 13800, label: `TIE ${ph}` });
    C.nodes.push({ id: `BUSH_${ph}`, type: 'load', load: 40, role: 'bushing', label: `BUSHING H${PHASE_ORDER.indexOf(ph) + 1}` });
    C.edges.push({ id: `BRK_${ph}`, a: `SRC_${ph}`, b: `BUSH_${ph}`, type: 'breaker', label: `52-T${ph}`, forceable: false });
    const [bx, by] = bushPos[ph];
    L.devices.push({ type: 'breaker', x: bx, y: by, edge: `BRK_${ph}`, phase: ph, label: `52-T${ph}`, wall: bx === 2 ? 'W' : bx === W - 3 ? 'E' : 'S' });
  }
  drawConduit(L, x0, cy, 2, cy);
  drawConduit(L, x1, cy, W - 3, cy);
  drawConduit(L, cx, y1, cx, H - 3);
  C.nodes.push({ id: 'CORE', type: 'load', load: 0, label: 'CORE' });
  C.nodes.push({ id: 'EARTH', type: 'bus', label: 'GROUND GRID' });
  C.edges.push({ id: 'GND', a: 'CORE', b: 'EARTH', type: 'fuse', blown: true, label: 'NEUTRAL GROUND' });
  L.devices.push({ type: 'ground', x: x0, y: y0, edge: 'GND' });
  L.devices.push({ type: 'disconnect', x: cx, y: 2 });
  L.devices.push({ type: 'transformer', x: cx, y: cy });

  // Oil-and-rain puddle ring around the core; it goes live during back-feed pulses.
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const d = Math.hypot(x - cx, (y - cy) * 1.2);
    if (d > 4.2 && d < 6.3 && rng.chance(0.7)) { L.water[idx(x, y)] = 1; L.waterNode[idx(x, y)] = -2; }
  }
  for (const [bx, by] of [[8, 6], [W - 9, 6], [8, H - 7], [W - 9, H - 7], [cx, 5], [cx, H - 6]]) {
    L.bulbs.push({ x: bx * 32, y: by * 32, r: 260, kind: rng.chance(0.3) ? 'flicker' : 'steady', seed: rng.int(0, 9999) });
  }
  return L;
}
