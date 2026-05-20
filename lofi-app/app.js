/* ===== LOFI ENGINE ===== */

class LofiEngine {
  constructor() {
    this.audioCtx = null;
    this.audioBuffer = null;
    this.sourceNode = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.loop = false;
    this.onended = null;
    this.nodes = {};
    this.chainReady = false;

    this.params = {
      lowpassFreq: 3000,
      lowpassEnabled: true,
      highpassEnabled: false,
      saturation: 0.4,
      saturationEnabled: true,
      reverbAmount: 0.25,
      reverbEnabled: true,
      tremoloDepth: 0.08,
      tremoloEnabled: true,
      noiseAmount: 0.06,
      noiseEnabled: true,
      speed: 0.98,
      volume: 0.8,
    };

    this._createContext();
  }

  _createContext() {
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.error('Web Audio not supported', e);
    }
  }

  async unlock() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  /* ---- Audio processing chain ---- */

  buildChain() {
    this._teardownChain();
    const ctx = this.audioCtx;
    const n = this.nodes;

    n.inputGain = ctx.createGain();
    n.inputGain.gain.value = 1.0;

    // High-pass (phone / rumble removal)
    n.highpass = ctx.createBiquadFilter();
    n.highpass.type = 'highpass';
    n.highpass.frequency.value = this.params.highpassEnabled ? 200 : 20;
    n.highpass.Q.value = 0.7;

    // Low-pass (the main lofi character)
    n.lowpass = ctx.createBiquadFilter();
    n.lowpass.type = 'lowpass';
    n.lowpass.frequency.value = this.params.lowpassEnabled ? this.params.lowpassFreq : 20000;
    n.lowpass.Q.value = 1.4;

    // Tape saturation (soft-clip waveshaper)
    n.saturation = ctx.createWaveShaper();
    n.saturation.curve = this._satCurve(this.params.saturationEnabled ? this.params.saturation : 0);
    n.saturation.oversample = '4x';

    // Tremolo: static gain modulated by an LFO
    n.tremoloGain = ctx.createGain();
    n.tremoloGain.gain.value = 1.0;
    n.tremoloLFO = ctx.createOscillator();
    n.tremoloLFO.type = 'sine';
    n.tremoloLFO.frequency.value = 3.8;
    n.tremoloMod = ctx.createGain();
    n.tremoloMod.gain.value = this.params.tremoloEnabled ? this.params.tremoloDepth : 0;
    n.tremoloLFO.connect(n.tremoloMod);
    n.tremoloMod.connect(n.tremoloGain.gain);
    n.tremoloLFO.start();

    // Reverb via convolution
    n.reverb = ctx.createConvolver();
    n.reverb.buffer = this._makeReverbIR(1.8, 3.2);
    n.dryGain = ctx.createGain();
    n.dryGain.gain.value = 1 - this.params.reverbAmount;
    n.wetGain = ctx.createGain();
    n.wetGain.gain.value = this.params.reverbEnabled ? this.params.reverbAmount : 0;
    n.reverbMix = ctx.createGain();
    n.reverbMix.gain.value = 1.0;

    // Vinyl noise: looped white noise → bandpass → gain
    n.noiseSource = ctx.createBufferSource();
    n.noiseSource.buffer = this._makeNoiseBuffer();
    n.noiseSource.loop = true;
    n.noiseBP = ctx.createBiquadFilter();
    n.noiseBP.type = 'bandpass';
    n.noiseBP.frequency.value = 2200;
    n.noiseBP.Q.value = 0.7;
    n.noiseGain = ctx.createGain();
    n.noiseGain.gain.value = this.params.noiseEnabled ? this.params.noiseAmount : 0;
    n.noiseSource.connect(n.noiseBP);
    n.noiseBP.connect(n.noiseGain);
    n.noiseSource.start();

    // Final compressor & output
    n.compressor = ctx.createDynamicsCompressor();
    n.compressor.threshold.value = -18;
    n.compressor.knee.value = 12;
    n.compressor.ratio.value = 4;
    n.compressor.attack.value = 0.003;
    n.compressor.release.value = 0.25;

    n.outputGain = ctx.createGain();
    n.outputGain.gain.value = this.params.volume;

    n.analyser = ctx.createAnalyser();
    n.analyser.fftSize = 512;
    n.analyser.smoothingTimeConstant = 0.75;

    // Wire chain: inputGain → hp → lp → sat → tremolo → dry/wet reverb → noise mix → compressor → output → analyser → dest
    n.inputGain.connect(n.highpass);
    n.highpass.connect(n.lowpass);
    n.lowpass.connect(n.saturation);
    n.saturation.connect(n.tremoloGain);

    n.tremoloGain.connect(n.dryGain);
    n.tremoloGain.connect(n.reverb);
    n.dryGain.connect(n.reverbMix);
    n.reverb.connect(n.wetGain);
    n.wetGain.connect(n.reverbMix);

    n.noiseGain.connect(n.reverbMix);

    n.reverbMix.connect(n.compressor);
    n.compressor.connect(n.outputGain);
    n.outputGain.connect(n.analyser);
    n.analyser.connect(this.audioCtx.destination);

    this.chainReady = true;
  }

  _teardownChain() {
    const n = this.nodes;
    try { if (n.tremoloLFO) n.tremoloLFO.stop(); } catch (_) {}
    try { if (n.noiseSource) n.noiseSource.stop(); } catch (_) {}
    Object.values(n).forEach(node => { try { node.disconnect(); } catch (_) {} });
    this.nodes = {};
    this.chainReady = false;
  }

  /* ---- DSP helpers ---- */

  _satCurve(amount) {
    const k = amount * 180;
    const n = 22050;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = k === 0 ? x : (1 + k / 100) * x / (1 + (k / 100) * Math.abs(x));
    }
    return curve;
  }

  _makeReverbIR(duration, decay) {
    const ctx = this.audioCtx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _makeNoiseBuffer() {
    const ctx = this.audioCtx;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.25;
      if (Math.random() < 0.001) data[i] = (Math.random() * 2 - 1) * 1.8; // crackle
    }
    return buf;
  }

  /* ---- File loading ---- */

  async loadFile(file) {
    await this.unlock();
    const arrayBuf = await file.arrayBuffer();
    return new Promise((resolve, reject) => {
      this.audioCtx.decodeAudioData(arrayBuf, buf => {
        this.audioBuffer = buf;
        this.buildChain();
        resolve(buf);
      }, reject);
    });
  }

  /* ---- Transport ---- */

  play(offset = 0) {
    if (!this.audioBuffer || !this.audioCtx) return;
    this.stop();
    if (!this.chainReady) this.buildChain();

    this.sourceNode = this.audioCtx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.playbackRate.value = this.params.speed;
    this.sourceNode.loop = this.loop;
    this.sourceNode.connect(this.nodes.inputGain);
    this.sourceNode.onended = () => {
      if (!this.loop) {
        this.isPlaying = false;
        this.isPaused = false;
        this.pauseOffset = 0;
        if (this.onended) this.onended();
      }
    };

    this.startTime = this.audioCtx.currentTime - offset;
    this.sourceNode.start(0, offset);
    this.isPlaying = true;
    this.isPaused = false;
  }

  pause() {
    if (!this.isPlaying || !this.sourceNode) return;
    this.pauseOffset = this.audioCtx.currentTime - this.startTime;
    try { this.sourceNode.stop(); } catch (_) {}
    this.isPlaying = false;
    this.isPaused = true;
  }

  resume() {
    if (!this.isPaused) return;
    this.play(this.pauseOffset);
  }

  stop() {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch (_) {}
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.pauseOffset = 0;
  }

  getCurrentTime() {
    if (this.isPlaying) return this.audioCtx.currentTime - this.startTime;
    return this.pauseOffset;
  }

  getDuration() {
    if (!this.audioBuffer) return 0;
    return this.audioBuffer.duration / this.params.speed;
  }

  seek(fraction) {
    const offset = Math.max(0, Math.min(1, fraction)) * this.getDuration();
    if (this.isPlaying) {
      this.play(offset);
    } else {
      this.pauseOffset = offset;
      this.isPaused = true;
    }
  }

  /* ---- Parameter setters ---- */

  setLowpassFreq(f) {
    this.params.lowpassFreq = f;
    if (this.nodes.lowpass)
      this.nodes.lowpass.frequency.setTargetAtTime(
        this.params.lowpassEnabled ? f : 20000, this.audioCtx.currentTime, 0.01);
  }

  setLowpassEnabled(v) {
    this.params.lowpassEnabled = v;
    if (this.nodes.lowpass)
      this.nodes.lowpass.frequency.setTargetAtTime(
        v ? this.params.lowpassFreq : 20000, this.audioCtx.currentTime, 0.05);
  }

  setHighpassEnabled(v) {
    this.params.highpassEnabled = v;
    if (this.nodes.highpass)
      this.nodes.highpass.frequency.setTargetAtTime(v ? 200 : 20, this.audioCtx.currentTime, 0.05);
  }

  setSaturation(v) {
    this.params.saturation = v;
    if (this.nodes.saturation)
      this.nodes.saturation.curve = this._satCurve(this.params.saturationEnabled ? v : 0);
  }

  setSaturationEnabled(v) {
    this.params.saturationEnabled = v;
    if (this.nodes.saturation)
      this.nodes.saturation.curve = this._satCurve(v ? this.params.saturation : 0);
  }

  setReverbAmount(v) {
    this.params.reverbAmount = v;
    if (this.nodes.dryGain) {
      this.nodes.dryGain.gain.setTargetAtTime(1 - v, this.audioCtx.currentTime, 0.05);
      this.nodes.wetGain.gain.setTargetAtTime(
        this.params.reverbEnabled ? v : 0, this.audioCtx.currentTime, 0.05);
    }
  }

  setReverbEnabled(v) {
    this.params.reverbEnabled = v;
    if (this.nodes.wetGain)
      this.nodes.wetGain.gain.setTargetAtTime(
        v ? this.params.reverbAmount : 0, this.audioCtx.currentTime, 0.05);
  }

  setTremoloDepth(v) {
    this.params.tremoloDepth = v;
    if (this.nodes.tremoloMod)
      this.nodes.tremoloMod.gain.setTargetAtTime(
        this.params.tremoloEnabled ? v : 0, this.audioCtx.currentTime, 0.05);
  }

  setTremoloEnabled(v) {
    this.params.tremoloEnabled = v;
    if (this.nodes.tremoloMod)
      this.nodes.tremoloMod.gain.setTargetAtTime(
        v ? this.params.tremoloDepth : 0, this.audioCtx.currentTime, 0.05);
  }

  setNoiseAmount(v) {
    this.params.noiseAmount = v;
    if (this.nodes.noiseGain)
      this.nodes.noiseGain.gain.setTargetAtTime(
        this.params.noiseEnabled ? v : 0, this.audioCtx.currentTime, 0.05);
  }

  setNoiseEnabled(v) {
    this.params.noiseEnabled = v;
    if (this.nodes.noiseGain)
      this.nodes.noiseGain.gain.setTargetAtTime(
        v ? this.params.noiseAmount : 0, this.audioCtx.currentTime, 0.05);
  }

  setSpeed(v) {
    this.params.speed = v;
    if (this.sourceNode) this.sourceNode.playbackRate.value = v;
  }

  setVolume(v) {
    this.params.volume = v;
    if (this.nodes.outputGain)
      this.nodes.outputGain.gain.setTargetAtTime(v, this.audioCtx.currentTime, 0.05);
  }

  getAnalyserData() {
    if (!this.nodes.analyser) return null;
    const data = new Uint8Array(this.nodes.analyser.frequencyBinCount);
    this.nodes.analyser.getByteTimeDomainData(data);
    return data;
  }

  /* ---- Offline export ---- */

  async exportWav() {
    if (!this.audioBuffer) return null;
    const p = this.params;
    const sr = this.audioCtx.sampleRate;
    const dur = this.audioBuffer.duration;
    const offline = new OfflineAudioContext(
      this.audioBuffer.numberOfChannels,
      Math.ceil(dur * sr),
      sr
    );

    const hp = offline.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = p.highpassEnabled ? 200 : 20;

    const lp = offline.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.lowpassEnabled ? p.lowpassFreq : 20000;
    lp.Q.value = 1.4;

    const sat = offline.createWaveShaper();
    sat.curve = this._satCurve(p.saturationEnabled ? p.saturation : 0);
    sat.oversample = '4x';

    // Tremolo via offline script — use a simple fixed gain equivalent
    const trGain = offline.createGain();
    trGain.gain.value = 1.0 - (p.tremoloEnabled ? p.tremoloDepth * 0.5 : 0);

    const irLen = Math.floor(1.8 * sr);
    const irBuf = offline.createBuffer(2, irLen, sr);
    for (let c = 0; c < 2; c++) {
      const ch = irBuf.getChannelData(c);
      for (let i = 0; i < irLen; i++)
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    const reverb = offline.createConvolver();
    reverb.buffer = irBuf;

    const dry = offline.createGain();
    dry.gain.value = 1 - p.reverbAmount;
    const wet = offline.createGain();
    wet.gain.value = p.reverbEnabled ? p.reverbAmount : 0;
    const mix = offline.createGain();

    const nLen = Math.ceil(sr * 3);
    const nBuf = offline.createBuffer(1, nLen, sr);
    const nData = nBuf.getChannelData(0);
    for (let i = 0; i < nLen; i++) {
      nData[i] = (Math.random() * 2 - 1) * 0.25;
      if (Math.random() < 0.001) nData[i] = (Math.random() * 2 - 1) * 1.8;
    }
    const nSrc = offline.createBufferSource();
    nSrc.buffer = nBuf;
    nSrc.loop = true;
    const nBP = offline.createBiquadFilter();
    nBP.type = 'bandpass';
    nBP.frequency.value = 2200;
    nBP.Q.value = 0.7;
    const nGain = offline.createGain();
    nGain.gain.value = p.noiseEnabled ? p.noiseAmount : 0;
    nSrc.connect(nBP);
    nBP.connect(nGain);

    const comp = offline.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;

    const outGain = offline.createGain();
    outGain.gain.value = p.volume;

    const src = offline.createBufferSource();
    src.buffer = this.audioBuffer;
    src.playbackRate.value = p.speed;

    src.connect(hp);
    hp.connect(lp);
    lp.connect(sat);
    sat.connect(trGain);
    trGain.connect(dry);
    trGain.connect(reverb);
    dry.connect(mix);
    reverb.connect(wet);
    wet.connect(mix);
    nGain.connect(mix);
    mix.connect(comp);
    comp.connect(outGain);
    outGain.connect(offline.destination);

    src.start(0);
    nSrc.start(0);

    const rendered = await offline.startRendering();
    return this._bufToWav(rendered);
  }

  _bufToWav(buf) {
    const ch = buf.numberOfChannels;
    const sr = buf.sampleRate;
    const len = buf.length;
    const byteLen = len * ch * 2;
    const ab = new ArrayBuffer(44 + byteLen);
    const v = new DataView(ab);

    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + byteLen, true);
    str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, ch, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 2, true);
    v.setUint16(32, ch * 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, byteLen, true);

    let offset = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]));
        v.setInt16(offset, s * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }
}

