# Still loop — SP-1200 Modern

Measured with the same script on both images (image-space shares of the front top edge; dark share = luma < 80 in the device's bounding box).
Camera solved from 6 reference landmarks (normalised fit error 0.0066 → 0.0029). Gate: proportions ±0.03, dark share 0.8–1.25 × reference.

| Measure | Reference | Round 1 | Round 2 |
|---|---|---|---|
| side / front | 0.767 | 0.809 | 0.789 |
| back / front | 0.997 | 0.971 | 0.978 |
| left / front | 0.761 | 0.793 | 0.776 |
| front height right | 0.155 | 0.127 | 0.143 |
| front height left | 0.129 | 0.125 | 0.141 |
| dark share | 0.542 | 0.100 (0.19×) | 0.892 (1.65×) |

| # | Line | Round 1 | Round 2 |
|---|---|---|---|
| 1 | Silhouette / view / proportions | partial | **yes**, all within ±0.03 |
| 2 | Pads: edge-only light | partial (bloom floods faces) | partial (thin edges now, far edges hidden under the pads) |
| 3 | Touchscreen | yes | yes |
| 4 | Faders level, dotted LEDs | partial (solid bars) | yes |
| 5 | Knobs + logos | partial (logo clipped) | yes |
| 6 | Buttons | yes | yes |
| 7 | Top rim / inset panel | partial (washed out) | partial (contrast there, too dark overall) |
| 8 | Aluminium cheek, inset | partial | partial (reads as a dark slot; the aluminium sits in shadow) |
| 9 | Front face | partial (small floppy) | yes |
| 10 | Rear cables | partial (drift right) | yes |
| 11 | Accents only as lines | partial (halos) | yes |
| 12 | Density 0.8–1.25 × | **no** (0.19×) | **no** (1.65×, overcorrected) |

## Round 3 (approved by the user, run to completion)

| Measure | Reference | Round 3 | Gate |
|---|---|---|---|
| side / front | 0.767 | 0.789 | ±0.03 ✓ |
| back / front | 0.997 | 0.978 | ±0.03 ✓ |
| left / front | 0.761 | 0.776 | ±0.03 ✓ |
| front height right | 0.155 | 0.143 | ±0.03 ✓ |
| front height left | 0.129 | 0.141 | ±0.03 ✓ |
| dark share | 0.542 | 0.503 (0.93×) | 0.8–1.25× ✓ |

| # | Line | Round 3 | Note |
|---|---|---|---|
| 1 | Silhouette / view / proportions | yes | camera solved from 6 landmarks, fit error 0.0029 |
| 2 | Pads: edge-only light | yes | near edges lit as in the reference; a touch brighter than the reference's |
| 3 | Touchscreen | yes | less cyan than the reference's |
| 4 | Faders level, dotted LEDs | yes | |
| 5 | Knobs + logos | yes | |
| 6 | Buttons | yes | |
| 7 | Top rim / inset panel | yes | |
| 8 | Aluminium cheek, inset | yes | now lit from the right; dark grille, 4 screws |
| 9 | Front face | yes | |
| 10 | Rear cables | yes | arch up over the back edge, one red |
| 11 | Accents only as lines | yes | 3 overlapping labels removed or moved |
| 12 | Density 0.8–1.25 × | yes | 0.19× → 1.65× → 0.93× |

What changed: the wood carries the light and the device carries the dark (the reference's dark share comes from the device, not the desk);
a warm light from the right; multisampled render target and a 4096 shadow map; props re-placed from the reference with the solved camera.

Also checked: `out/round3-exploded.png` — every part group separates (screen, knobs, faders, pads, buttons, top plate, cheeks, floppy,
I/O, mainboard, power supply, pad sensors). The page (`out/dist/sp1200-still.html`) has drag-to-orbit, wheel zoom and a Take apart button.

Not done: the film, the short version and the score. The skill films only after the still is approved.
