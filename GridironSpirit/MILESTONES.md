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

## ✅ M3: Full 7v7 play: 6+6 plays, AI, downs and scoring

### Summary
- **Playbook** (`plays.json`, validated on load). Offense: HB DIVE, TOSS SWEEP
  (run); SLANTS, CURL FLAT (short); VERTICALS, POST CORNER (deep). Defense:
  COVER 2, COVER 3 (zone); MAN PRESS, PREVENT (man); LB BLITZ, ZERO BLITZ
  (pressure). Kicking formations are built in code.
- **Play calling:** 3 cards per page with chalkboard diagrams generated from
  the play data. Swipe to page, tap to call. Separate offense, defense,
  4th-down and conversion menus. Play clock.
- **Rules** (`GSRules`): downs and distance, first downs, turnover on downs,
  TD, PAT, 2-pt, FG, safety, punts, touchbacks, interceptions and fumbles,
  false start, defensive PI (accept/decline), clock stops, quarters,
  halftime possession, and the final whistle.
- **Kicks:** power/aim meter, field goals judged at the upright plane, punts
  that bounce and roll prolately, and wind on the HUD. CPU kickers err by
  difficulty.
- **AI:** a CPU QB with progression reads, pressure-shortened timers and
  throw-aways. Also handoffs and pitches, run blocking with unique
  assignments, daylight running, zone, man and spy coverage, a difficulty
  read delay on runs, dive tackles, and a situational play caller.
- **Human on defense:** SWTCH (switch to the defender nearest the ball),
  DIVE (dive tackle) and JUMP (deflect high balls).
- **HUD (basic, polished in M5):** scorebug with possession arrow, quarter
  and clock; down & distance, field position and play clock; field strip
  with the line to gain; wind; and the active player's SPD/POW/CATCH.
  Everything sits inside the safe area.
- 3D goal posts at both end lines.

### Verified here
- `swift test`: **90/90 pass**. That includes 12 rules tests covering every
  scoring path, penalties, the clock and quarter transitions, and 9 match
  tests. Among them: **two complete CPU-vs-CPU games played to FINAL with no
  hang or crash** (about 110 plays each), the human offense flow (cards,
  paging, snap, 4th-down page), human defense switching, the run handoff
  passing control to the RB, false start, CPU QB release timing, and FG
  geometry with wind.
- A full game simulates in about 9 s in a debug build on this machine.
- [`docs/m3/`](docs/m3) has the play-call screens (offense, defense, 4th
  down), the kick meter, HUD and game stills, 3 GIFs, and a full
  play-by-play of a CPU-vs-CPU game.

### Not verified here
The iOS layer still hasn't been compiled (no Xcode or iOS SDK). This round
touched `WorldRenderer` (UILayout pooling), `GameController` (end-zone
colors, safe-area accent) and `DebugOverlay` (moved to bottom-left).

### Device test checklist (M3)
- [ ] The game opens on the offense play-call screen with 3 cards (HB DIVE /
      SLANTS / VERTICALS). Swipe to see page 2, then tap a card to call it.
- [ ] The play clock counts down from :20. Let it expire once: a play is called and snapped automatically.
- [ ] On a run play the QB hands off by himself and control jumps to the RB.
      On a TOSS SWEEP he pitches it.
- [ ] Before the snap, push the stick hard: "FALSE START", back 5 yards, same down.
- [ ] Gain 10 yards: "FIRST DOWN!", and the yellow line on the field strip moves.
- [ ] On 4th down the first page is PUNT / FIELD GOAL. Kick a field goal:
      tap to lock power, then aim. Watch the ball through (or past) the
      uprights, and check that wind visibly bends long kicks.
- [ ] Score a TD and pick KICK PAT or GO FOR 2. Then the other team gets the ball at its 25.
- [ ] On defense: the cards show COVER 2 / MAN PRESS / LB BLITZ. You control
      a linebacker; SWTCH jumps to the defender nearest the ball, DIVE
      lunges, JUMP leaps to tip a pass.
