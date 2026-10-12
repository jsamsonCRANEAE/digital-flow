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

## M4: Art pass and replayability
The brief for this round was "make it the best there is, with high
replayability". These are the levers I chose, and why.

### Why these systems
Replay value in arcade sports games comes from three places:
1. **Moments.** Plays you want to see again and talk about.
2. **Mastery.** Choices that matter and keep revealing depth.
3. **Pull.** A reason to start "one more game" tomorrow.

Each system below targets at least one of them.

| System | Lever | Notes |
|---|---|---|
| **Spirit Plays** (11, one per star) | Mastery + moments | Real gameplay effects, not cosmetics (below). Each team has an offensive and a defensive star; *when* to spend the meter is the strategic decision. Tuned so each team gets about 2–3 per game, so they stay special. |
| **Comeback charging** | Keeps games alive | The trailing team's meter fills 35% faster, and conceding a TD charges the scored-on team. Blowouts get a lifeline without fake rubber-banding of stats. |
| **Instant replays** | Moments | Triggered by TDs, picks, fumbles, big hits, 25+ yd gains and 45+ yd FGs. Played at half speed, letterboxed, with the original hit-stop and impact frame. Tap to skip. They're built from recorded render frames, so they cost no simulation and are always exact. |
| **Reaction portraits** | Moments | After highlights, the winner looks confident and the loser shocked, giving the 3 expressions a purpose. Matchups (QB or RB vs. the defensive star) slide in for 1 s at every snap. |
| **Daily Spirit Trials** | Pull | 3 goals a day (easy +50, medium +100, hard +200 coins), seeded by date so everyone shares the same set. The pool has 19, so a week rarely repeats. |
| **Report card** | Mastery | A grade from S to D (margin plus completeness, capped at B for a loss), an MVP, a box score, trial results and coins earned. It tells you *how* you won, not just that you did. |
| **College overtime** | Moments | Alternating possessions from the 25, untimed, two-point tries forced from OT2. No ties unless you want them. This answers M3 question 2. |
| **Team identity** | Mastery | The CPU calls plays by archetype. Disciplined teams lean on timing throws (short ×1.35), flashy teams take shots (deep ×1.6), powerhouse teams pound the ball (run ×1.6). Helmets and portraits follow archetype too: kabuto crest and headbands, neon bolts, twin stripes. |

### Spirit Play effects (data in `spirits.json`)
- **Speed:** a ×1.03–1.15 multiplier.
- **Tackling:** extra tackle resistance (carrier) or power (defense).
- **Passing:** *perfect pass* (no error, no wobble) and faster throws.
- **Catching:** catch or pick bonuses.
- **Blocking:** *block win* (pancake blocks, or rushers shed blocks).
- **Moves:** *unbreakable moves* (juke or spin always whiffs inside its window).
- **Piles and fumbles:** *push pile* (every tackle falls forward), and a fumble multiplier.
- **Reads:** *instant reads*, where the defense AI has zero reaction lag and perfect angles.

The star is chosen to fit the call: on a run play the RB's Spirit, on a pass
the QB's.

### Art decisions
- **Portraits are procedural (88×88 content, 96×111 framed).** Each one is
  seeded by a stable FNV hash of the player id, so a player always has the
  same face. The generator picks from 6 hair styles, 6 iris colors, 5 skin
  tones, headbands and eye black, and varies jaw width for linemen.
  Shading is cel style with hue-shifted shadows and a 1 px outline.
  - *Confident:* half-lidded eyes, a grin and a sparkle.
  - *Shocked:* pinprick pupils, an open mouth, a sweat drop and a purple burst.
- **Callouts** are block letters built from the 5×7 font at integer scales
  2–5, with vertical gradient bands (chrome, rainbow or fire), a hard drop
  shadow and a double outline. The pop-in (small → overshoot → settle) steps
  through integer scales only, so it never produces mixels.
