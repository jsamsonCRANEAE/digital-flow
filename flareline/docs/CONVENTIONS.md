# FlareLine geometry conventions

These are the decisions agreed before Phase 1. Every one of them changes numbers,
so changing any of them needs an engineering review.

| Topic | Convention |
|---|---|
| Units | Inches, IEEE double precision. Display: 4 dp linear, 0.01° angles. Never rounded in the model. 1 in = 25.4 mm exactly. |
| Axes | Right-handed, **Z up**. |
| Origin | End-1 end point (P0). LRA input starts at the origin, first leg along +X. |
| End points | P0 and P(N-1) **sit at the flare reference point**. Where exactly that point is on the flare is a text note in the AS4330 data file (`end_point_definition`); it is printed on drawings and stays flagged until you fill it in. For a plain end, the end point is the cut end. |
| Vertices | P0 = end 1, P(N-1) = end 2. Bend *k* sits at vertex *k*. Leg *j* runs from P*j* to P*j+1*. |
| Bend radius | CLR (centerline radius), set per bend. |
| Lengths | Measured on the centerline (taken as the neutral axis). Arc = R·θ. |
| Feed (Y) | **Straight between tangent points** (tangent line to tangent line). |
| Leg | Distance from one intersection point to the next (how a drafter usually dimensions a tube). Leg = Y + adjacent tangent lengths. |
| Rotation (B) | Angle of the bend plane relative to the previous bend's plane, about the leg between them. **Stored** as + = clockwise looking along the tube toward end 2 (the right-hand rule about the end 1 → end 2 direction). **Display is configurable** per project: CW or CCW positive, viewed toward end 2 or toward end 1. Only the shown sign changes. |
| First bend B | Measured from a reference plane normal: +Z projected perpendicular to the first leg (+Y if the first leg is vertical). With the default frame, B = 0 bends toward +Y. |
| Zero-angle vertex | Allowed (INFO). It has B = 0, and the next real bend's B is measured from the last real bend. |
| Developed length | Σ straights + Σ (R·θ·f + adj), with shop factor f = 1 and adj = 0 by default. |
| Cut length | Developed + end-1 allowance + end-2 allowance. Each allowance is the stock from the end point to the cut end that is needed to form the flare (AS4330 data file `end_allowance`; 0 for a plain end). If an allowance is missing, the cut length is marked incomplete. |
| Bend marks | Developed distance from the P0 end point to the start and end of each bend. Add the end-1 allowance to measure from the cut end of the stock. |
| Springback | Optional per-material table of (design angle, springback °), linearly interpolated. Bender angle = design + springback. Off by default. Values outside the table hold the end value and raise a warning. |
| Extrados wall | Screening estimate t·2R/(2R+OD) from a simple strain model. Not a standards value. |
| Self-interference | Centerline distance < OD + clearance between points more than π·OD/2 apart along the tube. Checked on chords (≤ 2°, ≤ OD/4). |

## Decisions log

- 2026-10-18: Z up; origin at end 1; feed measured between tangent points; + rotation = CW.
- 2026-10-18: Rotation display made configurable (direction and viewpoint). End points sit
  at the flare. Springback is a table.
