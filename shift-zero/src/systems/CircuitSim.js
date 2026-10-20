// Real-time nodal voltage propagation over an undirected conductor graph.
// Sources inject a phase; breakers/fuses gate conduction; SCADA auto-reclose
// re-energises any breaker left open without a LOTO lock. Pure module.

export const PHASES = ['A', 'B', 'C'];

export class CircuitSim {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.adj = new Map();
    this.listeners = [];
    this.recloseDelay = 6;
    this.forcedT = 0;
    this.time = 0;
    this.phaseLoad = { A: 0, B: 0, C: 0 };
    this.imbalance = 0;
    this.stress = 0;
  }

  static fromSpec(spec) {
    const sim = new CircuitSim();
    for (const n of spec.nodes) sim.addNode(n.id, n);
    for (const e of spec.edges) sim.addEdge(e.id, e.a, e.b, e);
    sim.propagate();
    return sim;
  }

  addNode(id, o = {}) {
    const node = {
      id, type: o.type || 'bus', phase: o.phase || null, nominal: o.voltage || 480,
      load: o.load || 0, role: o.role || null, label: o.label || id,
      energized: false, voltage: 0, fedPhase: null, failed: false,
    };
    this.nodes.set(id, node);
    this.adj.set(id, []);
    return node;
  }

  addEdge(id, a, b, o = {}) {
    if (!this.nodes.has(a) || !this.nodes.has(b)) throw new Error(`CircuitSim: edge ${id} references missing node`);
    const edge = {
      id, a, b, type: o.type || 'wire', label: o.label || id,
      closed: o.closed ?? true, blown: !!o.blown, bridged: false,
      locked: false, ghostT: 0, recloseT: 0, loss: o.loss ?? 0.012,
      autoReclose: o.autoReclose ?? true, forceable: o.forceable ?? true, removed: false,
    };
    this.edges.set(id, edge);
    this.adj.get(a).push(edge);
    this.adj.get(b).push(edge);
    return edge;
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  getNode(id) { return this.nodes.get(id); }
  getEdge(id) { return this.edges.get(id); }

  isLocked(e) { return e.locked || e.ghostT > 0; }

  conducts(e) {
    if (e.removed) return false;
    if (e.type === 'breaker') return e.closed && !(this.forcedT > 0 && e.forceable);
    if (e.type === 'fuse') return !e.blown || e.bridged;
    return true;
  }

  open(id, cause = 'manual') {
    const e = this.edges.get(id);
    if (!e || !e.closed) return false;
    e.closed = false;
    e.recloseT = e.autoReclose ? this.recloseDelay : 0;
    this.propagate();
    this.emit('open', { edge: e, cause });
    return true;
  }

  close(id, cause = 'manual') {
    const e = this.edges.get(id);
    if (!e || e.closed || this.isLocked(e)) return false;
    e.closed = true;
    e.recloseT = 0;
    this.propagate();
    this.emit('close', { edge: e, cause });
    return true;
  }

  lock(id) {
    const e = this.edges.get(id);
    if (!e || e.closed || e.locked) return false;
    e.locked = true;
    this.emit('lock', { edge: e });
    return true;
  }

  unlock(id) {
    const e = this.edges.get(id);
    if (!e || !e.locked) return false;
    e.locked = false;
    e.recloseT = e.autoReclose ? this.recloseDelay : 0;
    this.emit('unlock', { edge: e });
    return true;
  }

  /** Ghost Lockout: a digital LOTO projected by the Voxel. Trips the breaker if needed. */
  ghostLock(id, seconds) {
    const e = this.edges.get(id);
    if (!e || e.removed) return false;
    if (e.closed) this.open(id, 'ghost');
    e.ghostT = seconds;
    this.emit('ghost', { edge: e });
    return true;
  }

  setBridge(id, on) {
    const e = this.edges.get(id);
    if (!e || e.bridged === on) return;
    e.bridged = on;
    this.propagate();
    this.emit(on ? 'bridge' : 'unbridge', { edge: e });
  }

  /** Overclock surge: every forceable breaker is held open regardless of state. */
  forceOff(seconds) {
    this.forcedT = Math.max(this.forcedT, seconds);
    this.propagate();
  }

  removeEdge(id) {
    const e = this.edges.get(id);
    if (!e) return;
    e.removed = true;
    this.propagate();
  }

  update(dt) {
    this.time += dt;
    let changed = false;
    if (this.forcedT > 0) {
      this.forcedT -= dt;
      if (this.forcedT <= 0) { this.forcedT = 0; changed = true; }
    }
    for (const e of this.edges.values()) {
      if (e.type !== 'breaker' || e.removed) continue;
      if (e.ghostT > 0) {
        e.ghostT -= dt;
        if (e.ghostT <= 0) {
          e.ghostT = 0;
          if (!e.closed && !e.locked && e.autoReclose) e.recloseT = Math.min(e.recloseT || this.recloseDelay, 1.5);
          this.emit('ghostExpired', { edge: e });
        }
      }
      if (!e.closed && !this.isLocked(e) && e.autoReclose && e.recloseT > 0) {
        e.recloseT -= dt;
        if (e.recloseT <= 0) {
          e.closed = true;
          e.recloseT = 0;
          changed = true;
          this.emit('reclose', { edge: e });
        }
      }
    }
    if (changed) this.propagate();
    // Stress eases toward the current imbalance (plus a kick while the grid is surged).
    const target = Math.min(1, this.imbalance + (this.forcedT > 0 ? 0.25 : 0));
    this.stress += (target - this.stress) * Math.min(1, dt * 0.8);
  }

  /** BFS from every source; each conductor drops a little voltage. Tracks feeding phase. */
  propagate() {
    for (const n of this.nodes.values()) { n.energized = false; n.voltage = 0; n.fedPhase = null; }
    const queue = [];
    for (const n of this.nodes.values()) {
      if (n.type === 'source' && !n.failed) {
        n.energized = true; n.voltage = n.nominal; n.fedPhase = n.phase;
        queue.push(n);
      }
    }
    while (queue.length) {
      const n = queue.shift();
      for (const e of this.adj.get(n.id)) {
        if (!this.conducts(e)) continue;
        const other = this.nodes.get(e.a === n.id ? e.b : e.a);
        if (other.failed) continue;
        const v = n.voltage * (1 - e.loss);
        if (v > other.voltage + 1e-6) {
          other.voltage = v;
          other.energized = true;
          other.fedPhase = n.fedPhase;
          queue.push(other);
        }
      }
    }
    this.computeLoads();
  }

  computeLoads() {
    const pl = { A: 0, B: 0, C: 0 };
    for (const n of this.nodes.values()) {
      if (n.energized && n.load > 0 && n.fedPhase) pl[n.fedPhase] += n.load * (n.voltage / n.nominal);
    }
    this.phaseLoad = pl;
    const max = Math.max(pl.A, pl.B, pl.C), min = Math.min(pl.A, pl.B, pl.C);
    this.imbalance = max > 0 ? (max - min) / max : 0;
  }

  isEnergized(id) {
    const n = this.nodes.get(id);
    return !!n && n.energized;
  }

  breakers() { return [...this.edges.values()].filter((e) => e.type === 'breaker' && !e.removed); }

  /** Count of energized load nodes — used to drive the mains hum. */
  liveLoadCount() {
    let c = 0;
    for (const n of this.nodes.values()) if (n.energized && n.type === 'load') c++;
    return c;
  }
}
