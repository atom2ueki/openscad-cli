# Design rules that produce printable parts

These are the constraints that decide whether a model is usable. OpenSCAD
will happily render a mesh that no printer can build.

## Walls

- Minimum wall: **3 nozzle widths**, or ~1.2 mm for a 0.4 mm nozzle. Below that
  the wall will not extrude reliably.
- A "wall" thinner than this usually means a dimension reached zero through a
  subtraction — that is what `geometry.degenerate` is telling you.
- Ribs and webs: 1.5 to 2 mm is usually enough for stiffness without adding
  much time.

## Overhangs

- Anything beyond 45° from vertical needs support.
- Self-supporting alternatives: chamfers, ribs, or a "T-slot" profile.
- A flat 20 mm roof needs support; a 45° chamfer does not.

## Holes

- A through-hole in a wall needs the cutter to extend **past** both faces.
  `-1` on each side is enough:

  ```openscad
  translate([x, y, -1]) cylinder(h = height + 2, r = r, $fn = 32);
  ```

- For bolts and heat-set inserts, follow the actual datasheet clearance. A
  common starting point: M3 clearance 3.2 mm, M4 4.3 mm, M5 5.3 mm.
- Chamfer the entry of a hole so the first layer is not a knife edge.

## Fit and tolerance

- Holes that a shaft passes through: make them 0.1 to 0.3 mm larger than the
  shaft.
- Holes that a screw head sits in: 0.2 to 0.5 mm clearance for a moving part.
- Snap fits need a real test print; a model that "looks right" in a slicer
  usually needs the interference reduced by 0.2 mm at a time.

## Print orientation and time

- A tall thin part is wasteful; orienting the longest dimension horizontally
  usually cuts the time dramatically.
- `stats.volume` divided by the printer's mm³/hour is a decent time estimate.
- A very high triangle count slows the slicer and bloats the file without
  improving the surface. Above roughly 100k triangles, check whether `$fn` is
  higher than it needs to be.

## What the CLI measures for you

| Number | Healthy value | When it is not |
|---|---|---|
| `stats.volume` | clearly positive, plausible for the part | near zero → hollow, or faces only touching |
| `stats.area` | large relative to volume for a thin part | tiny → the model is effectively empty |
| `stats.triangles` | enough for the curves, no more | very high → reduce `$fn` |
| `stats.degenerateTriangles` | 0 | any → faces collapsed to zero thickness |
| `diagnostics` | no `geometry.*` codes | `geometry.nonmanifold` → the mesh will not slice |
| bbox `size` | matches the intended envelope | much larger → a stray or un-clipped child |

## 2D output for laser cutting

- Keep cut lines on whole millimetres, or at least on a value your laser can hit
  exactly.
- Minimum feature width 1 mm for most lasers; 0.1 mm for a fine CO2 beam.
- Leave a 1 to 2 mm gap between parts so they do not fall out joined.
- Kerf compensation: for a snug hole, oversize the cut path by roughly the
  kerf. For a tab that must fit, undersize it.
- `offset(r = 0.1)` before cutting is often enough to clean up a path drawn
  with a coarser `$fn`.

## Checklist before declaring a part done

1. `validate` reports no errors.
2. `build` reports `status: "ok"`, or `warn` with only notes you accept.
3. No `geometry.*` or `verify.*` diagnostics.
4. `volume` is plausible for the envelope.
5. Every dimension the user cares about is a top-level variable with a range,
   so variants can be swept without editing the file.
