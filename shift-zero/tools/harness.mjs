// Shared test harness: serves the project and launches headless Chromium (Playwright).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function loadChromium() {
  try { return require('playwright').chromium; }
  catch { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')).chromium; }
}

export async function launch(query = '') {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const p = path.join(root, u === '/' ? 'index.html' : u);
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  }).listen(0);
  const browser = await loadChromium().launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://localhost:${server.address().port}/${query}`);
  await page.waitForTimeout(400);
  const close = async () => { await browser.close(); server.close(); };
  return { page, errors, close };
}
