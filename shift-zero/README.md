# SHIFT ZERO: The Weight of Amperage

A 2-player **local asymmetric co-op action-RPG roguelite** in HTML5 Canvas + ES modules.
**Zero external assets** — every pixel, light, shader-like effect and sound is synthesized at
runtime (Canvas 2D + Web Audio API). No build step, no dependencies.

> Hour 11 of a weekend graveyard shift in Substation Zero. An unlogged corporate load transfer
> arc-flashes Cole — and he doesn't die. His body is still standing in the flood water; part of
> his mind is running through the copper. Get the body home. Keep the mind whole. You won't
> always manage both.

## Run it

**Easiest:** open `dist/ShiftZero.html` — a single self-contained file. Double-click it; no install,
no server. (Rebuild it with `node tools/build-single.mjs` after changing the source.)

From source:

ES modules don't load from `file://`, so serve the folder:

```bash
cd shift-zero
npm start            # zero-dependency Node server → http://localhost:8080
# or: python3 -m http.server 8080
```

Append `?seed=1234` to the URL for a reproducible run.

## Controls (one keyboard, two players)

| P1 · THE BODY | | P2 · THE VOXEL | |
|---|---|---|---|
| `W A S D` | move (inertia) | `↑ ← ↓ →` | ride the conduits |
| `SPACE` | interact · LOTO · hit the skill check | `ENTER` tap | hack device / shunt pulse |
| `Q` / `E` | cycle / use tool (Hot Stick, Multimeter) | `ENTER` hold | living jumper (on a fuse) · Ghost Lockout (synergy) |
| `L-SHIFT` | heavy dodge (i-frames) | `R-SHIFT` | materialize insulated pad / holographic decoy |
| | | `/` | **OVERCLOCK** — burn a memory |

**Solo:** `TAB` Solo-Swap hands P1's keys to the Voxel (`SPACE` hack, `L-SHIFT` materialize,
`F` overclock). Hold a jumper and tap `TAB` to **latch** it — the Voxel holds the line alone at
1.5× drain while you walk the Body through. `ESC` pause · `M` mute.

## The loop

1. **Work Order** — choose *Clean Maintenance* (Anchor restoration + defensive gear) or
   *Hot-Work Emergency* (grid stays live, Arc Hound packs, tighter timer, 2× pay, an
   Experimental Prototype). Each card carries a random **Shift Mutator**.
2. **The floor** — reach the freight elevator before the load spike (Cole's father's Timex is
   the timer). The bulkhead to it is dead behind a blown 200 A fuse: the Voxel must physically
   **become the jumper** while the Body walks through. Live water and arc beams gate the route;
   each is fed by a breaker placed *before* it.
3. **Breakroom** — P1 buys physical tools at the workbench, P2 installs firmware daemons at the
   outlet; pairs unlock **Duo-Circuit Synergies**.
4. Four depths, then **THE MAIN TIE TRANSFORMER**, then one of four endings.

### Lock it. Tag it. Try it.
Throwing a 480 V disconnect is a timing-bar **micro skill check** (perfect = 50 ms hit-stop,
directional shake, spark shower that reflects in puddles, bonus copper; miss = arc flash).
An unlocked breaker is **auto-reclosed by SCADA** after a few seconds. A brass padlock keeps
it dead — and corporate docks 14% of your efficiency bonus for every one. Scan a locked breaker
with the Multimeter to *verify zero energy* (the "try" step). You start with two padlocks;
deeper floors have more gates than that, so you choose: buy locks, throw-and-run, have the
Voxel lay insulated pads, or eat the shock.

Locking out loads unbalances the three phases (watch the oscilloscope). Imbalance breeds
**Harmonic Phantoms**, which are only solid while *measured* by the Multimeter and steal
Anchor on touch. Balancing lockouts across phases A/B/C calms them.

### ANCHOR — why his face is pixelated
Anchor is Cole's humanity, tracked against five memories (his father's Timex, the porch light
at 41 Alder, Mara's laugh, Tess learning to ride, *their names*). OVERCLOCK burns 20 Anchor to
surge the grid: clears nearby anomalies, force-opens every breaker for 10 s, revives a downed
Body. As Anchor falls the HUD portrait pixelates from the left, names decay to hex
(`Tess → T█s → 0x54 0x65 ?? → [NULL]`), the music sours and bit-crushes, the pager starts
calling him *ASSET #4471*, and the screen tears.

