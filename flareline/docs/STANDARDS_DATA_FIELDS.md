# Standards and shop data you must fill in

Generated from data set `0.1.0-placeholder` (SHA-256 `fbc06821c09e…`).

**254 values in 162 rows are still to be entered or verified.**

Fill these in with the data editor, which logs every change, or directly in the JSON
files. A row counts as **VERIFIED** only once every required field below is set
*and* its provenance has `standard`, `revision`, `table_ref`, `date_entered` and
`entered_by`. The loader refuses to load anything less.

## `materials` — Tube materials

| Field | Unit | Required | What to enter |
|---|---|---|---|
| `name` | - | yes | Display name |
| `material_spec` | - | yes | Tube material specification your drawings call out |
| `condition` | - | if tabulated | Temper / condition, if the spec needs one |
| `flaring_permitted` | - | yes | Whether your organization permits 37° flaring of this material |

Rows still empty:

- `material_spec` (6): cres304; cres316; cres21-6-9; al6061-t6; ti-3al-2.5v; in625
- `flaring_permitted` (6): cres304; cres316; cres21-6-9; al6061-t6; ti-3al-2.5v; in625

## `tube_walls` — Wall thickness options

| Field | Unit | Required | What to enter |
|---|---|---|---|
| `walls` | in | yes | Wall thicknesses available for this size and material |

Rows still empty:

- `walls` (60): -4, cres304; -4, cres316; -4, cres21-6-9; -4, al6061-t6; -4, ti-3al-2.5v; -4, in625; -5, cres304; -5, cres316; -5, cres21-6-9; -5, al6061-t6; -5, ti-3al-2.5v; -5, in625; -6, cres304; -6, cres316; -6, cres21-6-9; -6, al6061-t6; -6, ti-3al-2.5v; -6, in625; -8, cres304; -8, cres316; -8, cres21-6-9; -8, al6061-t6; -8, ti-3al-2.5v; -8, in625; -10, cres304; -10, cres316; -10, cres21-6-9; -10, al6061-t6; -10, ti-3al-2.5v; -10, in625; -12, cres304; -12, cres316; -12, cres21-6-9; -12, al6061-t6; -12, ti-3al-2.5v; -12, in625; -16, cres304; -16, cres316; -16, cres21-6-9; -16, al6061-t6; -16, ti-3al-2.5v; -16, in625; -20, cres304; -20, cres316; -20, cres21-6-9; -20, al6061-t6; -20, ti-3al-2.5v; -20, in625; -24, cres304; -24, cres316; -24, cres21-6-9; -24, al6061-t6; -24, ti-3al-2.5v; -24, in625; -32, cres304; -32, cres316; -32, cres21-6-9; -32, al6061-t6; -32, ti-3al-2.5v; -32, in625

## `as4330_flare` — 37° flared tube ends

Source: **SAE AS4330** (supersedes MS33584). Record the revision and table/figure.

| Field | Unit | Required | What to enter |
|---|---|---|---|
| `end_allowance` | in | yes | Stock from the end reference point to the cut end that is needed to form the flare; added to the cut length. Record whether it comes from the standard or from your flaring process. |
| `flare_diameter_min` | in | yes | Flare diameter, minimum, as tabulated |
| `flare_diameter_max` | in | yes | Flare diameter, maximum, as tabulated |
| `flare_angle_nominal_deg` | deg | yes | Flare angle, nominal, as specified |
| `flare_angle_tol_deg` | deg | yes | Flare angle tolerance (±), as specified |
| `notes` | - | if tabulated | Other requirements to repeat on the flare detail |

Rows still empty:

- `end_allowance` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `flare_diameter_min` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `flare_diameter_max` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `flare_angle_nominal_deg` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `flare_angle_tol_deg` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32

Table note `end_point_definition`: Exactly where the tube end point (P0 / Pn) sits on the flare, per your standard or drawing practice. Printed on every drawing.

## `as33611_bend_radius` — Tube bend radii

