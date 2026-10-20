# Hayate Rally 疾風ラリー

An anime cel-shaded rally game for the browser, inspired by the low-poly hardpack look of rally clips
like *hardpackrally*. You drive everyday cars (a 2026 RAV4-style crossover, a 2003 Sienna-style minivan,
a pickup, an EV, a kei van and more) through banked dirt, tarmac and snow stages, and you can play it
with a Bluetooth controller on Windows.

## Play on Windows

1. Download this folder (on GitHub: **Code → Download ZIP**, then extract it).
2. Pair your controller: **Settings → Bluetooth & devices → Add device**.
   * Xbox: hold the small pair button on top until the logo flashes fast.
   * PS5 DualSense: hold **Create + PS** until the light bar blinks.
   * PS4 DualShock: hold **Share + PS**.
   * Switch Pro: hold the sync button on top.
3. Double-click **`Play.bat`**. It opens the game full-screen in Edge.
   You can also open `index.html` in Chrome or Edge directly.
4. **Press any button on the controller.** Browsers only reveal a gamepad after a button press.

No install, server or internet is needed. Fonts fall back to Impact when you're offline.

## Controls

| Action | Controller (Xbox / PlayStation) | Keyboard |
|---|---|---|
| Steer | Left stick | ← → / A D |
| Throttle | RT / R2 (analog) | ↑ / W |
| Brake, reverse when stopped | LT / L2 (analog) | ↓ / S |
| Handbrake | A / ✕ | Space |
| Shift up / down (manual mode) | RB / LB | E / Q |
| Change camera (chase, far, hood, bumper) | Y / △ | C |
| Look back | B / ○ (hold) | B |
| Reset to road | View / Share | R |
| Pause | Menu / Options | Esc |
| Fullscreen | Fullscreen item in the main, pause and settings menus | F |

You can rebind any action under **Controls**. Bindings are saved per controller, so pads with an unusual
layout (8BitDo, generic Bluetooth pads) work too. The Controls screen also shows live axis and button
readings, and has a rumble test.

## Features

* **Anime art style**: 3-band cel shading, ink outlines, manga screen-tone hatching in shadows, crisp rim
  lights and paint highlights. The sky has quantised bands and the clouds are inked. Dust puffs are
  cel-shaded too.
* **Anime effects**: speed lines, "DRIFT!", "BIG AIR!" and "CRASH!" impact pop-ups, a countdown, gate
  flashes, and an animated co-driver who reads pace notes aloud ("Right 3, tightens, banked!").
* **8 everyday cars** (fictional homages):
  * Kitsune RV-4 '26 (2026 RAV4)
  * Tanuki Family Van '03 (2003 Sienna)
  * Raijin GT-Four '92 (90s rally coupe)
  * Hikari Hatch '25 (Civic hatch)
  * Sakura Sedan '25 (Camry)
  * Kuma Trail '24 (Tacoma)
  * Denki Y '26 (Model Y)
  * Mochi Kei Box '23 (N-BOX)
* **Garage customisation**:
  * Looks: paint, accent, two-tone roof, 6 liveries (including itasha), race number, custom number
    plate, 6 rim styles, rim colour, spoilers, rally light pods, mudflaps, ride height and window tint.
  * Tuning: tyres (street, gravel, snow), engine tune, suspension and drivetrain swap (FWD, RWD, AWD).
* **Physics**:
  * A rigid body with 4 raycast suspension springs and dampers, plus anti-roll bars.
  * Load-sensitive tyres using a Pacejka-style curve and a friction circle, so wheelspin and a locked
    handbrake steal lateral grip and the car drifts.
  * Torque curves and gearboxes, AWD/FWD/RWD torque split, aero drag, collisions with the body and trees,
    and per-surface grip.
  * It runs at a fixed 240 Hz with input smoothing and an optional counter-steer assist, so it stays smooth
    on a controller.
* **3 stages** of about 2.3 km with 20 gates and banked corners: Pine Hollow (dirt), Sunset Cape
  (coastal tarmac) and Yuki Pass (snow, with falling snow).
* **Crash physics and damage**:
  * Trees and rocks are solid, and signposts and marker poles snap off and fly.
  * Impacts land at bumper height, so a big hit can spin, pitch or roll the car.
  * The body crumples where you hit. Glass cracks, lamps smash, and mirrors, wings, bumpers, plates,
    light pods and roof rails tear off as tumbling debris.
  * In the default **Looks + handling** mode, a front-end hit costs engine power and makes the engine
    smoke, and a hit near a front wheel bends the steering so the car pulls to one side.
  * Big impacts trigger an anime slow-motion "WRECKED!!" moment.
  * Under **Settings → Car damage** you can choose looks only or off. Restart the stage to repair.
* **Real-car detailing**: beltline trims, gloss-black pillar trims, shoulder-crease highlights, side
  marker lamps, a third brake light, a shark-fin antenna, fog lamps, rear reflectors, a fuel door,
  hood shut lines, projector headlights, grille surrounds, model badges, wheel lug nuts and centre caps,
  tow straps, and a windshield banner on rally liveries.
* **Ghost car** of your best run, split times at every gate, a drift score, and saved records.
* **Rumble**: surface texture, wheelspin, landings and crashes.
* Audio is fully synthesised: engine and EV whine, turbo and blow-off, gravel, wind and impacts.

## Code map

| File | What it does |
|---|---|
| `js/core.js` | Toon/ink material system (cel bands, hatching, rim light), outlines, noise, helpers |
| `js/cars.js` | Car roster, procedural car builder (profiles, lights, glass, wheels, liveries), tuning |
| `js/track.js` | Stage generator: spline road, banking, heightfield, forests, gates, sky |
| `js/physics.js` | Vehicle dynamics |
| `js/input.js` | Gamepad + keyboard, rebinding, rumble |
| `js/audio.js` | WebAudio synth |
| `js/fx.js` | Dust, tyre tracks, snow, speed lines, pop-ups |
| `js/damage.js` | Crumple deformation, glass and lamp breakage, flying debris, mechanical damage |
| `js/ui.js` | Menus, HUD, minimap, co-driver |
| `js/main.js` | Game flow, garage, race loop, camera |

To add a car, copy an entry in `AR.CARS` (`js/cars.js`). Edit its side-profile points (`top`), cabin and
physics. Front is negative z, ground is y = 0, and units are metres.

To add a stage, copy an entry in `AR.STAGES` (`js/track.js`) and change the `seed`, colours and surfaces.

Three.js r149 (MIT) is vendored in `vendor/`. Car names are fictional homages, and no real logos or
trademarks are used.