/* ===== PRESETS ===== */

const PRESETS = {
  'Classic Lofi': {
    lowpassFreq: 3000, lowpassEnabled: true, highpassEnabled: false,
    saturation: 0.4, saturationEnabled: true,
    reverbAmount: 0.25, reverbEnabled: true,
    tremoloDepth: 0.08, tremoloEnabled: true,
    noiseAmount: 0.06, noiseEnabled: true,
    speed: 0.98, volume: 0.8,
  },
  'Study Beats': {
    lowpassFreq: 4500, lowpassEnabled: true, highpassEnabled: false,
    saturation: 0.2, saturationEnabled: true,
    reverbAmount: 0.15, reverbEnabled: true,
    tremoloDepth: 0.04, tremoloEnabled: false,
    noiseAmount: 0.03, noiseEnabled: true,
    speed: 1.0, volume: 0.85,
  },
  'Rainy Day': {
    lowpassFreq: 2000, lowpassEnabled: true, highpassEnabled: false,
    saturation: 0.55, saturationEnabled: true,
    reverbAmount: 0.4, reverbEnabled: true,
    tremoloDepth: 0.05, tremoloEnabled: true,
    noiseAmount: 0.12, noiseEnabled: true,
    speed: 0.97, volume: 0.78,
  },
  'Old Radio': {
    lowpassFreq: 2500, lowpassEnabled: true, highpassEnabled: true,
    saturation: 0.65, saturationEnabled: true,
    reverbAmount: 0.08, reverbEnabled: true,
    tremoloDepth: 0.15, tremoloEnabled: true,
    noiseAmount: 0.1, noiseEnabled: true,
    speed: 1.0, volume: 0.8,
  },
  'Vinyl': {
    lowpassFreq: 5500, lowpassEnabled: true, highpassEnabled: true,
    saturation: 0.3, saturationEnabled: true,
    reverbAmount: 0.18, reverbEnabled: false,
    tremoloDepth: 0.04, tremoloEnabled: true,
    noiseAmount: 0.15, noiseEnabled: true,
    speed: 1.0, volume: 0.82,
  },
  'Clean': {
    lowpassFreq: 15000, lowpassEnabled: false, highpassEnabled: false,
    saturation: 0.0, saturationEnabled: false,
    reverbAmount: 0.0, reverbEnabled: false,
    tremoloDepth: 0.0, tremoloEnabled: false,
    noiseAmount: 0.0, noiseEnabled: false,
    speed: 1.0, volume: 1.0,
  },
};

