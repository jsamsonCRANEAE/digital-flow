// ---------------------------------------------------------------------------
// Audio: a direct port of GSAudio (the Swift synth). Songs are rendered
// offline into AudioBuffers (two passes so the hall reverb tail wraps
// seamlessly), then looped by Web Audio. SFX are rendered on demand.
// ---------------------------------------------------------------------------
const SR = 32000;

function Env(a, d, s, r) { return { a, d, s, r }; }
function envLevel(e, t, off) {
  const held = (t) => { if (t < e.a) return t / Math.max(e.a, 1e-5); const td = t - e.a;
    if (td < e.d) return 1 - (1 - e.s) * td / Math.max(e.d, 1e-5); return e.s; };
  if (off == null || t < off) return held(t);
  const lv = held(off), tr = t - off;
  return tr >= e.r ? 0 : lv * (1 - tr / Math.max(e.r, 1e-5));
}
// Instrument: { wave: {type, ...}, env, vol, slide, vib:[depth,rate], cutoff, fenv, penv:[semis,time] }
const I = (wave, env, vol, o = {}) => Object.assign({ wave, env, vol, slide: 0, vib: [0, 0], cutoff: 0, fenv: 0, penv: [0, 0] }, o);
const fm = (ratio, index, decay) => ({ type: 'fm', ratio, index, decay });
const saw = (unison, cents) => ({ type: 'saw', unison, cents });
const noise = () => ({ type: 'noise' });
const pulse = (duty) => ({ type: 'pulse', duty });
const INST = {
  kick: I(fm(1, 0.4, 20), Env(0.001, 0.16, 0, 0.02), 0.5, { slide: -60 }),
  snare: I(noise(), Env(0.001, 0.12, 0, 0.03), 0.22),
  crash: I(noise(), Env(0.001, 0.9, 0, 0.2), 0.12),
  bell: I(fm(3.5, 2.2, 6), Env(0.002, 0.35, 0, 0.2), 0.12),
  strings: I(saw(3, 9), Env(0.12, 0.3, 0.85, 0.35), 0.24, { vib: [0.10, 5.2], cutoff: 2600, fenv: 0.4 }),
  stringsStacc: I(saw(3, 10), Env(0.004, 0.09, 0, 0.05), 0.36, { cutoff: 2200, fenv: 0.8 }),
  contrabass: I(saw(2, 6), Env(0.01, 0.2, 0.7, 0.08), 0.24, { cutoff: 420, fenv: 1.0 }),
  brassSection: I(saw(2, 7), Env(0.035, 0.25, 0.7, 0.15), 0.26, { vib: [0.08, 5], cutoff: 700, fenv: 3.2 }),
  trumpet: I(saw(2, 4), Env(0.02, 0.2, 0.75, 0.12), 0.26, { vib: [0.12, 5.5], cutoff: 1100, fenv: 3.0 }),
  horn: I(saw(2, 6), Env(0.06, 0.3, 0.75, 0.25), 0.28, { vib: [0.06, 4.5], cutoff: 600, fenv: 1.6 }),
  brassStab: I(saw(3, 8), Env(0.005, 0.16, 0, 0.06), 0.30, { cutoff: 800, fenv: 4.0 }),
  choir: I(saw(3, 13), Env(0.3, 0.4, 0.8, 0.5), 0.17, { vib: [0.10, 4.8], cutoff: 1300, fenv: 0.2 }),
  pizz: I(fm(1, 1.4, 14), Env(0.001, 0.22, 0, 0.08), 0.20),
  harp: I(fm(2, 0.9, 5), Env(0.001, 0.6, 0, 0.3), 0.09),
  glock: I(fm(3.5, 1.3, 3), Env(0.001, 1.0, 0, 0.4), 0.14),
  timpani: I(fm(1, 0.7, 9), Env(0.002, 0.8, 0, 0.3), 0.14, { penv: [3, 0.04] }),
  taiko: I(fm(1, 1.1, 28), Env(0.001, 0.32, 0, 0.1), 0.20, { penv: [14, 0.022] }),
  orchSnare: I(noise(), Env(0.001, 0.14, 0, 0.04), 0.16),
  cymbal: I(noise(), Env(0.002, 1.8, 0, 0.4), 0.10),
};

