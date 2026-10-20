// Controller-first menu system, HUD rendering, minimap and the co-driver portrait.
(function () {
  'use strict';
  const AR = window.AR;
  const $ = (id) => document.getElementById(id);

  // ---------- generic list menu ----------
  const Menu = {
    items: [], sel: 0, onBack: null,
    open(title, jp, items, opts) {
      opts = opts || {};
      $('title').classList.add('hidden');
      $('panel').classList.remove('hidden');
      $('ptitle').textContent = title;
      $('pjp').textContent = jp || '';
      $('pfoot').innerHTML = opts.foot || 'Ⓐ select · Ⓑ back · ◀ ▶ change';
      this.items = items;
      this.onBack = opts.onBack || null;
      this.onChange = opts.onChange || null;
      this.sel = Math.min(opts.sel || 0, items.length - 1);
      while (this.items[this.sel] && this.items[this.sel].disabled) this.sel++;
      this.render();
    },
    close() {
      $('panel').classList.add('hidden');
      $('side').classList.add('hidden');
      this.items = [];
    },
    render() {
      const host = $('items');
      host.innerHTML = '';
      this.items.forEach((it, i) => {
        const d = document.createElement('div');
        d.className = 'item' + (i === this.sel ? ' sel' : '') + (it.disabled ? ' disabled' : '');
        const lab = document.createElement('span');
        lab.textContent = it.label;
        d.appendChild(lab);
        if (it.values || it.display) {
          const v = document.createElement('span');
          v.className = 'val';
          const cur = it.get ? it.get() : null;
          let shown = it.display ? it.display(cur) : String(cur);
          if (it.swatch) shown = '<i class="swatch" style="background:#' + new THREE.Color(cur).getHexString() + '"></i>' + (it.display ? it.display(cur) : '');
          v.innerHTML = (it.values ? '<span class="arr" data-d="-1">◀</span>' : '') + '<span>' + shown + '</span>' + (it.values ? '<span class="arr" data-d="1">▶</span>' : '');
          d.appendChild(v);
        } else if (it.text) {
          const inp = document.createElement('input');
          inp.maxLength = 8;
          inp.value = it.get();
          inp.addEventListener('input', () => it.set(inp.value.toUpperCase().replace(/[^A-Z0-9 \-]/g, '')));
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
          d.appendChild(inp);
          it._input = inp;
        }
        d.addEventListener('mouseenter', () => { if (!it.disabled) { this.sel = i; this.highlight(); } });
        d.addEventListener('click', (e) => {
          if (it.disabled) return;
          AR.Audio.init();
          const arr = e.target.closest('.arr');
          if (arr) this.change(i, +arr.dataset.d);
          else this.activate(i);
        });
        host.appendChild(d);
      });
      this.highlight();
    },
    highlight() {
      const els = $('items').children;
      for (let i = 0; i < els.length; i++) els[i].classList.toggle('sel', i === this.sel);
      const el = els[this.sel];
      if (el) el.scrollIntoView({ block: 'nearest' });
      const it = this.items[this.sel];
      if (it && it.onFocus) it.onFocus();
    },
    change(i, d) {
      const it = this.items[i];
      if (!it || !it.values) return;
      const vals = typeof it.values === 'function' ? it.values() : it.values;
      const cur = it.get();
      let idx = vals.findIndex((v) => v === cur);
      if (idx < 0) idx = 0;
      idx = (idx + d + vals.length) % vals.length;
      it.set(vals[idx]);
      AR.Audio.blip();
      if (this.onChange) this.onChange(it);
      this.renderValue(i);
    },
    renderValue(i) {
      // re-render all values (some options depend on others)
      const keepSel = this.sel;
      this.render();
      this.sel = keepSel;
      this.highlight();
    },
    activate(i) {
      const it = this.items[i];
      if (!it || it.disabled) return;
      if (it.action) { AR.Audio.select(); it.action(); }
      else if (it.values) this.change(i, 1);
      else if (it.text && it._input) it._input.focus();
    },
    handle(m) {
      if (!this.items.length) return;
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      const n = this.items.length;
      const move = (d) => {
        let s = this.sel;
        for (let k = 0; k < n; k++) {
          s = (s + d + n) % n;
          if (!this.items[s].disabled) break;
        }
        this.sel = s;
        AR.Audio.blip();
        this.highlight();
      };
      if (m.up) move(-1);
      if (m.down) move(1);
      if (m.left) this.change(this.sel, -1);
      if (m.right) this.change(this.sel, 1);
      if (m.ok) this.activate(this.sel);
      if (m.back && this.onBack) { AR.Audio.blip(); this.onBack(); }
    },
  };
  AR.Menu = Menu;

  AR.side = function (html) {
    const s = $('side');
    if (html == null) { s.classList.add('hidden'); return; }
    s.innerHTML = html;
    s.classList.remove('hidden');
  };

  // ---------- co-driver portrait (inline SVG, anime style) ----------
  AR.portraitSVG = function () {
    return [
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">',
      // helmet
      '<path d="M14 62 C10 26 32 10 52 10 C74 10 92 28 88 62 L84 74 L18 74 Z" fill="#f4f2ea" stroke="#1b1530" stroke-width="3"/>',
      '<path d="M18 40 C30 20 74 18 86 40" fill="none" stroke="#e8262f" stroke-width="6"/>',
      // hair (spiky bangs)
      '<path d="M24 46 L30 30 L36 44 L42 26 L50 44 L58 27 L64 44 L70 31 L78 47 L78 54 L24 54 Z" fill="#3b2a6b" stroke="#1b1530" stroke-width="2.5" stroke-linejoin="round"/>',
      // face
      '<path d="M26 50 C26 74 38 86 51 86 C64 86 76 74 76 50 Z" fill="#ffe2cf" stroke="#1b1530" stroke-width="3"/>',
      // blush
      '<ellipse cx="34" cy="70" rx="5" ry="2.5" fill="#ff9fb5" opacity="0.8"/><ellipse cx="68" cy="70" rx="5" ry="2.5" fill="#ff9fb5" opacity="0.8"/>',
      // eyes
      '<g class="eye"><ellipse cx="39" cy="61" rx="6" ry="8" fill="#1b1530"/><ellipse cx="39" cy="62" rx="4.4" ry="6" fill="#4a7de8"/><circle cx="37" cy="58" r="2.2" fill="#fff"/><circle cx="41" cy="65" r="1" fill="#fff"/></g>',
      '<g class="eye"><ellipse cx="63" cy="61" rx="6" ry="8" fill="#1b1530"/><ellipse cx="63" cy="62" rx="4.4" ry="6" fill="#4a7de8"/><circle cx="61" cy="58" r="2.2" fill="#fff"/><circle cx="65" cy="65" r="1" fill="#fff"/></g>',
      // brows
      '<path d="M32 50 L45 52" stroke="#1b1530" stroke-width="2.5" stroke-linecap="round"/><path d="M57 52 L70 50" stroke="#1b1530" stroke-width="2.5" stroke-linecap="round"/>',
      // mouth
      '<path class="mouth-closed" d="M46 76 Q51 79 56 76" fill="none" stroke="#1b1530" stroke-width="2.5" stroke-linecap="round"/>',
      '<ellipse class="mouth-open" cx="51" cy="77" rx="4.5" ry="3.5" fill="#7a2a3a" stroke="#1b1530" stroke-width="2"/>',
      // headset mic
      '<path d="M78 58 C84 70 74 80 60 80" fill="none" stroke="#1b1530" stroke-width="3"/><circle cx="59" cy="80" r="3.5" fill="#1b1530"/>',
      '<rect x="74" y="50" width="10" height="16" rx="4" fill="#2f6fd6" stroke="#1b1530" stroke-width="2.5"/>',
      '</svg>',
    ].join('');
  };

  // ---------- co-driver pace notes ----------
  const JP_DIR = { Left: 'ひだり', Right: 'みぎ' };
  AR.CoDriver = {
    lastCorner: -9999, talkT: 0, nextAllowed: 0,
    reset() { this.lastCorner = -9999; this.talkT = 0; this.nextAllowed = 0; },
    say(text, jp, speak) {
      $('note').textContent = text;
      $('notejp').textContent = jp || '';
      const b = $('bubble');
      b.classList.remove('bpop');
      void b.offsetWidth;
      b.classList.add('bpop');
      $('portrait').classList.add('talk');
      this.talkT = 0.9;
      if (speak && AR.settings.voice && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(speak);
          u.rate = 1.25;
          u.pitch = 1.25;
          window.speechSynthesis.speak(u);
        } catch (e) { /* voice unavailable */ }
      }
    },
    update(dt, stage, progressIdx, speed, time) {
      if (this.talkT > 0) {
        this.talkT -= dt;
        if (this.talkT <= 0) $('portrait').classList.remove('talk');
      }
      if (time < this.nextAllowed) return;
      const N = stage.N, ds = stage.ds;
      const look0 = Math.round(Math.max(35, speed * 2.6) / ds);
      const look1 = look0 + Math.round(90 / ds);
      for (let k = look0; k < look1; k++) {
        const i = (progressIdx + k) % N;
        const c = stage.curv[i];
        if (Math.abs(c) > 0.0085) {
          const absIdx = progressIdx + k;
          if (absIdx - this.lastCorner < Math.round(60 / ds)) return;
          // measure the corner
          let total = 0, maxC = 0, j = 0, first = 0, second = 0;
          const sign = Math.sign(c);
          while (j < Math.round(160 / ds)) {
            const cc = stage.curv[(i + j) % N];
            if (Math.sign(cc) !== sign || Math.abs(cc) < 0.004) break;
            total += cc * ds;
            maxC = Math.max(maxC, Math.abs(cc));
            if (j < 10) first = Math.max(first, Math.abs(cc)); else second = Math.max(second, Math.abs(cc));
            j++;
          }
          const radius = 1 / Math.max(maxC, 1e-4);
          const ang = Math.abs(total) * (180 / Math.PI);
          let sev = radius > 140 ? 6 : radius > 95 ? 5 : radius > 65 ? 4 : radius > 42 ? 3 : radius > 26 ? 2 : 1;
          const dir = sign > 0 ? 'Right' : 'Left';
          let call = ang > 120 && radius < 30 ? 'Hairpin ' + dir : dir + ' ' + sev;
          let extra = '';
          if (ang > 85 && !call.startsWith('Hairpin')) extra = 'long';
          if (second > first * 1.35 && j > 14) extra = 'tightens';
          const bank = Math.abs(stage.bank[(i + Math.floor(j / 2)) % N]);
          if (bank > 0.15) extra = extra ? extra + ', banked' : 'banked!';
          const dist = Math.round((k * ds) / 10) * 10;
          const jp = (call.startsWith('Hairpin') ? 'ヘアピン ' : '') + JP_DIR[dir] + ' ' + (call.startsWith('Hairpin') ? '' : sev) + (bank > 0.15 ? ' バンク！' : '');
          this.say((call + (extra ? ' ' + extra : '')).toUpperCase(), jp + ' · ' + dist + 'm', call + (extra ? ', ' + extra : ''));
          this.lastCorner = absIdx + j;
          this.nextAllowed = time + 1.6;
          return;
        }
      }
    },
  };

  // ---------- HUD ----------
  const HUD = {
    tachLen: 0,
    init() {
      $('portrait').innerHTML = AR.portraitSVG();
      const p = $('tachfill');
      this.tachLen = p.getTotalLength ? p.getTotalLength() : 420;
      this.mm = $('minimap').getContext('2d');
    },
    show(v) { $('hud').classList.toggle('hidden', !v); },
    update(st) {
      $('timer').textContent = AR.fmtTime(st.time);
      $('gatelbl').textContent = 'GATE ' + st.gate + ' OF ' + st.gates;
      const mph = AR.settings.units === 'mph';
      const sp = Math.abs(st.speed) * (mph ? 2.23694 : 3.6);
      $('spd').textContent = Math.round(sp);
      $('units').textContent = mph ? 'MPH' : 'KM/H';
      $('gear').textContent = st.gear === -1 ? 'R' : st.ev ? 'D' : String(st.gear);
      const r = AR.clamp(st.rpm / st.redline, 0, 1);
      const f = $('tachfill');
      f.style.strokeDasharray = r * this.tachLen + ' 999';
      f.classList.toggle('red', r > 0.9);
      const ip = st.input;
      document.querySelector('#inputs .steer i').style.left = 50 + ip.steer * 48 + '%';
      document.querySelector('#inputs .thr i').style.width = ip.throttle * 100 + '%';
      document.querySelector('#inputs .brk i').style.width = ip.brake * 100 + '%';
      document.querySelector('#inputs .hb').classList.toggle('on', ip.handbrake > 0.3);
    },
    minimap(stage, pos, heading, ghostPos) {
      const c = this.mm, W = c.canvas.width, H = c.canvas.height;
      c.clearRect(0, 0, W, H);
      const scale = 0.55 * (W / 220);
      const lw = W / 220;
      c.save();
      c.translate(W / 2, H * 0.72);
      c.rotate(-heading);
      c.lineCap = c.lineJoin = 'round';
      const pr = stage.project(pos.x, pos.z);
      const i0 = pr ? pr.i : 0;
      const pts = [];
      for (let k = -40; k < 180; k += 2) {
        const p = stage.P[(i0 + k + stage.N) % stage.N];
        pts.push([(p.x - pos.x) * scale, (p.z - pos.z) * scale]);
      }
      const path = () => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); };
      path(); c.strokeStyle = '#1b1530'; c.lineWidth = 10 * lw; c.stroke();
      path(); c.strokeStyle = '#e9e6dc'; c.lineWidth = 5 * lw; c.stroke();
      if (ghostPos) {
        c.fillStyle = '#7fe9ff';
        c.beginPath(); c.arc((ghostPos.x - pos.x) * scale, (ghostPos.z - pos.z) * scale, 4 * lw, 0, Math.PI * 2); c.fill();
      }
      c.restore();
      // player arrow
      c.fillStyle = '#ff7a2f';
      c.strokeStyle = '#1b1530';
      c.lineWidth = 2 * lw;
      c.beginPath();
      c.moveTo(W / 2, H * 0.72 - 9 * lw); c.lineTo(W / 2 + 6 * lw, H * 0.72 + 6 * lw); c.lineTo(W / 2 - 6 * lw, H * 0.72 + 6 * lw); c.closePath();
      c.fill(); c.stroke();
    },
    split(text, good) {
      const s = $('split');
      s.textContent = text;
      s.className = 'show ' + (good == null ? '' : good ? 'good' : 'bad');
      clearTimeout(this._st);
      this._st = setTimeout(() => (s.className = ''), 1800);
    },
    msg(text) { $('msg').innerHTML = text || ''; },
    damage(z, engine, total) {
      const col = (v) => (v < 0.05 ? '#57e389' : v < 0.4 ? '#ffd83a' : v < 0.75 ? '#ff8a2f' : '#ff3048');
      ['front', 'rear', 'left', 'right'].forEach((k) => $('dz-' + k).style.fill = col(z[k]));
      $('dz-engine').style.fill = col(engine);
      $('dmgpct').textContent = Math.round(total * 100) + '%';
      const d = $('damage');
      d.classList.remove('hit');
      void d.offsetWidth;
      d.classList.add('hit');
    },
    hint(text) { $('hint').innerHTML = text || ''; },
    countdown(text, go) {
      const c = $('countdown');
      c.textContent = text;
      c.className = '';
      void c.offsetWidth;
      c.className = go ? 'go' : 'tick';
    },
    drift(on, pts, mult) {
      const d = $('drift');
      d.classList.toggle('on', on);
      if (on) {
        d.querySelector('.pts').textContent = Math.round(pts).toLocaleString();
        d.querySelector('.mult').textContent = 'x' + mult + ' ドリフト';
      }
    },
  };
  AR.HUD = HUD;
})();
