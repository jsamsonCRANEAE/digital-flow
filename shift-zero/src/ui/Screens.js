// DOM overlay screens: Title, Intro crawl, Work Orders, Breakroom shop, Endings, Pause.
// Pure presentation — main.js owns state and input; we only re-render when markup changes.
import { ITEMS, SYNERGIES } from '../systems/RPGSystem.js';
import { MUTATORS } from '../systems/World.js';
import { ENDINGS } from '../systems/Narrative.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Screens {
  constructor(root) {
    this.root = root;
    this.last = '';
  }

  set(html) {
    if (html === this.last) return;
    this.last = html;
    this.root.innerHTML = html;
    this.root.classList.toggle('active', !!html);
  }

  hide() { this.set(''); }

  title(meta, t, pads = 0) {
    const found = Object.keys(ENDINGS).filter((k) => k !== 'terminated');
    const endings = found.map((k) => `<li class="${meta.endings.includes(k) ? 'got' : ''}">${meta.endings.includes(k) ? esc(ENDINGS[k].title) : '— locked —'}</li>`).join('');
    this.set(`
      <div class="screen title-screen">
        <div class="logo" data-text="SHIFT ZERO">SHIFT ZERO</div>
        <div class="subtitle">THE WEIGHT OF AMPERAGE</div>
        <div class="tagline">A 2-player asymmetric co-op roguelite · one keyboard · one man, split in two</div>
        <div class="press ${Math.floor(t * 2) % 2 ? 'dim' : ''}">PRESS SPACE, ENTER OR Ⓐ TO CLOCK IN</div>
        <div class="pads ${pads ? 'on' : ''}">${pads ? `🎮 ${pads} controller${pads > 1 ? 's' : ''} connected — controller 1 = BODY${pads > 1 ? ' · controller 2 = VOXEL' : ' (plug in a 2nd for the VOXEL)'}` : '🎮 Controllers supported — connect one and press any button'}</div>
        <div class="controls">
          <div class="col body">
            <h3>P1 · THE BODY</h3>
            <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move</p>
            <p><kbd>SPACE</kbd> interact · LOTO · skill-check</p>
            <p><kbd>Q</kbd> cycle tool · <kbd>E</kbd> use tool</p>
            <p><kbd>L-SHIFT</kbd> heavy dodge</p>
          </div>
          <div class="col voxel">
            <h3>P2 · THE VOXEL</h3>
            <p><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd> ride the conduits</p>
            <p><kbd>ENTER</kbd> hack · tap = shunt pulse · hold = jumper</p>
            <p><kbd>R-SHIFT</kbd> materialize pad / decoy</p>
            <p><kbd>/</kbd> OVERCLOCK — burn a memory</p>
          </div>
          <div class="col solo">
            <h3>CONTROLLERS</h3>
            <p>Stick/D-pad move · Ⓐ interact/hack · Ⓑ dodge/materialize · Ⓧ use tool · Ⓨ cycle tool (P2: overclock) · RT overclock · BACK solo-swap · START pause</p>
            <h3>PLAYING ALONE?</h3>
            <p><kbd>TAB</kbd> Solo-Swap: WASD/SPACE/SHIFT drive the Voxel, <kbd>F</kbd> overclock</p>
            <p><kbd>ESC</kbd> pause · <kbd>M</kbd> mute</p>
          </div>
        </div>
        <div class="endings"><span>ENDINGS FOUND ${meta.endings.length}/4 · SHIFTS WORKED ${meta.runs}</span><ul>${endings}</ul></div>
      </div>`);
  }

  intro(lines, index, chars) {
    const shown = lines.slice(0, index).map((l) => `<p>${esc(l)}</p>`).join('');
    const cur = index < lines.length ? `<p class="typing">${esc(lines[index].slice(0, chars))}<span class="caret">▌</span></p>` : '';
    this.set(`
      <div class="screen intro-screen">
        <div class="crawl">${shown}${cur}</div>
        <div class="hint">SPACE / ENTER — continue · ESC — skip</div>
      </div>`);
  }

  workOrders(depth, cards, sel, monologue, tierName) {
    const html = cards.map((c, i) => `
      <div class="card ${c.kind} ${i === sel ? 'selected' : ''}">
        <div class="wo-head">WORK ORDER #${esc(c.number)}</div>
        <h2>${esc(c.title)}</h2>
        <div class="risk">${esc(c.risk)}</div>
        <ul>${c.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <div class="mutator"><b>SHIFT MUTATOR · ${esc(MUTATORS[c.mutator].name)}</b><br>${esc(MUTATORS[c.mutator].desc)}</div>
        <div class="reward">${esc(c.reward)}</div>
      </div>`).join('');
    this.set(`
      <div class="screen wo-screen">
        <div class="wo-title">DEPTH ${depth} OF 4 — CHOOSE THE NEXT WORK ORDER</div>
        <div class="monologue ${tierName}">“${esc(monologue)}”</div>
        <div class="cards">${html}</div>
        <div class="hint"><kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> select · <kbd>SPACE</kbd>/<kbd>ENTER</kbd> sign the order</div>
      </div>`);
  }

  breakroom(d) {
    const item = (id, i, sel) => {
      const it = ITEMS[id];
      const pending = d.rpg.pendingSynergyFor(id);
      const afford = d.rpg.scrap >= it.cost;
      return `<li class="${i === sel ? 'sel' : ''} ${afford ? '' : 'poor'}">
        <div class="row"><span class="name">${esc(it.name)}</span><span class="cost">${it.cost} Cu</span></div>
        <div class="desc">${esc(it.desc)}</div>
        ${pending.length ? `<div class="syn">⚡ completes DUO: ${esc(pending.map((p) => p.name).join(', '))}</div>` : ''}
      </li>`;
    };
    const owned = [...d.rpg.owned.keys()].map((id) => `<span class="chip ${ITEMS[id].owner}">${esc(ITEMS[id].name)}</span>`).join('') || '<span class="chip none">nothing yet</span>';
    const syn = SYNERGIES.map((s) => {
      const on = d.rpg.hasSynergy(s.id);
      const parts = s.requires.map((r) => `<span class="${d.rpg.has(r) ? 'have' : ''}">${esc(ITEMS[r].name)}</span>`).join(' + ');
      return `<div class="synergy ${on ? 'on' : ''}"><b>${on ? '⚡ ' : ''}${esc(s.name)}</b> <small>${parts}</small><div>${esc(s.desc)}</div></div>`;
    }).join('');
    this.set(`
      <div class="screen break-screen">
        <div class="break-head">
          <div class="break-title">THE BREAKROOM · BETWEEN DEPTH ${d.depth} AND ${d.depth + 1}</div>
          ${d.reflection.map((l) => `<p class="reflection ${d.tier}">${esc(l)}</p>`).join('')}
          <div class="summary">${d.summary.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
        </div>
        <div class="shop">
          <div class="shop-col body"><h3>P1 · WORKBENCH (physical tools)</h3><div class="keys"><kbd>W</kbd>/<kbd>S</kbd> select · <kbd>SPACE</kbd> buy · <kbd>L-SHIFT</kbd> ready</div>
            <ul>${d.bodyList.map((id, i) => item(id, i, d.selB)).join('')}</ul>
            <div class="ready ${d.readyB ? 'on' : ''}">${d.readyB ? 'BODY READY' : 'BODY: not ready'}</div></div>
          <div class="shop-mid">
            <div class="scrap">${d.rpg.scrap} <small>Cu SCRAP</small></div>
            <div class="stat">BODY ${Math.ceil(d.hp)}/${d.maxHp} · ANCHOR ${d.anchor}% · LOCKS ${d.locks}</div>
            <div class="owned">${owned}</div>
            <div class="synergies"><h4>DUO-CIRCUIT SYNERGIES</h4>${syn}</div>
            <div class="log">${d.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
          </div>
          <div class="shop-col voxel"><h3>P2 · OUTLET (firmware daemons)</h3><div class="keys"><kbd>↑</kbd>/<kbd>↓</kbd> select · <kbd>ENTER</kbd> install · <kbd>R-SHIFT</kbd> ready</div>
            <ul>${d.voxelList.map((id, i) => item(id, i, d.selV)).join('')}</ul>
            <div class="ready ${d.readyV ? 'on' : ''}">${d.readyV ? 'VOXEL READY' : 'VOXEL: not ready'}</div></div>
        </div>
        <div class="hint">Both players ready to clock back in · solo: <kbd>TAB</kbd> readies both</div>
      </div>`);
  }

  ending(e, stats, canLeave) {
    this.set(`
      <div class="screen end-screen ${e.id}">
        <div class="end-title">${esc(e.title)}</div>
        <div class="end-sub">${esc(e.sub)}</div>
        <div class="end-lines">${e.lines.map((l, i) => `<p style="animation-delay:${0.6 + i * 1.6}s">${esc(l)}</p>`).join('')}</div>
        <div class="end-stats" style="animation-delay:${0.6 + e.lines.length * 1.6}s">${stats.map((s) => `<span>${esc(s)}</span>`).join('')}</div>
        <div class="hint ${canLeave ? '' : 'dim'}">${canLeave ? 'SPACE / ENTER — new shift' : '…'}</div>
      </div>`);
  }

  pause() {
    this.set(`
      <div class="screen pause-screen">
        <div class="end-title">PAUSED</div>
        <div class="end-sub">The grid doesn't pause. You do.</div>
        <div class="hint">ESC / START resume · M mute · R abandon shift</div>
      </div>`);
  }
}
