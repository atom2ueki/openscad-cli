# Reusable solids

Primitives and shape constructions worth copying verbatim.

**Library split:** `torus.scad`, `shells.scad`, `disks-and-washers.scad` and
`rounded-cubes.scad` are pure OpenSCAD. `hull.scad`, `ibeam.scad` and
`support-fin.scad` need `include <BOSL2/std.scad>` for `cuboid`/`cyl`/`xcopies`/
`grid_copies` and the anchor helpers — see [`bosl2.md`](./bosl2.md).

## Torus — `parts/torus.scad`

```openscad
module torus(radius, rx, ry, arc = 360) {
    rotate_extrude(angle = arc, convexity = 2)
        translate([radius, 0, 0])
            scale([rx, ry, 1])
                circle(r = 1, $fn = $fn);
}
```

`rx` and `ry` are **semi-axes (radii), not diameters**, and they are independent
— `torus(30, 5, 10, 240)` is a 240° arc of a torus 10 mm thick radially and
20 mm tall at the profile center. `convexity=2` is required or the preview
renders inside-out. Sets `$fa = $preview ? 8 : 1`, `$fs = $preview ? 1 : 0.1`.

## Hull constructions — `parts/hull.scad`

Three shapes that would otherwise be hand-made polyhedra. The trick is that the
hull's end geometry is a **0.01-thick slice**, so the blend is exact:

```openscad
slice = 0.01;

// stadium plate: two discs at opposite ends
hull() xcopies(plate_span) cyl(d=plate_diameter, h=plate_thickness, rounding=0.5, anchor=BOTTOM);

// square-to-round adapter: rounded square at z=0, disc raised to h
hull() {
    cuboid([square_size, square_size, slice], rounding=corner_rounding, edges="Z", anchor=BOTTOM);
    up(h - slice) cyl(d=round_d, h=slice, anchor=BOTTOM);
}

// bracket: base plate, then a post offset horizontally and raised
hull() {
    cuboid([bracket_base, bracket_base, bracket_base_thickness], rounding=corner_rounding, edges="Z", anchor=BOTTOM);
    right(bracket_offset) up(bracket_height - slice) cyl(d=bracket_post, h=slice, anchor=BOTTOM);
}
```

The adapter is hollowed by subtracting a second `adapter_shape()` scaled in by
`2 * wall_thickness` in XY and extended `epsilon` past both ends in Z, so the
cut is clean. `edges="Z"` rounds only the vertical edges, which is what keeps the
footprint printable.

## I-beam — `parts/ibeam.scad`

Two chamfered-cuboid differences; no custom profile:

```openscad
union() {
    difference() {
        cuboid([length, width, height], chamfer = chamfer);
        xrot(90) cuboid([length + epsilon, height - 2*wall + epsilon, width + epsilon],
                        chamfer = -chamfer, edges = "X");
    }
    difference() {
        cuboid([length, 2*wall, height - 2*wall + 2*epsilon], chamfer = -4*chamfer, edges = "X");
        cuboid([length - 2*wall, 1.5 * layer_height, height]);
    }
}
```

Note the **negative chamfers** (`chamfer=-chamfer`, `-4*chamfer`) flaring the
channels outward, and the `epsilon` inflation (`0.05`) on every cutter so no face
is coincident.

## Rounded and chamfered cubes — `parts/rounded-cubes.scad`

Four variants, cheapest first:

| Variant | Construction | Rounds |
|---|---|---|
| `minkowski(cube([s,s,1]); cylinder(r=.05*s, h=1))` | cheap | vertical edges |
| `minkowski(cube([s,s,1]); sphere(r=.2*s))` | expensive | all edges |
| `chamfered_cube(w, d, h, c)` | explicit 16-point polyhedron | top and bottom only |
| `minkowski(chamfered_cube(...); cylinder(r=.05*s, h=1))` | mid | top/bottom + verticals |

`chamfered_cube()` clamps first, so it cannot be asked for more than it can do:

```openscad
chamfer = min(chamfer, min(width, depth) / 2, height / 2);
```

`minkowski()` is the expensive operator here: it multiplies the mesh of both
operands, and the rounding tool inherits `$fa`/`$fs` unless you set `$fn` on it.

## Bodies of revolution — `parts/shells.scad`, `parts/disks-and-washers.scad`

Two printed demonstrations of the calculus methods for a solid of revolution, and
a good source for *approximate-then-verify* technique.

- **Shell method** (`shells.scad`): split `x ∈ [a,b]` into `n` intervals, sample
  `x` per interval, revolve the wall `[x−t/2, x+t/2] × [g, f]`, thickness
  `t = interval`.
- **Disk/washer method** (`disks-and-washers.scad`): split `y ∈ [a,b]` into `n`
  intervals, revolve `g(y) → f(y)`; `g = 0` collapses the washer to a disk.

Both files:

- expose `sample_type` (`left|mid|right` in one, `bottom|mid|top` in the other)
  and `n = 10`, so you can see the Riemann sum error;
- build an **exact reference solid** (`solid_surface()`) by `rotate_extrude()`ing
  a polygon sampled 100 steps each way along the top curve and back along the
  bottom — `show_solid = !$preview` renders it instead of the approximation;
- scale model units to millimetres with `scalefactor` (`printedwidth/(2*b)` and
  `printedheight/(b-a)` respectively);
- offset every inner cutter by `-0.1 * scalefactor` and make it
  `(thickness + 0.2) * scalefactor` tall, so the stacked cylinders never share a
  face.

That last point generalises: **in a stack of N abutting solids, pad the cutters
in Z** rather than relying on exactly-touching faces.

## Support fin — `parts/support-fin.scad`

A parametric triangular gusset for printing an object on its edge or corner,
with designed break-away attachment.

- The gusset is a right triangle through a **double `offset()`** for rounded
  corners, proportional to thickness:

  ```openscad
  linear_extrude(height = thickness, center = true)
      offset(r = thickness/3) offset(delta = -thickness/3)
          polygon(points = [[0, -size/sqrt(2)], [0, size/sqrt(2)], [size/sqrt(2), 0]]);
  ```

- **Tines along the hypotenuse are the whole point.** A row of small cubes at
  `4 * thickness` spacing, each `fin_gap*sqrt(2) × 0.3 × 0.45`, `zrot(45)`:

  ```openscad
  step = 4 * thickness;
  for (h = [0 : step : size*sqrt(2) - step])
      translate([-.25*fin_gap*sqrt(2), h - size/sqrt(2) + thickness/2, 0])
          zrot(45) cube([fin_gap*sqrt(2), tine_heigth, tine_width], center = true);
  ```

  The contact area is tiny, so the fin snaps off with a wiggle and a deburring
  tool finishes the rest — no slicer support, and no support scar.

- **A bed-adhesion helper** (a squashed cylinder, `scale([0.5,1,1])`,
  `r = .95*size`, chamfered) sits beside the fin so the tall gusset does not
  topple, while object contact stays minimal.
- Cost on the reference cube: 9.98 g part + 1.85 g for two fins = **11.8 g
  total; the supports are 15.6 % of the print**, and they make the part
  compatible with fuzzy skin / BumpMesh surface textures that would otherwise
  destroy bed adhesion.

File defaults: `fin_size=20`, `fin_thickness=1`, `fin_gap=.75`, `cuboid_size=30`.

Full module list: [`catalog.md`](./catalog.md#reusable-solids--solidsmd).