class Voice {
  constructor(inst, midi, gain = 1) {
    this.i = inst; this.f = 440 * Math.pow(2, (midi - 69) / 12); this.gain = gain;
    this.t = 0; this.off = null; this.pc = 0; this.pm = 0; this.lfsr = 1; this.nc = 0; this.nv = 1;
    this.lp = 0; this.lpAmt = 1; this.f1 = 0; this.f2 = 0;
    const w = inst.wave;
    if (w.type === 'saw') { const k = Math.max(1, Math.min(4, w.unison)); this.uk = k;
      this.uph = [0, 0.37, 0.71, 0.13].slice(0, k);
      this.urat = this.uph.map((_, i) => Math.pow(2, (k === 1 ? 0 : (i / (k - 1) - 0.5) * 2 * w.cents) / 1200)); }
  }
  get finished() { return this.off != null && this.t - this.off > this.i.env.r; }
  sample(dt) {
    const I = this.i, env = envLevel(I.env, this.t, this.off);
    let f = this.f;
    if (I.slide) f *= Math.pow(2, I.slide * this.t / 12);
    if (I.penv[0]) f *= Math.pow(2, I.penv[0] * Math.exp(-this.t / Math.max(1e-4, I.penv[1])) / 12);
    if (I.vib[0] > 0 && this.t > 0.12) f *= Math.pow(2, I.vib[0] * Math.sin(TAU * I.vib[1] * this.t) / 12);
    let s; const w = I.wave;
    switch (w.type) {
      case 'fm': { this.pm += f * w.ratio * dt; this.pc += f * dt;
        s = Math.sin(TAU * this.pc + w.index * Math.exp(-w.decay * this.t) * Math.sin(TAU * this.pm)); break; }
      case 'pulse': this.pc += f * dt; s = (this.pc % 1) < w.duty ? 0.8 : -0.8; break;
      case 'noise': { this.nc += f * 8 * dt;
        while (this.nc >= 1) { this.nc -= 1; const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1; this.lfsr = (this.lfsr >> 1) | (bit << 14); this.nv = (this.lfsr & 1) === 0 ? 1 : -1; }
        this.lp += (this.nv - this.lp) * this.lpAmt; s = this.lp; break; }
      case 'saw': { let acc = 0;
        for (let k = 0; k < this.uk; k++) { const inc = f * this.urat[k] * dt; let ph = this.uph[k] + inc; if (ph >= 1) ph -= 1; this.uph[k] = ph;
          let b = 0; if (ph < inc) { const x = ph / inc; b = x + x - x * x - 1; } else if (ph > 1 - inc) { const x = (ph - 1) / inc; b = x * x + x + x + 1; }
          acc += 2 * ph - 1 - b; }
        s = acc / Math.sqrt(this.uk) * 0.7; break; }
    }
    if (I.cutoff > 0) { const fc = Math.min(12000, I.cutoff * (1 + I.fenv * env)); const x = TAU * fc * dt, a = x / (1 + x);
      this.f1 += (s - this.f1) * a; this.f2 += (this.f1 - this.f2) * a; s = this.f2; }
    this.t += dt;
    return s * env * I.vol * this.gain;
  }
}

