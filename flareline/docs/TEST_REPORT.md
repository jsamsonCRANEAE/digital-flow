# FlareLine geometry engine: test report

- Date (UTC): 2026-10-18 05:30
- Python 3.12.3 on Linux x86_64, numpy 2.5.4, pytest 9.1.1
- Result: **133 / 133 passed**

Each case states its hand calculation in the description. Expected values in the
tests are literals or closed forms (e.g. tan 22.5 = sqrt2 - 1), not engine output.

| # | Module | Case (hand calculation) | Result |
|---|--------|-------------------------|--------|
| 1 | data | DT-01 the shipped data set loads, and no standards table holds a number: every AS4330 / AS33611 / J514 / shop-limit value is null and UNVERIFIED. | PASSED |
| 2 | data | DT-02 tube OD is the one filled value: OD = dash/16 (e.g. -5 -> 0.3125), DERIVED with a basis. | PASSED |
| 3 | data | DT-03 tables cite AS4330 (supersedes MS33584) and AS33611 (supersedes MS33611). | PASSED |
| 4 | data | DT-04 a row marked VERIFIED without revision / table / date / entered_by is refused. | PASSED |
| 5 | data | DT-05 a row with full provenance but an empty required value cannot be VERIFIED. | PASSED |
| 6 | data | DT-06 wrong types, unknown fields, duplicate keys, bad status/date, wrong name are rejected. `[<lambda>-must be a number]` | PASSED |
| 7 | data | DT-06 wrong types, unknown fields, duplicate keys, bad status/date, wrong name are rejected. `[<lambda>-unknown value fields]` | PASSED |
| 8 | data | DT-06 wrong types, unknown fields, duplicate keys, bad status/date, wrong name are rejected. `[<lambda>-duplicate key]` | PASSED |
| 9 | data | DT-06 wrong types, unknown fields, duplicate keys, bad status/date, wrong name are rejected. `[<lambda>-unknown provenance status]` | PASSED |
| 10 | data | DT-06 wrong types, unknown fields, duplicate keys, bad status/date, wrong name are rejected. `[<lambda>-YYYY-MM-DD]` | PASSED |
| 11 | data | DT-06 wrong types, unknown fields, duplicate keys, bad status/date, wrong name are rejected. `[<lambda>-does not match]` | PASSED |
| 12 | data | DT-07 a wall-specific AS33611 row beats the any-wall row; other walls fall back. | PASSED |
| 13 | data | DT-08 the data set SHA-256 is stable on reload and changes if any file changes. | PASSED |
| 14 | data | DT-09 editing a value and verifying the row writes both changes to CHANGELOG.jsonl with user, reason, before/after and file hashes; the loaded row is VERIFIED. | PASSED |
| 15 | data | DT-10 verifying a row with an empty required value is refused and the file is untouched. | PASSED |
| 16 | data | DT-11 changing a value on a VERIFIED row drops it back to UNVERIFIED. | PASSED |
| 17 | data | DT-12 adding a -3 size needs only a data-file row (no code change). | PASSED |
| 18 | development | DV-01 KA-09 with arc factor 1.02 and +0.01 per bend: developed = 22 + 2pi*1.02 + 0.02 = 28.4288; centerline stays 22 + 2pi. | PASSED |
| 19 | development | DV-02 cut = developed + FA1 + FA2 = 22 + 2pi + 0.10 + 0.20; sources are kept. | PASSED |
| 20 | development | DV-03 the tangent trace carries R and theta; R*tan(theta/2) recomputed from the trace inputs equals the stored value exactly. | PASSED |
| 21 | development | DV-04 every bend/segment/total value has a trace, and the trace book serialises to JSON for the audit log. | PASSED |
| 22 | development | DV-05 t=0.035, OD=0.25, R=1: t_out ~= 0.035 * 2 / 2.25 = 0.031111. | PASSED |
| 23 | development | SB-01 springback: bender angle = design + interpolated springback. `[points0-45.0-2.5-False]` | PASSED |
| 24 | development | SB-01 springback: bender angle = design + interpolated springback. `[points1-45.0-1.5-False]` | PASSED |
| 25 | development | SB-01 springback: bender angle = design + interpolated springback. `[points2-90.0-3.0-False]` | PASSED |
| 26 | development | SB-01 springback: bender angle = design + interpolated springback. `[points3-120.0-3.0-True]` | PASSED |
| 27 | development | SB-01 springback: bender angle = design + interpolated springback. `[points4-5.0-0.5-True]` | PASSED |
| 28 | development | SB-02 a disabled table changes nothing; duplicate angles are rejected. | PASSED |
| 29 | development | UN-01 display is 4 dp (in/mm) and 2 dp (deg); 1 in = 25.4 mm exactly; the stored value keeps full precision. | PASSED |
| 30 | development | PF-01 analyse + validate (incl. self-interference) a 20-bend tube in < 100 ms (median of 5). | PASSED |
| 31 | formats | FM-01 Y=5, B=0, C=90, R=1, Y=5 -> T=1, legs 6/6 -> (0,0,0),(6,0,0),(6,6,0). | PASSED |
| 32 | formats | FM-02 second bend with B=+90 (CW looking toward end 2) turns toward +Z (inverse of KA-09): Y 8/6/8, C 90/90, R 2 -> (10,10,10) end point. | PASSED |
| 33 | formats | FM-03 first bend B=-90 from the +Z reference: normal becomes rotate(+Z, +X, -90) = +Y, bend direction = +Y x +X = -Z, so a 90 deg bend points the tube straight down. | PASSED |
| 34 | formats | FM-04 KA-09 route -> Y 8/6/8, B 0/+90, C 90/90. | PASSED |
| 35 | formats | FM-05 legs = Y + adjoining tangents: KA-09 legs are 10/10/10. | PASSED |
| 36 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[0]` | PASSED |
| 37 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[1]` | PASSED |
| 38 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[2]` | PASSED |
| 39 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[3]` | PASSED |
| 40 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[4]` | PASSED |
| 41 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[5]` | PASSED |
| 42 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[6]` | PASSED |
| 43 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[7]` | PASSED |
| 44 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[8]` | PASSED |
| 45 | formats | FM-06 random 3D routes (1-20 bends): XYZ -> LRA -> XYZ within 1e-9 in. `[9]` | PASSED |
| 46 | formats | FM-07 random 3D routes: XYZ -> LEGS -> XYZ within 1e-9 in. `[0]` | PASSED |
| 47 | formats | FM-07 random 3D routes: XYZ -> LEGS -> XYZ within 1e-9 in. `[1]` | PASSED |
| 48 | formats | FM-07 random 3D routes: XYZ -> LEGS -> XYZ within 1e-9 in. `[2]` | PASSED |
| 49 | formats | FM-07 random 3D routes: XYZ -> LEGS -> XYZ within 1e-9 in. `[3]` | PASSED |
| 50 | formats | FM-07 random 3D routes: XYZ -> LEGS -> XYZ within 1e-9 in. `[4]` | PASSED |
| 51 | formats | FM-08 the display setting only changes the shown sign: CW toward end 2 is the stored convention; reversing the viewpoint flips it; the stored value never changes. `[CW-toward_end2-1]` | PASSED |
| 52 | formats | FM-08 the display setting only changes the shown sign: CW toward end 2 is the stored convention; reversing the viewpoint flips it; the stored value never changes. `[CCW-toward_end2--1]` | PASSED |
| 53 | formats | FM-08 the display setting only changes the shown sign: CW toward end 2 is the stored convention; reversing the viewpoint flips it; the stored value never changes. `[CW-toward_end1--1]` | PASSED |
| 54 | formats | FM-08 the display setting only changes the shown sign: CW toward end 2 is the stored convention; reversing the viewpoint flips it; the stored value never changes. `[CCW-toward_end1-1]` | PASSED |
| 55 | formats | FM-09 LRA must have one more feed than bends. | PASSED |
| 56 | formats | FM-10 a 180 deg bend has no finite tangent and is rejected. | PASSED |
| 57 | gui | GU-01 the simple-90 sample opens: 3 points, bend 90.00°, banner up on placeholder data. | PASSED |
| 58 | gui | GU-02 editing P2 Y from 6 to 10 changes the route and developed length (+4.0000), then Ctrl+Z restores the exact original value and Ctrl+Y re-applies it. | PASSED |
| 59 | gui | GU-03 in LRA mode, increasing feed Y1 by 1 moves P1 and P2 by 1 along +X and adds exactly 1 to the developed length. | PASSED |
| 60 | gui | GU-04 switching to mm shows 8 in as 203.2000 mm; the stored point is still 8.0 in. | PASSED |
| 61 | gui | GU-05 typing text into a number cell reverts it and adds no undo step. | PASSED |
| 62 | gui | GU-06 selecting the bend angle cell shows its formula in the Explain panel. | PASSED |
| 63 | gui | GU-07 choosing -5 in step 1 resolves OD 0.3125 (DERIVED from the dash number). | PASSED |
| 64 | gui | GU-08 Add leg appends a 6 in leg at 90°; Remove last leg takes it away again. | PASSED |
| 65 | gui | GU-09 moving P2 onto P1 (zero-length leg) shows an ERROR and keeps the table usable. | PASSED |
| 66 | gui | GU-10 save writes the project, clears the unsaved mark, and reopening is identical. | PASSED |
| 67 | gui | GU-11 with CCW display, the LRA B of the 3D sample shows the opposite sign. | PASSED |
| 68 | gui | GU-12 a 20-bend tube: edit -> evaluated -> every panel (no 3D) updated, median < 100 ms. | PASSED |
| 69 | gui | DE-01 what the user types becomes the right JSON value, and formats back. `[number-0.875-0.875]` | PASSED |
| 70 | gui | DE-01 what the user types becomes the right JSON value, and formats back. `[number--None]` | PASSED |
| 71 | gui | DE-01 what the user types becomes the right JSON value, and formats back. `[numbers-0.035, 0.049-value2]` | PASSED |
| 72 | gui | DE-01 what the user types becomes the right JSON value, and formats back. `[numbers--value3]` | PASSED |
| 73 | gui | DE-01 what the user types becomes the right JSON value, and formats back. `[points-0:0; 90:3-value4]` | PASSED |
| 74 | gui | DE-01 what the user types becomes the right JSON value, and formats back. `[bool-yes-True]` | PASSED |
| 75 | gui | DE-01 what the user types becomes the right JSON value, and formats back. `[bool-No-False]` | PASSED |
| 76 | gui | DE-01 what the user types becomes the right JSON value, and formats back. `[text- AMS 5567 -AMS 5567]` | PASSED |
| 77 | gui | DE-02 entering a min CLR then verifying the row: data reloads VERIFIED, the change log names the user and reason, and the grid shows the new status. | PASSED |
| 78 | gui | DE-03 verifying a row with an empty required value is refused; nothing is written. | PASSED |
| 79 | gui | DE-04 the flare end-point note can be written and verified; an empty note cannot. | PASSED |
| 80 | gui | DE-05 text in a number field is refused before anything is written. | PASSED |
| 81 | gui | GU-13 hand-bender marks in the LRA table, simple 90 (legs 8/6, R 0.75, T 0.75): bend starts at 7.2500 and ends at 7.25 + 0.75*pi/2 = 8.4281 from P0. | PASSED |
| 82 | known_answers | KA-01 Straight tube, 2 points 10 in apart: no bends, developed = 10.0000. | PASSED |
| 83 | known_answers | KA-02 90 deg in XY, legs 10/10, R=2: T=2, A=pi=3.14159265, S=8/8, dev=16+pi. | PASSED |
| 84 | known_answers | KA-03 45 deg, legs 10/10, R=3: T=3(sqrt2-1)=1.24264069, A=3pi/4=2.35619449, dev = 2(10-T) + A = 19.87091312. | PASSED |
| 85 | known_answers | KA-04 30 deg, legs 10/5, R=1: T=2-sqrt3=0.26794919, A=pi/6, S=9.73205081/4.73205081, dev=14.98770039. | PASSED |
| 86 | known_answers | KA-05 120 deg, legs 5/5, R=1: T=sqrt3=1.73205081, A=2pi/3=2.09439510, dev = 10 - 2sqrt3 + 2pi/3 = 8.63029349. | PASSED |
| 87 | known_answers | KA-06 90 deg up into +Z (Z-up), legs 6/6, R=1.5: T=1.5, S=4.5/4.5, dev = 9 + 0.75pi = 11.35619449; bend-plane normal = X x Z = -Y. | PASSED |
| 88 | known_answers | KA-07 S-offset: 45 deg left then 45 deg right, offset leg 4, outer legs 5, R=1. T = sqrt2-1; S = 5-T, 4-2T, 5-T; dev = 14 - 4T + pi/2 = 13.91394208; bend planes opposite => rotation 180. | PASSED |
| 89 | known_answers | KA-08 U: two 90 deg in the same plane, legs 10/4/10, R=1: S = 9, 2, 9; dev = 20 + pi = 23.14159265; rotation 0. | PASSED |
| 90 | known_answers | KA-09 X -> Y -> +Z, legs 10/10/10, R=2: S = 8, 6, 8, dev = 22 + 2pi. n1 = X x Y = +Z, n2 = Y x Z = +X. Right-hand turn about +Y takes Z to X, so B2 = +90 (clockwise looking toward end 2). | PASSED |
| 91 | known_answers | KA-10 mirror of KA-09 going down to -Z: n2 = Y x (-Z) = -X, B2 = -90. | PASSED |
| 92 | known_answers | KA-11 skew 90 deg: u = +X, v = (0, 0.6, 0.8), legs 4/5, R=1: u.v = 0 so 90 deg; S = 3, 4; dev = 7 + pi/2 = 8.57079633; n = (0, -0.8, 0.6). | PASSED |
| 93 | known_answers | KA-12 compound bend into (1,1,1) direction, legs 3/sqrt3, R=2: theta = acos(1/sqrt3) = 54.73561032 deg; tan(theta/2) = sin/(1+cos) = 0.51763809; T = 1.03527618; A = 1.91063324; dev = 3 + sqrt3 - 2T + A = 4.57213168. | PASSED |
| 94 | known_answers | KA-13 collinear interior vertex: angle 0, T=0, A=0, dev = 12; INFO issue raised. | PASSED |
| 95 | known_answers | KA-14 KA-09 with an extra collinear vertex on the middle leg: B is measured from the last real bend, so bend 3 still reads +90 and dev is unchanged. | PASSED |
| 96 | known_answers | KA-15 moving the whole route changes no length, angle or rotation. | PASSED |
| 97 | known_answers | KA-16 the same tube described from end 2: lengths are identical, bend order reverses, and the KA-09 rotation reads +90 again (a right-handed turn stays right-handed when both the axis and the planes reverse). | PASSED |
| 98 | known_answers | KA-17 marks from end 1 for KA-09: bend 1 starts at 8, ends at 8+pi; bend 2 starts at 14+pi, ends at 14+2pi; total = 22+2pi. | PASSED |
| 99 | known_answers | KA-18 tangent points of KA-02: (8,0,0) in, (10,2,0) out. | PASSED |
| 100 | known_answers | KA-19 different CLR per bend (U, legs 10/6/10, R1=1, R2=2): T = 1 and 2; S = 9, 3, 8; dev = 20 + pi/2 + pi = 24.71238898. | PASSED |
| 101 | project | PJ-01 save -> load reproduces every float bit for bit (1/3, pi) and all settings. | PASSED |
| 102 | project | PJ-02 files from a newer schema, or missing format / version, are refused. | PASSED |
| 103 | project | PJ-03 on placeholder data the banner lists every missing value actually used, the cut length is marked incomplete and the design is not releasable. | PASSED |
| 104 | project | PJ-04 missing data never blocks the geometry: legs 10/10/10, two 90 deg bends at R = 0.75 (T = 0.75): developed = 30 - 4T + 2R(pi/2) = 27 + 0.75pi = 29.35619449. | PASSED |
| 105 | project | PJ-05 with verified test rows: no banner; cut = developed + 0.1 + 0.1; the AS33611 min CLR (test 0.5) is enforced with its source named. | PASSED |
| 106 | project | PJ-06 a min-CLR override replaces the data value, is marked USER INPUT with its reason, and is listed as INFO so it shows on the drawing notes. | PASSED |
| 107 | project | PJ-07 plain end: allowance 0 (DERIVED); flareless end: placeholder INFO, allowance missing and cut length incomplete. | PASSED |
| 108 | project | PJ-08 a material marked flaring_permitted = false with a 37° end -> ERROR. | PASSED |
| 109 | project | PJ-09 an image-derived route is APPROXIMATE and not releasable until confirmed. | PASSED |
| 110 | project | PJ-10 the audit log line holds the data set hash, each input's status/source, every traced calculation and every issue. | PASSED |
| 111 | project | PJ-11 a wall marked 'from data' that the wall table does not list is flagged. | PASSED |
| 112 | project | PJ-12 springback on with an empty shop table -> MISSING; with test points (0,0),(90,3) a 120 deg bend outside the table warns SPRINGBACK_EXTRAPOLATED. | PASSED |
| 113 | project | PJ-13 a material or dash size missing from the data is an ERROR, not a crash. | PASSED |
| 114 | project | PJ-14 a value typed into a row that is not yet VERIFIED is used in the check (CLR 0.4 < 0.6 warns) but is flagged: red banner, UNVERIFIED_DATA warning, not releasable. | PASSED |
| 115 | validation | VA-01 KA-09 route with every limit set: no errors, no warnings, no info. | PASSED |
| 116 | validation | VA-02 limits left unset are not silently skipped: one INFO each, plus interference not checked when OD is unknown. | PASSED |
| 117 | validation | VA-03 U with middle leg 1.0 and R=1: S1 = 1 - 1 - 1 = -1 -> BEND_OVERLAP by 1.0000. | PASSED |
| 118 | validation | VA-04 first leg 1.0 with a 90 deg R=2 bend: T=2 > 1 -> BEND_PAST_END on end 1. | PASSED |
| 119 | validation | VA-05 CLR 0.5 < min 0.75 -> WARNING citing the limit source. | PASSED |
| 120 | validation | VA-06 CLR 0.125 = OD/2 is not physically bendable -> ERROR, not just a warning. | PASSED |
| 121 | validation | VA-07 U legs 10/2.5/10, R=1: S1 = 0.5 < 1.0 bender minimum -> WARNING. | PASSED |
| 122 | validation | VA-08 end 2 leg 2.5 with R=2: S = 0.5 < 1.0 -> END_STRAIGHT_BELOW_MIN on end 2 only. | PASSED |
| 123 | validation | VA-09 coincident points, zero CLR and a 180 deg fold stop the solve with an ERROR. `[points0-radii0-ZERO_LENGTH_LEG]` | PASSED |
| 124 | validation | VA-09 coincident points, zero CLR and a 180 deg fold stop the solve with an ERROR. `[points1-radii1-CLR_NOT_POSITIVE]` | PASSED |
| 125 | validation | VA-09 coincident points, zero CLR and a 180 deg fold stop the solve with an ERROR. `[points2-radii2-BEND_180]` | PASSED |
| 126 | validation | VA-10 a 120 deg bend with a table that ends at 90 deg -> SPRINGBACK_EXTRAPOLATED. | PASSED |
| 127 | validation | IN-01 last leg (x=5) crosses the first leg (y=0) in the same plane -> contact between segment 0 and segment 3 at about (5, 0, 0), distance ~0. | PASSED |
| 128 | validation | IN-02 same crossing but the last leg runs 1.0 above the first: gap 0.75 -> no contact. | PASSED |
| 129 | validation | IN-03 last leg only 0.2 above the first: centerline distance 0.2 < OD 0.25 -> contact. | PASSED |
| 130 | validation | IN-04 U with CLR 0.15 (0.6 x OD) and zero straight between bends: legs 0.30 apart, tube is continuous, nothing touches -> no contact reported. | PASSED |
| 131 | validation | IN-05 two square turns of a coil: pitch 0.1 < OD touches, pitch 1.0 does not. `[0.1-True]` | PASSED |
| 132 | validation | IN-05 two square turns of a coil: pitch 0.1 < OD touches, pitch 1.0 does not. `[1.0-False]` | PASSED |
| 133 | validation | IN-06 validate() turns a contact into a SELF_INTERFERENCE error. | PASSED |
