// Synthesised audio (no sample files): engine/EV whine, turbo, gravel/tyre noise, wind,
// impacts, UI blips and countdown beeps. Starts on the first user gesture.
(function () {
  'use strict';
  const AR = window.AR;
  const A = {
    ctx: null, master: null, ready: false,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      const ctx = (this.ctx = new C());
      this.master = ctx.createGain();
      this.master.gain.value = (AR.settings ? AR.settings.volume : 0.7) * 0.8;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(ctx.destination);
      // noise buffer
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.ready = true;
    },
    setVolume(v) {
      if (this.master) this.master.gain.value = v * 0.8;
    },
    noise() {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      return s;
    },
    startCar(sound) {
      if (!this.ready) return;
      this.stopCar();
      const ctx = this.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(this.master);
      const car = { out, sound };
      if (sound.ev) {
        const o1 = ctx.createOscillator(); o1.type = 'sine';
        const o2 = ctx.createOscillator(); o2.type = 'triangle';
        const g2 = ctx.createGain(); g2.gain.value = 0.25;
        o1.connect(out); o2.connect(g2); g2.connect(out);
        o1.start(); o2.start();
        car.oscs = [o1, o2];
      } else {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.4); }
        shaper.curve = curve;
        const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
        const o2 = ctx.createOscillator(); o2.type = 'square';
        const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
        const g1 = ctx.createGain(); g1.gain.value = 0.5;
        const g2 = ctx.createGain(); g2.gain.value = 0.22;
        const g3 = ctx.createGain(); g3.gain.value = 0.18;
        o1.connect(g1); o2.connect(g2); o3.connect(g3);
        [g1, g2, g3].forEach((g) => g.connect(shaper));
        shaper.connect(lp); lp.connect(out);
        o1.start(); o2.start(); o3.start();
        car.oscs = [o1, o2, o3];
        car.lp = lp;
        if (sound.turbo) {
          const t = ctx.createOscillator(); t.type = 'sine';
          const tg = ctx.createGain(); tg.gain.value = 0;
          t.connect(tg); tg.connect(this.master); t.start();
          car.turbo = t; car.turboG = tg;
        }
      }
      // tyre / gravel noise
      const n = this.noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.value = 0;
      n.connect(bp); bp.connect(ng); ng.connect(this.master); n.start();
      car.tyre = { bp, g: ng, src: n };
      // wind
      const w = this.noise();
      const wl = ctx.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 500;
      const wg = ctx.createGain(); wg.gain.value = 0;
      w.connect(wl); wl.connect(wg); wg.connect(this.master); w.start();
      car.wind = { g: wg, f: wl, src: w };
      car.boost = 0;
      this.car = car;
    },
    stopCar() {
      const c = this.car;
      if (!c) return;
      try {
        (c.oscs || []).forEach((o) => o.stop());
        if (c.turbo) c.turbo.stop();
        c.tyre.src.stop();
        c.wind.src.stop();
        c.out.disconnect();
      } catch (e) { /* already stopped */ }
      this.car = null;
    },
    updateCar(tm, p, surf, dt) {
      const c = this.car;
      if (!c || !this.ready) return;
      const t = this.ctx.currentTime;
      const rpm = tm.rpm;
      if (c.sound.ev) {
        const f = 120 + (rpm / p.redline) * 1500;
        c.oscs[0].frequency.setTargetAtTime(f, t, 0.03);
        c.oscs[1].frequency.setTargetAtTime(f * 1.5, t, 0.03);
        c.out.gain.setTargetAtTime(0.03 + tm.throttle * 0.06 + Math.min(tm.speed / 60, 1) * 0.04, t, 0.05);
      } else {
        const cyl = c.sound.cyl;
        const fire = (rpm / 60) * (cyl / 2) * c.sound.base;
        c.oscs[0].frequency.setTargetAtTime(fire, t, 0.02);
        c.oscs[1].frequency.setTargetAtTime(fire * 0.5, t, 0.02);
        c.oscs[2].frequency.setTargetAtTime(fire * 2.01, t, 0.02);
        c.lp.frequency.setTargetAtTime(400 + tm.throttle * 2600 + (rpm / p.redline) * 1200, t, 0.03);
        c.out.gain.setTargetAtTime(0.1 + tm.throttle * 0.12, t, 0.04);
        if (c.turbo) {
          const target = tm.throttle > 0.5 ? Math.min(1, rpm / p.redline + 0.2) : 0;
          if (c.boost > 0.6 && target === 0) this.blowOff();
          c.boost = AR.lerp(c.boost, target, Math.min(1, dt * 3));
          c.turbo.frequency.setTargetAtTime(1800 + c.boost * 3500, t, 0.05);
          c.turboG.gain.setTargetAtTime(c.boost * 0.018, t, 0.05);
        }
      }
      const loose = surf !== AR.SURF.TARMAC;
      const roll = Math.min(tm.speed / 30, 1);
      const slip = AR.clamp(tm.slipAvg / 6, 0, 1);
      c.tyre.bp.frequency.setTargetAtTime(loose ? (surf === AR.SURF.SNOW ? 2200 : 700) : 1400 + slip * 800, t, 0.05);
      c.tyre.bp.Q.value = loose ? 0.7 : 4;
      const tg = loose ? roll * 0.08 + slip * 0.22 : slip * slip * 0.18;
      c.tyre.g.gain.setTargetAtTime(tm.airborne ? 0 : tg, t, 0.05);
      c.wind.g.gain.setTargetAtTime(Math.min(tm.speed / 55, 1) * 0.12, t, 0.1);
      c.wind.f.frequency.setTargetAtTime(300 + tm.speed * 12, t, 0.1);
    },
    burst(freq, dur, gain, type) {
      if (!this.ready) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = this.noise();
      const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(f); f.connect(g); g.connect(this.master);
      n.start(t); n.stop(t + dur + 0.05);
    },
    blowOff() { this.burst(2600, 0.35, 0.12, 'highpass'); },
    shift() { this.burst(300, 0.08, 0.15, 'lowpass'); },
    crash(v) { this.burst(180, 0.4, Math.min(0.6, v * 0.05), 'lowpass'); this.burst(1200, 0.2, Math.min(0.25, v * 0.02)); },
    land(t) { this.burst(120, 0.3, Math.min(0.5, t * 0.3), 'lowpass'); },
    tone(freq, dur, gain, type) {
      if (!this.ready) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type || 'square'; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    blip() { this.tone(880, 0.06, 0.05, 'triangle'); },
    select() { this.tone(660, 0.05, 0.06, 'square'); this.tone(990, 0.08, 0.05, 'square'); },
    gate(good) { this.tone(good ? 1320 : 700, 0.12, 0.06, 'triangle'); this.tone(good ? 1760 : 520, 0.18, 0.05, 'triangle'); },
  };
  AR.Audio = A;
})();
