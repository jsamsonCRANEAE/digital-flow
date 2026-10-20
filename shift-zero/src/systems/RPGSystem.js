// Inventory, Physical Tools (Body) / Firmware Daemons (Voxel), Experimental Prototypes,
// and the Duo-Circuit Synergy evaluator. Pure module.

export const ITEMS = {
  // ---- Body: physical tools
  calibrated_meter: { owner: 'body', kind: 'tool', cost: 55, name: 'Calibrated Fluke Multimeter', desc: 'Multimeter scan radius +60%. Scans stun Arc Hounds for 2s.' },
  grounded_jacket: { owner: 'body', kind: 'tool', cost: 60, name: 'Grounded Carhartt Jacket', desc: 'Arc-rated FR duck canvas. Electrical damage −30%.' },
  class2_gloves: { owner: 'body', kind: 'tool', cost: 45, name: 'Class 2 Rubber Gloves', desc: 'Skill-check sweet zone +35%. Failures arc for half damage.' },
  steel_toes: { owner: 'body', kind: 'tool', cost: 40, name: 'Steel-Toe Grips', desc: 'Move speed +12%. Water no longer slows you.' },
  discharge_hook: { owner: 'body', kind: 'tool', cost: 50, name: 'Discharge Hook', desc: 'Capacitor discharges always pay double scrap.' },
  lock_hasp: { owner: 'body', kind: 'tool', cost: 45, name: 'Group Lock Hasp', desc: 'Carry +1 brass padlock. Hasp holds up to six locks.' },
  heavy_stick: { owner: 'body', kind: 'tool', cost: 50, name: 'Fiberglass Hot Stick (8ft)', desc: 'Hot Stick damage +40%, reach +25%.' },
  // ---- Voxel: firmware daemons
  magnetic_coil: { owner: 'voxel', kind: 'firmware', cost: 55, name: 'magnetic_coil.d', desc: 'Shunt pulse radius +50%. Pulls anomalies inward.' },
  voxel_buffer: { owner: 'voxel', kind: 'firmware', cost: 50, name: 'voxel_buffer.d', desc: 'Materialize costs 40% less Signal Coherence.' },
  coherence_recycler: { owner: 'voxel', kind: 'firmware', cost: 45, name: 'coherence_recycler.d', desc: 'Signal Coherence regenerates 2× faster.' },
  remote_loto: { owner: 'voxel', kind: 'firmware', cost: 55, name: 'remote_loto.d', desc: 'Remote breaker trips cost no Coherence.' },
  packet_sprint: { owner: 'voxel', kind: 'firmware', cost: 35, name: 'packet_sprint.d', desc: 'Conduit travel speed +30%.' },
  watchdog_timer: { owner: 'voxel', kind: 'firmware', cost: 40, name: 'watchdog_timer.d', desc: 'Stalls SCADA auto-reclose: +5s before breakers re-close.' },
  // ---- Experimental prototypes (Hot-Work rewards only)
  proto_tesla: { owner: 'body', kind: 'prototype', cost: 0, name: 'PROTOTYPE: Tesla Gauntlet', desc: 'Hot Stick hits chain lightning to 2 nearby anomalies.' },
  proto_ferrite: { owner: 'body', kind: 'prototype', cost: 0, name: 'PROTOTYPE: Ferrite Heart', desc: '+35 max Body integrity.' },
  proto_qfuse: { owner: 'voxel', kind: 'prototype', cost: 0, name: 'PROTOTYPE: Quantum Fuse', desc: 'Holding a jumper costs no Signal Coherence.' },
  proto_capacitor: { owner: 'voxel', kind: 'prototype', cost: 0, name: 'PROTOTYPE: Memory Capacitor', desc: 'OVERCLOCK burns 25% less Anchor.' },
  // ---- Breakroom consumables
  coffee: { owner: 'shared', kind: 'consumable', cost: 15, name: 'Vending Machine Coffee', desc: 'Burnt, lukewarm, perfect. Restore 35 Body integrity.' },
  burrito: { owner: 'shared', kind: 'consumable', cost: 30, name: 'Microwave Burrito', desc: 'Molten core, frozen edges. Restore all Body integrity.' },
  spare_lock: { owner: 'shared', kind: 'consumable', cost: 25, name: 'Spare Brass Padlock', desc: '+1 padlock for the rest of the run.' },
};

export const SYNERGIES = [
  { id: 'arc_lasso', name: 'Inductive Arc-Lasso', requires: ['calibrated_meter', 'magnetic_coil'], desc: 'A lightning tether binds Body and Voxel. Anything that crosses it is clotheslined and vaporised.' },
  { id: 'phase_carhartts', name: 'Phase-Shift Carhartts', requires: ['grounded_jacket', 'voxel_buffer'], desc: 'Dodge-rolls turn Cole to pure pixels: phase through chain-link fences and live arc beams.' },
  { id: 'bleed_down', name: 'Regenerative Bleed-Down', requires: ['discharge_hook', 'coherence_recycler'], desc: 'Discharging capacitor banks heals the Body and restores Signal Coherence.' },
  { id: 'ghost_lockout', name: 'Ghost Lockout', requires: ['lock_hasp', 'remote_loto'], desc: 'Hold HACK away from devices: project a digital LOTO lock onto the nearest live breaker anywhere on the map (8s).' },
];