/* ===== UI CONTROLLER ===== */

let engine;
let fileName = '';
let rafProgress = null;
let rafViz = null;
let canvasW = 0, canvasH = 0;

function fmtTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), ms);
}

function showLoading(on, text = 'Processing…') {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingOverlay').classList.toggle('show', on);
}

function setToggle(id, on) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('on', on);
}

function updatePlayBtn() {
  document.getElementById('btnPlay').textContent = engine.isPlaying ? '⏸' : '▶';
}

function updateProgress() {
  const cur = engine.getCurrentTime();
  const dur = engine.getDuration();
  const frac = dur > 0 ? Math.min(cur / dur, 1) : 0;
  document.getElementById('progressFill').style.width = `${frac * 100}%`;
  document.getElementById('progressThumb').style.left = `${frac * 100}%`;
  document.getElementById('timeDisplay').textContent = `${fmtTime(cur)} / ${fmtTime(dur)}`;
  if (engine.isPlaying) rafProgress = requestAnimationFrame(updateProgress);
}

function stopProgressLoop() {
  if (rafProgress) { cancelAnimationFrame(rafProgress); rafProgress = null; }
}

function startProgressLoop() {
  stopProgressLoop();
  updateProgress();
}

/* ---- Visualizer ---- */

function resizeCanvas() {
  const canvas = document.getElementById('visualizer');
  canvasW = canvas.offsetWidth;
  canvasH = canvas.offsetHeight;
  canvas.width = canvasW;
  canvas.height = canvasH;
}