- [ ] The camera is always behind the offense, so it flips when possession changes, and the end zone colors follow.
- [ ] The clock stops after incompletions. In the last minute of a half it also stops after out-of-bounds plays and scores.
- [ ] The game ends after Q4 with "FINAL". Halftime gives the ball to the other team.
- [ ] The HUD never sits under the notch or Dynamic Island, and the FPS overlay (bottom-left) holds.

### Questions for you before M4
1. Do you want kickoff and punt **returns** (simulated now as touchbacks / fair catches), or keep them out for pace?
2. Should ties go to **overtime** (and which format), or stay ties in arcade mode?
3. Is a quarter of about 13 plays the right length? It's 3:00 game time with a 6 s runoff between plays.
4. M4 brings the art pass. Who are the two featured teams' star players (QB +
   defensive star) whose portraits and Spirit Plays should come first?

## ✅ M4: Art pass, portraits, callouts, Spirit Plays (+ replayability systems)

### Summary
- **Portraits:** procedural anime busts for every player with 3 expressions,
  beveled frames and caps name plates. Matchups slide in for 1 s at every
  snap; reactions (confident vs. shocked) follow highlights.
- **Spirit Plays:**
  - 11 unique plays in `spirits.json`, each with real effects.
  - A meter charged by good plays, faster when trailing.
  - SPRT button: before the snap on offense; in the defensive pre-snap context on defense.
  - A 1.5 s cut-in: dim, diagonal band with brush glyphs, 2× portrait, chrome
    name, flash. Then a one-snap boost and a glowing aura on the star.
  - The CPU fires its meter on 3rd down, in the red zone, late in close games and in OT.
- **Callouts:** chrome, rainbow or fire block letters with an integer-step
  overshoot pop for TOUCHDOWN!, FIRST DOWN!, INTERCEPTION!, SACK!, BIG HIT!,
  FIELD GOAL! and more.
- **Sprites:** jersey numbers, three helmet designs by archetype, lineman builds, Spirit aura.
- **Replays:** instant replays of highlights at half speed, letterboxed with
  a blinking REPLAY tag. Tap to skip.
- **Overtime:** college style, alternating from the 25, untimed, 2-pt tries forced from OT2.
- **Progression:**
  - Per-team and per-player stats.
  - Daily Spirit Trials (3 per day from a pool of 19, date-seeded) shown on the first play call.
  - A report card at FINAL: grade S–D, MVP, box score, trials and coins.
  - Coins persist (UserDefaults) for the M5 gear shop.
- **Team identity:** archetype-weighted CPU play calling.

### Verified here
- `swift test`: **104/104 pass**. The 14 new tests cover:
  - Overtime: walk-off rules and OT2 forcing two-point tries.
  - Spirit: data integrity (every team has an offensive and a defensive
    Spirit), activation, the cut-in world freeze, effects, aura, picking the
    RB's Spirit on runs, CPU usage, comeback charging, and effects changing
    tackle and catch resolution.
  - Progression: daily trials that are deterministic and rotate, report
    grades and coins (losses capped at B).
  - Art: portrait determinism and expressions, and the integer callout pop.
  - Flow: a forced TD → slow-motion replay → skip.
  - A full CPU game that uses Spirit Plays and produces a report.
- In 3 CPU games: 4–5 Spirit Plays per game, final scores of 20-28 to 36-39,
  and no hangs. That's arcade-high scoring, by design.
- [`docs/m4/`](docs/m4) has the stills (cut-in, matchup, reaction,
  touchdown, replay, report), a portrait sheet, a GIF of a Spirit Play
  drive, and a play-by-play.

### Not verified here
The iOS layer still hasn't been compiled. This round touched `WorldRenderer`
(sprite keys with number/build/aura), `GameController` (progress store) and
the new `UserDefaultsProgressStore`. Every new screen element goes through
the existing generic `UILayout` path, so the app needed no new node types.