const DEFENSIVE = ['grounded_jacket', 'class2_gloves', 'steel_toes'];
const PROTOTYPES = ['proto_tesla', 'proto_ferrite', 'proto_qfuse', 'proto_capacitor'];

export class RPGSystem {
  constructor() {
    this.scrap = 0;
    this.owned = new Map();
    this.extraLocks = 0;
  }

  has(id) { return (this.owned.get(id) || 0) > 0; }

  grant(id) {
    if (!ITEMS[id]) throw new Error(`Unknown item ${id}`);
    if (id === 'spare_lock') { this.extraLocks++; return; }
    if (ITEMS[id].kind === 'consumable') return;
    this.owned.set(id, (this.owned.get(id) || 0) + 1);
  }

  canAfford(id) { return this.scrap >= ITEMS[id].cost; }

  /** Returns true if purchased. Consumable effects are applied by the caller. */
  buy(id) {
    const it = ITEMS[id];
    if (!it || this.scrap < it.cost) return false;
    if (it.kind !== 'consumable' && this.has(id)) return false;
    this.scrap -= it.cost;
    this.grant(id);
    return true;
  }

  activeSynergies() {
    return SYNERGIES.filter((s) => s.requires.every((r) => this.has(r)));
  }

  hasSynergy(id) {
    const s = SYNERGIES.find((q) => q.id === id);
    return !!s && s.requires.every((r) => this.has(r));
  }

  /** Synergies that a single additional purchase would complete — surfaced as shop hints. */
  pendingSynergyFor(id) {
    return SYNERGIES.filter((s) => s.requires.includes(id) && !this.hasSynergy(s.id) && s.requires.every((r) => r === id || this.has(r)));
  }

  rollShop(rng) {
    const pool = (owner) => Object.keys(ITEMS).filter((id) => ITEMS[id].owner === owner && ITEMS[id].kind !== 'prototype' && !this.has(id));
    const pick = (owner) => {
      const ids = rng.shuffle(pool(owner));
      // Bias: if a synergy partner is owned, guarantee its other half is offered.
      const partner = ids.find((id) => this.pendingSynergyFor(id).length);
      const out = partner ? [partner, ...ids.filter((x) => x !== partner)] : ids;
      return out.slice(0, 3);
    };
    return { body: pick('body'), voxel: pick('voxel'), shared: ['coffee', 'burrito', 'spare_lock'] };
  }

  rollDefensive(rng) {
    const ids = DEFENSIVE.filter((id) => !this.has(id));
    return ids.length ? rng.pick(ids) : null;
  }

  rollPrototype(rng) {
    const ids = PROTOTYPES.filter((id) => !this.has(id));
    return ids.length ? rng.pick(ids) : null;
  }

  stats() {
    const h = (id) => this.has(id);
    return {
      maxHp: 100 + (h('proto_ferrite') ? 35 : 0),
      elecResist: h('grounded_jacket') ? 0.7 : 1,
      sweetBonus: h('class2_gloves') ? 1.35 : 1,
      failMult: h('class2_gloves') ? 0.5 : 1,
      moveSpeed: h('steel_toes') ? 1.12 : 1,
      waterSlow: h('steel_toes') ? 1 : 0.6,
      padlocks: 2 + (h('lock_hasp') ? 1 : 0) + this.extraLocks,
      scanRadius: h('calibrated_meter') ? 200 : 125,
      scanStun: h('calibrated_meter') ? 2 : 0.6,
      stickDamage: 34 * (h('heavy_stick') ? 1.4 : 1),
      stickReach: 56 * (h('heavy_stick') ? 1.25 : 1),
      chain: h('proto_tesla') ? 2 : 0,
      capScrap: h('discharge_hook') ? 2 : 1,
      pulseRadius: h('magnetic_coil') ? 120 : 80,
      pulsePull: h('magnetic_coil'),
      materializeCost: h('voxel_buffer') ? 18 : 30,
      regen: h('coherence_recycler') ? 14 : 7,
      remoteCost: h('remote_loto') ? 0 : 15,
      voxelSpeed: h('packet_sprint') ? 11.5 : 8.8,
      recloseDelay: 6 + (h('watchdog_timer') ? 5 : 0),
      jumperDrain: h('proto_qfuse') ? 0 : 7,
      overclockCost: h('proto_capacitor') ? 15 : 20,
      arcLasso: this.hasSynergy('arc_lasso'),
      phaseShift: this.hasSynergy('phase_carhartts'),
      bleedDown: this.hasSynergy('bleed_down'),
      ghostLockout: this.hasSynergy('ghost_lockout'),
    };
  }
}
