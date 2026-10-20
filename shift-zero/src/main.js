// Bootstrap + state machine: Title → Intro → Work Order → Playing ⇄ Breakroom → Boss → Ending.
// Fixed-timestep simulation (60 Hz) with hit-stop freezing the sim while the camera breathes.
import { Input } from './engine/Input.js';
import { Camera } from './engine/Camera.js';
import { ParticlePool } from './engine/ParticlePool.js';
import { Lighting } from './engine/Lighting.js';
import { audio } from './engine/AudioSynth.js';
import { RNG, hashNoise } from './engine/Util.js';
import { generateLevel } from './systems/LevelGen.js';
import { RPGSystem, ITEMS } from './systems/RPGSystem.js';
import { Narrative, INTRO, tier, determineEnding, memoriesLost, MEMORIES } from './systems/Narrative.js';
import { World, MUTATORS } from './systems/World.js';
import { HUD } from './ui/HUD.js';
import { Screens } from './ui/Screens.js';
import { Backdrops } from './ui/Backdrops.js';

const W = 1280, H = 720, STEP = 1 / 60;
const META_KEY = 'shiftzero.meta.v1';

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY));
    if (m && Array.isArray(m.endings)) return m;
  } catch { /* storage unavailable */ }
  return { endings: [], runs: 0 };
}
function saveMeta(m) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* storage unavailable */ }
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.uiCanvas = document.getElementById('ui');
    this.canvas.width = this.uiCanvas.width = W;
    this.canvas.height = this.uiCanvas.height = H;
    this.input = new Input(window);
    this.camera = new Camera(W, H);
    this.particles = new ParticlePool(3500);
    this.lighting = new Lighting(W, H);
    this.hud = new HUD(this.uiCanvas, document.getElementById('pager'));
    this.screens = new Screens(document.getElementById('overlay'));
    this.backdrops = new Backdrops(W, H);
    this.narrative = new Narrative();
    this.meta = loadMeta();
    this.swapped = false;
    this.paused = false;
    this.world = null;
    this.run = null;
    this.t = 0;
    this.stateT = 0;
    this.acc = 0;
    this.last = performance.now();
    this.intents = { body: {}, voxel: {} };
    const qs = new URLSearchParams(location.search);
    this.forcedSeed = qs.has('seed') ? Number(qs.get('seed')) >>> 0 : null;
    this.debug = qs.has('debug');
    this.setState('title');
    window.addEventListener('resize', () => this.fit());
    this.fit();
    window.__shiftZero = this;
    requestAnimationFrame((n) => this.frame(n));
  }

  fit() {
    const stage = document.getElementById('stage');
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.width = `${Math.floor(W * s)}px`;
    stage.style.height = `${Math.floor(H * s)}px`;
    stage.style.setProperty('--ui-scale', s);
  }

  setState(name) {
    this.state = name;
    this.stateT = 0;
    this.paused = false;
    this.hud.showPager(name === 'playing');
    audio.setBreakroom(name === 'breakroom');
    if (name !== 'playing') this.hud.clear();
    if (name === 'intro') { this.introIndex = 0; this.introChars = 0; }
    if (name === 'workorder') { this.cards = this.makeWorkOrders(); this.cardSel = 0; }
    if (name === 'playing') this.screens.hide();
  }

  // ------------------------------------------------------------------ run lifecycle
  newRun() {
    const seed = this.forcedSeed ?? ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    this.run = {
      seed, rng: new RNG(seed), depth: 1, anchor: 100, hp: 100, rpg: new RPGSystem(),
      workOrder: 'clean', mutator: null, mutatorName: '', efficiency: 1,
      scrapEarned: 0, totalPay: 0, lotoCount: 0, shortcuts: 0, verified: 0, overclocks: 0, downs: 0,
      ciphers: 0, cipherFloors: new Set(), memoryShards: 0, burnedAll: false, floorsCleared: 0,
    };
    this.narrative = new Narrative();
    this.swapped = false;
    audio.setMood(100);
    audio.setIntensity(0);
    this.meta.runs++;
    saveMeta(this.meta);
  }

  makeWorkOrders() {
    const run = this.run, rng = run.rng, d = run.depth;
    const muts = rng.shuffle(Object.keys(MUTATORS));
    return [
      {
        kind: 'clean', number: `${d}${rng.int(100, 999)}-C`, title: 'CLEAN MAINTENANCE', risk: 'RISK: STANDARD · PAY: BASE',
        lines: [`Planned outage window: ${fmt(220 - d * 10)}`, 'Standard hazards. Fewer Arc Hounds on patrol.', 'Lock it. Tag it. Try it.'],
        mutator: muts[0], reward: 'REWARD: ANCHOR RESTORATION +15 · free defensive gear',
      },
      {
        kind: 'hot', number: `${d}${rng.int(100, 999)}-H`, title: 'HOT-WORK EMERGENCY', risk: 'RISK: HIGH · PAY: DOUBLE',
        lines: [`Grid stays live. Load spike in ${fmt(150 - d * 8)}`, 'Arc Hounds patrol in packs. Extra capacitor banks.', 'Sign the waiver. Don\'t read it.'],
        mutator: muts[1], reward: 'REWARD: EXPERIMENTAL PROTOTYPE · 2× scrap',
      },
    ];
  }

  startFloor() {
    const run = this.run;
    run.efficiency = 1;
    run.mutatorName = run.mutator ? MUTATORS[run.mutator].name : '';
    const level = generateLevel({ seed: (run.seed + run.depth * 1013) >>> 0, depth: run.depth, workOrder: run.workOrder, mutator: run.mutator });
    this.world = new World(this, level);
    this.narrative.clear();
    this.narrative.event(run.workOrder === 'hot' ? 'hotWork' : 'cleanWork', {}, run.anchor);
    this.narrative.event('floorStart', { depth: run.depth }, run.anchor);
    this.world.bigText = { title: '— COLE —', text: this.narrative.floorLine(run.depth, run.anchor), t: 0, max: 6.5, color: '#ffcf70', icon: 'watch' };
    this.setState('playing');
  }

  startBoss() {
    const run = this.run;
    run.workOrder = 'final';
    run.mutator = null;
    run.mutatorName = '';
    run.efficiency = Math.max(run.efficiency, 1);
    const level = generateLevel({ seed: run.seed, depth: 5 });
    this.world = new World(this, level);
    this.narrative.clear();
    this.narrative.event('bossStart', { priority: true }, run.anchor);
    this.world.bigText = { title: 'THE MAIN TIE TRANSFORMER', text: 'Thirteen thousand eight hundred volts. The thing that ate the shift. Lock out all three phases.', t: 0, max: 6, color: '#ff9040', icon: 'key' };
    audio.setIntensity(0.6);
    this.setState('playing');
  }

  onFloorComplete(summary) {
    const run = this.run, rpg = run.rpg;
    rpg.scrap += summary.pay;
    run.totalPay += summary.pay;
    run.floorsCleared++;
    const log = [`Shift pay +${summary.pay} Cu · efficiency ${Math.round(summary.efficiency * 100)}%${summary.timeBonus > 1 ? ' · on-time bonus' : ''}`];
    const lostBefore = memoriesLost(run.anchor);
    if (run.workOrder === 'clean') {
      const before = run.anchor;
      run.anchor = Math.min(100, run.anchor + 15);
      log.push(`Anchor restored +${run.anchor - before}% — you did it right, and some of you came back`);
      const g = rpg.rollDefensive(run.rng);
      if (g) { rpg.grant(g); log.push(`Defensive gear issued: ${ITEMS[g].name}`); }
    } else {
      const p = rpg.rollPrototype(run.rng);
      if (p) { rpg.grant(p); log.push(`Experimental prototype acquired: ${ITEMS[p].name}`); }
      else { rpg.scrap += 40; log.push('No prototypes left in the crate: +40 Cu hazard bonus'); }
    }
    const lostAfter = memoriesLost(run.anchor);
    if (lostAfter < lostBefore) log.push(`MEMORY RECOVERED: ${MEMORIES[lostAfter].title.replace('{WIFE}', 'Mara').replace('{KID}', 'Tess')}`);
    const maxHp = rpg.stats().maxHp;
    run.hp = Math.min(maxHp, run.hp + 15);
    log.push('Five minutes on the bench: +15 Body');
    audio.setMood(run.anchor);
    this.world = null;
    const shop = rpg.rollShop(run.rng);
    this.br = {
      bodyList: [...shop.body, ...shop.shared], voxelList: shop.voxel, selB: 0, selV: 0, readyB: false, readyV: false,
      log, reflection: this.narrative.breakroom(run.depth, run.anchor), tier: tier(run.anchor),
      summary: [`Depth ${run.depth} cleared`, `LOTO locks ${run.lotoCount}`, `Corners cut ${run.shortcuts}`, `Ciphers ${run.ciphers}/4`],
    };
    this.setState('breakroom');
  }

  onShiftTerminated() { this.terminateT = 1.8; }

  onBossDefeated() {
    const id = determineEnding(this.run);
    this.endingId = id;
    if (!this.meta.endings.includes(id)) this.meta.endings.push(id);
    saveMeta(this.meta);
    audio.setIntensity(0);
    this.world = null;
    this.setState('ending');
  }

  endingStats() {
    const r = this.run;
    return [
      `Anchor ${r.anchor}% · memories kept ${5 - memoriesLost(r.anchor)}/5`,
      `LOTO locks hung ${r.lotoCount} · verified dead ${r.verified} · corners cut ${r.shortcuts}`,
      `Overclocks ${r.overclocks} · ciphers ${r.ciphers}/4 · copper earned ${r.scrapEarned + r.totalPay}`,
      `Final efficiency bonus (corporate's favourite number): ${Math.round(r.efficiency * 100)}%`,
    ];
  }

  // ------------------------------------------------------------------ loop
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.camera.update(dt);
    if (this.camera.hitStopT > 0) {
      this.camera.hitStopT -= dt;
      this.acc = 0;
      this.globalKeys();
    } else {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) {
        this.update(STEP);
        this.input.consume();
        this.acc -= STEP;
        steps++;
      }
      if (steps >= 6) this.acc = 0;
    }
    this.render(dt);
    audio.update(dt);
    requestAnimationFrame((n) => this.frame(n));
  }

  globalKeys() {
    if (this.input.wasPressed('KeyM')) { audio.init(); audio.setMuted(!audio.muted); }
  }

  confirm() { return this.input.anyPressed('Space', 'Enter', 'NumpadEnter'); }

  update(dt) {
    this.stateT += dt;
    this.globalKeys();
    const inp = this.input;
    switch (this.state) {
      case 'title':
        if (this.confirm()) {
          audio.init();
          audio.uiSelect();
          this.newRun();
          this.setState('intro');
        }
        break;
      case 'intro': {
        const line = INTRO[this.introIndex] || '';
        this.introChars += dt * 42;
        if (inp.wasPressed('Escape')) { this.setState('workorder'); break; }
        if (this.confirm()) {
          audio.uiMove();
          if (this.introChars < line.length) this.introChars = line.length;
          else { this.introIndex++; this.introChars = 0; }
        }
        if (this.introIndex >= INTRO.length) this.setState('workorder');
        break;
      }
      case 'workorder':
        if (inp.anyPressed('KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight')) { this.cardSel = 1 - this.cardSel; audio.uiMove(); }
        if (this.stateT > 0.3 && this.confirm()) {
          const c = this.cards[this.cardSel];
          this.run.workOrder = c.kind;
          this.run.mutator = c.mutator;
          if (c.kind === 'hot') this.run.shortcuts += 1;
          audio.uiSelect();
          this.startFloor();
        }
        break;
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'breakroom':
        this.updateBreakroom();
        break;
      case 'ending':
      case 'terminated':
        if (this.stateT > 3 && this.confirm()) { audio.uiSelect(); this.setState('title'); }
        break;
    }
  }

  updatePlaying(dt) {
    const inp = this.input;
    if (inp.wasPressed('Escape')) { this.paused = !this.paused; audio.uiMove(); }
    if (this.paused) {
      if (inp.wasPressed('KeyR')) { this.world = null; this.setState('title'); }
      return;
    }
    if (inp.wasPressed('Tab')) {
      if (this.swapped && this.world) this.world.voxel.latch(this.world);
      this.swapped = !this.swapped;
      audio.uiMove();
      if (this.world) this.world.toast(this.swapped ? 'SOLO-SWAP: P1 keys now drive the VOXEL' : 'SOLO-SWAP: P1 keys back on the BODY', '#50f0ff');
    }
    if (this.terminateT !== undefined && this.terminateT > 0) {
      this.terminateT -= dt;
      if (this.terminateT <= 0) {
        this.terminateT = undefined;
        this.endingId = 'terminated';
        this.world = null;
        this.setState('terminated');
        return;
      }
    }
    this.intents = this.input.readIntents(this.swapped);
    if (this.world) {
      this.world.update(dt, this.intents);
      const started = this.narrative.update(dt, this.run.anchor);
      this.hud.updatePager(this.narrative, dt, started);
    }
  }

  updateBreakroom() {
    const inp = this.input, br = this.br;
    if (inp.wasPressed('KeyW')) { br.selB = (br.selB + br.bodyList.length - 1) % br.bodyList.length; audio.uiMove(); }
    if (inp.wasPressed('KeyS')) { br.selB = (br.selB + 1) % br.bodyList.length; audio.uiMove(); }
    if (inp.wasPressed('ArrowUp') && br.voxelList.length) { br.selV = (br.selV + br.voxelList.length - 1) % br.voxelList.length; audio.uiMove(); }
    if (inp.wasPressed('ArrowDown') && br.voxelList.length) { br.selV = (br.selV + 1) % br.voxelList.length; audio.uiMove(); }
    if (this.stateT > 0.4) {
      if (inp.wasPressed('Space')) this.buy(br.bodyList, 'selB');
      if (inp.anyPressed('Enter', 'NumpadEnter')) this.buy(br.voxelList, 'selV');
      if (inp.wasPressed('ShiftLeft')) { br.readyB = !br.readyB; audio.uiMove(); }
      if (inp.wasPressed('ShiftRight')) { br.readyV = !br.readyV; audio.uiMove(); }
      if (inp.wasPressed('Tab')) { br.readyB = br.readyV = true; }
    }
    if (br.readyB && br.readyV) {
      audio.uiSelect();
      this.run.depth++;
      if (this.run.depth >= 5) this.startBoss();
      else this.setState('workorder');
    }
  }

  buy(list, selKey) {
    const br = this.br, run = this.run, rpg = run.rpg;
    const id = list[br[selKey]];
    if (!id) return;
    const before = new Set(rpg.activeSynergies().map((s) => s.id));
    if (!rpg.buy(id)) {
      audio.deny();
      br.log.unshift(rpg.has(id) ? 'Already owned.' : `Not enough copper for ${ITEMS[id].name}.`);
      return;
    }
    audio.uiSelect();
    const maxHp = rpg.stats().maxHp;
    if (id === 'coffee') run.hp = Math.min(maxHp, run.hp + 35);
    if (id === 'burrito') run.hp = maxHp;
    br.log.unshift(`Bought ${ITEMS[id].name}.`);
    if (ITEMS[id].kind !== 'consumable') {
      list.splice(br[selKey], 1);
      br[selKey] = Math.max(0, Math.min(br[selKey], list.length - 1));
    }
    for (const s of rpg.activeSynergies()) {
      if (!before.has(s.id)) { audio.synergy(); br.log.unshift(`⚡ DUO-CIRCUIT SYNERGY ONLINE: ${s.name}`); }
    }
    br.log.length = Math.min(br.log.length, 7);
  }

  // ------------------------------------------------------------------ render
  render(dt) {
    const ctx = this.ctx, t = this.t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    switch (this.state) {
      case 'title':
        this.backdrops.title(ctx, t, dt);
        this.screens.title(this.meta, t);
        break;
      case 'intro':
        this.backdrops.intro(ctx, t, dt, this.introIndex);
        this.screens.intro(INTRO, this.introIndex, Math.floor(this.introChars));
        break;
      case 'workorder': {
        this.backdrops.blueprint(ctx, t);
        const a = this.run.anchor;
        this.screens.workOrders(this.run.depth, this.cards, this.cardSel, this.narrative.floorLine(this.run.depth, a), tier(a));
        break;
      }
      case 'playing':
        if (this.world) {
          this.world.render(ctx, t);
          this.postFx(ctx, t);
          this.hud.render(this, this.world, dt, t);
        }
        if (this.paused) this.screens.pause(); else this.screens.hide();
        break;
      case 'breakroom': {
        const run = this.run;
        this.backdrops.breakroom(ctx, t, dt, run.anchor);
        const stats = run.rpg.stats();
        this.screens.breakroom({ ...this.br, rpg: run.rpg, depth: run.depth, hp: run.hp, maxHp: stats.maxHp, anchor: run.anchor, locks: stats.padlocks });
        break;
      }
      case 'ending':
      case 'terminated': {
        const id = this.endingId;
        this.backdrops.ending(ctx, this.stateT, dt, id);
        const e = { id, ...this.narrative.ending(id, this.run.anchor) };
        this.screens.ending(e, this.endingStats(), this.stateT > 3);
        break;
      }
    }
  }

  /** Low-Anchor glitch: horizontal slices of the frame tear sideways. */
  postFx(ctx, t) {
    const a = this.run.anchor;
    if (a >= 40) return;
    const amt = (1 - a / 40) * 0.25;
    const tick = Math.floor(t * 20);
    if (hashNoise(tick, 0, 11) > amt) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 3; i++) {
      const y = Math.floor(hashNoise(tick, i, 12) * H);
      const h = 4 + Math.floor(hashNoise(tick, i, 13) * 30);
      const dx = Math.round((hashNoise(tick, i, 14) - 0.5) * 40);
      ctx.drawImage(this.canvas, 0, y, W, h, dx, y, W, h);
    }
    ctx.fillStyle = 'rgba(80,240,255,0.04)';
    ctx.fillRect(0, 0, W, H);
  }
}

window.addEventListener('DOMContentLoaded', () => new Game());
