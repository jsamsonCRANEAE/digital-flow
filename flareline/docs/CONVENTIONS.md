# FlareLine geometry conventions

These are the decisions agreed before Phase 1. Every one of them changes numbers,
so changing any of them needs an engineering review.

| Topic | Convention |
|---|---|
| Units | Inches, IEEE double precision. Display: 4 dp linear, 0.01° angles. Never rounded in the model. 1 in = 25.4 mm exactly. |
| Axes | Right-handed, **Z up**. |
| Origin | End-1 tube end (P0). LRA input starts at the origin, first leg along +X. |
| Vertices | P0 = end 1, P(N-1) = end 2. Bend *k* sits at vertex *k*. Leg *j* runs from P*j* to P*j+1*. |
| Bend radius | CLR (centerline radius), set per bend. |
| Lengths | Measured on the centerline (taken as the neutral axis). Arc = R·θ. |
| Feed (Y) | **Straight between tangent points** (tangent line to tangent line). |
| Leg | Distance from one intersection point to the next (how a drafter usually dimensions a tube). Leg = Y + adjacent tangent lengths. |
| Rotation (B) | Angle of the bend plane relative to the previous bend's plane, about the leg between them. **+ = clockwise when viewed looking along the tube toward end 2** (the right-hand rule about the end 1 → end 2 direction). A CCW display option exists; the stored value is always this convention. |
| First bend B | Measured from a reference plane normal: +Z projected perpendicular to the first leg (+Y if the first leg is vertical). With the default frame, B = 0 bends toward +Y. |
| Zero-angle vertex | Allowed (INFO). It has B = 0, and the next real bend's B is measured from the last real bend. |
| Developed length | Σ straights + Σ (R·θ·f + adj), with shop factor f = 1 and adj = 0 by default. |
| Cut length | Developed + end-1 allowance + end-2 allowance. The allowances come from the AS4330 data file (Phase 2). |
| Bend marks | Developed distance from the P0 tube end to the start and end of each bend. |
| Springback | Optional per-material table of (design angle, springback °), linearly interpolated. Bender angle = design + springback. Off by default. Values outside the table hold the end value and raise a warning. |
| Extrados wall | Screening estimate t·2R/(2R+OD) from a simple strain model. Not a standards value. |
| Self-interference | Centerline distance < OD + clearance between points more than π·OD/2 apart along the tube. Checked on chords (≤ 2°, ≤ OD/4). |

## Open points to confirm

1. **Rotation viewpoint.** You chose "+ = CW". FlareLine defines that viewpoint as
   *looking along the tube toward end 2*. On a hand bender, check that this
   matches the way the operator rotates the tube between bends.
2. **The end point versus the flare.** P0 and P(N-1) are the as-designed tube
   ends. Phase 2 must decide whether the AS4330 allowance is added beyond these
   points, or whether the points sit at the flare seat.
