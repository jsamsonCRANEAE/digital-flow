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

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.lastKey = null;
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      this.lastKey = e.code;
    });
    target.addEventListener('keyup', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasReleased(code) { return this.released.has(code); }
  anyPressed(...codes) { return codes.some((c) => this.pressed.has(c)); }
  anyDown(...codes) { return codes.some((c) => this.down.has(c)); }
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
