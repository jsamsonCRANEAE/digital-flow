import { chromium } from 'playwright';
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage();
await page.goto('file://' + process.argv[2] + '/index.html'); await page.waitForTimeout(500);
console.log(await page.evaluate(() => {
  let broken = 0, tackles = 0, catches = 0, minD = [], closeFrames = 0, frames = 0;
  for (let k = 0; k < 60; k++) {
    const m = new GS.Match({ teams: [GS.DATA.teams.teams[k % 3], GS.DATA.teams.teams[(k + 1) % 3]], human: null, difficulty: 'pro', qLen: 120 });
    m.offCall = 'slants'; m.defCall = 'cover2'; m.cpuCalls(); m.snap(); const p = m.play; let t = 0, caught = false, md = 99;
    while (p.phase === 'live' && t < 15) { p.step(1 / 120, null); t += 1 / 120;
      for (const e of p.events) { if (e.type === 'catch') { caught = true; catches++; } if (e.type === 'broken' && caught) broken++; if (e.type === 'tackle' && caught) tackles++; } p.events.length = 0;
      if (caught && p.ballCarrier) { frames++; const c = p.ballCarrier; const d = Math.min(...p.players.filter((x) => x.side === 'def' && x.up).map((x) => Math.hypot(x.x - c.x, x.y - c.y))); md = Math.min(md, d); if (d < 1.3) closeFrames++; } }
    if (caught) minD.push(md);
  }
  minD.sort((a, b) => a - b);
  return { catches, tackles, broken, closeFramesPerCatch: (closeFrames / catches).toFixed(1), framesPerCatch: (frames / catches).toFixed(0), minDistMedian: minD[minD.length >> 1]?.toFixed(2) };
}));
await browser.close();