- **The cut-in** is 1.5 s with the world frozen. A diagonal band in team
  colors carries original abstract brush-stroke "glyphs" (deliberately not
  real kanji, so nothing reads as unintended text). The portrait is shown at
  an integer 2× in its confident expression. The rest of the screen is dimmed
  with a 50% checker (pixel-art transparency), and the sequence ends on a
  white flash.
- **Sprites:**
  - 3×5 jersey numbers on near sprites (44 px and taller).
  - Lineman builds 18% wider.
  - Three helmet designs.
  - A dithered aura ring around a Spirit star.
- **"BIG HIT!" threshold.** Raised to impact 9 (a full-speed head-on hit is
  about 11), and only counted when the hit brings the runner down. At 7.5 a
  game had 15+ of them and the word stopped meaning anything.

### Answers to my own M3 questions (I decided, per your brief)
- **Returns:** still touchbacks and fair catches. Returns are the next
  biggest source of highlight plays, so they're the first thing I'd add (M5+).
- **Overtime:** yes, college style (see above).
- **Quarter length:** kept at about 13 plays per 3:00 quarter, so a full
  game runs about 10 minutes, which is right for a phone session.
- **Featured stars:**
  - Ronin: Takashiro (QB, *Iai Strike*), Mibu (RB, *Kage Step*), Aramaki (DL, *Iron Wall*), Kusaka (S, *Hawk Eye*).
  - Strays: Vantablue (QB, *Laser Line*), Razz (RB, *Neon Drift*), Venn (DL, *Riot Rush*), Shade (CB, *Ghost Pick*).
  - Colossi: Kane (RB, *Landslide*), Varga (OG, *Bulwark*), Ash (DL, *Quake*).

## M5: Menus, gear shop, Spirit Cup, audio

### Answers to my own M4 questions (decided, per your brief)
- **Shop economy: a top-tier item costs about 5–6 strong wins.**
  - Prices per tier: 120 / 300 / 650 / 1,300 / 2,600 coins.
  - A strong win pays about 400–550 coins: 150 for the win, up to 75 for
    TDs, up to 60 for takeaways, sacks and big hits, plus whichever daily
    trials you clear (50 / 100 / 200).
    - The test's 28-10 win clearing two trials pays 400.
    - Clearing the hard trial too pushes a win past 600.
  - So the first item is affordable after a single game, and a legendary
    piece takes about a week of casual play.
  - Unit-tested: `testTopTierCostsAboutFiveStrongWins` fails if a
    data change makes the top tier cheaper than 4 wins or dearer than 7.
- **Spirit Cup ships now**, as a 3-round ladder: quarterfinal, semifinal,
  then the **Shadow Final**.
  - The final is a mirror match against your own team, recolored in a
    dark-violet palette with magenta eyes and +4 to every rating. It's a
    classic anime rival beat, and it works with a 3-team league because the
    final opponent is always "you, but stronger".
  - Win the cup: +500 coins and a trophy on the shop shelf.
  - Lose any round: the run ends and you start again (ties count as losses).
  - The run is saved between launches and resumes at the bracket.
- **Kick and punt returns: deferred to M6.** Menus, shop and audio were already a full milestone.
- **Spirit Plays stay risk-free.** The comeback charging already gives
  trailing teams a lifeline. A risk mechanic would make the best-feeling
  moment feel like a gamble.

### Gear
- **Four categories, five tiers each**, so the shop grid is exactly the
  spec's 5x4 (rows are categories, columns are tiers I–V).
  - Categories: cleats, gloves, helmets, training.
  - The tabs pick the category, and the grid always shows everything, so
    players can see what's ahead of them.
  - Tier colors: steel, jade, azure, violet, then gold for legendary.
- **One item equipped per category; boosts stack across categories.**
  Buying an item equips it immediately. Tapping an owned item toggles it on and off.
- **Gear only boosts the positions it lists** (`appliesTo`); for example, cleats don't help linemen.
  - Ratings are capped at 99.
  - Tier IV–V items also add +5–12% Spirit meter charge.
  - The boost applies to a copy of your team when a match starts, so the
    data files never change.
