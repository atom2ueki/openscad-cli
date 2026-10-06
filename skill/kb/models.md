# Worked models

Ten finished parts from the corpus. Read one when you want a concrete template
for a whole model — parameter layout, feature decomposition, and the print
settings that ship with it — rather than a single technique.

| Model | Directory | Demonstrates |
|---|---|---|
| AC drain pan | `models/ac-drain-pan/` | angled-wall box with a spout and U-handles, 22 parameters in 3 customizer sections |
| AC bayonet connectors | `models/ac-bayonet-connectors/` | three plates, a bayonet twist-lock, material constraints |
| AC hose connector (intake/exhaust) | `models/ac-hose-connector-intake/` | panel-mount rings, insect screen, deflection grill |
| AC side extension box | `models/ac-intake-cover-side-extension/` | arc-radius corner covers that extend a box past its bounding box; split-a-large-part workflow |
| Bambu A1 gantry mount | `models/bambu-lab-a1/` | a dovetail slide joint, twist-lock camera interface |
| Tapo C230 wall mount | `models/camera-tapo-230/` | twist-lock bar + plate, printable brim/support recipe |
| Clothes pin | `models/clothes-pin/` | one-piece spring-free mechanism with a wavy interlock |
| Eye drops holder | `models/eye-drops/` | a prompt-driven model: the brief is checked in beside the source |
| Hinged box | `models/hinged-box/` | filament-pin print-in-place knuckle (see `mechanisms.md`) |
| LED puck lamp base | `models/lamp-led-puck/` | a multi-file, multi-plate family with a selectable texture parameter |

## Parametric layout, as the corpus writes it

Every one of these exposes a handful of top-level parameters, grouped into
`/* [Section] */` blocks with slider ranges, and hides the rest:

```openscad
/* [Box Dimensions (mm)] */
box_depth = 30;   // [10:1:200]
box_width = 45;   // [10:1:200]
box_height = 15;  // [10:1:200]
box_corner = 3;   // [1:1:10]
wall_thickness = 2; // [0.4:0.1:5]

/* [Hidden] */
```

Exact parameter sets worth copying:

| Model | Parameters (default `[range]`) |
|---|---|
| drain pan | `wall_thickness 2.5 [1:0.1:5]`, `chamfer_size 1.5`, `box_height 19 [10:1:100]`, `box_width 240 [50:1:300]`, `box_depth 200`, `box_wall_angle 82 [45:1:89]`, `spout_width 30`, `spout_length 25`, `handle_length 120`, `handle_width 5`, `handle_height 25`, `handle_radius 10` |
| hinged box | `box_depth 30`, `box_width 45`, `box_height 15`, `box_corner 3`, `wall_thickness 2 [0.4:0.1:5]` |
| clothes pin | `pin_depth 15 [10:1:40]`, `pin_width 25 [10:1:40]`, `pin_gap .6 [.2:.05:1]` |
| camera wall mount | `plate_diameter 55 [30:1:100]`, `bar_diameter 44`, `bar_width 7`, `top_diameter 29`, `bottom_diameter 31`, `cone_height 6`, `wall_thickness 1.5`, `hole_distance 28`, `hole_size 4` |
| gantry mount | `bracket_thickness 5 [3:1:5]`, `bracket_width 44`, `arm_length 30`, `dovetail_depth 6`, `dovetail_gap .6`, `gantry_clearance 20`, `wall_thickness 1.5`, `c230_bar_width 7`, `c230_top_diameter 29`, `c230_bottom_diameter 31`, `c230_cone_height 6` |
| lamp base | `led_puck_diameter 82 [25:1:120]`, `led_puck_height 21`, `base_height 40`, `shade_height 90`, `wall_thickness 2.5`, `lamp_chamfer .75`, `cable_diameter 3`, `lug_size 5` |
| lamp shade | `total_height 160`, `wall_thickness 1.5`, `texture_id 4 [0:1:10]`, `connector_outer_diameter 97 [50:.5:150]`, `connector_height 11` |

