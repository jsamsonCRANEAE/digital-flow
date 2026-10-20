// Builds dist/ShiftZero.html: one self-contained file that runs by double-clicking (file://).
// Usage: node tools/build-single.mjs   (uses esbuild via npx to bundle the ES modules)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const bundle = path.join(dist, '.bundle.js');
execSync(`npx -y esbuild@0.24.0 src/main.js --bundle --format=iife --outfile=${bundle}`, { cwd: root, stdio: 'inherit' });
const js = fs.readFileSync(bundle, 'utf8').replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css" />', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="src/main.js"></script>', () => `<script>\n${js}\n</script>`);
fs.writeFileSync(path.join(dist, 'ShiftZero.html'), html);
fs.unlinkSync(bundle);
console.log(`built dist/ShiftZero.html (${(html.length / 1024).toFixed(0)} KB)`);