function drawViz() {
  const canvas = document.getElementById('visualizer');
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvasW, canvasH);

  const bgGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
  bgGrad.addColorStop(0, '#1a0a2e');
  bgGrad.addColorStop(1, '#0d0618');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  const data = engine ? engine.getAnalyserData() : null;
  const midY = canvasH / 2;

  if (data && engine && engine.isPlaying) {
    const wGrad = ctx.createLinearGradient(0, 0, canvasW, 0);
    wGrad.addColorStop(0, '#ff8c42');
    wGrad.addColorStop(0.5, '#ffd166');
    wGrad.addColorStop(1, '#ef476f');

    // Glow pass
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255, 140, 66, 0.18)';
    ctx.beginPath();
    const sw = canvasW / data.length;
    let x = 0;
    for (let i = 0; i < data.length; i++) {
      const y = ((data[i] / 128.0) * canvasH) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sw;
    }
    ctx.lineTo(canvasW, midY);
    ctx.stroke();

    // Sharp line
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = wGrad;
    ctx.beginPath();
    x = 0;
    for (let i = 0; i < data.length; i++) {
      const y = ((data[i] / 128.0) * canvasH) / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sw;
    }
    ctx.lineTo(canvasW, midY);
    ctx.stroke();
  } else {
    // Idle: flat centre line
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,140,66,0.25)';
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(canvasW, midY);
    ctx.stroke();
  }

  rafViz = requestAnimationFrame(drawViz);
}

