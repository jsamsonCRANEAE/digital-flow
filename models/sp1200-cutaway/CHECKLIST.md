# SP-1200 Modern — checklist (cutaway method, `docs/CHECKLIST.md` format)

Reference: the user's render (2400 × 1792). Measured before the first line of code.

## Measurements off the reference

Image-space lengths, as shares of the front top edge (front-left-top → front-right-top corner):

| Measure | Reference |
|---|---|
| side top edge (front-right → back-right) | 0.767 |
| back top edge | 0.997 |
| left top edge | 0.761 |
| front height at the right corner | 0.155 |
| front height at the left corner | 0.129 |
| dark share (luma < 80) in the device's bounding box | 0.542 |

Layout from a homography of the top surface (4 corners → flat panel, x across −2.3…2.3, z back −2.0 … front +2.0):
screen x −2.04…−0.15, z −1.44…−0.34 · run/stop (−1.92, 0.12) · 8 numbered buttons x −1.51…0.13 at z 0.08 ·
7 faders x −1.55…0.39, slots z 0.49…1.33, caps level at z ≈ 0.80 · front row of 8 buttons x −1.53…0.48 at z 1.6 ·
2 left buttons x −1.91 at z 0.94 / 1.59 · 4 knobs x 0.12…1.68 at z −1.38 · both logos on the back strip (z ≈ −1.7) ·
repeat / roll (0.21 / 0.46, −0.40) · tap (0.45, 0.12) · toggle (1.23, −0.48) · 2 small buttons (1.56 / 1.87, −0.46) ·
3 × 3 pads in x 0.6…2.2, z 0…1.22 · 5 LED buttons x 0.91…2.01 at z 1.6.

## The 12 lines

1. **Silhouette and view:** a low wedge, back taller than front, seen from the FRONT-RIGHT and well above, on a wooden desk. Image proportions as in the table above (side 0.77, back 1.00, right height 0.155, left height 0.129 of the front edge), each within ±0.03.
2. **Signature feature:** a 3 × 3 grid of square black rubber pads, colored light ONLY as a thin glowing edge (violet, teal, blue, pink, green), filling the front-right quarter (x 0.6…2.2). NEVER a lit pad face.
3. **Touchscreen** at the back-left, 1.9 × 1.1 units: cyan waveforms, an orange step grid, a tab bar, a dark navy background. NEVER a blank, grey or washed-out white rectangle.
4. **Seven faders** front-to-back in the left-centre, chrome caps all at the same height (z ≈ 0.80), each with a dotted amber LED column beside the slot. NEVER staggered caps.
5. **Four knurled black knobs** in a row at the back-right with small labels; "SP-1200 Modern" (dark grey) and "E-mu Modern" (white + orange) printed on the back strip.
6. **Square rubber buttons:** run/stop + 8 numbered in front of the screen; 8 in front of the faders; 2 on the left edge; repeat / roll / tap; 5 with coloured LEDs (red, pink, green, yellow) in front of the pads.
7. **Top surface:** a lighter grey rim, wide at the back, around a darker inset panel with rounded corners and a thin light outline; thin orange section lines.
8. **Right side:** a brushed aluminium cheek INSET into the side (below the top rim, behind the front face), a dark perforated grille window, 4 screws. NEVER a frame standing out past the front corner.
9. **Front face:** a 3.5" floppy drive bottom-left with a black bezel; a black I/O block right of centre (SD, USB-C, blue USB-A, 3.5 mm); a small knob and a 1/4" jack to its right. Rounded vertical corners.
10. **Rear:** 5 to 7 thick cables (one red, two braided) with XLR and jack plugs, leaving the back edge toward the back-right.
11. **Accents:** orange only as thin lines and small text; RGB light only at the pad edges and the LED buttons. Zero glowing dots anywhere else.
12. **Density:** dark share in the device's bounding box at least 0.8 of the reference's (≥ 0.43) and not above 1.25 of it (≤ 0.68): the grey must read as grey, not black.

## Built to come apart (the cutaway part of the brief)

Every part that opens is its own group with a named anchor: `screen`, `knobs`, `faders`, `pads`, `buttons`, `topPlate`,
`floppy`, `io`, `cheekL`, `cheekR`, `mainboard`, `psu`, `padBoard`, `rear`. Inside the shell: a mainboard dense with chips
and capacitors, a power supply with a transformer and heatsink, the floppy mechanism, pad sensors, fader pots and ribbon cables.
