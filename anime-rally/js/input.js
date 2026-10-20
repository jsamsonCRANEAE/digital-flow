// Input: Gamepad API (Xbox / PlayStation / Switch Pro / generic Bluetooth pads), keyboard,
// remappable bindings saved per controller, menu navigation with auto-repeat, and rumble.
(function () {
  'use strict';
  const AR = window.AR;

  const DEFAULT_BINDS = {
    steer: { type: 'axis', index: 0, sign: 1 },
    throttle: { type: 'button', index: 7 },
    brake: { type: 'button', index: 6 },
    handbrake: { type: 'button', index: 0 },
    shiftUp: { type: 'button', index: 5 },
    shiftDown: { type: 'button', index: 4 },
    camera: { type: 'button', index: 3 },
    lookBack: { type: 'button', index: 1 },
    reset: { type: 'button', index: 8 },
    pause: { type: 'button', index: 9 },
  };
  AR.BIND_LABELS = {
    steer: 'Steer (push RIGHT)', throttle: 'Throttle', brake: 'Brake / Reverse', handbrake: 'Handbrake',
    shiftUp: 'Shift up', shiftDown: 'Shift down', camera: 'Change camera', lookBack: 'Look back',
    reset: 'Reset to road', pause: 'Pause',
  };
  const STD_NAMES = ['A / ✕', 'B / ○', 'X / □', 'Y / △', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'View / Share', 'Menu / Options', 'L-stick', 'R-stick', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];

  const keys = new Set();
  const keyEdges = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (!keys.has(e.code)) keyEdges.add(e.code);
    keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const Input = {
    padIndex: -1,
    padName: '',
    binds: null,
    capture: null,
    prevButtons: [],
    prevAxes: [],
    menuHeld: {},
    menuTimer: {},
    lastDevice: 'keyboard',
    state: { steer: 0, throttle: 0, brake: 0, handbrake: 0, shiftUp: false, shiftDown: false, camera: false, lookBack: false, reset: false, pause: false },
    menu: { up: false, down: false, left: false, right: false, ok: false, back: false, any: false },
    settings: { deadzone: 0.1, curve: 1.35 },

    pads() {
      try {
        return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
      } catch (e) {
        return [];
      }
    },
    activePad() {
      const pads = this.pads();
      if (!pads.length) { this.padIndex = -1; return null; }
      // choose the pad with any pressed input, else keep the last one
      for (const p of pads) {
        if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5 && p.mapping === 'standard')) {
          if (p.index !== this.padIndex) this.selectPad(p);
          break;
        }
      }
      let p = pads.find((x) => x.index === this.padIndex);
      if (!p) { p = pads[0]; this.selectPad(p); }
      return p;
    },
    selectPad(p) {
      this.padIndex = p.index;
      this.padName = p.id;
      const saved = AR.store.get('binds.' + p.id, null);
      this.binds = Object.assign({}, DEFAULT_BINDS, saved || {});
      this.prevButtons = p.buttons.map((b) => b.value);
      this.prevAxes = p.axes.slice();
    },
    saveBinds() {
      if (this.padName) AR.store.set('binds.' + this.padName, this.binds);
    },
    resetBinds() {
      this.binds = Object.assign({}, DEFAULT_BINDS);
      this.saveBinds();
    },
    buttonName(i) {
      return STD_NAMES[i] || 'Button ' + i;
    },
    bindName(b) {
      if (!b) return '—';
      if (b.type === 'button') return this.buttonName(b.index);
      return 'Axis ' + b.index + (b.sign != null ? (b.sign > 0 ? ' +' : ' −') : '');
    },

    read(p, b) {
      if (!b || !p) return 0;
      if (b.type === 'button') {
        const btn = p.buttons[b.index];
        return btn ? btn.value || (btn.pressed ? 1 : 0) : 0;
      }
      const v = p.axes[b.index] || 0;
      if (b.from != null) return AR.clamp((v - b.from) / (b.to - b.from), 0, 1);
      return v * (b.sign || 1);
    },

    // Begin capturing a binding: calls cb(binding) when the player moves an input.
    startCapture(action, cb) {
      const p = this.activePad();
      if (!p) return false;
      this.capture = { action, cb, base: p.axes.slice(), baseBtn: p.buttons.map((b) => b.value), t: 0 };
      return true;
    },

    rumble(strong, weak, ms) {
      if (AR.settings && AR.settings.vibration === false) return;
      const p = this.pads().find((x) => x.index === this.padIndex);
      if (!p) return;
      try {
        if (p.vibrationActuator && p.vibrationActuator.playEffect) {
          p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: AR.clamp(strong, 0, 1), weakMagnitude: AR.clamp(weak, 0, 1) });
        } else if (p.hapticActuators && p.hapticActuators[0]) {
          p.hapticActuators[0].pulse(Math.max(strong, weak), ms);
        }
      } catch (e) { /* rumble unsupported */ }
    },

    poll(dt) {
      const s = this.state, mn = this.menu;
      const p = this.activePad();
      let steer = 0, thr = 0, brk = 0, hb = 0;
      const edge = { shiftUp: false, shiftDown: false, camera: false, lookBack: false, reset: false, pause: false };
      const nav = { up: false, down: false, left: false, right: false, ok: false, back: false };

      if (p && this.capture) {
        const c = this.capture;
        c.t += dt;
        let found = null;
        p.buttons.forEach((b, i) => { if (!found && b.value > 0.6 && c.baseBtn[i] < 0.3) found = { type: 'button', index: i }; });
        if (!found) p.axes.forEach((a, i) => {
          if (found) return;
          const d = a - c.base[i];
          if (Math.abs(d) > 0.6) {
            if (c.action === 'steer') found = { type: 'axis', index: i, sign: Math.sign(d) };
            else if (Math.abs(c.base[i]) > 0.8) found = { type: 'axis', index: i, from: c.base[i], to: c.base[i] + Math.sign(d) * 2 * Math.min(1, Math.abs(c.base[i])) }; // trigger axis resting at ±1
            else found = { type: 'axis', index: i, from: 0, to: Math.sign(d) };
          }
        });
        if (found) {
          this.binds[c.action] = found;
          this.saveBinds();
          this.capture = null;
          c.cb(found);
          this.prevButtons = p.buttons.map((b) => b.value);
        }
        if (keyEdges.has('Escape')) { this.capture = null; c.cb(null); }
        keyEdges.clear();
        return s;
      }

      if (p) {
        const b = this.binds;
        let st = this.read(p, b.steer);
        const dz = this.settings.deadzone;
        st = Math.abs(st) < dz ? 0 : (Math.sign(st) * (Math.abs(st) - dz)) / (1 - dz);
        steer = Math.sign(st) * Math.pow(Math.abs(st), this.settings.curve);
        thr = this.read(p, b.throttle);
        brk = this.read(p, b.brake);
        hb = this.read(p, b.handbrake);
        const pressed = (bind) => this.read(p, bind) > 0.5;
        const was = (bind) => {
          if (!bind) return false;
          if (bind.type === 'button') return (this.prevButtons[bind.index] || 0) > 0.5;
          const v = this.prevAxes[bind.index] || 0;
          if (bind.from != null) return AR.clamp((v - bind.from) / (bind.to - bind.from), 0, 1) > 0.5;
          return v * (bind.sign || 1) > 0.5;
        };
        ['shiftUp', 'shiftDown', 'camera', 'lookBack', 'reset', 'pause'].forEach((k) => {
          if (k === 'lookBack') edge[k] = pressed(b[k]);
          else edge[k] = pressed(b[k]) && !was(b[k]);
        });
        const btn = (i) => (p.buttons[i] ? p.buttons[i].pressed || p.buttons[i].value > 0.5 : false);
        const wasBtn = (i) => (this.prevButtons[i] || 0) > 0.5;
        const ax0 = p.axes[0] || 0, ax1 = p.axes[1] || 0;
        nav.up = btn(12) || ax1 < -0.6;
        nav.down = btn(13) || ax1 > 0.6;
        nav.left = btn(14) || ax0 < -0.6;
        nav.right = btn(15) || ax0 > 0.6;
        nav.ok = btn(0) && !wasBtn(0);
        nav.back = btn(1) && !wasBtn(1);
        if (btn(9) && !wasBtn(9)) nav.ok = nav.ok || false;
        if (p.buttons.some((x) => x.pressed) || Math.abs(ax0) > 0.5 || thr > 0.2) this.lastDevice = 'pad';
        this.prevButtons = p.buttons.map((x) => x.value);
        this.prevAxes = p.axes.slice();
      }

      // keyboard (merged)
      const k = (c) => keys.has(c);
      const kSteer = (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0);
      if (kSteer) steer = kSteer;
      if (k('ArrowUp') || k('KeyW')) thr = 1;
      if (k('ArrowDown') || k('KeyS')) brk = 1;
      if (k('Space')) hb = 1;
      const ke = (c) => keyEdges.has(c);
      edge.shiftUp = edge.shiftUp || ke('KeyE');
      edge.shiftDown = edge.shiftDown || ke('KeyQ');
      edge.camera = edge.camera || ke('KeyC');
      edge.reset = edge.reset || ke('KeyR');
      edge.pause = edge.pause || ke('Escape') || ke('KeyP');
      edge.lookBack = edge.lookBack || k('KeyB');
      nav.up = nav.up || k('ArrowUp') || k('KeyW');
      nav.down = nav.down || k('ArrowDown') || k('KeyS');
      nav.left = nav.left || k('ArrowLeft') || k('KeyA');
      nav.right = nav.right || k('ArrowRight') || k('KeyD');
      nav.ok = nav.ok || ke('Enter') || ke('Space');
      nav.back = nav.back || ke('Escape') || ke('Backspace');
      if (keyEdges.size) this.lastDevice = 'keyboard';
      keyEdges.clear();

      // directional auto-repeat for menus
      ['up', 'down', 'left', 'right'].forEach((d) => {
        if (nav[d]) {
          if (!this.menuHeld[d]) { mn[d] = true; this.menuTimer[d] = 0.38; }
          else {
            this.menuTimer[d] -= dt;
            mn[d] = this.menuTimer[d] <= 0;
            if (mn[d]) this.menuTimer[d] = 0.09;
          }
        } else mn[d] = false;
        this.menuHeld[d] = nav[d];
      });
      mn.ok = nav.ok;
      mn.back = nav.back;
      mn.any = mn.up || mn.down || mn.left || mn.right || mn.ok || mn.back;

      s.steer = AR.clamp(steer, -1, 1);
      s.throttle = AR.clamp(thr, 0, 1);
      s.brake = AR.clamp(brk, 0, 1);
      s.handbrake = AR.clamp(hb, 0, 1);
      s.shiftUp = s.shiftUp || edge.shiftUp;
      s.shiftDown = s.shiftDown || edge.shiftDown;
      s.camera = edge.camera;
      s.lookBack = edge.lookBack;
      s.reset = edge.reset;
      s.pause = edge.pause;
      return s;
    },
    rawPad() {
      return this.pads().find((x) => x.index === this.padIndex) || null;
    },
  };

  window.addEventListener('gamepadconnected', (e) => {
    Input.selectPad(e.gamepad);
    if (AR.onPad) AR.onPad(true, e.gamepad.id);
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === Input.padIndex) Input.padIndex = -1;
    if (AR.onPad) AR.onPad(false, e.gamepad.id);
  });

  AR.Input = Input;
})();
