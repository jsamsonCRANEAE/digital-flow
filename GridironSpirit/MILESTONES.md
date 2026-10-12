# Milestones

## ✅ M1: Render pipeline, projected field, camera, one running player

### Summary
- 640x296 canvas → integer upscale (Metal) with a letterbox; sprites are drawn
  at canvas resolution by `SKRenderer`, so every pixel lands on the grid.
- Pseudo-3D field rasterizer: mow stripes every 5 yd, converging yard lines,
  hash marks, rotated yard numbers, team-colored diagonal-striped end zones, a
  dirt apron and dithered distance haze.
- Procedural stadium: a dithered sky, light towers, a 2-frame cheering crowd,
  a scoreboard and a padded wall of fake-brand ad panels, all with horizontal
  parallax.
- 7v7 lineup of placeholder players. They have 1 px outlines, hue-shifted
  shading, big helmets and gloves, front and back views, a 4-frame run cycle,
  and an oval ground shadow that stays on the ground.
- Fixed 120 Hz simulation, interpolated rendering, and stat-driven momentum
  movement.
- Camera follows the RB with smoothing and look-ahead. It has framing/zoom
  support (used by passing in M2) and 2 to 4 px decaying screen shake.
- Floating joystick that respects the safe area, plus a 5x7 bitmap font and an
  FPS/CPU overlay.

### Verified here
- `swift test`: **43/43 pass** (Swift 5.10, Linux). Covers the timestep,
  projection and ground-ray agreement, yard lines never vanishing, integer
  scale on 6 iPhone models, safe-area mapping, sprite outline rules, movement
  physics, joystick, determinism, input latency, the frame-rate governor, and
  the originality guard.
- Field raster: **~0.9 to 1.0 ms/frame** in a Release build, measured on this
  x86 build machine.
- Previews rendered from the real core code are in [`docs/m1/`](docs/m1).

### Not verified here
The iOS layer (Metal, SpriteKit, UIKit) was written but **not compiled**: this
environment has no Xcode or iOS SDK. Expect the first `xcodegen generate` and
build to possibly need small fixes, which I'll handle when you report them.

### Device test checklist (please run on an iPhone 12 or newer)
- [ ] App launches in landscape, either orientation; no status bar; home indicator dims.
- [ ] Image is crisp: zoom a screenshot and each canvas pixel is an exact 3x3
      block (4x4 on Pro Max). No blur, no uneven pixel sizes. Also check an
      iPhone mini if you have one.
- [ ] Letterbox border is dark navy; nothing important sits under the notch or Dynamic Island.
- [ ] Field reads correctly: crowd and scoreboard at the top, end zone far away, yard lines converging.
- [ ] Touch the left half: the joystick appears under the thumb. Dragging runs
      the RB (yellow marker) and the response feels instant.
- [ ] Drag past the ring: the base follows the thumb. Release: the RB decelerates and stops.
- [ ] Full speed then pull back: the RB plants and reverses (no instant 180).
      A gentle curve carves an arc.
- [ ] Camera leads the runner and stays smooth. Run to each sideline: the camera stops short of the bench area.
- [ ] Sprites don't jitter 1 px back and forth while running slowly next to a yard line.
- [ ] Players further away are smaller, keep 1 px outlines, and their shadows sit under their feet.
- [ ] Tap the right half: a short screen shake (about 3 px, 150 ms).
- [ ] Debug line (top-left, inside the safe area): FPS holds 60 (120 on
      ProMotion) and CPU stays under 6 ms. Over a 10-second sprint across the
      field there should be no drops.
- [ ] Background the app and return: no jump or teleport.
- [ ] In Instruments (Time Profiler + Metal System Trace): the main thread is under 8 ms per frame.

### Questions for you before M2
1. Integer 3x with a letterbox, or add the "sharp fit" option? (See DECISIONS.md.)
2. Can you re-attach the reference images? None reached this session.
3. Should the camera stay behind the human's team on defense too (it flips
   with possession), or always face the same end zone?

## ⏭ M2: Ball physics, passing, catching, tackling, hit-stop
## M3: Full 7v7 play: 6+6 plays, AI, downs and scoring
## M4: Art pass: 2 teams, portraits, callouts, Spirit Play cut-ins
## M5: HUD, menus, gear shop, audio
## M6: Polish, haptics, performance profiling
