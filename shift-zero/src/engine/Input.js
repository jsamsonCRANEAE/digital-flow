// Keyboard state + per-player intent mapping (with Solo-Swap support).

const GAME_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Slash',
  'ShiftLeft', 'ShiftRight', 'Enter', 'NumpadEnter', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyQ', 'KeyE', 'KeyF', 'Escape', 'Backquote',
]);

export const KEYS = {
  P1: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', interact: 'Space', cycle: 'KeyQ', use: 'KeyE', dodge: 'ShiftLeft', overclock: 'KeyF' },
  P2: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', hack: 'Enter', hackAlt: 'NumpadEnter', materialize: 'ShiftRight', overclock: 'Slash' },
};

// Standard-mapping gamepad buttons → the virtual keys each player already uses.
// Controller 1 drives P1 (Body), controller 2 drives P2 (Voxel). Shared: Back = Solo-Swap, Start = pause.
const PAD_MAPS = [
  {
    up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
    buttons: { 0: 'Space', 1: 'ShiftLeft', 2: 'KeyE', 3: 'KeyQ', 4: 'KeyQ', 5: 'KeyE', 6: 'ShiftLeft', 7: 'KeyF', 8: 'Tab', 9: 'Escape' },
  },
  {
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    buttons: { 0: 'Enter', 1: 'ShiftRight', 2: 'Enter', 3: 'Slash', 5: 'ShiftRight', 7: 'Slash', 8: 'Tab', 9: 'Escape' },
  },
];
const DEADZONE = 0.45;

export class Input {
  constructor(target = window) {
    this.keyDown = new Set();
    this.padDown = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.lastKey = null;
    this.pads = [];
    this.onPadChange = null;
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.isDown(e.code)) this.pressed.add(e.code);
      this.keyDown.add(e.code);
      this.lastKey = e.code;
    });
    target.addEventListener('keyup', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      this.keyDown.delete(e.code);
      if (!this.padDown.has(e.code)) this.released.add(e.code);
    });
    target.addEventListener('blur', () => this.keyDown.clear());
    target.addEventListener('gamepadconnected', () => this.onPadChange && this.onPadChange(this.connectedPads().length, true));
    target.addEventListener('gamepaddisconnected', () => this.onPadChange && this.onPadChange(this.connectedPads().length, false));
  }

  connectedPads() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    return [...list].filter((p) => p && p.connected);
  }

  /** Called once per rendered frame: converts controller state into virtual key edges. */
  pollGamepads() {
    this.pads = this.connectedPads();
    const held = new Set();
    this.pads.slice(0, 2).forEach((pad, i) => {
      const m = PAD_MAPS[i];
      const btn = (n) => !!pad.buttons[n] && (pad.buttons[n].pressed || pad.buttons[n].value > 0.5);
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      if (ay < -DEADZONE || btn(12)) held.add(m.up);
      if (ay > DEADZONE || btn(13)) held.add(m.down);
      if (ax < -DEADZONE || btn(14)) held.add(m.left);
      if (ax > DEADZONE || btn(15)) held.add(m.right);
      for (const [n, code] of Object.entries(m.buttons)) if (btn(Number(n))) held.add(code);
    });
    for (const code of held) if (!this.isDown(code)) { this.pressed.add(code); this.lastKey = code; }
    for (const code of this.padDown) if (!held.has(code) && !this.keyDown.has(code)) this.released.add(code);
    this.padDown = held;
  }

  /** Dual-rumble every connected controller (ignored where unsupported). */
  rumble(strength, ms = 120) {
    for (const pad of this.pads) {
      const act = pad.vibrationActuator;
      if (act && act.playEffect) {
        act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strength), weakMagnitude: Math.min(1, strength * 0.6) }).catch(() => {});
      }
    }
  }

  isDown(code) { return this.keyDown.has(code) || this.padDown.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasReleased(code) { return this.released.has(code); }
  anyPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }
  anyDown(...codes) { return codes.some((c) => this.isDown(c)); }
  get anyKeyPressed() { return this.pressed.size > 0; }

  /** Called after each fixed simulation step so edge-triggered presses fire exactly once. */
  consume() {
    this.pressed.clear();
    this.released.clear();
  }

  axis(neg, pos) { return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0); }

  /**
   * Builds body/voxel intents. P2 keys always drive the Voxel. P1 keys drive whichever
   * character is "active" — Solo-Swap (TAB) hands P1's keyboard to the Voxel.
   */
  readIntents(swapped) {
    const k1 = KEYS.P1, k2 = KEYS.P2;
    const p1 = {
      x: this.axis(k1.left, k1.right),
      y: this.axis(k1.up, k1.down),
      interact: this.wasPressed(k1.interact),
      interactHeld: this.isDown(k1.interact),
      interactReleased: this.wasReleased(k1.interact),
      cycle: this.wasPressed(k1.cycle),
      use: this.wasPressed(k1.use),
      dodge: this.wasPressed(k1.dodge),
      overclock: this.wasPressed(k1.overclock),
    };
    const p2 = {
      x: this.axis(k2.left, k2.right),
      y: this.axis(k2.up, k2.down),
      hackPressed: this.anyPressed(k2.hack, k2.hackAlt),
      hackHeld: this.anyDown(k2.hack, k2.hackAlt),
      hackReleased: this.wasReleased(k2.hack) || this.wasReleased(k2.hackAlt),
      materialize: this.wasPressed(k2.materialize),
      overclock: this.wasPressed(k2.overclock),
    };
    const idleBody = { x: 0, y: 0, interact: false, interactHeld: false, cycle: false, use: false, dodge: false };
    if (!swapped) {
      return { body: p1, voxel: p2 };
    }
    const voxel = {
      x: p1.x || p2.x,
      y: p1.y || p2.y,
      hackPressed: p1.interact || p2.hackPressed,
      hackHeld: p1.interactHeld || p2.hackHeld,
      hackReleased: p1.interactReleased || p2.hackReleased,
      materialize: p1.dodge || p2.materialize,
      overclock: p1.overclock || p2.overclock,
    };
    return { body: idleBody, voxel };
  }
}