/* ---- Apply preset ---- */

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  Object.assign(engine.params, p);

  engine.setLowpassFreq(p.lowpassFreq);
  engine.setLowpassEnabled(p.lowpassEnabled);
  engine.setHighpassEnabled(p.highpassEnabled);
  engine.setSaturation(p.saturation);
  engine.setSaturationEnabled(p.saturationEnabled);
  engine.setReverbAmount(p.reverbAmount);
  engine.setReverbEnabled(p.reverbEnabled);
  engine.setTremoloDepth(p.tremoloDepth);
  engine.setTremoloEnabled(p.tremoloEnabled);
  engine.setNoiseAmount(p.noiseAmount);
  engine.setNoiseEnabled(p.noiseEnabled);
  engine.setSpeed(p.speed);
  engine.setVolume(p.volume);

  // Sync slider values
  document.getElementById('sliderLowpass').value    = p.lowpassFreq;
  document.getElementById('sliderSaturation').value = Math.round(p.saturation * 100);
  document.getElementById('sliderReverb').value     = Math.round(p.reverbAmount * 100);
  document.getElementById('sliderTremolo').value    = Math.round(p.tremoloDepth * 100);
  document.getElementById('sliderNoise').value      = Math.round(p.noiseAmount * 100);
  document.getElementById('sliderSpeed').value      = Math.round(p.speed * 100);
  document.getElementById('sliderVolume').value     = Math.round(p.volume * 100);

  // Sync toggle states
  setToggle('toggleLowpass',    p.lowpassEnabled);
  setToggle('toggleSaturation', p.saturationEnabled);
  setToggle('toggleReverb',     p.reverbEnabled);
  setToggle('toggleTremolo',    p.tremoloEnabled);
  setToggle('toggleNoise',      p.noiseEnabled);

  // Sync displayed values
  document.getElementById('valLowpass').textContent    = p.lowpassFreq + ' Hz';
  document.getElementById('valSaturation').textContent = Math.round(p.saturation * 100) + '%';
  document.getElementById('valReverb').textContent     = Math.round(p.reverbAmount * 100) + '%';
  document.getElementById('valTremolo').textContent    = Math.round(p.tremoloDepth * 100) + '%';
  document.getElementById('valNoise').textContent      = Math.round(p.noiseAmount * 100) + '%';
  document.getElementById('valSpeed').textContent      = p.speed.toFixed(2) + '×';
  document.getElementById('valVolume').textContent     = Math.round(p.volume * 100) + '%';

  toast('✨ ' + name);
}

