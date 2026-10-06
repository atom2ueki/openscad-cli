# Surface textures

Seven procedural wall patterns. None uses a library — they are pure OpenSCAD, so
they port anywhere. The point of all of them: **hide layer lines with geometry
instead of buying print resolution.**

| Pattern | File | Formula |
|---|---|---|
| helical knurl | `parts/textures/knurling.scad` | two opposite twisted square ribs |
| straight ribbing | `parts/textures/ribbing.scad` | 36 minkowski-rounded ribs + end bands |
| wavy ribs | `parts/textures/waves.scad` | sine-modulated rib angle |
| diamond knurl (cut) | `parts/textures/diamonds.scad` | crossed twisted V-grooves |
| diamond tread (raised) | `parts/textures/diamond-tread.scad` | alternating diamond pads on a plate |
| stipple | `parts/textures/stippling.scad` | offset sphere grid |
| Japandi ripples | `parts/textures/japandi.scad` | double-sine organic grooves |

Two techniques recur: **`linear_extrude(twist=…)` for a constant-pitch helix**
and **`hull()` of neighbouring spheres/ellipsoids for a smooth swept
centerline**. Both are cheap and both are used in the BOSL2-free files here.

## Helical knurl — `knurling.scad`

A square drawn at `x = radius + knurl_height/2` is half-buried in the cylinder,
so it protrudes exactly `knurl_height/2`. Sweep it with a twist and mirror the
handedness:

```openscad
turns  = height / knurl_pitch;                       // 50/7 ≈ 7.14
slices = ceil(turns * 24);                           // twist needs explicit slices
linear_extrude(height=height, twist=direction*360*turns, slices=slices, convexity=4)
    translate([radius + knurl_height / 2, 0, 0])
        square([knurl_height, knurl_width], center=true);
```

`convexity=4` is not optional — a twisty preview without it renders inside-out.
`knurl_ribs = 18` ribs × two directions give the crosshatch.

## Straight ribbing — `ribbing.scad`

Rounded rib cross-section, made by minkowski-summing the *inset* rectangle with
a circle:

```openscad
minkowski() {
    square([rib_height - 2*rib_corner_radius, rib_width - 2*rib_corner_radius], center=true);
    circle(r = rib_corner_radius, $fn=12);
}
```

The result measures exactly `rib_height × rib_width` — the inset is
`2 * radius`. The same 2D profile reused through `rotate_extrude` becomes
`rib_ring()` at `z = rib_width/2` and `z = height - rib_width/2`, the two end
bands that close the pattern at the rim.

## Wavy ribs — `waves.scad`

The rib's *angular* position is a function of height, so the ribs curve:

```openscad
function rib_angle(index, z) =
    index*360/rib_count
  + z*tan(rib_slant_angle)/feature_radius*180/PI      // constant slant
  + wave_amplitude*sin(z*wave_count*360/height);      // the wave
```

Each rib is a chain of `hull()`ed ellipsoids scaled
`[rib_height, profile_radius, rib_width/2]` at the centerline point, so it stays
smooth as it wanders. `feature_radius = radius - 2*rib_height`, which makes the
ribs stand proud by exactly `rib_height`. Note `rib_slant_angle = -30` is passed
to `cos()` directly: **this corpus assumes degree-based trig**, so verify the
convention before porting (see `SKILL.md`).

## Diamond knurl — `diamonds.scad`

The inverse of the knurl: cut two oppositely twisted V-grooves.

```openscad
polygon(points = [
    [radius - groove_depth, 0],                 // apex, inside the wall
    [radius + groove_overcut, -groove_width/2], // surface width, overcut past the wall
    [radius + groove_overcut,  groove_width/2]
]);
```

Crossing angle and row pitch are derived from the groove count:

```openscad
groove_spacing_x  = 2*PI*radius / groove_count;
row_pitch         = groove_spacing_x / (2 * tan(groove_angle));
groove_twist      = height*tan(groove_angle)/radius * 180/PI;
groove_slices     = max(8, ceil(abs(groove_twist) / 15));
```

**Trim the grooves to the mid-section** or the rims get chewed up:

```openscad
bottom_ring_height = ceil(ring_height / row_pitch) * row_pitch;   // round UP
top_row_z          = floor((height - ring_height) / row_pitch) * row_pitch;  // round DOWN
intersection() { union() { diamond_grooves(1); diamond_grooves(-1); }
                 cube([..., top_row_z - bottom_ring_height]); }
```

Rounding one up and the other down is deliberate: the pattern must meet the
solid band *at a diamond corner*, not be sliced through it, and each end keeps
at least `ring_height = 1.5` mm of ungrooved wall.

## Raised diamond tread — `diamond-tread.scad`

A plate with raised 4-sided pads, alternating orientation, half-pitch row
offset:

```openscad
x = diamond_spacing_x/2 + column*diamond_spacing_x + row_offset;
y = diamond_spacing_y/2 + row*diamond_spacing_y;
row_offset  = (row % 2) * diamond_spacing_x / 2;
orientation = (row + column) % 2 * 90;
```

The grid loops run from `-1` to `ceil(dim/spacing)+1` so the pattern overhangs
the plate, and the raised layer is intersected with a slab of height
`tread_height` to cut the diamonds flush.

## Stipple — `stippling.scad`

An offset grid of spheres, the cheapest organic texture here:

```openscad
stipple_rows    = ceil(height / stipple_spacing);            // 13
stipple_columns = ceil(2*PI*radius / stipple_spacing);       // 24
angle = column*360/stipple_columns + (row % 2)*180/stipple_columns;  // stagger
translate([radius - .5*stipple_height, 0, z]) sphere(r = stipple_radius);   // protrudes 0.55 mm
```

## Japandi ripples — `japandi.scad`

Grooves cut by hulled spheres whose centerline is a sum of two sines with
per-index phase, which is what makes each ripple wander differently:

```openscad
function ripple_angle(index, z) =
    index*360/segments
  + 5*sin(z*360/height + index*37)
  + 2*sin(z*720/height - index*19);
```

The cutter center is pulled in by `groove_radius * 0.25` from the surface, so
depth is shallow and the pattern reads as handmade rather than machined. The
body itself is a stacked-cylinder shell union (softened rims), hollowed from
below at `+2.4` mm so the base stays solid.

`ripple_cutter()` sets `$fa`/`$fs` **locally** (`18/3` preview, `12/1.5` final)
rather than globally — a good pattern when one feature needs finer tessellation
than the rest of the part.

## Depth budget

Every pattern here stays at or under ~1 mm of relief (`knurl_height=0.9`,
`groove_depth=1`, `rib_height=0.75`, `tread_height=0.8`, `stipple` 0.55). That
is deliberate: a texture must survive a 0.2 mm layer and a 0.4 mm nozzle without
becoming an overhang or a sliver.

For the BOSL2 `texture()` route (built-in patterns, `tex_size`, `tex_inset`,
`tex_taper`), see [`bosl2.md`](./bosl2.md); the full module list is in
[`catalog.md`](./catalog.md#surface-textures--texturesmd).