### Device test checklist (M4)
- [ ] The first play call shows TODAY'S SPIRIT TRIALS (3 lines with coin rewards).
- [ ] At every snap, two framed portraits slide in from the sides for about 1 s: your QB (or RB on runs) vs. their defensive star.
- [ ] Make a big play: the portraits come back, yours grinning with a sparkle and theirs shocked with a sweat drop.
- [ ] The SPIRIT bars under the scorebug fill as you play and flash when
      full. Before a snap, SPRT lights up: tap it for the cut-in (1.5 s,
      everything frozen). Your star glows during the play.
- [ ] Spirit effects are noticeable:
      - *Iai Strike / Laser Line:* the pass is on a rope.
      - *Kage Step / Neon Drift:* jukes and spins can't be tackled.
      - *Iron Wall / Riot Rush:* rushers blow through blocks.
      - *Hawk Eye / Ghost Pick:* defenders jump routes.
- [ ] Fall behind by two scores: your meter visibly charges faster.
- [ ] A TD, pick or big hit replays in slow motion with black bars and a blinking REPLAY tag. A tap skips it.
- [ ] TOUCHDOWN! pops in rainbow block letters (small → big → settle); SACK! and BIG HIT! in fire; FIRST DOWN! in chrome.
- [ ] Near players show jersey numbers. Ronin helmets have a gold crest from
      the front, Strays a neon bolt, Colossi twin stripes. Linemen look wider.
- [ ] Tie after Q4: OVERTIME. The clock reads OT1 and each team gets a shot from the 25.
- [ ] At FINAL, the report card shows the grade, MVP, stats, trial checkboxes and coins. Coins persist across launches.

### Questions for you before M5
1. **Shop economy:** the base is 60–150 coins per game, plus trials (up to
   +350) and highlights. A good win pays about 400–600. Should a top-tier
   item take about 5 good games, or more?
2. **Returns** (kickoff and punt) are the next big highlight generator. Should they go into M5, or wait for polish in M6?
3. **Season or cup mode:** a short "Spirit Cup" ladder (beat the other two
   teams, then a final) would add a long-term goal on top of the daily
   trials. Do you want it in M5 with the menus?

## ✅ M5: Menus, gear shop, Spirit Cup, audio

### What's new
- **The full app loop:**
  - Title screen over a live attract-mode game.
  - Main menu with your coins, record, trophies, your star and today's trials.
  - Team select with portraits and OFF/DEF/SPD bars, plus opponent and difficulty pickers.
  - Settings: music and SFX volume, haptics, difficulty, quarter length 2/3/5 min, screen mode.
  - Pause (with auto-pause when the app resigns active).
  - Post-game with coin count-up, cup result and a "NEXT UNLOCK" card.
- **Gear shop** (spec reference 3):
  - The room: wood interior, shopkeeper Goro with reactive expressions, a
    trophy shelf filled by cup wins, and a pegboard of your gear.
  - The right panel: 4 tabs, coins, a 2x preview, tier and stat line, a
    "BEST FOR:" box, a 5x4 grid and a loadout strip.
  - 20 original items with prices from 120 to 2,600. Equipped gear raises
    your players' ratings in matches, and legendary pieces also speed up the
    Spirit meter.
- **Spirit Cup:** quarterfinal → semifinal → **Shadow Final** against a
  dark-palette, +4-rated mirror of your own team. Your progress is saved
  between rounds. A cup win pays +500 and a trophy.
- **Original audio, synthesized live:**
  - 4 songs: title, menu, in-game, touchdown fanfare.
  - 13 SFX, a crowd bed that swells, and footsteps for the ball carrier.
  - On iOS it streams through `AVAudioEngine` with an `.ambient` session.
- **"Sharp fill" scaling option:** a fractional scale that fills the screen,
  using a sharp-bilinear shader. Pixel perfect stays the default.
- **Fixed a lost-event bug:** the snap event (and its haptic, since M1) was dropped.