// --- Tracker format: "D5 - - - A4 . x |" (16 steps per bar) ------------------
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiOf(n) { const m = /^([A-G])(#|b)?(-?\d)$/.exec(n); if (!m) return null;
  return (parseInt(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); }
function parseSteps(s) { return s.split(/[\s|]+/).filter(Boolean).map((t) => t === '-' ? 'h' : t === '.' ? null : t === 'x' ? 36 : (midiOf(t) ?? null)); }
const Score = {
  ostinato: (chords, p) => chords.map((c) => Array.from({ length: 16 }, (_, i) => { const k = p[i % p.length]; return k < 0 ? '.' : c[k % c.length]; }).join(' ')).join(' | '),
  held: (ns) => ns.map((n) => n === '.' ? '. '.repeat(16) : n + ' -'.repeat(15)).join(' | '),
  rhythm: (ns, pat) => ns.map((n) => pat.split(' ').map((t) => t === 'R' ? n : t === 'O' ? Score.up(n) : t).join(' ')).join(' | '),
  up: (n) => n.slice(0, -1) + (parseInt(n.slice(-1)) + 1),
  rest: (b) => Array.from({ length: b }, () => '. '.repeat(16)).join(' | '),
  times: (s, n) => Array(n).fill(s).join(' | '),
};
function song(name, bpm, loops, tracks) {
  const ts = tracks.map(([inst, str, gain]) => ({ inst: INST[inst], steps: parseSteps(str), gain }));
  const n = Math.max(...ts.map((t) => t.steps.length));
  return { name, bpm, loops, tracks: ts, steps: n, sps: 60 / bpm / 4, get duration() { return this.steps * this.sps; } };
}
const CYM = 'C8', SNR = 'C7';
const SONGS = {
  title: (() => {
    const prog = [['D3', 'A3', 'D4', 'F4'], ['A#2', 'F3', 'A#3', 'D4'], ['F3', 'C4', 'F4', 'A4'], ['C3', 'G3', 'C4', 'E4'],
      ['G2', 'D3', 'G3', 'A#3'], ['A#2', 'F3', 'A#3', 'D4'], ['C3', 'G3', 'C4', 'E4'], ['A2', 'E3', 'A3', 'C#4']];
    const roots = ['D2', 'A#1', 'F2', 'C2', 'G1', 'A#1', 'C2', 'A1'];
    const ost = Score.ostinato(prog, [0, 1, 2, 1, 3, 1, 2, 1, 0, 1, 2, 1, 3, 2, 3, 1]);
    const bass = Score.rhythm(roots, 'R - R . R - O . R - R . R - O .');
    const timp = Score.rhythm(roots, 'R . . . . . . . R . . . R . R .');
    const melody = `D5 - - - A4 - D5 - F5 - - - E5 - D5 - | F5 - - - - - G5 - F5 - - - D5 - - - |
      C5 - - - F5 - - - A5 - - - - - G5 - | G5 - - - - - - - E5 - - - C5 - - - |
      D5 - - - G5 - - - A#5 - - - - - A5 - | G5 - - - F5 - - - D5 - - - - - - - |
      E5 - - - G5 - - - C6 - - - - - A#5 - | A5 - - - - - - - - - - - C#5 - E5 -`;
    const horns = `A3 - - - - - - - D4 - - - F4 - - - | F4 - - - - - - - D4 - - - - - - - |
      A3 - - - - - - - C4 - - - F4 - - - | G4 - - - - - - - E4 - - - - - - - |
      G3 - - - - - - - A#3 - - - D4 - - - | D4 - - - - - - - F4 - - - - - - - |
      E4 - - - - - - - G4 - - - C5 - - - | C#5 - - - - - - - - - - - E4 - - -`;
    const choirA = Score.held(['D4', 'D4', 'C4', 'C4', 'D4', 'D4', 'E4', 'E4']);
    const choirB = Score.held(['F4', 'F4', 'F4', 'E4', 'G4', 'F4', 'G4', 'A4']);
    const taikoA = Score.times('x . . . x . . x . . x . x . . .', 8);
    const taikoB = Score.times('x . x . x . . x x . x . x . x x', 7) + ' | ' + 'x '.repeat(16);
    const snareB = Score.times(`. . . . ${SNR} . . . . . . . ${SNR} . ${SNR} ${SNR}`, 7) + ' | ' + (SNR + ' ').repeat(16);
    const crash = CYM + ' ' + '. '.repeat(15) + '| ' + Score.rest(7) + ' | ' + Score.times(CYM + ' ' + '. '.repeat(15), 8);
    return song('SPIRIT RISING', 156, true, [
      ['stringsStacc', ost + ' | ' + ost, 0.9], ['contrabass', bass + ' | ' + bass, 1.0], ['timpani', timp + ' | ' + timp, 0.9],
      ['horn', horns + ' | ' + Score.rest(8), 0.8], ['trumpet', Score.rest(8) + ' | ' + melody, 1.0],
      ['brassSection', Score.rest(8) + ' | ' + horns, 0.75], ['choir', Score.rest(8) + ' | ' + choirB, 1.0],
      ['choir', choirA + ' | ' + choirA, 0.8], ['taiko', taikoA + ' | ' + taikoB, 0.9],
      ['orchSnare', Score.rest(8) + ' | ' + snareB, 0.8], ['cymbal', crash, 0.8]]);
  })(),
  menu: (() => {
    const prog = [['F3', 'C4', 'F4', 'A4'], ['D3', 'A3', 'D4', 'F4'], ['A#2', 'F3', 'A#3', 'D4'], ['C3', 'G3', 'C4', 'E4'],
      ['F3', 'C4', 'F4', 'A4'], ['A2', 'E3', 'A3', 'C4'], ['A#2', 'F3', 'A#3', 'D4'], ['C3', 'G3', 'C4', 'E4']];
    const roots = ['F2', 'D2', 'A#1', 'C2', 'F2', 'A1', 'A#1', 'C2'];
    const melody = `A4 - - - C5 - - - F5 - - - - - - - | E5 - - - D5 - - - A4 - - - - - - - |
      A#4 - - - D5 - - - F5 - - - - - E5 - | E5 - - - - - - - - - - - C5 - - - |
      A4 - - - C5 - - - F5 - - - A5 - - - | G5 - - - E5 - - - C5 - - - - - - - |
      D5 - - - F5 - - - A#5 - - - - - A5 - | G5 - - - - - - - - - - - . . . .`;
    return song('LOCKER ROOM', 116, true, [
      ['pizz', Score.ostinato(prog, [0, -1, 2, -1, 1, -1, 3, -1, 0, -1, 2, -1, 3, -1, 1, -1]), 1.0],
      ['harp', Score.ostinato(prog.map((c) => c.map(Score.up)), [-1, 2, -1, 3, -1, 1, -1, 2, -1, 3, -1, 2, -1, 1, -1, 3]), 0.9],
      ['contrabass', Score.rhythm(roots, 'R - - - . . R . R - - - . . O .'), 0.9], ['horn', melody, 1.0],
      ['strings', Score.held(['A3', 'A3', 'A#3', 'G3', 'A3', 'A3', 'A#3', 'G3']), 0.7],
      ['strings', Score.held(['C4', 'D4', 'D4', 'C4', 'C4', 'C4', 'D4', 'E4']), 0.6],
      ['taiko', Score.times('x . . . . . . . x . . . . . . .', 8), 0.5],
      ['orchSnare', Score.times(`. . . . ${SNR} . . . . . . . ${SNR} . . .`, 8), 0.45],
      ['glock', Score.rest(4) + ' | ' + Score.ostinato(prog.slice(4).map((c) => c.map((n) => Score.up(Score.up(n)))), [3, -1, -1, -1, 2, -1, -1, -1, 1, -1, -1, -1, 2, -1, -1, -1]), 0.8]]);
  })(),
  game: (() => {
    const prog = [['E3', 'B3', 'E4', 'G4'], ['C3', 'G3', 'C4', 'E4'], ['G2', 'D3', 'G3', 'B3'], ['D3', 'A3', 'D4', 'F#4'],
      ['E3', 'B3', 'E4', 'G4'], ['C3', 'G3', 'C4', 'E4'], ['A2', 'E3', 'A3', 'C4'], ['B2', 'F#3', 'B3', 'D#4']];
    const roots = ['E2', 'C2', 'G1', 'D2', 'E2', 'C2', 'A1', 'B1'];
    const ost = Score.ostinato(prog, [0, 1, 2, 1, 0, 1, 3, 1, 0, 1, 2, 1, 3, 1, 2, 1]);
    const bass = Score.rhythm(roots, 'R . R . R . O . R . R . R . O R');
    const horns = `B4 - - - - - - - G4 - - - - - - - | E5 - - - - - - - D5 - - - C5 - - - |
      D5 - - - - - - - B4 - - - - - - - | A4 - - - - - - - F#4 - - - A4 - - - |
      B4 - - - - - - - E5 - - - - - - - | G5 - - - - - - - E5 - - - C5 - - - |
      C5 - - - - - - - E5 - - - - - - - | D#5 - - - - - - - F#5 - - - B4 - - -`;
    const taiko = Score.times('x . . x . . x . x . . . x . x .', 7) + ' | x . x . x . x . x x x x x x x x';
    const snare = Score.times(`. . . . ${SNR} . . . . . . . ${SNR} . . .`, 8);
    return song('GRIDIRON DRIVE', 148, true, [
      ['stringsStacc', ost + ' | ' + ost, 0.75], ['contrabass', bass + ' | ' + bass, 0.9],
      ['brassStab', Score.rhythm(prog.map((c) => c[2]), 'R . . R . . R . . . . . R . . .') + ' | ' + Score.rest(8), 0.8],
      ['brassStab', Score.rhythm(prog.map((c) => c[3]), 'R . . R . . R . . . . . R . . .') + ' | ' + Score.rest(8), 0.6],
      ['horn', Score.rest(8) + ' | ' + horns, 0.9],
      ['strings', Score.rest(8) + ' | ' + Score.held(['G5', 'G5', 'B5', 'A5', 'G5', 'G5', 'E5', 'F#5']), 0.5],
      ['timpani', Score.rhythm(roots, 'R . . . . . . . . . . . . . . .') + ' | ' + Score.rhythm(roots, 'R . . . . . . . R . . . . . . .'), 0.8],
      ['taiko', taiko + ' | ' + taiko, 0.8], ['orchSnare', snare + ' | ' + snare, 0.6],
      ['cymbal', Score.times(CYM + ' ' + '. '.repeat(15) + '| ' + Score.rest(3), 4), 0.6]]);
  })(),
  touchdown: (() => {
    const hit = '. '.repeat(16) + '| ';
    return song('TOUCHDOWN', 150, false, [
      ['stringsStacc', 'D4 E4 F#4 G4 A4 B4 C#5 D5 E5 F#5 G5 A5 B5 C#6 D6 E6 | D6 . . . . . . . . . . . . . . .', 0.9],
      ['trumpet', 'D5 . D5 D5 A5 - - - F#5 - A5 - D6 - - - | D6 - - - - - - - - - - - . . . .', 1.1],
      ['brassSection', 'F#4 . F#4 F#4 D5 - - - A4 - D5 - F#5 - - - | A5 - - - - - - - - - - - . . . .', 0.9],
      ['strings', hit + 'D5 - - - - - - - - - - - . . . .', 1.0], ['strings', hit + 'A4 - - - - - - - - - - - . . . .', 0.9],
      ['contrabass', 'D2 . D2 D2 A1 - - - D2 - A1 - D2 - - - | D2 - - - - - - - - - - - . . . .', 1.0],
      ['choir', hit + 'F#4 - - - - - - - - - - - . . . .', 1.0],
      ['timpani', 'D2 D2 D2 D2 D2 D2 D2 D2 A1 A1 A1 A1 A1 A1 A1 A1 | D2 . . . . . . . . . . . . . . .', 0.8],
      ['taiko', '. . . . . . . . . . . . x . x x | x . . . . . . . . . . . . . . .', 0.9],
      ['cymbal', hit + CYM + ' . . . . . . . . . . . . . . .', 1.1]]);
  })(),
};

class Reverb {
  constructor(sr) { const k = sr / 44100;
    this.c = [1116, 1188, 1277, 1356].map((n) => ({ b: new Float32Array(Math.max(1, (n * k) | 0)), i: 0, s: 0 }));
    this.a = [556, 441].map((n) => ({ b: new Float32Array(Math.max(1, (n * k) | 0)), i: 0 })); }
  process(x) { let out = 0; const inp = x * 0.25;
    for (const c of this.c) { const y = c.b[c.i]; c.s = y * 0.7 + c.s * 0.3; c.b[c.i] = inp + c.s * 0.8; if (++c.i === c.b.length) c.i = 0; out += y; }
    for (const a of this.a) { const b = a.b[a.i]; a.b[a.i] = out + b * 0.5; out = b - out; if (++a.i === a.b.length) a.i = 0; }
    return out; }
}

// Renders a song to PCM. Looping songs render two passes and keep the second,
// so the reverb tail from the end flows into the start: a seamless loop.
// Yields to the browser every chunk so the page stays responsive.
async function renderSong(sg) {
  const dt = 1 / SR, perStep = sg.sps * SR, loopN = Math.round(sg.steps * perStep);
  const passes = sg.loops ? 2 : 1, total = loopN * passes + (sg.loops ? 0 : SR * 1.5) | 0;
  const out = new Float32Array(sg.loops ? loopN : total);
  const voices = sg.tracks.map(() => null), rv = new Reverb(SR);
  let step = -1, stepT = 0;
  for (let n = 0; n < total; n++) {
    stepT -= 1;
    if (stepT <= 0) { stepT += perStep; step++;
      const st = step % sg.steps;
      if (sg.loops || step < sg.steps) sg.tracks.forEach((tr, i) => { const s = st < tr.steps.length ? tr.steps[st] : null;
        if (typeof s === 'number') voices[i] = new Voice(tr.inst, s, tr.gain);
        else if (s === null && voices[i] && voices[i].off == null) voices[i].off = voices[i].t; }); }
    let s = 0;
    for (let i = 0; i < voices.length; i++) { const v = voices[i]; if (!v) continue; s += v.sample(dt); if (v.finished) voices[i] = null; }
    s = s + rv.process(s) * 0.72;
    const o = s * (27 + s * s) / (27 + 9 * s * s);
    if (sg.loops) { if (n >= loopN) out[n - loopN] = o; } else out[n] = o;
    if ((n & 8191) === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

// --- SFX (same recipes as AudioCore.play) -------------------------------------
function sfxVoices(kind, k = 1) {
  const v = (inst, midi, g = 1, lp = 1, dur = 0.05, delay = 0) => { const x = new Voice(inst, midi, g); x.lpAmt = lp; x.off = dur; x.t = -delay; return x; };
  const N = (e, vol) => I(noise(), e, vol), F = (r, ix, d, e, vol, o) => I(fm(r, ix, d), e, vol, o);
  switch (kind) {
    case 'snap': return [v(N(Env(0.001, 0.06, 0, 0.02), 0.35), 90, 1, 0.3), v(INST.kick, 48, 0.5)];
    case 'step': return [v(N(Env(0.001, 0.03, 0, 0.01), 0.12 * clamp(k, 0.2, 1)), 70 + rng.int(8), 1, 0.25)];
    case 'hit': { const g = clamp(k, 0.3, 1.5); return [v(N(Env(0.001, 0.14, 0, 0.05), 0.4), 76, g, 0.45),
      v(F(1.4, 3, 25, Env(0.001, 0.12, 0, 0.03), 0.45, { slide: -40 }), 45, g)]; }
    case 'whistle': return [v(F(2, 0.15, 0, Env(0.01, 0.05, 0.9, 0.08), 0.22, { vib: [0.6, 28] }), 101, 1, 1, 0.42)];
    case 'catch': return [v(F(1, 1.5, 30, Env(0.001, 0.06, 0, 0.02), 0.3, { slide: 30 }), 64)];
    case 'kick': return [v(INST.kick, 52, 0.9), v(N(Env(0.001, 0.05, 0, 0.02), 0.25), 96, 1, 0.6)];
    case 'spirit': return [v(F(3, 4, 2, Env(0.005, 0.6, 0, 0.3), 0.25, { slide: 24 }), 72, 1, 1, 0.6), v(INST.crash, 100, 0.8, 1, 0.5)];
    case 'whoosh': return [v(N(Env(0.05, 0.15, 0, 0.05), 0.12), 110, 1, 0.15)];
    case 'tap': return [v(I(pulse(0.5), Env(0.001, 0.04, 0, 0.01), 0.12), 84)];
    case 'back': return [v(I(pulse(0.5), Env(0.001, 0.05, 0, 0.01), 0.12, { slide: -24 }), 79)];
    case 'error': return [v(I(pulse(0.25), Env(0.001, 0.12, 0, 0.02), 0.12), 52)];
    case 'buy': return [76, 79, 84, 88].map((m, i) => v(INST.bell, m, 1.4, 1, 0.05, i * 0.07));
  }
  return [];
}

const Audio = {
  ctx: null, music: null, musicGain: null, sfxGain: null, crowdGain: null, buffers: {}, pending: {}, current: null,
  musicVol: 0.7, sfxVol: 0.8, sfxCache: new Map(),
  // Must run inside a user gesture (iOS/Safari autoplay rules).
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.musicGain = ctx.createGain(); this.musicGain.connect(ctx.destination);
    this.sfxGain = ctx.createGain(); this.sfxGain.connect(ctx.destination);
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0; this.crowdGain.connect(this.sfxGain);
    this.setVolumes(this.musicVol, this.sfxVol);
    // Crowd bed: 4 s of filtered noise, looped.
    const n = SR * 4, cb = ctx.createBuffer(1, n, SR), d = cb.getChannelData(0); let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.08; lp2 += (lp - lp2) * 0.3; d[i] = lp2 * 1.6; }
    for (let i = 0; i < 2000; i++) { const t = i / 2000; d[i] = d[i] * t + d[n - 2000 + i] * (1 - t); }
    const cs = ctx.createBufferSource(); cs.buffer = cb; cs.loop = true; cs.connect(this.crowdGain); cs.start();
    const s = ctx.createBuffer(1, 1, SR), src = ctx.createBufferSource(); src.buffer = s; src.connect(ctx.destination); src.start();
    if (this.want) this.play(this.want);
  },
  setVolumes(m, s) { this.musicVol = m; this.sfxVol = s;
    if (this.musicGain) { this.musicGain.gain.value = m * 0.9; this.sfxGain.gain.value = s; } },
  async load(name) {
    if (this.buffers[name]) return this.buffers[name];
    if (!this.pending[name]) this.pending[name] = renderSong(SONGS[name]).then((pcm) => {
      const b = this.ctx.createBuffer(1, pcm.length, SR); b.getChannelData(0).set(pcm); this.buffers[name] = b; return b; });
    return this.pending[name];
  },
  async play(name) {
    this.want = name; if (!this.ctx) return;
    if (this.current === name && SONGS[name].loops) return;
    const sg = SONGS[name];
    if (sg.loops) this.current = name;
    const buf = await this.load(name);
    if (sg.loops && this.current !== name) return;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = sg.loops;
    const g = this.ctx.createGain(); src.connect(g); g.connect(this.musicGain);
    const now = this.ctx.currentTime;
    if (sg.loops) {
      if (this.music) { const old = this.music; old.g.gain.setTargetAtTime(0, now, 0.25); setTimeout(() => { try { old.src.stop(); } catch (e) {} }, 1500); }
      g.gain.setValueAtTime(0, now); g.gain.setTargetAtTime(1, now, 0.15);
      this.music = { src, g };
    } else if (this.music) { // duck the loop under the stinger
      this.music.g.gain.setTargetAtTime(0.25, now, 0.05); this.music.g.gain.setTargetAtTime(1, now + buf.duration - 0.6, 0.4);
    }
    src.start();
  },
  // Pre-render the other songs in the background after the first one.
  warm() { ['menu', 'game', 'touchdown', 'title'].reduce((p, n) => p.then(() => this.load(n)), Promise.resolve()); },
  sfx(kind, k = 1) {
    if (!this.ctx || this.sfxVol <= 0) return;
    const key = kind + ':' + (kind === 'hit' || kind === 'step' ? Math.round(k * 4) : 0) + (kind === 'step' ? ':' + rng.int(3) : '');
    let buf = this.sfxCache.get(key);
    if (!buf) { const vs = sfxVoices(kind, k), n = (SR * 1.2) | 0, pcm = new Float32Array(n); let last = 0;
      for (let i = 0; i < n; i++) { let s = 0; for (const v of vs) { if (v.t < 0) { v.t += 1 / SR; continue; } if (!v.finished) s += v.sample(1 / SR); }
        pcm[i] = s; if (Math.abs(s) > 1e-4) last = i; }
      buf = this.ctx.createBuffer(1, last + 64, SR); buf.getChannelData(0).set(pcm.subarray(0, last + 64)); this.sfxCache.set(key, buf); }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.sfxGain); src.start();
  },
  crowd(level) { if (!this.crowdGain) return; this.crowdGain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.5, this.ctx.currentTime, 0.4); },
};
