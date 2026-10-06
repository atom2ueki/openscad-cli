# Print-in-place mechanisms

Three reference designs, each showing a different way to make a joint that comes
off the plate already assembled:

| Design | File | Joint |
|---|---|---|
| vertical conical hinge | `parts/mechanisms/hinge.scad` | two opposing cones around a barrel, printed in one piece |
| over-center latch | `parts/mechanisms/over-center-latch.scad` | two flat parts, pin snapping past the socket's centre |
| filament-pin knuckle | `models/hinged-box/box.scad` | interleaved knuckles on a 1.75 mm filament offcut |

## Conical hinge — `parts/mechanisms/hinge.scad`

Three solids of revolution on one axis: a barrel at the outer radius, and above
and below it two opposing truncated cones whose tips are `inner_diameter / 2`.
The pair of cones holds the assembly together; the barrel is the running surface.

```openscad
radius = outer_diameter / 2;
cyl_h  = (outer_diameter - inner_diameter) / 2 + epsilon;   // epsilon = 0.05, so the cones overlap the barrel
gap    = height - 2 * cyl_h;

union() {
    up(gap/2 - epsilon)   zcyl(r1=radius, r2=inner_diameter/2, h=cyl_h, anchor=BOTTOM, chamfer=tolerance);
    cyl(r=radius, h=gap, chamfer=tolerance);
    down(gap/2 - epsilon) zcyl(r2=radius, r1=inner_diameter/2, h=cyl_h, anchor=TOP,    chamfer=tolerance);
}
```

- `chamfer = tolerance` on every segment **is the running clearance** — the
  chamfer pulls each solid in by the fit tolerance so the parts do not fuse.
- `outer_diameter=25`, `inner_diameter=15`, `height=15`, `tolerance=0.25`,
  `epsilon=0.05` → `cyl_h = 5.05`, `gap = 4.9`, cone half-angle ≈ 44.7°.
- `epsilon` overlapping the cones into the barrel is what stops a coincident
  face between them.
- Asserts: `outer_diameter > inner_diameter`, `height > 0`, and `gap` must stay
  positive.
- The mating body in the same file subtracts
  `scale((height + 3*tolerance) / height) hinge()` — a hinge enlarged 1.05× —
  and cuts two 0.4 mm slots at 0° and 90° so the shaft splits into flexible
  fingers.

## Over-center latch — `parts/mechanisms/over-center-latch.scad`

A flat body plate with a hub hole at the origin and an open C-socket at +X; a
link swings on the hub and its end pin snaps past the socket's centre, where the
over-centre geometry holds it.

```openscad
socket_c  = [overall_x - socket_wall - socket_r, socket_dy];
link_len  = norm(socket_c);
link_rot  = atan2(socket_c.y, socket_c.x);
pin_d     = socket_d - 2 * pin_clearance;      // 3.0 -> 2.9
axle_d    = hub_hole_d - 2 * pin_clearance;    // 3.4 -> 3.3
pin_h     = link_t + layer_gap + plate_t;      // pins cross the gap and the whole plate
assert(socket_c.x > hub_r, "socket must lie beyond the hub");
```

- **The sloped lower edge is the mechanism.** The body polygon's bottom runs at
  `slope_angle` (7°) from the top of the socket back to the hub axis:
  `tail = [0, top.y - tan(slope_angle) * top.x]`. That incline is the face the
  pin rides over as it goes past centre.
- Pins are extruded cylinders with `chamfer2 = pin_clearance + 0.2` — a tapered
  tip that eases entry and absorbs print tolerance.
- `link_angle = 0` is the snapped-in position; other values show the link
  mid-travel.
- `print_layout` switches between `assembly()` (link below the body,
  `up(link_t + layer_gap)`) and `printable()` (both parts flat, pins up,
  `fwd(hub_r + link_w/2 + 5)` apart).

## Filament-pin knuckle hinge — `models/hinged-box/box.scad`

The box lid and body each carry a row of knuckles; the rows are offset by
`hinge_spacing / 2` so they interleave, and a 1.75 mm filament offcut is the
axle, captured by a tapered end cap.

- Axle bore `= filament_diameter + tolerance` = **2.0 mm**;
  `hinge_gap = tolerance = 0.25`.
- `n` is forced even: `floor(...) * 2`; `hinge_width` is then recomputed so
  `n` knuckles plus `n-1` gaps fill the box width — do not set `hinge_width`
  by hand.
- `end_cap()` is the retention: `d1 = filament_diameter + 2*tolerance` down to
  `d2 = filament_diameter + tolerance - eps2` — a tapered plug that jams the
  filament in place.
- Knuckles are `cuboid(..., rounding=wall_thickness, edges=[TOP+FRONT, TOP+BACK])`.
- A **triangular support beam** (`sup_size = 3*wall_thickness + tolerance`,
  chamfered ends) props the overhanging hinge row during printing.
- Lid and body shells are `offset_sweep(rect(..., rounding=box_corner), ...)`
  with `os_chamfer`; the cavity uses the *negative* chamfer
  `os_chamfer(width=-tolerance)` to open the fit. Do not drop the sign.
- `snap_lock()` is a rounded tongue unioned onto the lid and subtracted from the
  body at `scale(1.05)` — the same enlarged-cutter clearance trick as the hinge.
- `box_grid()` lays a 5 mm lattice of 0.4 mm ribs inside both shells as shrink
  relief ("anti-hull line"). The source marks it
  `// TODO: Use inverted chamfer instead!`.

## The rule all three obey

Every moving surface is separated by an explicit, named tolerance, and every
cutter that must clear a part is scaled or offset *outward* rather than placed
coincident with it. There is no fit anywhere in this catalogue that depends on
the slicer's tolerance setting.

See also [`printing.md`](./printing.md) for the layer-orientation rules, and
[`catalog.md`](./catalog.md#print-in-place-mechanisms--mechanismsmd) for every
module and parameter.