### Verified here
- **`swift test`: 124/124 pass.** The 20 new tests cover:
  - **Audio:** every song is audible with no clipping or NaNs, loops align to
    whole bars, every SFX is audible and mutable, rendering is deterministic,
    stingers end, and the WAV header is correct.
  - **Gear:** the 5x4 catalog, prices, boosts applied only to the listed
    positions, the 99 cap and the Spirit bonus.
  - **Economy:** the top tier costs 4–7 strong wins, and the first item is affordable after one game.
  - **Profile:** buy / equip / unequip / can't afford, save round-trips, and a corrupt save falls back cleanly.
  - **Spirit Cup:** the ladder, the shadow team (boosted ratings, no id
    collisions), and champion/eliminated outcomes.
  - **AppFlow:**
    - Every screen renders and navigates.
    - Real touch coordinates hit the right buttons, and dragging off a button cancels it.
    - A match applies gear to the in-game ratings, pause freezes the clock, and quit cleans up.
    - The cup flow resumes at the bracket.
  - **Sharp-fit layout:** it fills the screen and touches map back exactly.
  - **Sound cues:** a CPU game emits snap, whistle, tackle and footstep cues.
- **Renders:** [`docs/m5/`](docs/m5) has every screen, produced by driving
  the real `AppFlow` in `gs-preview --menus`, plus WAV renders of all 4 songs
  and an SFX reel from `--audio`.
  - Peak levels are 0.49–0.69, so there's headroom.

### Not verified here
- **The iOS layer still hasn't been compiled.** There's no Xcode in this
  environment. M5 touched:
  - `GameController`: now drives `AppFlow`.
  - New `AudioOutput`: `AVAudioSourceNode`.
  - `WorldRenderer`: per-match looks, hide-all for menus, flow overlays.
  - `PixelPipeline` and `Upscale.metal`: sharp-fit uniform and sampler.
  - `GameViewController`: resign-active hook.
  - I reviewed these by hand, for example fixing a `self` access before
    `super.init`, but the first Xcode build may still flag something small.
- **The music has only been checked by measurement** (levels, timing,
  determinism). I can't listen to it, so its musical quality needs your ears.
  The WAVs are in `docs/m5/`.

### Device test checklist (M5)
- [ ] Launch: the title logo sits over a live CPU game, "TAP TO START" blinks, and the "Spirit Rising" theme plays. A tap opens the main menu and the music changes.
- [ ] Main menu: your coins (top right), record and best grade (bottom left), your team's star, and today's 3 trials with coin rewards.
- [ ] Exhibition → team select: tap a card to pick your team. VS cycles the opponent and LEVEL cycles the difficulty. KICK OFF! starts the match with the in-game music.
- [ ] In-game sounds: the snap pop, footsteps that speed up on breakaways, the throw whoosh, the catch pop, hits that get bigger with impact, the whistle, and the crowd swelling on big plays. A TD plays the fanfare.
- [ ] Silent switch on: no audio. Your own music app keeps playing alongside the game.
- [ ] "II" pauses the match (the clock stops). Settings from pause returns to pause, and QUIT goes back to the menu. Switching apps mid-play auto-pauses.
- [ ] At the end of the game, CONTINUE appears after about 2 s. The post-game coins count up and the NEXT UNLOCK card shows the cheapest item you don't own.
- [ ] Gear shop:
  - Tabs switch rows, and tapping any grid cell previews that item.
  - Buy something: Goro grins, the item hangs on the pegboard and appears in LOADOUT.
  - Try a legendary item you can't afford: Goro looks shocked and says "NOT ENOUGH COIN!".
- [ ] Equip Swift Talons (SPD+2): when you control an RB, WR, CB or S, the SPD on the in-game player card (top right) is 2 higher than without it.
- [ ] Spirit Cup:
  - Pick a team. The bracket shows 3 rounds, with the final as your SHADOW (dark purple, magenta eyes).
  - Win round 1: the bracket advances.
  - Quit the app and relaunch: the cup resumes at the bracket.
  - Win the final: +500 coins, and a trophy appears on the shop shelf.
- [ ] Settings: volume bars change the sound immediately. Haptics OFF stops vibration. Changes persist across launches.
- [ ] SCREEN → SHARP FILL: the picture grows to fill the height with crisp
      pixels (no uneven columns, no blur), and touches still land where
      expected. PIXEL PERFECT restores the integer scale.
