import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage();
await page.goto('file://' + out + '/index.html'); await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const rows = [];
  for (const call of ['slants', 'curl_flat', 'verticals', 'post_corner']) for (const def of ['cover2', 'cover3', 'man_press', 'lb_blitz', 'prevent', 'zero_blitz']) for (let k = 0; k < 6; k++) {
    const m = new GS.Match({ teams: [GS.DATA.teams.teams[k % 3], GS.DATA.teams.teams[(k + 1) % 3]], human: null, difficulty: 'pro', qLen: 120 });
    m.offCall = call; m.defCall = def; m.cpuCalls(); m.snap(); const p = m.play; let t = 0, catchInfo = null, throwT = null, endX = null;
    while (p.phase === 'live' && t < 15) { p.step(1 / 120, null); t += 1 / 120; if (p.thrown && throwT == null) throwT = t;
      for (const e of p.events) if (e.type === 'catch') { const c = e.p; catchInfo = { air: c.y - p.los, x: c.x, sep: Math.min(...p.players.filter((d) => d.side === 'def' && d.up).map((d) => Math.hypot(d.x - c.x, d.y - c.y))), behind: p.players.filter((d) => d.side === 'def' && d.up && d.y > c.y).length }; }
      p.events.length = 0; }
    const res = p.result; rows.push({ call, def, kind: res.kind, catchInfo, throwT, end: (res.y ?? 0) - p.los, endX: res.x });
  }
  return rows;
});
const comp = r.filter((x) => x.catchInfo);
const avg = (a) => (a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)).toFixed(1);
console.log('attempts', r.length, 'completions', comp.length, 'pct', (comp.length / r.length * 100).toFixed(0));
console.log('air', avg(comp.map((x) => x.catchInfo.air)), 'yac', avg(comp.map((x) => x.end - x.catchInfo.air)), 'sep', avg(comp.map((x) => x.catchInfo.sep)), 'defenders behind', avg(comp.map((x) => x.catchInfo.behind)));
console.log('TD', r.filter((x) => x.kind === 'touchdown').length, 'OOB', r.filter((x) => x.kind === 'outOfBounds').length, 'throwT', avg(r.filter((x) => x.throwT).map((x) => x.throwT)));
for (const d of ['cover2', 'cover3', 'man_press', 'lb_blitz', 'prevent', 'zero_blitz']) { const s = r.filter((x) => x.def === d); console.log(d.padEnd(11), 'TD', s.filter((x) => x.kind === 'touchdown').length, '/', s.length, 'sep', avg(s.filter((x) => x.catchInfo).map((x) => x.catchInfo.sep)), 'behind', avg(s.filter((x) => x.catchInfo).map((x) => x.catchInfo.behind))); }
console.log('OOB samples', r.filter((x) => x.kind === 'outOfBounds').slice(0, 6).map((x) => x.call + ' x=' + (x.endX || 0).toFixed(1) + ' caught@' + (x.catchInfo ? x.catchInfo.x.toFixed(1) : '-')).join(' | '));
await browser.close();
