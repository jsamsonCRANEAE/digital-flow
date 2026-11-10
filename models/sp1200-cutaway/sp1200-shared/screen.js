// The touchscreen, drawn from the state alone (pure: same state, same pixels).
import {rng} from 'cutaway-kit/util.js';

const r = rng(26040);
const WAVE_A = Array.from({length: 460}, (_, i) => {
  const t = i / 460;
  return (Math.sin(i * 0.9) * 0.5 + (r() - 0.5)) * Math.exp(-t * 2.6) * (0.6 + 0.4 * Math.sin(t * 38));
});
const WAVE_B = Array.from({length: 240}, (_, i) => (r() - 0.5) * Math.exp(-i / 90) * 1.6);
export const PATTERN = [
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
];

export function drawScreen(tex, s) {
  const c = tex.userData.canvas;
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  const step = s.step ?? -1, ph = s.playhead ?? 0.45, bpm = s.bpm ?? 92, meters = s.meters ?? [];
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0e1724');
  bg.addColorStop(1, '#070b12');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const OR = '#ff7a2e', CY = '#6fe6ff', TX = '#cbd8e8', DM = '#5b6b7e';
  g.textAlign = 'left';
  g.font = '600 26px Inter, Arial';
  g.fillStyle = TX;
  g.fillText('SEQ · PATTERN 01', 26, 40);
  g.fillStyle = OR;
  g.fillText(`${bpm} BPM`, 300, 40);
  g.fillText('12-BIT / 26.04kHz', 450, 40);
  g.fillStyle = DM;
  g.fillText(step >= 0 ? '● PLAY' : '■ STOP', 1150, 40);
  // main waveform
  const wx = 26, wy = 62, ww = 760, wh = 230;
  g.strokeStyle = '#21324a';
  g.lineWidth = 2;
  g.strokeRect(wx, wy, ww, wh);
  g.strokeStyle = OR;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(wx, wy + wh / 2);
  g.lineTo(wx + ww, wy + wh / 2);
  g.stroke();
  g.fillStyle = CY;
  WAVE_A.forEach((v, i) => {
    const a = Math.round((Math.abs(v) * wh * 0.48) / 5) * 5;
    g.fillRect(wx + (i / WAVE_A.length) * ww, wy + wh / 2 - a, 1.6, a * 2);
  });
  g.fillStyle = 'rgba(255,122,46,0.14)';
  g.fillRect(wx + 0.1 * ww, wy, 0.32 * ww, wh);
  g.fillStyle = OR;
  g.fillRect(wx + ph * ww, wy, 3, wh);
  // side panel
  const sx = 810;
  g.fillStyle = '#101c2a';
  g.fillRect(sx, 62, 455, 230);
  g.fillStyle = TX;
  g.font = '600 22px Inter, Arial';
  g.fillText('SAMPLE EDIT', sx + 16, 94);
  g.font = '500 19px Inter, Arial';
  ['START  0.000', 'END    1.284', 'TUNE   +0.00', 'FILTER 62%', 'DRIVE  48%'].forEach((t, i) => {
    g.fillStyle = i === 3 ? OR : DM;
    g.fillText(t, sx + 16, 128 + i * 32);
  });
  g.strokeStyle = CY;
  g.lineWidth = 1.6;
  g.beginPath();
  WAVE_B.forEach((v, i) => g.lineTo(sx + 200 + i, 190 + v * 60));
  g.stroke();
  // step grid
  const gx = 26, gy = 312, cw = 1238 / 16, rh = 46;
  for (let rr = 0; rr < 6; rr++)
    for (let st = 0; st < 16; st++) {
      const on = PATTERN[rr][st];
      g.fillStyle = on ? (st === step ? '#ffd9bd' : OR) : st % 4 === 0 ? '#1d2a39' : '#15202d';
      g.fillRect(gx + st * cw + 3, gy + rr * rh + 3, cw - 6, rh - 8);
    }
  if (step >= 0) {
    g.fillStyle = 'rgba(111,230,255,0.25)';
    g.fillRect(gx + step * cw, gy, cw, rh * 6);
  }
  // channel meters
  const my = gy + 6 * rh + 10;
  for (let i = 0; i < 7; i++) {
    g.fillStyle = '#132131';
    g.fillRect(gx + i * 102, my, 92, 22);
    g.fillStyle = i % 2 ? CY : OR;
    g.fillRect(gx + i * 102, my, 92 * Math.min(1, meters[i] ?? 0.3), 22);
  }
  // tab bar
  ['MAIN', 'SEQUENCE', 'SAMPLE', 'MIXER', 'FX', 'DISK'].forEach((t, i) => {
    const tx = 26 + i * 207;
    g.fillStyle = i === 1 ? '#1f6f8f' : '#121c28';
    g.fillRect(tx, h - 62, 197, 48);
    g.fillStyle = TX;
    g.font = '600 20px Inter, Arial';
    g.textAlign = 'center';
    g.fillText(t, tx + 98, h - 31);
    g.textAlign = 'left';
  });
  tex.needsUpdate = true;
}