- [ ] Coins from an M4 install carry over (one-time migration).

### Questions for you before M6
1. **Music:** I've written original chiptune themes, but I can't hear them.
   After a listen (WAVs in `docs/m5/`), is the style right (FM/NES hybrid),
   or would you rather go more SNES-orchestral or more synthwave?
2. **Returns in M6:** kick and punt returns are the planned headline
   feature, with blocking lanes and a "Spirit Return" cut-in. Any other
   must-have for the final milestone (for example a 2-player pass-and-play,
   more teams, or a season mode)?
3. **The Shadow Final's +4:** should cup difficulty also step up each round (for example the final always at Legend), or stay at the level you choose?

## ✅ M5.1: Orchestral soundtrack and Bluetooth controllers

Your answers: orchestral hype music, nothing else must go into M6 besides returns, and the cup stays at the level you pick (already the behavior).

### What's new
- **A synthesized orchestra replaces the chiptunes:**
  - Detuned PolyBLEP-saw string, brass and choir sections, with filter envelopes for the brass blare.
  - Pizzicato, harp and glockenspiel; timpani and taiko with pitch envelopes; and a concert-hall reverb.
  - Four new arrangements: an epic D-minor title anthem, a warm menu theme, a
    driving in-game loop that leaves room for the SFX, and a string-rip
    touchdown fanfare.
- **Bluetooth controller support** for Xbox, PlayStation, Switch Pro and MFi controllers:
  - Full gameplay mapping, including receiver-per-button passing with tap/hold lobs.
  - Glyphs that match your controller's brand.
  - Every menu works with d-pad focus, and Menu pauses the game.
  - Touch and pad can be mixed freely.

### Verified here
- **`swift test`: 131/131 pass.** The 7 new controller tests cover:
  - The context button mapping and glyphs.
  - Bullet vs. lob throws by hold time.
  - Play-call, kick and replay mapping, plus the stick dead zone and brand glyphs.
  - A real passing down played entirely with the pad: snap, drop back, throw.
  - Every menu driven by the pad: focus, key repeat, shop preview and tabs, settings left/right, pause and resume.
  - Disconnecting falls back to touch.
- **Audio:**
  - The existing audio tests still pass against the new songs (audibility, no clipping, loops aligned to whole bars).
  - Each section was level-balanced solo.
  - Rendering costs 2.8% of one CPU core at 48 kHz.
  - The WAVs in [`docs/m5/`](docs/m5) are re-rendered.
- **Controller stills:** `menu_pad_playcall.png`, `menu_pad_passing.png`, `menu_pad_pause.png` and `menu_pad_menu.png`.

### Not verified here
- **`GamepadInput.swift`** (the GameController polling) hasn't been compiled, like the rest of the iOS layer.
- **The orchestra's musical quality.** I can measure it but not hear it. Please listen to the WAVs.

### Device test checklist (M5.1)
- [ ] Listen to the title, menu, in-game and touchdown music. Does it hit the "orchestral hype" target? Is anything too loud or too quiet, such as the drums or choir?
- [ ] Pair a controller in iOS Settings > Bluetooth, then launch. The title says "PRESS A" (or ✕ on PlayStation).
- [ ] Menus: the d-pad moves the gold frame. A selects and B goes back. In Settings, left/right changes volume. In the shop, LB/RB switch tabs and moving onto an item previews it.
- [ ] Play call: the cards show X / A / B badges, and LB/RB change the page.
- [ ] Before the snap, the on-screen buttons show glyph badges. A snaps the ball.
- [ ] Passing: receiver icons show A/B/X/Y. Tap for a bullet, hold for a lob.
- [ ] Running: X jukes, B spins, Y stiff-arms, A dives.
- [ ] Menu (≡) pauses the game, and B resumes it.
- [ ] Touch the screen mid-game: the badges disappear and touch works normally. Press a pad button and they come back.
- [ ] A PlayStation controller shows ✕ ○ □ △ shapes. A Switch Pro shows its own letter positions.

## ⏭ M6: Polish, kick/punt returns, haptics, performance profiling