- **Gear boosts are small:** +1–8 per stat. They make a difference without
  breaking the AI balance tuned in M3/M4. Strength comes from the stats, never
  from damage multipliers.
- **Original item names only** (Razor Spikes, Oni Faceguard, Titan Kabuto, Spirit Dojo…). No real brands.

### Shop art (spec reference 3)
- **The room:** vertical wood planks with procedural grain, a warm lamp falloff
  (Bayer-dithered), a trophy shelf, a pegboard, a pennant, a framed photo and
  a beveled counter.
- **The shelf** has one slot per club, filled by Spirit Cup wins. Empty slots
  show a dusty "?" cup, which is a visible goal. Filled trophies sparkle.
- **The pegboard** shows the gear you own, best first, so your collection is on display.
- **Shopkeeper "Old Man Goro"** is a retired lineman: #77, a gray buzz cut,
  a hachimaki headband and an apron.
  - He's built on the portrait renderer without its background, so he
    matches the game's anime style.
  - His expression follows what you do: confident when you buy, shocked
    (with a sweat drop) when you can't afford something, neutral otherwise.
- **The right panel** follows the spec: tabs, coin counter, preview (2x icon,
  tier, stat line, price or OWNED/EQUIPPED), a "BEST FOR:" box, the 5x4 grid,
  BUY/EQUIP/UNEQUIP, and a loadout strip.

### Menus and flow
- **Everything above the match lives in `GSUI.AppFlow`**, which is platform independent.
  - Each frame it returns either `.menu(PixelBuffer)` (a full CPU-composed
    640x296 screen) or `.game(frame, runtime, extraUI)`.
  - The iOS layer only forwards touches and presents the output. Menu
    frames reuse the field-texture upload path with the sprite layers hidden.
  - The preview tool drives the same `AppFlow`, so the screenshots in
    `docs/m5` are the real screens, not mockups.
- **Buttons are immediate-mode.** Each screen draws itself and registers hit
  rects in the same pass, so layout and hit-testing can never drift apart.
  - Small targets are padded to the 44 pt minimum. Exact hits win over padded ones.
  - A press is cancelled if you drag off the button.
- **The title screen is attract mode:** a real CPU-vs-CPU game (45 s quarters)
  with the HUD and callouts hidden under the logo. It restarts with new teams
  when the game ends.
- **The main menu** shows your team's star, your coins, your record, your trophies, and today's three trials with their rewards.
- **Post-game:**
  - Coins count up.
  - The cup result is shown.
  - A **"NEXT UNLOCK"** card shows the cheapest item you don't own and how
    many coins you still need, or "YOU CAN AFFORD" when you're there. This
    is the hook to play one more game.
- **Pause:** a "II" button next to the down-and-distance panel. The game also
  auto-pauses when the app resigns active (calls, app switch).
  - Pause → Settings → Back returns to the pause menu.
  - Live touches are released on pause so the joystick can't get stuck.
- **Persistence:** one Codable `Profile` JSON blob in UserDefaults
  (`gs.profile.v1`). It stores coins, record, owned and equipped gear, cup
  run, trophies and settings.
  - M4's loose keys are migrated into it once.
  - A corrupt save falls back to a fresh profile instead of crashing.

### Audio
- **Everything is synthesized live in Swift** (`GSAudio`). There are no audio files, so the IP is original by construction.
  - **Voices:** 2-operator FM (lead, brass, bells, bass), pulse and triangle
    (NES-style), and a 15-bit LFSR noise channel clocked by pitch (drums,
    crowd, hits).
  - ADSR envelopes, pitch slides (kick drum, hits) and delayed vibrato.
  - A tanh-style soft clip on the master.
