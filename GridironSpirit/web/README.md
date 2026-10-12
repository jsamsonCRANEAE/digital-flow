# Gridiron Spirit: web version

A browser port of the game that runs on any phone or computer, including iPhone Safari, with no install.
It's a single self-contained HTML page with no external files.

- `src/`: the game, in numbered modules:
  - core and font
  - audio (the GSAudio synth ported to Web Audio)
  - Mode-7 renderer and sprites
  - 7v7 simulation
  - match rules
  - input (touch, keyboard, Gamepad API)
  - app and screens
  - HUD
  - boot
- `build.mjs`: bundles `src/` plus the shared game data from `Packages/GridironCore/Sources/GSData/Resources` into `dist/gridiron-spirit.html`.
- `test/`: headless Chromium checks (Playwright). Pass a scratch directory as the first argument.
  - `smoke.mjs`: taps through every screen, then plays a full game.
  - `offense.mjs`: snap, throw, Spirit cut-in and the field-goal meter.
  - `balance.mjs`, `pass.mjs`, `trace.mjs`, `yac.mjs`: play-by-play balance stats.
  - `audio.mjs`: song render time and levels.

```sh
node build.mjs
node test/smoke.mjs /tmp/gs
```

It uses the same teams, plays, Spirit Plays, gear, prices and daily trials as the iOS build.
Simplifications versus iOS:
- No instant replays.
- Interceptions and fumbles end the play at the spot (no returns).
- Extra points are automatic.
