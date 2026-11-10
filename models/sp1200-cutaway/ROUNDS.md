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

Round 3 plan (after review): exposure / key light midway between rounds 1 and 2 to land the dark share near 0.55;
a light on the right side so the cheek reads as brushed aluminium; pad glow raised 2 mm so all 4 edges show;
keyboard and monitor pushed back so the frame matches the reference's props.
