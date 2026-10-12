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
- [ ] ~~Tap the right half: a short screen shake.~~ (This M1 debug tap was replaced in M2 by real shakes on tackles.)
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

## ✅ M2: Ball physics, passing, catching, tackling, hit-stop (+ anime layer)

### Summary
- **Ball:** drag, wind, wobbling ducks, visual spiral (laces rotate),
  prolate-spheroid bounces and rolls, and kick physics.
- **Passing:** tap a receiver icon for a bullet, or hold and release for a
  lob. The throw solver leads the receiver through drag and wind; accuracy and
  pressure add scatter and wobble. The snap is a real short toss to the QB.
- **Catching:** resolved at closest approach. Outcomes are caught, dropped,
  tipped (stays live) or intercepted.
- **Tackling:** momentum- and angle-based, with clean, pushed-forward,
  stumble, broken and whiff outcomes. Gang tackles, live fumbles and
  recoveries all work.
- **Carrier moves:** juke, spin, stiff arm, and dive (swipe up). Each has a
  commitment window and a pose.
- **AI:** routes (go, slant, swing), man and zone coverage that breaks on the
  ball, pass rush and block, lead-angle pursuit, and 3 difficulty levels.
- **Dead balls:** tackle, out of bounds, incomplete, touchdown, interception
  and turnover. The next play auto-spots, with the ball clamped between the
  hashes.
- **Feel:** hit-stop, impact frame, 2–4 px shake, squash and stretch, turf
  and dust particles, starbursts and catch flashes, crowd hype animation, and
  Core Haptics.
- **Anime:** manga speed lines in open field, laser bullet trail, dotted lob
  trail, landing reticle, and a pass camera that tracks the ball.
- **Context buttons:** SNAP / AUDIBLE / SPIRIT before the snap, and JUKE /
  SPIN / STIFF with the ball. All are at least 44 pt and stay inside the safe
  area.

### Verified here
- `swift test`: **70/70 pass**. The new tests cover drag vs. vacuum,
  ducks/headwind/tailwind/crosswind, irregular prolate bounces, coming to
  rest, the throw solver hitting a moving target through wind, lob vs.
  bullet, pressure scatter, kicks, catch and tackle probabilities, intercept
  math, snap to QB, and 60-play pass statistics. They also cover runs ending
  in tackles, live fumbles, hit-stop freezing the sim but not frames, exactly
  one impact frame, a full play loop, all poses keeping 1 px outlines, ball
  sprite orientation and spin, the shadow shrinking with height, speed lines
  leaving the runner clear, and buttons, swipe-dive and tap-vs-hold.
- Field raster is still about 1 ms/frame. Effects add well under 0.2 ms.
- [`docs/m2/`](docs/m2) has 4 GIFs of real scripted plays and 11 stills.

### Not verified here
The iOS layer still hasn't been compiled (no Xcode or iOS SDK here). This
round touched `WorldRenderer`, `GameController`, `Upscale.metal`,
`PixelPipeline` and the new `HapticsPlayer`.

### Device test checklist (M2)
- [ ] Tap **SNAP**: the ball tosses back to the QB with a little arc, and a light haptic fires.
- [ ] Numbered icons (1, 2, 3) appear over the receivers. **Tap** one: a flat,
      fast bullet with a laser trail. **Hold, then release**: a high lob with a
      dotted trail. The icon grows while held.
- [ ] A yellow ring pulses where the pass will come down. The ball's shadow
      shrinks and fades as the ball rises, and you can judge height from it alone.
- [ ] On a deep pass the camera travels downfield with the ball, and the catch is large on screen.
- [ ] Catch: a brief freeze, a flash ring and a "CATCH!" callout. Control
      switches to the receiver, and the buttons become JUKE / SPIN / STIFF.
- [ ] Juke dodges sideways with turf kicking up. Spin twirls between front
      and back views. Stiff arm extends the arm. Swipe up on a button to dive.
- [ ] Tackles: a starburst, shake and haptic. Big hits freeze longer, invert
      the screen for one frame and show "BIG HIT!". Broken tackles leave the
      defender on the turf.
- [ ] Defenders take pursuit angles (cutting ahead of you, not trailing behind).
- [ ] In open field at top speed, white speed lines rush in from the edges and stop short of the runner.
- [ ] Fumbles (rare, on big hits) bounce unpredictably, and anyone can pick them up.
- [ ] After every whistle the next snap is set up within about 2 s.
- [ ] Throughout: FPS holds with all 14 players, the ball and effects on screen.

### Questions for you before M3
1. Is the arcade balance right? (Open bullets are caught about 85%; blind
   throws complete about 50%.) Do you want higher-scoring, or more
   simulation-like?
2. Should the landing reticle show for both throws, or only lobs, so bullets stay a "read"?
3. Should the anime impact frame be inverted (current), or a 2-tone black/white "manga panel"?

## ⏭ M3: Full 7v7 play: 6+6 plays, AI, downs and scoring
## M4: Art pass: 2 teams, portraits, callouts, Spirit Play cut-ins
## M5: HUD, menus, gear shop, audio
## M6: Polish, haptics, performance profiling
