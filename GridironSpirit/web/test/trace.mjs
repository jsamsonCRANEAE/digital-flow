import { chromium } from 'playwright';
const out = process.argv[2], call = process.argv[3] || 'hb_dive', def = process.argv[4] || 'cover2';
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage();
await page.goto('file://' + out + '/index.html'); await page.waitForTimeout(500);
const r = await page.evaluate(([call, def]) => {
  const res = [], impacts = [];
  for (let k = 0; k < 40; k++) {
    const m = new GS.Match({ teams: [GS.DATA.teams.teams[0], GS.DATA.teams.teams[1]], human: null, difficulty: 'pro', qLen: 120 });
    m.offCall = call; m.defCall = def; m.cpuCalls(); m.snap(); const p = m.play; let t = 0, ho = null;
    while (p.phase === 'live' && t < 12) { p.step(1 / 120, null); t += 1 / 120; if (p.handedOff && ho == null) ho = +t.toFixed(2);
      for (const e of p.events) if (e.type === 'tackle') impacts.push(+e.impact.toFixed(1)); p.events.length = 0; }
    const tk = p.result; res.push([tk.kind, Math.round((tk.y ?? 0) - p.los), tk.by ? tk.by.slot : '-', +t.toFixed(2), ho]);
  }
  impacts.sort((a, b) => a - b);
  return { res, impacts: [impacts[0], impacts[impacts.length >> 2], impacts[impacts.length >> 1], impacts[(impacts.length * 3) >> 2], impacts[impacts.length - 1]] };
}, [call, def]);
console.log(call, 'vs', def); console.log(r.res.map((x) => x.join(':')).join('  ')); console.log('impact quartiles', r.impacts);
await browser.close();