Source: **SAE AS33611** (supersedes MS33611). Record the revision and table/figure.

| Field | Unit | Required | What to enter |
|---|---|---|---|
| `min_clr` | in | yes | Minimum centerline bend radius |
| `standard_clr` | in | if tabulated | Standard / preferred CLR, if tabulated |

Rows still empty:

- `min_clr` (60): -4, cres304; -4, cres316; -4, cres21-6-9; -4, al6061-t6; -4, ti-3al-2.5v; -4, in625; -5, cres304; -5, cres316; -5, cres21-6-9; -5, al6061-t6; -5, ti-3al-2.5v; -5, in625; -6, cres304; -6, cres316; -6, cres21-6-9; -6, al6061-t6; -6, ti-3al-2.5v; -6, in625; -8, cres304; -8, cres316; -8, cres21-6-9; -8, al6061-t6; -8, ti-3al-2.5v; -8, in625; -10, cres304; -10, cres316; -10, cres21-6-9; -10, al6061-t6; -10, ti-3al-2.5v; -10, in625; -12, cres304; -12, cres316; -12, cres21-6-9; -12, al6061-t6; -12, ti-3al-2.5v; -12, in625; -16, cres304; -16, cres316; -16, cres21-6-9; -16, al6061-t6; -16, ti-3al-2.5v; -16, in625; -20, cres304; -20, cres316; -20, cres21-6-9; -20, al6061-t6; -20, ti-3al-2.5v; -20, in625; -24, cres304; -24, cres316; -24, cres21-6-9; -24, al6061-t6; -24, ti-3al-2.5v; -24, in625; -32, cres304; -32, cres316; -32, cres21-6-9; -32, al6061-t6; -32, ti-3al-2.5v; -32, in625

Table note `organization_rule`: Any organizational rule that further limits CLR (e.g. by wall/OD ratio)

## `j514_reference` — 37° flare fitting reference geometry (reference only)

Source: **SAE J514**. Record the revision and table/figure.

| Field | Unit | Required | What to enter |
|---|---|---|---|
| `nut_hex_across_flats` | in | yes | Nut hex across flats |
| `nut_length` | in | yes | Nut overall length |
| `sleeve_length` | in | if tabulated | Sleeve overall length |
| `envelope_od` | in | yes | Largest fitting diameter, for clearance checks |
| `envelope_length` | in | yes | Fitting length behind the end point, for clearance |

Rows still empty:

- `nut_hex_across_flats` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `nut_length` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `envelope_od` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `envelope_length` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32

## `shop_limits` — Bender and end-prep limits (shop data)

Source: **Shop data**. Record the revision and table/figure.

| Field | Unit | Required | What to enter |
|---|---|---|---|
| `min_straight_between_bends` | in | yes | Shortest straight the bender can clamp between bends |
| `min_end_straight_flare37` | in | yes | Shortest end straight for the flaring tool, nut and sleeve (37° flare end) |
| `min_end_straight_plain` | in | yes | Shortest end straight for a plain / cut end |
| `min_end_straight_flareless` | in | if tabulated | Shortest end straight for a flareless end |
| `bender_die_clrs` | in | if tabulated | CLRs of the bend dies you have for this size |

Rows still empty:

- `min_straight_between_bends` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `min_end_straight_flare37` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32
- `min_end_straight_plain` (10): -4; -5; -6; -8; -10; -12; -16; -20; -24; -32

## `shop_bending` — Length correction and springback (shop data)

Source: **Shop data**. Record the revision and table/figure.

Shipped with neutral defaults (no correction). Replace them when you have test-bend results.

| Field | Unit | Required | What to enter |
|---|---|---|---|
| `arc_length_factor` | - | yes | Multiplies R·θ for each bend (1.0 = centerline) |
| `per_bend_adjust` | in | yes | Length added per bend (0.0 = none) |
| `springback_points` | deg | if tabulated | [design angle, springback] pairs, linearly interpolated |

