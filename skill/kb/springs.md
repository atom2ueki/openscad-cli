# Springs and flexures

Six flat-pack springs. **The idea is the same in all of them: the spring is a 2D
profile extruded through the print axis**, so the flex path lies in-plane with
the layer lines.

Never model a helical coil spring for FDM: its turns stack across layers and
split under load. Each file here is a compliant band, not a helix.

Common shape of every file: `/* [Section] */` parameters → `/* [Hidden] */`
derived values → `see_through()`/`solid()` preview helpers → geometry
functions → one feature module calling `offset_sweep(...)` → `assembly()` →
`mw_plate_1()`. All six `include <BOSL2/std.scad>` for
`offset_sweep`/`offset_stroke`/`helix`/`arc` — see [`bosl2.md`](./bosl2.md).

```openscad
module wave_band() {
    offset_sweep(offset_stroke(wave_path(), width=band_width), height=spring_height,
                 top=os_chamfer(width=chamfer), bottom=os_chamfer(width=chamfer));
}
```

| File | Centerline | Notable parameters |
|---|---|---|
| `coil-spring.scad` | Archimedean spiral, `helix(h=0)` | `outer_diameter=40`, `turns=4` |
| `extension-spring.scad` | trapezoid wave (flat projection of a winding) | `spring_length=60`, `windings=6`, `squareness=2` |
| `leaf-spring.scad` | two mirrored circular-segment leaves + rings | `leaf_bulge=8`, `leaf_spacing=3` |
| `omega-spring.scad` | squashed loop + tangent legs + end coils + grip bars | `loop_diameter=30`, `end_gap=2` |
| `stabilizer-spring.scad` | outer ring + inner disk joined by N wave bands | `outer_diameter=60`, `spring_count=3` |
| `snap-fit.scad` | cantilever finger with a ramped barb | `barb_depth=1.2`, `finger_thickness=2` |

## Stiffness is a dimension, not a material

- `band_width` (in-plane thickness of the band) and `band_thickness` set how
  easily it bends; `spring_height` (the extrusion) sets how much load it
  carries. Thin down to 1 mm for soft deflection, thicken for stiffness.
- `chamfer` on the top and bottom edges is not cosmetic: it removes the sharp
  extrusion edges (`os_chamfer` in `offset_sweep`).
- **Tolerances here sit at `tolerance = 0.2`** (0.25 in `snap-fit`) — below the
  0.3 mm the design notes ask for on a *moving* compliant joint, because these
  springs flex rather than rub.

## The wave-band pattern (extension and stabilizer springs)

A wound spring's flat projection is a trapezoid wave: flat crests joined by
straight flanks, then rounded corners.

```openscad
winding_length = spring_length / windings;
corner_offset  = winding_length * asin(1 / squareness) / 360;
// corners per winding: [±offset, 1], [winding_length/2 ∓ offset, -1]
[for (w = [0:windings - 1], p = [...]) [w * winding_length + p.x, spring_amplitude * p.y]]
```

`squareness >= 1` (the slider floor is 1.5) — a steeper `squareness` gives
steeper flanks and longer flat crests. `round_corners(..., radius=bend_radius)`
smooths the corners afterwards.

**Porting hazard.** `asin(1 / squareness) / 360` divides a *degree* result by
360 to get a fraction of a turn. It is only correct when `asin` returns degrees.
Confirm the convention on this engine before reusing the expression —
`echo(acos(0.5));` reads 60 on a degrees engine.

## Leaf spring

Each leaf is a circular arc whose chord spans ring-to-ring at that height and
whose rise is `leaf_bulge`; the radius comes from the chord-and-sagitta formula:

```openscad
len   = 2 * (ring_center_x - ring_attach_x(y));
r     = (pow(len / 2, 2) + pow(leaf_bulge, 2)) / (2 * leaf_bulge);
angle = 2 * asin(len / 2 / r);
path  = arc(r=r, cp=[0, y - (r - leaf_bulge)], start=90 - angle / 2, angle=angle, n=ceil(angle) + 1);
```

Two mirrored pairs of bands, `leaf_spacing` apart, land tangentially on two
rings (`ring_diameter=16`, `ring_wall=2`).

## Omega spring

A squashed loop (`loop_squash=0.7`), legs leaving on the tangent heading
`atan2(-loop_squash*cos(loop_end_angle), -sin(loop_end_angle))`, a bend toward
the axis, an internal common-tangent diagonal, a counter-rotating end coil, and
a handle ending in a tilted grip bar. Two asserts guard the geometry:

- `norm(bend_to_coil) > bend_radius + coil_radius` — else `coil_drop` is too
  small.
- `bend_sweep < 180` — else `coil_drop` is too large and the bend wraps into a
  full ring.

The flared root where the stub meets the grip bar is a **double offset** — out
by `handle_flare`, back in by the same amount — which is the idiomatic way to
fill a concave corner:

```openscad
handle_flare > 0 ? offset(offset(merged, r=handle_flare, closed=true), r=-handle_flare, closed=true) : merged;
```

## Coil spring (in-plane spiral)

```openscad
function spiral_path() = path2d(
    helix(h=0, turns=turns, r1=ring_outer_radius - ring_wall / 2, r2=outer_diameter / 2 - band_width / 2));
```

`h = 0` is the whole point: the helix is flat. The inner end starts *inside* the
mounting ring's wall and the outer end runs tangent into the second ring, which
`outer_ring_center()` places. Keep `ring_wall > band_width` (1.6 > 1.2
upstream) or the band eats through the ring.

## Snap fit — `parts/springs/snap-fit.scad`

A bag-clip: two hinged bars close on a cantilever finger whose ramped barb
catches the underside of the fixed bar.

- Undercut `barb_depth = 1.2`; ramp `barb_height / barb_depth` converts axial
  push into finger deflection; `finger_thickness = 2` sets the finger's stiffness.
- **Print-in-place pin:** the bar height is split into three layers —
  `layer = (bar_height - 2*tolerance) / 3` — with the moving knuckle in the
  middle separated from the fixed knuckles by `tolerance` on every side.
- `finger_x = bar_length + tolerance`, `barb_top_y = -(bar_width + half_gap) - tolerance`.
- No `assembly()`/`mw_plate_1()`: the root renders the closed assembly directly.

## Epsilon: fuse, do not abut

Every handle, stub and joint deliberately overlaps what it joins by
`epsilon`/`tolerance` (`[-handle_length - epsilon, 0]` against the ring wall)
so the two solids share volume. A butt joint that only touches is the coplanar
CSG case that renders non-manifold — the same rule as "keep cutters overlapping
the target" in `SKILL.md`.

## Related

- [`printing.md`](./printing.md) — the layer-orientation and minimum-wall rules
  these files depend on.
- [`mechanisms.md`](./mechanisms.md) — hinges and latches.
- [`catalog.md`](./catalog.md#springs-and-flexures--springsmd) — every module
  and parameter.