- **The music** is written in a small tracker text format (`"D5 - - - A4 . x"`), with 16 steps per bar.
  - **"Spirit Rising"** (title): D major, 150 bpm, heroic brass lead.
  - **"Locker Room"** (menus): laid-back, 108 bpm.
  - **"Gridiron Drive"** (in-game): A minor, 140 bpm, kept sparse so the SFX cut through.
  - **"Touchdown!"**: a non-looping 2-bar fanfare stinger.
  - A test fails if any loop's tracks have different lengths, because the
    loop would drift. That test caught a real 2-step error in the title bass line.
- **SFX are driven by `SoundCue`s** that the match emits next to its haptics:
  snap, throw whoosh, catch pop, hits scaled by impact, whistle, kick, Spirit
  activation, footsteps for the ball carrier (cadence follows speed), and
  crowd swells.
  - The crowd is a filtered noise bed that rises on big plays and decays back.
- **The audio session is `.ambient`:** it respects the silent switch and mixes
  with the player's own music, which suits a casual game. It restarts after
  interruptions.
- **Verified objectively here:** every song and SFX is rendered offline and
  checked for audibility (RMS), headroom (peak at most 1, no NaNs),
  determinism and loop alignment. The WAVs are in `docs/m5/`.

### Scaling: "Sharp fill" setting
- **Pixel perfect (default):** the M1 pipeline unchanged. Integer scale, exact NxN blocks, a thin letterbox.
- **Sharp fill:** a fractional scale that fills the screen; for example
  3.98x instead of 3x on a 2556x1179 panel. The shader uses "sharp bilinear":
  each texel's interior samples its own center (solid color) and only the
  ~1 drawable-pixel seam is blended.
  - Plain nearest-neighbor at a fractional scale would give uneven 3- and
    4-pixel columns ("pixel wobble"). Sharp bilinear avoids that while
    still filling the screen.
  - It falls back to pixel perfect when the gain would be under 5%.
  - Touch mapping uses the same fractional scale and is unit-tested.

### Bugs found while building M5
- **Events emitted between simulation steps were lost.** `world.snap()`, and
  any action applied from input before a step, appended its event, and then
  the next `World.step` cleared the list. So the snap haptic (since M1) and
  the snap sound never fired. Now each step drops only the events the
  previous step produced.
- **Scheduled note-offs silenced short SFX.** The envelope treated a future
  note-off as already reached. The audibility tests caught it.
- **Stale incremental builds on Linux.** After adding a stored property to
  `World` (a struct stored inline in `GameRuntime`), SwiftPM didn't rebuild a
  dependent module. That produced a memory-layout mismatch and a segfault in
  `GameRuntime.deinit`. A clean build fixed it. Rule: do a clean build after
  changing a struct's stored properties.

## M5.1: Orchestral soundtrack and Bluetooth controllers (your answers to the M5 questions)
- **Music style: orchestral hype.**
  - The chiptune themes are replaced with a synthesized virtual orchestra. It's
    still 100% code-generated and original, with no samples and no audio files.
- **Cup difficulty: the level you pick,** for every round. That was already
  the behavior. The Shadow Final's +4 ratings are the only step up.
- **M6 scope: returns only,** with no other must-haves.

### How the orchestra is built (`GSAudio`)
- **PolyBLEP sawtooth with up to 4 detuned unison copies.** The saw has the
  strings-and-brass harmonic series. PolyBLEP removes the aliasing a naive saw
  produces, and detuned copies give the "section" chorus of many players.
- **A 2-pole low-pass whose cutoff opens with the amplitude envelope.** Real
  brass gets brighter the harder it's blown, so the filter reproduces the
  "blare" on each attack. Strings use a gentle version. Contrabass is filtered dark.
- **Exponential pitch envelopes** for timpani and taiko: the head starts sharp and settles, which is what makes a drum sound like a drum.
- **A Freeverb-style hall** (4 damped combs into 2 allpasses) on the music bus
  only. The orchestra gets concert-hall space, while hits and whistles stay
  dry and punchy.
