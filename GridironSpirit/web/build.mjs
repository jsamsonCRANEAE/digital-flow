// Bundles web/src/*.js + the game's JSON data into one self-contained page.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
const root = new URL('.', import.meta.url).pathname;
const res = root + '../Packages/GridironCore/Sources/GSData/Resources/';
const data = { teams: JSON.parse(readFileSync(res + 'teams.json')), plays: JSON.parse(readFileSync(res + 'plays.json')),
  spirits: JSON.parse(readFileSync(res + 'spirits.json')), gear: JSON.parse(readFileSync(res + 'gear.json')) };
const font = readFileSync(root + 'src/font.json', 'utf8');
const js = readdirSync(root + 'src').filter((f) => f.endsWith('.js')).sort().map((f) => `// ==== ${f}\n` + readFileSync(root + 'src/' + f, 'utf8')).join('\n')
  .replace('__FONT__', font);
const html = `<title>Gridiron Spirit</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  /* Deliberately single-theme: a night-stadium arcade screen. */
  :root { --bg: #0E1426; --fg: #F6F4E8; --dim: #7A7FA8; color-scheme: dark; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--fg); overflow: hidden; overscroll-behavior: none;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
    font: 14px/1.4 ui-monospace, Menlo, monospace; }
  #stage { position: fixed; inset: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
    display: flex; align-items: center; justify-content: center; }
  #screen { image-rendering: pixelated; image-rendering: crisp-edges; touch-action: none; display: block; background: var(--bg); outline: none; }
  #rotate { position: fixed; left: 16px; right: 16px; top: calc(env(safe-area-inset-top, 0px) + 12px); text-align: center; color: var(--dim);
    font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; pointer-events: none; }
  noscript { position: fixed; inset: 0; display: grid; place-items: center; padding-inline: 16px; }
</style>
<div id="stage"><canvas id="screen" tabindex="0" aria-label="Gridiron Spirit game screen"></canvas></div>
<div id="rotate" hidden>Turn your phone sideways for the full field</div>
<noscript>Gridiron Spirit needs JavaScript to run.</noscript>
<script>
(() => {
"use strict";
const DATA = ${JSON.stringify(data)};
${js}
})();
</script>
`;
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(root + 'dist/gridiron-spirit.html', html);
console.log('wrote dist/gridiron-spirit.html', (html.length / 1024).toFixed(0) + ' KB');
