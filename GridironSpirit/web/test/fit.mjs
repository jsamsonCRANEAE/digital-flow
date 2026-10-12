import { chromium } from 'playwright';
const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })).newPage();
await page.goto('file://' + process.argv[2] + '/index.html'); await page.waitForTimeout(600);
console.log(await page.evaluate(() => ({ fit: GS.App.profile.settings.fit, w: document.getElementById('screen').style.width, stage: document.getElementById('stage').getBoundingClientRect().width })));
await browser.close();