/* ---- Load file ---- */

async function loadAudio(file) {
  if (!file || !file.type.match(/audio\/.*/)) {
    toast('Please select an audio file (MP3, WAV, AAC…)');
    return;
  }
  showLoading(true, 'Loading audio…');
  try {
    await engine.loadFile(file);
    fileName = file.name.replace(/\.[^/.]+$/, '');

    const zone = document.getElementById('uploadZone');
    zone.classList.add('has-file');
    zone.innerHTML = `
      <div class="upload-icon">🎶</div>
      <div class="upload-text">${file.name}</div>
      <div class="upload-hint">${fmtTime(engine.audioBuffer.duration)} · Tap to change file</div>
      <input type="file" id="fileInput" accept="audio/*" style="display:none">
    `;
    zone.addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', e => {
      if (e.target.files[0]) loadAudio(e.target.files[0]);
    });

    updateProgress();
    toast('🎵 Loaded! Hit play');
  } catch (err) {
    console.error(err);
    toast('Could not load file – try a different format');
  } finally {
    showLoading(false);
  }
}

/* ---- Init ---- */

function init() {
  engine = new LofiEngine();
  engine.onended = () => { updatePlayBtn(); stopProgressLoop(); updateProgress(); };

  // Canvas
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  drawViz();

  // Upload
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', e => {
    if (e.target.files[0]) loadAudio(e.target.files[0]);
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) loadAudio(e.dataTransfer.files[0]);
  });

  // Play / Pause
  document.getElementById('btnPlay').addEventListener('click', async () => {
    await engine.unlock();
    if (!engine.audioBuffer) { toast('Load an audio file first'); return; }
    if (engine.isPlaying) {
      engine.pause(); stopProgressLoop(); updateProgress();
    } else if (engine.isPaused) {
      engine.resume(); startProgressLoop();
    } else {
      engine.play(0); startProgressLoop();
    }
    updatePlayBtn();
  });

  // Stop
  document.getElementById('btnStop').addEventListener('click', () => {
    engine.stop();
    updatePlayBtn();
    stopProgressLoop();
    updateProgress();
  });

  // Loop
  document.getElementById('btnLoop').addEventListener('click', () => {
    engine.loop = !engine.loop;
    document.getElementById('btnLoop').classList.toggle('active', engine.loop);
    toast(engine.loop ? '🔁 Loop on' : '↪ Loop off');
  });

  // Seek
  document.getElementById('progressTrack').addEventListener('click', e => {
    if (!engine.audioBuffer) return;
    const rect = document.getElementById('progressTrack').getBoundingClientRect();
    engine.seek((e.clientX - rect.left) / rect.width);
    updateProgress();
    if (engine.isPlaying) startProgressLoop();
  });

  // Low-pass
  const slLP = document.getElementById('sliderLowpass');
  slLP.addEventListener('input', () => {
    engine.setLowpassFreq(+slLP.value);
    document.getElementById('valLowpass').textContent = slLP.value + ' Hz';
  });
  document.getElementById('toggleLowpass').addEventListener('click', () => {
    const v = !engine.params.lowpassEnabled;
    engine.setLowpassEnabled(v);
    setToggle('toggleLowpass', v);
  });

  // Saturation
  const slSat = document.getElementById('sliderSaturation');
  slSat.addEventListener('input', () => {
    const v = slSat.value / 100;
    engine.setSaturation(v);
    document.getElementById('valSaturation').textContent = slSat.value + '%';
  });
  document.getElementById('toggleSaturation').addEventListener('click', () => {
    const v = !engine.params.saturationEnabled;
    engine.setSaturationEnabled(v);
    setToggle('toggleSaturation', v);
  });

  // Reverb
  const slRev = document.getElementById('sliderReverb');
  slRev.addEventListener('input', () => {
    const v = slRev.value / 100;
    engine.setReverbAmount(v);
    document.getElementById('valReverb').textContent = slRev.value + '%';
  });
  document.getElementById('toggleReverb').addEventListener('click', () => {
    const v = !engine.params.reverbEnabled;
    engine.setReverbEnabled(v);
    setToggle('toggleReverb', v);
  });

  // Tremolo
  const slTrem = document.getElementById('sliderTremolo');
  slTrem.addEventListener('input', () => {
    const v = slTrem.value / 100;
    engine.setTremoloDepth(v);
    document.getElementById('valTremolo').textContent = slTrem.value + '%';
  });
  document.getElementById('toggleTremolo').addEventListener('click', () => {
    const v = !engine.params.tremoloEnabled;
    engine.setTremoloEnabled(v);
    setToggle('toggleTremolo', v);
  });

  // Noise
  const slNoise = document.getElementById('sliderNoise');
  slNoise.addEventListener('input', () => {
    const v = slNoise.value / 100;
    engine.setNoiseAmount(v);
    document.getElementById('valNoise').textContent = slNoise.value + '%';
  });
  document.getElementById('toggleNoise').addEventListener('click', () => {
    const v = !engine.params.noiseEnabled;
    engine.setNoiseEnabled(v);
    setToggle('toggleNoise', v);
  });

  // Speed
  const slSpeed = document.getElementById('sliderSpeed');
  slSpeed.addEventListener('input', () => {
    const v = slSpeed.value / 100;
    engine.setSpeed(v);
    document.getElementById('valSpeed').textContent = v.toFixed(2) + '×';
  });

  // Volume
  const slVol = document.getElementById('sliderVolume');
  slVol.addEventListener('input', () => {
    const v = slVol.value / 100;
    engine.setVolume(v);
    document.getElementById('valVolume').textContent = slVol.value + '%';
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });
  // Mark default
  const defaultPreset = document.querySelector('[data-preset="Classic Lofi"]');
  if (defaultPreset) defaultPreset.classList.add('active');

  // Export
  document.getElementById('btnExport').addEventListener('click', async () => {
    if (!engine.audioBuffer) { toast('Load a file first'); return; }
    showLoading(true, 'Rendering lofi audio…');
    try {
      const blob = await engine.exportWav();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lofi_${fileName || 'audio'}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('✅ Exported! Check your Downloads');
    } catch (err) {
      console.error(err);
      toast('Export failed: ' + err.message);
    } finally {
      showLoading(false);
    }
  });

  // Install hint dismiss
  document.getElementById('btnDismissHint').addEventListener('click', () => {
    document.getElementById('installHint').classList.add('hidden');
  });

  // Hide install hint on iOS if already standalone
  if (window.navigator.standalone) {
    document.getElementById('installHint').classList.add('hidden');
  }

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
