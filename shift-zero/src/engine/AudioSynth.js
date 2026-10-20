// Web Audio synthesis: 60 Hz mains hum, arc crackle, breaker clunks, wet footsteps,
// corporate pager buzz and a somber pad score whose harmony decays with Cole's Anchor.
// Every sound is generated at runtime — no samples.

const CHORDS = [
  // A minor (add9) → F maj7 → C (add9) → G sus2 — low, tired, hopeful.
  [45, 52, 57, 59, 64],
  [41, 48, 53, 57, 64],
  [36, 48, 52, 55, 62],
  [43, 50, 55, 57, 62],
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

class AudioSynth {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.anchor = 100;
    this.chordIndex = 0;
    this.padTimer = 0;
    this.blipTimer = 0;
    this.crackleLevel = 0;
    this.crackleTimer = 0;
    this.intensity = 0;
    this.pulseTimer = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.sfxVerb = ctx.createGain(); this.sfxVerb.gain.value = 0.25; this.sfx.connect(this.sfxVerb).connect(this.reverbSend);
    this.music = ctx.createGain(); this.music.gain.value = 0.3; this.music.connect(this.master); this.music.connect(this.reverbSend);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.55; this.amb.connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.crushCurve = this.makeCrushCurve(6);
    this.startHum();
    this.startCrackle();
    this.startPadBus();
    this.startBreakroomBed();
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.75, this.t, 0.05);
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  makeCrushCurve(bits) {
    const n = 1024, curve = new Float32Array(n), steps = Math.pow(2, bits);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  makeDriveCurve(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  noise(dest, { dur = 0.2, gain = 0.5, type = 'bandpass', freq = 1000, q = 1, freqEnd = null, attack = 0.002, when = 0 } = {}) {
    const ctx = this.ctx;
    const t0 = this.t + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(dest || this.sfx);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  tone(dest, { type = 'sine', freq = 440, freqEnd = null, dur = 0.2, gain = 0.3, attack = 0.005, when = 0, detune = 0, curve = null } = {}) {
    const ctx = this.ctx;
    const t0 = this.t + when;
    const o = ctx.createOscillator();
    o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = o;
    if (curve) {
      const ws = ctx.createWaveShaper(); ws.curve = curve;
      node = o.connect(ws);
    }
    node.connect(g).connect(dest || this.sfx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // ---------------------------------------------------------------- ambience
  startHum() {
    const ctx = this.ctx;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520;
    this.humFilter = lp;
    this.humOscs = [[60, 'sine', 0.5], [120, 'triangle', 0.35], [180, 'sawtooth', 0.08], [240, 'sine', 0.06], [300, 'square', 0.015]].map(([f, type, g]) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og).connect(lp);
      o.start();
      return o;
    });
    lp.connect(this.humGain).connect(this.amb);
  }

  /** level 0..1 = how much live copper is near; stress 0..1 = phase imbalance (warbles the hum). */
  setHum(level, stress = 0) {
    if (!this.ctx) return;
    this.humGain.gain.setTargetAtTime(0.06 + level * 0.22, this.t, 0.3);
    this.humFilter.frequency.setTargetAtTime(380 + level * 400 + stress * 900, this.t, 0.3);
    const wob = stress * 6;
    this.humOscs.forEach((o, i) => o.detune.setTargetAtTime((Math.random() - 0.5) * wob * (i + 1), this.t, 0.2));
  }

  startCrackle() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    this.crackleGate = ctx.createGain(); this.crackleGate.gain.value = 0;
    src.connect(hp).connect(this.crackleGate).connect(this.amb);
    src.start();
  }

  setCrackle(level) { this.crackleLevel = Math.max(0, Math.min(1, level)); }

  startPadBus() {
    const ctx = this.ctx;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 900; this.padFilter.Q.value = 0.7;
    this.padCrush = ctx.createWaveShaper(); this.padCrush.curve = null;
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0.5;
    this.padFilter.connect(this.padCrush).connect(this.padGain).connect(this.music);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 350;
    lfo.connect(lfoG).connect(this.padFilter.frequency); lfo.start();

    this.bassGain = ctx.createGain(); this.bassGain.gain.value = 0;
    this.bassGain.connect(this.music);
  }

  setMood(anchor) {
    this.anchor = anchor;
    if (!this.ctx) return;
    const cold = 1 - anchor / 100;
    this.padFilter.frequency.setTargetAtTime(1100 - cold * 650, this.t, 1.5);
    this.padCrush.curve = cold > 0.65 ? this.makeCrushCurve(Math.round(8 - cold * 5)) : null;
  }

  setIntensity(v) { this.intensity = v; }

  playChord() {
    const ctx = this.ctx;
    const chord = CHORDS[this.chordIndex++ % CHORDS.length];
    const cold = 1 - this.anchor / 100;
    const t0 = this.t;
    const dur = 9;
    chord.forEach((m, i) => {
      // As memories burn, voices drop out and detune drifts sour.
      if (cold > 0.5 && i === 3 && Math.random() < cold) return;
      for (const det of [-1, 1]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sawtooth';
        o.frequency.value = mtof(m + (i === 0 ? -12 : 0));
        o.detune.value = det * (6 + cold * 28) + (Math.random() - 0.5) * cold * 20;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(i === 0 ? 0.09 : 0.035, t0 + 2.5);
        g.gain.setValueAtTime(i === 0 ? 0.09 : 0.035, t0 + dur - 3);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(this.padFilter);
        o.start(t0); o.stop(t0 + dur + 0.1);
      }
    });
    // A single music-box note of memory when Anchor is high.
    if (this.anchor > 55) {
      const top = chord[chord.length - 1] + 12;
      this.tone(this.music, { type: 'sine', freq: mtof(top), dur: 3, gain: 0.05, attack: 0.02, when: 1.2 });
      this.tone(this.music, { type: 'sine', freq: mtof(top - 5), dur: 3, gain: 0.035, attack: 0.02, when: 2.4 });
    }
  }

  startBreakroomBed() {
    const ctx = this.ctx;
    this.breakGain = ctx.createGain(); this.breakGain.gain.value = 0;
    // Vending machine compressor: buzzy 120 Hz with a rattling AM.
    const vend = ctx.createOscillator(); vend.type = 'sawtooth'; vend.frequency.value = 120;
    const vf = ctx.createBiquadFilter(); vf.type = 'lowpass'; vf.frequency.value = 300;
    const am = ctx.createGain(); am.gain.value = 0.5;
    const rattle = ctx.createOscillator(); rattle.frequency.value = 7.3;
    const rg = ctx.createGain(); rg.gain.value = 0.25;
    rattle.connect(rg).connect(am.gain);
    vend.connect(vf).connect(am).connect(this.breakGain);
    // Microwave magnetron hum.
    const mw = ctx.createOscillator(); mw.type = 'square'; mw.frequency.value = 60;
    const mf = ctx.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 240; mf.Q.value = 4;
    const mg = ctx.createGain(); mg.gain.value = 0.18;
    mw.connect(mf).connect(mg).connect(this.breakGain);
    vend.start(); rattle.start(); mw.start();
    this.breakGain.connect(this.amb);
  }

  setBreakroom(on) {
    if (!this.ctx) return;
    this.breakGain.gain.setTargetAtTime(on ? 0.12 : 0, this.t, 0.4);
  }

  update(dt) {
    if (!this.ctx) return;
    // Arc crackle: randomly gated bursts whose density follows proximity to live copper.
    this.crackleTimer -= dt;
    if (this.crackleTimer <= 0) {
      const lvl = this.crackleLevel;
      this.crackleTimer = 0.02 + Math.random() * (0.25 - lvl * 0.2);
      if (lvl > 0.02 && Math.random() < 0.3 + lvl * 0.7) {
        const t0 = this.t, peak = lvl * (0.15 + Math.random() * 0.35);
        this.crackleGate.gain.cancelScheduledValues(t0);
        this.crackleGate.gain.setValueAtTime(peak, t0);
        this.crackleGate.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.01 + Math.random() * 0.05);
      }
    }
    this.padTimer -= dt;
    if (this.padTimer <= 0) { this.padTimer = 7.5; this.playChord(); }
    // Low anchor: cold hexadecimal telemetry blips replace the melody.
    if (this.anchor < 40) {
      this.blipTimer -= dt;
      if (this.blipTimer <= 0) {
        this.blipTimer = 0.15 + Math.random() * 0.9;
        const n = [72, 79, 84, 86, 91][Math.floor(Math.random() * 5)];
        this.tone(this.music, { type: 'square', freq: mtof(n), dur: 0.06, gain: 0.02 * (1 - this.anchor / 40) + 0.006 });
      }
    }
    // Boss pulse bass.
    this.bassGain.gain.setTargetAtTime(this.intensity * 0.5, this.t, 0.5);
    if (this.intensity > 0.05) {
      this.pulseTimer -= dt;
      if (this.pulseTimer <= 0) {
        this.pulseTimer = 0.5;
        this.tone(this.bassGain, { type: 'sawtooth', freq: 55, freqEnd: 40, dur: 0.35, gain: 0.5, curve: this.makeDriveCurve(8) });
      }
    }
  }

  // ---------------------------------------------------------------- one-shots
  ok() { return this.ctx && !this.muted; }

  clunk() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sine', freq: 110, freqEnd: 38, dur: 0.38, gain: 0.8 });
    this.tone(this.sfx, { type: 'square', freq: 70, freqEnd: 30, dur: 0.12, gain: 0.2 });
    this.noise(this.sfx, { dur: 0.06, gain: 0.5, type: 'highpass', freq: 2500 });
    this.noise(this.sfx, { dur: 0.25, gain: 0.25, type: 'lowpass', freq: 400, when: 0.02 });
  }

  spark(intensity = 0.5) {
    if (!this.ok()) return;
    for (let i = 0; i < 3 + intensity * 5; i++) {
      this.noise(this.sfx, { dur: 0.02 + Math.random() * 0.05, gain: 0.2 + intensity * 0.4, type: 'highpass', freq: 3000 + Math.random() * 3000, when: Math.random() * 0.12 });
    }
  }

  zap() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sawtooth', freq: 1800, freqEnd: 90, dur: 0.25, gain: 0.35 });
    this.noise(this.sfx, { dur: 0.3, gain: 0.6, type: 'bandpass', freq: 3500, q: 0.6, freqEnd: 600 });
  }

  arcFlash() {
    if (!this.ok()) return;
    this.noise(this.sfx, { dur: 0.6, gain: 0.9, type: 'lowpass', freq: 6000, freqEnd: 200, attack: 0.001 });
    this.tone(this.sfx, { type: 'sine', freq: 60, freqEnd: 25, dur: 0.7, gain: 0.9 });
    this.spark(1);
  }

  footstep(wet) {
    if (!this.ok()) return;
    this.noise(this.sfx, { dur: 0.07, gain: 0.12, type: 'lowpass', freq: 380 + Math.random() * 120 });
    this.tone(this.sfx, { type: 'sine', freq: 70 + Math.random() * 20, freqEnd: 40, dur: 0.06, gain: 0.12 });
    if (wet) this.noise(this.sfx, { dur: 0.16, gain: 0.12, type: 'bandpass', freq: 900, q: 2, freqEnd: 2600, when: 0.01 });
  }

  pager() {
    if (!this.ok()) return;
    for (let i = 0; i < 2; i++) {
      this.tone(this.sfx, { type: 'square', freq: 2730, dur: 0.07, gain: 0.08, when: i * 0.14 });
      this.tone(this.sfx, { type: 'sawtooth', freq: 140, dur: 0.12, gain: 0.08, when: i * 0.14 });
    }
  }

  overclock() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sawtooth', freq: 80, freqEnd: 2400, dur: 1.1, gain: 0.5, attack: 0.3, curve: this.crushCurve });
    this.tone(this.sfx, { type: 'sine', freq: 40, freqEnd: 20, dur: 1.6, gain: 0.9, attack: 0.05 });
    this.noise(this.sfx, { dur: 1.2, gain: 0.5, type: 'bandpass', freq: 400, q: 0.5, freqEnd: 8000, attack: 0.4 });
  }

  memoryBurn() {
    if (!this.ok()) return;
    // A lullaby fragment that bit-crushes as it plays.
    [76, 74, 72, 69].forEach((m, i) => this.tone(this.music, { type: 'triangle', freq: mtof(m), dur: 0.7, gain: 0.08, when: i * 0.22, curve: i > 1 ? this.crushCurve : null }));
  }

  skillTick() { if (this.ok()) this.tone(this.sfx, { type: 'square', freq: 1200, dur: 0.02, gain: 0.04 }); }
  skillPerfect() {
    if (!this.ok()) return;
    this.clunk();
    this.tone(this.sfx, { type: 'triangle', freq: 880, dur: 0.25, gain: 0.15 });
    this.tone(this.sfx, { type: 'triangle', freq: 1320, dur: 0.3, gain: 0.12, when: 0.05 });
  }
  skillGood() { if (this.ok()) { this.clunk(); this.tone(this.sfx, { type: 'triangle', freq: 660, dur: 0.15, gain: 0.1 }); } }
  skillFail() { if (this.ok()) this.arcFlash(); }

  hurt() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'square', freq: 220, freqEnd: 90, dur: 0.18, gain: 0.25 });
    this.noise(this.sfx, { dur: 0.15, gain: 0.4, type: 'highpass', freq: 2000 });
  }

  swing() { if (this.ok()) this.noise(this.sfx, { dur: 0.16, gain: 0.25, type: 'bandpass', freq: 600, q: 1.5, freqEnd: 2200 }); }
  hit() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sine', freq: 160, freqEnd: 50, dur: 0.15, gain: 0.6 });
    this.noise(this.sfx, { dur: 0.1, gain: 0.5, type: 'highpass', freq: 3000 });
  }
  kill() {
    if (!this.ok()) return;
    this.zap();
    this.tone(this.sfx, { type: 'square', freq: 600, freqEnd: 40, dur: 0.4, gain: 0.2, curve: this.crushCurve });
  }
  scan() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sine', freq: 1000, freqEnd: 3000, dur: 0.25, gain: 0.12 });
    this.tone(this.sfx, { type: 'sine', freq: 3000, dur: 0.05, gain: 0.08, when: 0.3 });
  }
  pickup() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'triangle', freq: 990, dur: 0.08, gain: 0.12 });
    this.tone(this.sfx, { type: 'triangle', freq: 1480, dur: 0.12, gain: 0.1, when: 0.07 });
  }
  lockClick() {
    if (!this.ok()) return;
    this.noise(this.sfx, { dur: 0.04, gain: 0.5, type: 'highpass', freq: 4000 });
    this.tone(this.sfx, { type: 'square', freq: 900, freqEnd: 400, dur: 0.05, gain: 0.15, when: 0.05 });
    this.noise(this.sfx, { dur: 0.05, gain: 0.4, type: 'bandpass', freq: 2500, when: 0.12 });
  }
  materialize() {
    if (!this.ok()) return;
    for (let i = 0; i < 6; i++) this.tone(this.sfx, { type: 'square', freq: 300 + i * 160, dur: 0.05, gain: 0.05, when: i * 0.03, curve: this.crushCurve });
  }
  pulse() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sine', freq: 500, freqEnd: 120, dur: 0.2, gain: 0.25 });
    this.noise(this.sfx, { dur: 0.12, gain: 0.2, type: 'bandpass', freq: 1500 });
  }
  jumperHum(level) {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sawtooth', freq: 60, dur: 0.12, gain: 0.08 * level });
  }
  desync() { if (this.ok()) this.tone(this.sfx, { type: 'square', freq: 800, freqEnd: 60, dur: 0.8, gain: 0.2, curve: this.crushCurve }); }
  elevator() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sawtooth', freq: 45, freqEnd: 60, dur: 2.5, gain: 0.25, attack: 0.4 });
    this.noise(this.sfx, { dur: 2.5, gain: 0.15, type: 'lowpass', freq: 300, attack: 0.5 });
    this.tone(this.sfx, { type: 'sine', freq: 1046, dur: 1.2, gain: 0.08, when: 2.2 });
  }
  synergy() {
    if (!this.ok()) return;
    [60, 64, 67, 72, 76].forEach((m, i) => this.tone(this.sfx, { type: 'triangle', freq: mtof(m + 12), dur: 0.5, gain: 0.08, when: i * 0.06 }));
  }
  growl() { if (this.ok()) this.noise(this.sfx, { dur: 0.4, gain: 0.25, type: 'bandpass', freq: 180, q: 3, freqEnd: 90 }); }
  skitter() { if (this.ok()) for (let i = 0; i < 4; i++) this.noise(this.sfx, { dur: 0.02, gain: 0.12, type: 'highpass', freq: 5000, when: i * 0.04 }); }
  whine() { if (this.ok()) this.tone(this.sfx, { type: 'sine', freq: 1400 + Math.random() * 300, freqEnd: 900, dur: 0.9, gain: 0.05, attack: 0.3 }); }
  bossRoar() {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sawtooth', freq: 48, freqEnd: 30, dur: 1.6, gain: 0.7, curve: this.makeDriveCurve(20) });
    this.noise(this.sfx, { dur: 1.4, gain: 0.5, type: 'lowpass', freq: 600, freqEnd: 80 });
  }
  uiMove() { if (this.ok()) this.tone(this.sfx, { type: 'square', freq: 1500, dur: 0.03, gain: 0.04 }); }
  uiSelect() {
    if (!this.ok()) return;
    this.clunk();
    this.tone(this.sfx, { type: 'square', freq: 990, dur: 0.06, gain: 0.05, when: 0.05 });
  }
  deny() { if (this.ok()) this.tone(this.sfx, { type: 'square', freq: 140, dur: 0.18, gain: 0.12 }); }
  bulkhead(open) {
    if (!this.ok()) return;
    this.tone(this.sfx, { type: 'sawtooth', freq: open ? 70 : 90, freqEnd: open ? 110 : 50, dur: 0.6, gain: 0.18 });
    this.noise(this.sfx, { dur: 0.5, gain: 0.25, type: 'lowpass', freq: 500 });
  }
}

export const audio = new AudioSynth();
