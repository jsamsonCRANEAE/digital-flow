# Design decisions

This file records the choices made where the brief left room, and why.

## Architecture
- **The core package holds every gameplay and render rule.** Simulation, input,
  projection, rasterization and the procedural art all live in `GridironCore`,
  which doesn't import UIKit, SpriteKit or Metal. The iOS app only copies
  numbers onto nodes and textures. This meets "no game logic in SKScene" by
  construction, and it means the rules are unit-tested in CI on any OS.
- **XcodeGen instead of a committed `.xcodeproj`.** A hand-written pbxproj is
  fragile and conflicts on merge. `project.yml` is small and readable.
- **Units are yards.** World x runs 0 to 53.33 (sideline to sideline) and y runs
  0 to 120 (back line to back line, end zones included). z is height. The
  offense in M1 drives toward +y.
- **Doubles in the simulation.** These are deterministic on one platform
  (there's a replay test). Bit-identical results across CPU architectures would
  need replacing `sin`/`cos` with table-based versions. That only matters for
  networked play, which is out of scope.

## Rendering: pixel-perfect pipeline
- **Real offscreen canvas, not SKView scaling.** `SKRenderer` draws the scene
  into a 640x296 `MTLTexture`. A tiny Metal pass then draws that texture to the
  drawable at an exact integer scale, using integer `texture.read()`, so no
  sampler is involved at all. With SKView's `.aspectFit`, scaled sprites would
  be rasterized at screen resolution, which produces "mixels" (pixels of mixed
  sizes) and sub-pixel edges.
- **The panel's native scale.** `contentScaleFactor = nativeScale`. On iPhone
  12/13 mini the UIKit scale (3) differs from the panel's (2.88), and iOS would
  resample the whole frame, which blurs it.
- **The field is a CPU "Mode 7" scanline rasterizer.** It does one ground-ray
  intersection per row, so it costs about 1 ms per frame in a Release build
  (measured on the x86 build machine; A14 should be similar). Every row is
  computed analytically, so yard lines converge exactly to the vanishing point.
  Lines are widened to at least one pixel's ground footprint, so they never
  flicker while the camera moves (there's a unit test for this). Thin far
  detail fades into an ordered-dither haze instead of shimmering.
- **Placeholder sprites are drawn natively at every height bucket** (even
  sizes 12 to 80 px) instead of being scaled. Outlines stay exactly 1 px at
  every depth. Real art (M4) should be authored as 3 or 4 size tiers for the
  same reason.
- **Snapping.** All sprite positions are interpolated in world space, projected,
  then `snapToPixel`ed. Nodes use anchor (0, 0) at integer coordinates, so an
  odd-width texture can't land on a half pixel.
- **Sprite scale is exaggerated 1.25x** over true perspective. With the camera
  at 6 yd high and 16 yd back, a player at the camera focus is 48 px tall, in
  the middle of the brief's 40 to 56 px range. About 46 yd of field width is
  visible at the line of scrimmage.
- **Camera.** It has a fixed pitch (horizon on row 96) and no yaw. Zoom moves
  the camera along its own view ray, so the horizon and the backdrop never
  move. Screen shake offsets the principal point by whole pixels, which shifts
  field, backdrop and sprites together.

### Open trade-off: integer scale vs. screen fill
640x296 is only 14 rows short of 4x on most iPhones (1170 to 1179 px tall),
so they get 3x (1920x888). That leaves a letterbox of about 12% on each side,
roughly 24% of each axis in total. Pro Max models get 4x. Options:
1. **Keep it (current).** The letterbox is filled with the stadium-night color, and the HUD (M5) can use it.
2. **Add a "sharp fit" mode.** Scale by 3.95x, rendering 4x nearest and then
   area-filtering at the pixel seams only. This fills the screen; edges are
   soft by at most 1 device pixel.
3. **Pick a canvas per device class**, for example 632x292 so 4x fits 2532x1170.
   This changes the internal resolution, which the brief fixes at 640x296.

Option 1 is what the brief asks for. Option 2 is the usual choice in shipping
pixel-art games, so I recommend adding it as a user setting in M6.

## Simulation
- **The fixed step is 120 Hz.** It uses an accumulator, a catch-up limit of 12
  steps, and an epsilon so 60 Hz frames always run exactly 2 steps.
- **Movement model.** Throttle sets the target speed. Turning is
  rate-limited, and the limit interpolates from `turnRateSlow` to
  `turnRateFast` as speed rises. Heavy players keep only 16% of their turn rate
  at top speed, against 42% for light ones. Reversals sharper than about 115°
  plant first (straight-line braking), then pivot. Cuts the player can't make
  at the current speed bleed speed by cos²(error). Each of these is
  unit-tested.
- Ratings (1 to 99) map to physics in exactly one place,
  `MovementProfile.from`. Top speed runs from 7.1 to 10.2 yd/s, about 14.5 to
  21 mph.

## Input
- **Floating joystick.** It appears where the thumb lands in the left half of
  the safe area, has a 14% radial dead zone that is rescaled, and its base
  follows the thumb when dragged past the radius. Raw `touchesBegan`/`Moved`
  are used with no gesture recognizers. Touches are applied immediately and
  sampled by the next sim tick inside the same display callback, so they are
  never more than one 8.3 ms tick old when the frame is built.
- System edge gestures are deferred, and the home indicator auto-hides.
- The right half holds the 3 context buttons (M2). The M1 debug shake tap is gone.

## Content (original IP)
- Teams: **Kurogane Ronin** (disciplined, samurai-style), **Neon Alley Strays**
  (flashy street) and **Basalt Ridge Colossi** (giant-lineman powerhouse).
  Sponsors are invented (ZUNKO COLA, RAMEN ROCKET, …). A unit test rejects any
  team name containing a current NFL, CFL, XFL, USFL or UFL nickname, or a
  league name. **This is a guard rail, not a legal clearance.** Run a real
  trademark search before release.
- The brief mentions "attached reference images", but none reached this
  session. The art direction was implemented from the written description. It
  should be re-checked against the references in M4.

## Frame rate
`FrameRateGovernor` starts at 120 Hz on ProMotion displays
(`CADisableMinimumFrameDurationOnPhone` is set). If the 90th-percentile CPU
frame work over 120 frames goes above 6 ms, it drops to 60 Hz for the rest of
the session. It never goes back up, so the rate doesn't oscillate.

## M2: Ball physics
- **The ball is a custom deterministic projectile.** It uses semi-implicit
  Euler at 120 Hz and doesn't touch SpriteKit physics. Gravity is
  10.72 yd/s². Drag is quadratic against the air (wind is subtracted), with
  k = ρ·Cd·A/2m ≈ 0.0025 per yard for a tight spiral. That assumes Cd of about
  0.1, A = 0.0186 m² and m = 0.41 kg. These are **tunable approximations**,
  not measured constants.
- **Wobble.** A wobbly "duck" gets up to 4x the drag, plus an oscillating
  sideways force. Wobble comes from pressure (a defender within 3.5 yd) and
  from lower accuracy.
- **The throw solver uses shooting.** It leads the receiver by iterating
  flight time against the lead point, takes the vacuum solution, then
  simulates with drag and wind and corrects the aim by the miss (up to 12
  iterations). A test confirms it hits a moving receiver within 0.35 yd
  through wind. Bullets are minimum-time at arm speed (21.5 to 28.5 yd/s from
  `throwPower`). Lobs take longer and arc higher. Passer error is Gaussian yaw
  and speed noise, scaled by accuracy and pressure.
- **Prolate-spheroid ground behavior.** On every contact, the angle of the
  ball's long axis decides the outcome. A point-first landing pops high
  (restitution up to 0.62) and kicks off at a random angle of up to ±70°. A
  belly landing skids low and keeps its line. The tumble rate is re-rolled at
  each hop. A rolling ball rocks end over end, curves, and sometimes catches a
  point and hops. A test asserts that identical impacts with different
  orientations scatter widely; a round ball would not.
- **Kicks.** Kick physics (power + elevation + yaw, tumbling drag, wind) is
  done and tested. The power/angle meter UI ships with special teams in M3.

## M2: Catching
- **The attempt resolves at closest approach**, not the moment the ball
  enters the catch radius. This was a real bug found by instrumenting: every
  ball was rated "edge of reach".
- Probability combines the catching rating, how centered the ball is, ball
  speed (open bullets are still caught 85%+), awkward height, diving, and
  contest (the nearest opponent's distance to the ball). Defenders mostly
  break passes up rather than pick them off. A tipped ball stays live and
  catchable. A drop is incomplete.
- **Measured outcomes.** In 60 seeded sandbox plays with blind throws (random
  target and random timing, often into coverage), passes split 50% complete,
  38% incomplete and 12% intercepted. A human throwing to open men will
  complete far more. QB-AI tuning is M3.

## M2: Tackling
- **Contact model.** Contact is resolved by the tackle model instead of being
  pushed apart. Impact is the two-body reduced mass × closing speed / 100, so
  a 300 lb lineman hitting a 185 lb receiver rates far above two receivers
  bumping at the same speed.
- **Angle and moves matter.** From behind, the tackler wraps up (bonus).
  Stiff arm beats frontal and side contact. Spin beats side and rear contact.
  A juke's first 0.22 s can make the tackler whiff entirely. Every move has a
  commitment window.
- **Five outcomes.** Clean, pushed forward (the carrier's momentum carries the
  pile), stumble, broken, and whiff. A second defender arriving on a stumbling
  or driven carrier finishes a gang tackle. Fumbles are possible only on big
  hits (impact 6 and up) and stay live, so anyone can recover them.
- **AI pursuit** solves the true intercept point (a quadratic in time) and
  blends toward the carrier's current position by difficulty. Difficulty
  changes only perception (reaction lag as a low-pass on observed velocity),
  pursuit quality and coverage cushion. It never inflates stats.

## M2: Game feel and the anime layer
- **Hit-stop** is specified in 60 Hz frames: 3 for a catch, 4 for a tackle,
  5 for a contested catch, 6 for a big hit. During it the world freezes but
  screen shake keeps running.
- **Impact frame.** One display frame is inverted with a hard contrast boost,
  in the Metal upscale pass, so it costs nothing.
- **Squash and stretch** is drawn natively as separate texture sizes, never
  node scaling, so the 1 px outline holds.
- **Down and dive poses** are made by rotating the upright sprite a quarter
  turn (lossless in pixel art), then foreshortening it vertically.
- **Ground-layer effects are drawn into the CPU field buffer**, under the
  sprites. That covers turf and dirt particles, the ball shadow, the trail,
  the landing reticle and speed lines. They cost almost nothing and stay
  pixel-exact.
- **Ball height readability.** The ball's shadow is always on the ground. It
  shrinks and its dither thins as the ball rises, but it never disappears
  (there's a test). Passes also get a pulsing landing reticle.
- **Speed lines.** These are tapered manga wedges from the screen edge
  toward the runner, with a clear window around them. They appear when the
  controlled carrier is at 92%+ of top speed with no defender within 5 yd.
- **Pass camera.** It frames the thrower and the landing spot, and the near
  edge of the frame travels with the ball, so a deep catch arrives large.
- **Controls.** Context buttons fire on touch-down, not release, for latency.
  A swipe up on any carrier button means dive. Receiver icons have a full
  44 pt hit target, and overlapping targets go to the nearest. Releasing an
  icon in under 0.18 s throws a bullet; a longer hold throws a lob. The throw
  pose shows instantly, and the ball leaves the hand after a 0.1 s wind-up.
- Callouts are plain pixel text for now. The chrome-gradient,
  overshoot-scaled versions are M4 art.

## M3: Game rules and match flow
- **Canonical frame.** The simulation always runs with the offense driving
  toward +y. The rules state stores `ballOn` as yards from the possessing
  team's own goal. On a change of possession the spot mirrors (`100 − spot`)
  and the lateral position flips. The camera is therefore always behind the
  offense, including when you're on defense. (This was M1 question 3: decided
  as "behind whoever has the ball".) End zones are recolored per possession.
- **The clock** is my reading of a slightly ambiguous spec:
  - Incompletions always stop it, as in the NFL.
  - Out-of-bounds plays and scores stop it only in the last minute of each half.
  - Turnovers don't stop it, because the spec doesn't say they do.
  - It runs during live play.
  - When it's running, each play charges a 6 s "huddle" runoff instead of the
    real time you spend on menus, so a 3-minute quarter has about 13 plays.
  - The 20 s play clock auto-calls a play and auto-snaps instead of throwing
    delay of game, which isn't in the penalty list.
  - Tries are untimed. A pending try is played even at 0:00.
- **Simplifications, to revisit later:**
  - **Kickoffs:** an automatic touchback at the 25. The team that scored on a
    safety receives.
  - **No returns:** interceptions, fumble recoveries and punts are dead where
    possession changes. Ball-in-end-zone cases become touchbacks.
  - **No overtime:** ties stand.
  - **Missed field goals:** the defense takes over at the spot of the kick,
    or at the 20 if that's farther out.
- **Penalties**: the slice has only false start and pass interference.
  - *False start:* the human moves their player before the snap; −5 yd, or
    half the distance near the goal.
  - *Defensive PI:* a defender bumps the intended receiver hard (closing
    speed over 2.5 yd/s) while a catchable ball is still more than 0.4 s
    away, and isn't playing the ball himself. Each defender is judged once
    per pass, and 10% of qualifying contacts draw a flag. The result is a
    spot foul and an automatic first down. Offense keeps the play instead if
    it's better.
- **Kicks**:
  - The meter is power then aim (triangle sweeps), with a tap to lock each.
  - FG/PAT elevation is 36° and punts 50°. The ball is the same tumbling
    projectile with drag and wind.
  - A field goal is decided at the plane of the end line: inside 18 ft 6 in
    and above the 10 ft crossbar.
  - Wind is 0–14 mph, set per game, shown on the HUD and mirrored with
    possession.
- **CPU quarterback**:
  - Drops back about 7.5 yd, then works through the play's progression.
  - Each read lasts a difficulty-based time, and that clock runs faster under
    pressure.
  - Throws when the projected separation at the catch point beats a
    difficulty threshold. Lobs go deep when he's tightly covered.
  - Late in the down he takes the best option, or throws it away depending on
    "pocket awareness".
- **Run game:**
  - Blockers take unique targets each tick.
  - A blocked defender can only arm-tackle (−0.4 power).
  - The carrier slips through his own teammates.
  - Second-level defenders take a difficulty-based beat to read run after the
    exchange (rookie 0.65 s, pro 0.45 s, legend 0.3 s).
- **Play calling**: 3 cards per page (run / short / deep, or zone / man /
  pressure), with swipe to page and tap to call. On 4th down the human gets
  a PUNT / FIELD GOAL page first. The CPU coordinator calls situationally
  and uses a standard two-point chart late in games.

### Balancing: found and fixed with the headless full-game simulation
The CPU-vs-CPU game test exposed real problems; each was root-caused, not just tuned around:
1. **PI on almost every pass.** Coverage contact was treated as blocking, and
   the flag chance was re-rolled every tick of contact. Fixed by one judgement
   per defender and a "playing the ball" exemption.
2. **Fumbles on about 30% of dives.** The impact scale made full-speed hits
   enormous and the fumble chance had no cap. Fixed by normalising (a 16 yd/s
   head-on hit ≈ 11) and capping fumbles at 7%.
3. **Runs at about 0 yd/play.** The back was shoved backwards by his own
   linemen, all three blockers took the same defender, and every linebacker
   read the run instantly. Fixed as described under Run game.

Two seeded CPU-vs-CPU games now average 3.6–4.8 yd per run, 4.9–6.4 per short
pass and 6.8–7.3 per deep pass, with 2–3 turnovers, 2–4 PI flags and scores
like 24-24 and 20-24. Sacks are rare when the CPU is at QB, because it reads
fast; humans holding the ball do get sacked. Pass-rush tuning is an M6 item.
