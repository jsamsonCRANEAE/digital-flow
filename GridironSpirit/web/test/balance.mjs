// Plays N full CPU-vs-CPU games in the page and prints per-play outcome stats.
import { chromium } from 'playwright';
const out = process.argv[2], N = +(process.argv[3] || 4);
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message + (e.stack || '').split('\n')[1]));
await page.goto('file://' + out + '/index.html'); await page.waitForTimeout(800);
const r = await page.evaluate((N) => {
  const { DATA } = GS; const rows = []; const games = [];
  for (let g = 0; g < N; g++) {
    const m = new GS.Match({ teams: [DATA.teams.teams[g % 3], DATA.teams.teams[(g + 1) % 3]], human: null, difficulty: 'pro', qLen: 120 });
    let n = 0; const seen = new Set();
    while (!m.report && n < 60 * 60 * 30) {
      const before = m.phase === 'post' && m.timer + 1 / 60 > 1.5 ? { on: m.state.ballOn, poss: m.state.poss, play: m.play } : null;
      m.update(1 / 60, null); n++;
      if (before && before.play.result && !seen.has(before.play)) { seen.add(before.play); const p = before.play, rr = p.result;
        rows.push({ call: p.offPlay.id, kind: rr.kind, gain: Math.round((rr.y ?? p.ball.y) - p.los), thrown: !!p.thrown, t: +p.time.toFixed(1) }); }
    }
    games.push({ score: m.state.score, big: m.stats.map((s) => s.bigHits), fd: m.stats.map((s) => s.firstDowns), plays: n });
  }
  return { rows, games };
}, N);
const by = {}; for (const x of r.rows) { const k = x.call; (by[k] ||= []).push(x); }
for (const [k, v] of Object.entries(by)) { const g = v.map((x) => x.gain); const kinds = {}; v.forEach((x) => kinds[x.kind] = (kinds[x.kind] || 0) + 1);
  g.sort((a, b) => a - b); console.log(k.padEnd(12), 'n=' + v.length, 'median=' + g[g.length >> 1], 'mean=' + (g.reduce((a, b) => a + b, 0) / g.length).toFixed(1), JSON.stringify(kinds)); }
console.log('games', JSON.stringify(r.games)); console.log('plays/game', (r.rows.length / N).toFixed(1));
console.log(errs.join('\n')); await browser.close();
