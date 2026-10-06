# BOSL2 idioms

The corpus's BOSL2 examples, reduced to what you actually need. BOSL2 is not
vendored — it must be installed as an OpenSCAD library and reached with:

```openscad
include <BOSL2/std.scad>
include <BOSL2/threading.scad>   // only for trapezoidal_threaded_rod
```

## Anchors and attachment

Replace coordinate arithmetic with anchor names.

| Call | Effect |
|---|---|
| `attach(anchor, from_anchor=BOTTOM, spin=)` | moves *and* rotates the child so its `from_anchor` meets the parent's `anchor` |
| `position(anchor)` | moves the child's origin to the parent's anchor, **without** rotating |
| `orient(dir)` / `orient(anchor, spin)` | rotates so the object's TOP points along `dir` |
| `align(anchor, inside=)` | places inside a space, aligning the bounding box; **not** part of the attachment tree |

- Anchor aliases: `CENTER`/`CTR`, `TOP`/`T`, `BOTTOM`/`BOT`, `LEFT`/`L`,
  `RIGHT`/`R`, `FRONT`/`F`, `BACK`/`BK`. Combine by **vector addition**:
  `TOP+RIGHT`, `BOTTOM+FRONT+LEFT`.
- Always pass `overlap=-epsilon` (`0.05`) to `attach()` when the child cuts or
  joins the parent. Without it the child sinks nothing and the shared face is a
  coplanar CSG artifact.

```openscad
diff()
cube(box_size)
    attach(TOP, overlap=-epsilon)
        zscale(head_slope)
            tag("remove")
                cyl(d=hole_diameter + tolerance, h=hole_depth / head_slope,
                    chamfer=-(head_diameter - hole_diameter) / 2 - tolerance, anchor=TOP);
```

`diff()` + `tag("remove")` replaces nested `difference()` blocks and keeps the
subtraction expression next to the face it cuts. `diff()` with no argument means
"subtract everything tagged `remove`".

## Negative `chamfer` / `rounding` flares outward

The single most useful BOSL2 trick in this corpus. A positive chamfer cuts the
edge in; a **negative** value flares it out.

| Use | Expression |
|---|---|
| countersink a screw head | `cyl(d=hole+tolerance, h=depth/slope, chamfer=-(head_d - hole_d)/2 - tolerance)`, wrapped in `zscale(head_slope)` |
| taper a bore | `zcyl(d1=0.75*hole, d2=1.25*hole, anchor=TOP, chamfer2=-chamfer)` |
| bevel hole mouths outward | `cyl(d=hole_diameter, h=plate_thickness + 2*edge_gap, chamfer=-hole_bevel)` |
| flare a post's base | `cuboid([s,s,chamfer], chamfer=-chamfer, edges=BOTTOM)` |
| open a fitting clearance | `os_chamfer(width=-tolerance)` in `offset_sweep` |

## Threads

One `std_thread()` wrapper feeds both the male neck and the lid's internal mask,
so the nominal geometry cannot drift between them:

```openscad
module std_thread(l, internal = false, bevel1 = false, bevel2 = false, anchor = BOTTOM) {
    trapezoidal_threaded_rod(d = thread_diam, l = l, pitch = pitch,
        thread_depth = thread_depth, thread_angle = thread_angle,
        internal = internal, bevel1 = bevel1, bevel2 = bevel2, anchor = anchor);
}
```

- `internal = true` auto-enlarges the cut by roughly `4 * $slop`.
- **`$slop` defaults to 0.0.** Set it (0.15 upstream) or the printed lid will not
  turn. This is the BOSL2 knob for print clearance.
- Shared derived geometry: `thread_crest_radius = lid_inner_radius - 0.2`,
  `neck_radius = thread_crest_radius - thread_depth`.
- See [`threads.md`](./threads.md) for the library-free implementation and the
  reasoning behind the recessed neck.

## Fasteners

- `screw_hole(spec="M3x12", head="pan"|"countersunk", counterbore=…)`.
- `metric_bolt(size="M3", l=12, head=…)`, `threaded_nut(nut_type="M3", …)`.
- Hex pocket sizing (what the corpus computes by hand):
  `pocket_flats = nut_width + tolerance`, `pocket_corners = pocket_flats / cos(30)`,
  `pocket_depth = ceil((nut_thickness + tolerance) / layer_height) * layer_height`.
  Render the hex with `cyl($fn=6)` or `regular_ngon(n=6, d=…)`; `zrot(90)` picks
  whether flats or corners face you.

## Textures

`texture=` accepts a **named built-in** (`"rough"`, `"diamonds"`,
`"trunc_ribs"`) or a **2D matrix of 0..1 heightfield values**.

| Parameter | Meaning |
|---|---|
| `tex_size=[w,h]` | size of one repeating tile, mm |
| `tex_depth` | relief depth |
| `tex_inset=true` | press the pattern **into** the surface, preserving the outer bounds |
| `tex_inset=false` | let it protrude |
| `tex_reps=[n,m]` | tiles across the surface |
| `tex_taper` | taper the relief at the ends so it fades out |
| `style="min_edge"` | silhouette-preserving sampling on curved sweeps |

