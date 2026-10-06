# Threaded containers

A flush threaded container and lid: the lid's outside diameter equals the body's
outside diameter, and the threaded neck is recessed below the body wall so the
lid screws on flush.

Two implementations of the same design, pick by whether you already depend on
BOSL2:

| | upstream file | approach |
|---|---|---|
| no library | `parts/threads.scad` | hand-built helical thread from hulled slices |
| BOSL2 | `bosl2/threads.scad` | `trapezoidal_threaded_rod()` + `$slop` |

## The design in one paragraph

Body outer radius `outer_radius`. The lid's bore is `outer_radius - wall`. The
male thread's crest sits `clearance` inside that bore, and the neck below it is
narrower still by `thread_height`, so the body's outer wall steps *in* to the
neck and the thread never exceeds the lid's bore. The thread is deliberately
embedded into the neck radially and axially (`thread_overlap`), because the
first turn of a helix has near-zero width and cannot carry the thread base on
its own.

## The trapezoidal profile

`thread_profile(thread_height, thread_z)` returns six points — flat crest, flat
root, inward taper:

```openscad
function thread_profile(thread_height, thread_z) = [
    [0,                    -thread_z / 2],
    [thread_height * 0.35, -thread_z / 2],
    [thread_height,        -thread_z * 0.25],
    [thread_height,         thread_z * 0.25],
    [thread_height * 0.35,  thread_z / 2],
    [0,                     thread_z / 2]
];
```

`thread_height` is the **radial** height and `thread_z` the **axial** ridge
thickness — both direct measurements. Build the helix by placing that profile as
a thin slab at angle θ and height z, then `hull()` consecutive slabs:

```openscad
for (i = [0 : steps - 1]) {
    theta0 = i * 360 * turns / steps;   theta1 = (i + 1) * 360 * turns / steps;
    z0     = i * height / steps;        z1     = (i + 1) * height / steps;
    hull() {
        thread_slice(theta0, z0, radius, thread_height, thread_z);
        thread_slice(theta1, z1, radius, thread_height, thread_z);
    }
}
```

One slice: `translate([0,0,z]) rotate([0,0,theta]) translate([radius,0,0])
rotate([90,0,0]) linear_extrude(height=0.001) polygon(thread_profile(...))`.

`steps = max(16, round(turns * 32))`, `turns = height / pitch`. **Do not** sweep
the profile with `linear_extrude(twist=)`: that scales the tangential offset by
`pitch / (2*pi*radius)`, so neither dimension stays what you measured.

## Parameters that matter

Defaults from `parts/threads.scad`:

| Parameter | Default | Meaning |
|---|---|---|
| `outer_radius` | 20 | body and lid outside radius |
| `wall` | 2 | lid bore = `outer_radius - wall` = 18 |
| `body_height` / `lid_height` | 30 / 12 | |
| `pitch` | 3 | one turn per 3 mm |
| `thread_height` | 2 | radial height of the thread |
| `thread_z` | 1.8 | axial thickness of the thread ridge |
| `thread_turns` | 2.5 | → `thread_length = pitch * thread_turns` = 7.5 |
| `clearance` | 0.30 | male thread sits this far inside the lid bore |
| `thread_overlap` | 0.30 | radial + axial embed of the thread base into the neck |
| `edge_pad` | 0.25 | cutter overshoot so no face is coincident |
| `chamfer` | 1 | 45° leg on body and lid rims |

BOSL2 variant swaps `thread_height`/`thread_z` for `thread_depth = 2` +
`thread_angle = 30` + `$slop = 0.15`, and gets grip ribbing from the built-in
`texture = "trunc_ribs"` instead of a hand-rolled `lid_ribbing()`.

## Gotchas the upstream comments call out

- **Overlap the thread base.** Without `thread_overlap`, the helix's first turn
  is a sliver and the base is held by a razor-thin seam that renders
  non-manifold. `parts/threads.scad` translates the thread to
  `thread_start - thread_overlap` and adds `thread_overlap` to both its height
  and its radial height.
- **The cavity must narrow before the neck.** A single bore of
  `outer_radius - wall` would hollow the recessed neck and the thread (crest
  radius < bore). Use two bores: `outer_radius - wall` down to
  `thread_start`, then `neck_radius - wall` for the rest.
- **Enlarge the internal cutter for clearance and lead-in**, rather than
  shrinking the male thread: radius `neck_radius + clearance`, axial
  `thread_z + 0.25`, and start it `pitch * 0.20` below the lid's opening so the
  thread reaches flush with the rim.
- **Push the shoulder ramp `edge_pad` into the neck.** A ramp whose top face is
  exactly coincident with the neck renders as a dark non-manifold line.
- **Cut chamfers at `radius + edge_pad`.** On the ribbed lid, a chamfer that
  exactly grazes the rib peaks leaves tangent-face artifacts at the seam.
- **Stop the grip ribs short.** `height - 2*chamfer - 2*rib_height` keeps their
  flat ends inside the rounded rings instead of poking through.
- **Anchor the lid's internal thread to the opening rim**, not the closed
  bottom; otherwise it does not reach the rim and the lid will not start.
- `chamfer_cut(radius, z, size, flip)`: `flip = false` removes material *above*
  `z` (bottom edge), `flip = true` removes material *below* `z` (top edge).

## As a starting point

Copy `parts/threads.scad` when the project must not depend on BOSL2, and
`bosl2/threads.scad` when it already does. Re-scale `outer_radius`, `wall`,
`body_height`, `lid_height` and `pitch`; leave `clearance`, `thread_overlap`,
`edge_pad`, `thread_z` and the two profile ratios alone unless you are prepared
to re-measure the fit. Upstream chose `$fa = $preview ? 8 : 1` with
`$fs = $preview ? 1 : 0.1` for this part — a thread is one of the few shapes
where the coarse preview default is visibly faceted.

The full module list, with every parameter and default, is in
[`catalog.md`](./catalog.md#threaded-containers--threadsmd).
