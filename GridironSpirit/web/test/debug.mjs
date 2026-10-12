import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message + ' | ' + (e.stack || '').split('\n')[1])); page.on('console', (m) => errs.push(m.type() + ': ' + m.text()));
await page.goto('file://' + out + '/index.html'); await page.waitForTimeout(1500);
console.log(await page.evaluate(() => ({ gs: typeof GS, canvas: (() => { const c = document.getElementById('screen'); return c && [c.width, c.height, c.style.width, c.style.height]; })(), stage: document.getElementById('stage')?.getBoundingClientRect().toJSON() })));
console.log(errs.join('\n'));
await browser.close();