```openscad
cyl(r = outer_radius, h = lid_height, chamfer1 = chamfer, chamfer2 = chamfer,
    texture = "trunc_ribs", tex_reps = [rib_count, 1], tex_depth = rib_depth,
    tex_inset = true, tex_taper = 2 * chamfer / lid_height);
```

A custom heightfield is anything that evaluates to a matrix; the brushed-metal
example is `rands(-0.5, 0.5, 1)[0]` per cell with an anisotropic
`tex_size=[30,2]` to stretch the strokes, applied to `cyl(..., tex_inset=false)`.
`linear_sweep(square([20,20], center=true), h=30, texture=custom, tex_size=[4,4])`
textures an extrusion; `rotate_sweep(arc(r, angle=[-90,90]), texture=…)` textures
a body of revolution, and `top_half(z = sp_r - cap_h)` clips the result to a cap.

## Support-free pocket roofs

**Bridged hole** (`bosl2/bridged-hole.scad`) closes a hex nut pocket with a stack
of one-layer-thick planes instead of a long bridge. Each plane's opening is the
intersection of parallel strips over several angles, narrowing each layer:

```openscad
bridge_layers = ceil((width_start - width_end) / bridge_step);
strip_angle(i)     = i * 180 / bridge_angles;
strip_halfwidth(k) = width_start - (width_start - width_end) * (k + 1) / bridge_layers;
```

Each edge only spans the small step beyond the layer below. A related trick that
*does* use 45° geometry is the nut-slot roof in `screw-post.scad`: a quarter
pyramid from `intersection()` of a 4-sided cone (`$fn=4`) apexed above the post
edge and the pocket footprint, so the roof rises at 45°.

Other details worth copying from `screw-post.scad`:

- **Nut retention lips**: two small bumps just outside the seated nut, so it must
  be pressed past them and is then held.
- **`assert()` the derived geometry**, e.g.
  `assert(hole_bottom_z > tolerance, "…")` and
  `assert(slot_roof_z + roof_height < post_height, "…")` — a bad parameter
  combination fails loudly instead of rendering a plausible wrong part.

## Rounding and hole grids

```openscad
minkowski() {                                  // cylinder is the rounding tool
    chamfered_cube(w, l, thickness - 2*edge_chamfer, edge_chamfer);
    cylinder(r = corner_radius, h = 1);
}
grid_copies(spacing=[hole_spacing, hole_spacing], n=[columns, rows])
    cyl(d = hole_diameter, h = plate_thickness + 2*edge_gap, chamfer = -hole_bevel, anchor=BOTTOM);
```

Clamp the requested radius or chamfer to what fits:
`usable_corner_radius = min(corner_radius, min(w, l)/2 - edge_chamfer)`.

## The canonical file skeleton

`template.scad` is the corpus's model template. Reproduce this structure for any
non-trivial part:

```openscad
// MY MODEL
// One-line description of what it is, ideally in terms of user input.

include <BOSL2/std.scad>

/* [Main Settings] */
width = 40;           // [20:1:150]
// (each parameter: a // description line, an inline // [min:step:max] range)

/* [Hidden] */
//$preview = true;
local = 1;
$fa = $preview ? 32 : 4;
$fs = $preview ? 4 : 0.2;
tolerance = 0.2;
epsilon   = 0.05;
plate_grid_spacing = [1.2 * width, 1.2 * length];
// Keep derived calculations below this line, so they are hidden from the UI.
echo("SIZE H × L × W:", height, length, width);

// Helpers
module see_through(base_color = "grey", alpha = 0.6) { if ($preview) color(base_color, alpha=alpha) children(); else children(); }
module solid(base_color = "red") { if ($preview) color(base_color) children(); else children(); }

// Parts
module enclosure() { … }

// Main Assembly & Plates
module assembly() { grid_copies(spacing = plate_grid_spacing, n = [2, 1]) if ($idx == 0) mw_plate_1(); else if ($idx == 1) mw_plate_2(); }
module mw_plate_1() { … }

// Plates
if ($preview || local) {          // main assembly in Parametric Model Maker
    if ($preview) mw_plate_1();
    else assembly();
}
```

Conventions that go with it:

- **User parameters live in `/* [Section] */` blocks; derived values and
  `$preview`/`$fa`/`$fs` live under `/* [Hidden] */`.** The inline
  `// [min:step:max]` comment is what renders a slider in MakerWorld's
  Parametric Model Maker.
- `see_through()`/`solid()` colour only in `$preview`, so the printed render is
  plain.
- **`mw_plate_N()` are the printable plates and must be declared explicitly**;
  the root/`assembly()` view exists only to visualise the model. Plates sit flat
  on `Z=0`, positioned exactly as they will print.
- `local = 1` forces the local preview branch, because Parametric Model Maker
  ignores a `$preview = …` assignment.
- `assert()` in the hidden block; `echo()` a derived summary.

## Also useful

- `extra2=1` on `cyl`/`zcyl` extends the far end so a subtracting cylinder does
  not leave an open face at the bottom of a through-hole.
- `regular_ngon(n=6, d=…)`, `rect([x,y], rounding=/chamfer=)`,
  `arc(r, cp=, start=, angle=, n=)`, `round_corners(path, radius=, closed=)` are
  the 2D-path workhorses the spring and texture files lean on.

Catalogue of every module and parameter:
[`catalog.md`](./catalog.md#bosl2-idioms--bosl2md).