### Duo-Circuit Synergies
| Body tool | + Voxel daemon | = Synergy |
|---|---|---|
| Calibrated Multimeter | magnetic_coil.d | **Inductive Arc-Lasso** — lightning tether between players vaporises what crosses it |
| Grounded Carhartt Jacket | voxel_buffer.d | **Phase-Shift Carhartts** — dodge as pixels through fences and live arcs |
| Discharge Hook | coherence_recycler.d | **Regenerative Bleed-Down** — capacitor discharge heals Body + Signal |
| Group Lock Hasp | remote_loto.d | **Ghost Lockout** — hold HACK to project an 8 s digital LOTO onto the nearest breaker anywhere |

### Endings
* **The Union Ending** — finish with Anchor ≥ 60 and at least as many LOTO locks as corners cut.
* **The Company Man Ending** — Anchor 0, or BURN EVERYTHING to skip the final disconnect.
* **The Overtime Ending** — everything in between.
* **The Ghost in the Machine** — secret: solve the hidden schematic cipher on all four floors
  (the Voxel decrypts a hex key only it can read; the Body sets a 4-relay bank in binary) —
  with any Anchor left.

## Architecture

```text
shift-zero/
├── index.html / styles.css   canvas layers, DOM pager + screens, CRT/film-grain overlay
├── src/main.js               bootstrap, fixed-step loop + hit-stop, state machine
├── src/engine/
│   ├── Camera.js             co-op framing, trauma shake (directional), zoom punch, hit-stop
│   ├── Lighting.js           half-res darkness buffer, raycast flashlight, pre-baked bulb sprites
│   ├── ParticlePool.js       SoA pool: pseudo-3D bouncing sparks, voxel drift, puddle reflections
│   ├── AudioSynth.js         mains hum, gated arc crackle, clunks, pager, anchor-driven score
│   ├── Input.js · Util.js    intents + Solo-Swap mapping · seeded RNG, noise, lightning paths
├── src/entities/
│   ├── PlayerBody.js         inertia, dodge, tools, SkillCheck, eroding pixel sprite
│   ├── PlayerVoxel.js        conduit graph movement (+cornering forgiveness), Verlet jumper rope
│   └── Anomalies.js          Arc Hound, Bit-Rot Crawler, Harmonic Phantom, Main Tie boss
├── src/systems/
│   ├── CircuitSim.js         nodal propagation, 3-phase loads, breakers/fuses, LOTO, auto-reclose
│   ├── LevelGen.js           seeded rooms + gates + conduit, co-op solvability validator
│   ├── RPGSystem.js          tools, firmware, prototypes, synergy evaluator, stats
│   ├── Narrative.js          pager queue, memories, name decay, reflections, endings
│   ├── World.js              one floor: map queries, rules, hazards, render pipeline
│   └── Devices.js            breakers, fuses, bulkheads, arcs, capacitors, cipher relays…
├── src/ui/                   HUD.js (portrait/scope/gauges/Timex), Screens.js, Backdrops.js
└── tools/                    test suite (see below) + static server
```

Pure modules (`CircuitSim`, `LevelGen`, `RPGSystem`, `Narrative`, `Util`) run in Node for tests.

## Verification

| Command | What it proves |
|---|---|
| `npm test` | 1,200 generated floors pass the co-op solvability validator; a sabotaged layout is *rejected*; LOTO/auto-reclose/ghost-lock/fuse-bridge circuit behaviour; synergies; memory thresholds; every ending condition |
| `node tools/mechanics.mjs` | 23 in-browser assertions: cipher solve, Lock·Tag·Try, pads insulate live water, Ghost Lockout, solo jumper latch, overclock revive, imbalance → phantoms |
| `node tools/bot.mjs` | a bot using **only player intents** solves 20 floors (5 seeds × 4 depths) and beats the boss through all three phases on 3 seeds |
| `node tools/fuzz.mjs` | ~50k frames of random input across every depth, with and without all synergies, zero exceptions |
| `npm run smoke` | drives every game state in Chromium and saves screenshots to `tools/shots/` |

Browser tests need Playwright with Chromium available (`npm i -g playwright`).

**Honest limits:** the solver bot is invulnerable — it proves floors are *completable*, not that
difficulty is tuned; balance has not been playtested by humans. Frame cost measured ~13–16 ms in
headless Chromium's CPU rasterizer; GPU-accelerated browsers should be far faster, but low-end
hardware is untested.
