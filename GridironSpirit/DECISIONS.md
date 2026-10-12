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
- In M1, a tap on the right half triggers a test screen shake, standing in for the buttons that come in M2.

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