- **Arrangements:**
  - **"Spirit Rising"** (title): D minor, 156 bpm, 16 bars.
    - Progression: i–VI–III–VII then iv–VI–VII–V (Dm Bb F C | Gm Bb C A).
      The raised-7th A major at the end gives the loop its lift.
    - A section: 16th-note staccato string ostinato, taiko and timpani, low horns.
    - B section: trumpet melody, brass section, choir, snare, cymbal crashes, and a snare roll into the loop.
  - **"Locker Room"** (menus): F major, 116 bpm. Pizzicato and harp
    arpeggios, a warm horn tune, string pads and glockenspiel sparkle. It's
    upbeat but easy to sit with while shopping.
  - **"Gridiron Drive"** (in-game): E minor, 148 bpm, 16 bars.
    - A section: driving ostinato, syncopated brass stabs, taiko.
    - B section: horn melody and high strings.
    - The lead stays in the horns' mid range, so tackles, whistles and the crowd cut through.
  - **"Touchdown!"**: a two-octave string rip into a trumpet call over a timpani roll, ending in a full-orchestra hit and a cymbal.
- **Mixed by measurement.** I rendered every track solo and balanced their
  RMS levels. The first pass had percussion at about 7x the string energy,
  which would have buried the ostinato.
  - The final sections sit between 0.02 and 0.07 RMS each.
  - Songs land around 0.15–0.20 RMS at full volume, about 0.13 at the default setting.
  - Rendering costs about 3% of one CPU core at 48 kHz.

### Bluetooth controllers
- **API: Apple's GameController framework.** It supports Xbox Wireless,
  PlayStation DualShock 4 and DualSense, Switch Pro, and MFi controllers.
  Players pair them in iOS Settings > Bluetooth.
  - Info.plist declares `GCSupportsControllerUserInteraction` and
    `GCSupportedGameControllers: [ExtendedGamepad]`. These are the keys
    Xcode's Game Controllers capability writes.
- **One input path.** The pad is polled once per frame into a
  platform-free `GamepadState`. `TouchRouter` turns its press edges into the
  same `InputCommand`s touches produce, so the gameplay code doesn't know
  which device you're using, and every touch rule (tap = bullet, hold = lob,
  0.18 s) applies unchanged.
- **Mapping:**
  - **Before the snap:** A = SNAP, Y = SPIRIT (R1 also works), B = switch player (defense), X = audible.
  - **Passing:** receiver icons become A / B / X / Y / R1, the console-football
    convention. Tap for a bullet, hold for a lob.
  - **Ball carrier:** X = JUKE, B = SPIN, Y = STIFF ARM, A = DIVE.
  - **Defense:** A = DIVE TACKLE, B = SWITCH, Y = JUMP.
  - **Play call:** X / A / B pick the left / middle / right card, matching the
    face buttons' own layout. LB/RB or a stick flick change the page.
  - **Kick:** A. **Replay:** A or B skips.
  - **Menu (≡):** pause.
- **Your controller's glyphs.**
  - Buttons are mapped by *position*, so muscle memory carries across brands.
  - Labels are drawn for the brand you're holding: Xbox letters in their
    colors, PlayStation ✕ ○ □ △ shapes, and Nintendo letters (the bottom
    button is labeled B on a Switch Pro).
  - While you're playing with a pad, the on-screen buttons, receiver icons
    and play-call cards show those glyphs. Touching the screen switches the
    hints straight back to touch mode, so you can mix freely.
- **Menus:**
  - The d-pad or stick moves a pulsing gold focus frame between the same hit
    regions touches use (spatial navigation, with key repeat).
  - A selects, B goes back, LB/RB switch shop tabs.
  - In Settings, left and right change the value directly.
  - Moving onto a shop item previews it.
  - An "A SELECT  B BACK" hint appears only while a pad is in use.
- **Not done:**
  - Controller rumble. The phone's haptics still fire.
  - Two-player play (one pad each). It would need a second human-controlled team, so it's an M6+ idea.