Two cautions the corpus itself exhibits: a README's slider table can disagree
with the source defaults (`dovetail_depth` here is `6` with a `[10:1:30]`
range; `round-image.scad` has `total_height 160` with `[10:1:40]`), and a
parameter can be declared but unused (the dovetail's `angle`). **Trust the
source, not the README, and check that a parameter is actually read.**

## Techniques worth lifting

### Bayonet twist-lock — `ac-bayonet-connectors`

Male lugs enter L-shaped slots in the female side and lock on rotation.
Three plates: female connector, male connector, and a female adapter that
retrofits the lock onto a plain tube (`tube extension` switch). Printed with no
supports on a device that handles 45° overhangs.

**Material constraint:** the README forbids PLA outright — "you need a
heat-resistant and UV-stable material like PCTG or PETG". A hot-air exhaust
duct is the reason. Say so when you generate a variant.

### Wavy interlock instead of a straight seam — `clothes-pin`

A one-piece, spring-free clothespin: the coiled side profile flexes at the pivot
to close the jaws, nothing is cut there. Two details matter:

- The jaw halves are separated by a **wavy rift** (`rift_cutter`, sized by
  `pin_gap`) so they interlock rather than meeting on a straight line — better
  grip on fabric, and the wave keeps the two jaws from fusing during the print.
- The thumb-press ends get the same wave texture as a grip.
- Profile traced from an SVG half-outline, mirrored, extruded, then
  minkowski-summed with a small diamond to chamfer top and bottom edges.

### Twist-lock camera interface — `camera-tapo-230`, reused in `bambu-lab-a1`

A cone-keyed twist-lock: `top_diameter 29` → `bottom_diameter 31` over
`cone_height 6`, on a bar of `bar_diameter 44`. The wall-mount plate is 55 mm
octagonal with four 4 mm holes on a 28 mm square. The A1 gantry mount reuses the
identical interface with `c230_*` parameters and swaps the wall plate for a
dovetail-slide bracket — a good example of factoring a mating interface out as
parameters so two models stay compatible.

### AC hose interface — `ac-hose-connector-intake`

The intake and exhaust rings are the same interface: a cylinder at the hose's
nominal diameter **minus `tolerance_gap = 0.15`**, a base plate or rim that sits
on the print bed, and features hung off it:

- **Insect screen as a honeycomb.** A hex grid cut through the plate with
  `cell_flat_to_flat` and a *uniform* wall: `x_spacing = 2*r_inner +
  wall_thickness`, `y_spacing = x_spacing * sin(60)`, rows staggered by half a
  column. `$fn = 6` makes the cylinder hexagonal; `rotate([0,0,30])` turns flats
  to flats. Kept lean on purpose to minimise airflow friction.
- **Foam-tape groove** on the plate's upper face: four straight runs, cut to
  `plate size - 2*chamfer - 2*corner_radius` so they stop short of the rounded
  corners, 90 % of the tape thickness deep.
- **Top rim as an added quarter circle** on the tube wall, convex and facing up
  and outward, so the hose slides on.
- **Spring tongues** on the exhaust cover: two vertical slits per tongue, the
  tongue thinned to 1 mm to flex, with an ellipsoid segment outside it extending
  `2*tolerance_gap` past the tube and overlapping the tongue by half a wall
  thickness. The ellipsoid is clipped at the slits.

Both files carry a **checked-in spec document** (`hose-connector-intake.md`,
`vent-cover-grill.md`) that is a prompt plus a parameter table plus
**"Guardrails / Checks"** — e.g. "the arc of the quarter circle cannot be
concave, I want it convex", "the groove cannot be missing, cut it out of the
plate". That is a pattern worth copying: write the acceptance checks down
alongside the model so the next iteration cannot silently regress them.

### Friction fit without a thread — `lamp-led-puck/shade-base-connector.scad`

A two-sided connector that joins the lamp base to a shade by friction alone:
a **torus ring** protruding from the outer wall between the two halves, plus
friction dots and tongue slots, all sized off `tolerance = 0.2`. The file's own
header carries the arithmetic — `11.2 - 2*4.7 = 1.8 mm` friction ring — and the
print note: **PETG, "due to mechanical stress for better durability"**.

### Wall fasteners and clearance guards

- `camera-tapo-230/wall-mount.scad` drills its four mounting holes as
  **teardrop** holes in a `grid_copies(n=[2,2], spacing=hole_distance)` pattern —
  a teardrop rather than a circle so a printed horizontal hole does not sag into
  an oval.
- `bambu-lab-a1/gantry-mount.scad` includes a `clearance_guard()` module: solid
  blocks sized from `gantry_clearance = 20` that hold the bracket a fixed
  distance from the mechanism it must not touch. Modelling the clearance as
  geometry, rather than trusting a number in a README, is the right move for any
  part that mounts onto a machine.

### Multi-file family with a selectable texture — `lamp-led-puck`

Four files: `lampbase.scad` (base + shade assembly), `shades/round-textured.scad`
(11 selectable textures by `texture_id`), `shade-base-connector.scad` (friction
fit), plus `shades/round-image.scad` (image/logo shade) and
`shades/wide-round-textured.scad`. The base and the shades are separate models
that share the connector diameter — the same "factor the interface into
parameters" idea as the camera mount.

## Prompting a model into existence

`models/eye-drops/prompt.md` is the brief that produced `eye-drops.scad`, checked
in next to the result. It is a good shape for a modelling request:

> Create an openscad script for a solid object that is the extrusion of a
> rectangle with rounded corners. The object's height is 30mm, width 65mm, and
> depth 25mm. The corners radius is 5mm. In that object, create equidistant holes
> of diameter 15mm, with the holes placed along the center of the object wider
> axis. The holes are open on the top, and end 2.5mm above the bottom surface of
> the main object. Place the assembly of the 3 holes in the middle of the object,
> leaving 5mm room on all sides and between the holes. Add chamfers to all sharp
> edges. In the bottom surface, add holes to all four corners of 6.2mm diameter
> and 0.2mm depth, with the holes being offset from the sides by 3mm.

What makes it work: a base primitive, every dimension as a number, the placement
rule spelled out as *clearance* rather than coordinates, and an explicit
finishing instruction ("chamfers to all sharp edges").

`ac-drain-pan/README.md` and `ac-intake-cover-side-extension/README.md` carry the
same thing at a larger scale: the literal "AI instructions" that generated each
part, followed by the parameter list. The drain-pan author's own note is the
honest part — "plus a little back & forth to get rid of the AI's spatial
errors (they all suck at geometry)" — which is why the KB page you are reading
insists on checking `stats.volume` and sectioning the mesh.

## MakerWorld multi-plate — `examples/mw-multi-part.md`

MakerWorld scans the file **statically** for modules named `mw_plate_N()` before
running it. The rules, which are firm:

1. **`mw_plate_1()` must not be empty** — it generates the cover thumbnail, and
   an empty plate fails upload validation.
2. **Plates must be declared explicitly.** No loops, no computed names
   (`module mw_plate_part(index)` is not recognised).
3. **Orientation differs from the assembly view.** `assembly()` shows the parts
   as a finished product; each `mw_plate_N()` must place its part flat on the
   **Z=0 print plane**, exactly as it will print.

The corpus's convention adds `local = 1` and a preview-guarded invocation:

```openscad
if ($preview || local) {
    if ($preview) mw_plate_1();
    else assembly();
}
```

`assembly()` dispatches with `grid_copies(...)` and the special variable `$idx`:

```openscad
module assembly() {
    grid_copies(spacing = plate_grid_spacing, n = [2, 1])
        if ($idx == 0) mw_plate_1(); else if ($idx == 1) mw_plate_2();
}
```

Files that follow it: `lamp-led-puck/lampbase.scad`,
`ac-bayonet-connectors/hose-connector-multi-plate.scad`,
`bosl2/hull.scad`, `examples/mw-multi-part.scad`.

## Print settings that ship with the models

| Model | Settings |
|---|---|
| A1 gantry mount, C230 wall mount | wall generator *Arachne*, infill *Gyroid*, support *tree(auto)*; wall mount additionally outer brim, width 8, brim-object gap 0.15 |
| AC bayonet connectors, LED puck lamp | no supports, 45° overhangs; **PETG/PCTG, never PLA** for the AC parts |
| Clothes pin | PETG (Elegoo white in the reference print) |
| AC drain pan | test-fit cuboid for the drain clearance before committing; ~680 ml to the rim, ~400 ml usable |

Arachne plus gyroid is the corpus's default recipe for parts with thin walls and
fiddly features; that combination is also what the `parts/joining/README.md`
recommends for the tapered plug.

Catalogue of the modules inside these models:
[`catalog.md`](./catalog.md#worked-models--modelsmd).
