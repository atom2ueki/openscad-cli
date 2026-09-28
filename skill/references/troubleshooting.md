# Troubleshooting

Find the `code` in `diagnostics[]` and read the matching section. Codes are
stable across engine versions; message text is not.

## The build did not start

**Exit code 3 — engine unavailable.**
```bash
openscad-cli doctor
```
The `doctor` output lists every location searched. Install with
`brew install atom2ueki/tap/openscad-cli`, or point `OPENSCAD_ENGINE` at an
OpenSCAD executable. On macOS a manual install lives at
`/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD`.

**Exit code 2 — usage error.** An unknown flag, or a missing input file. Run
`openscad-cli --help`. Note that unknown flags are rejected rather than
ignored, on purpose: a silently dropped `--max-dim` would ship an unprotected
model.

**Exit code 6 — internal error.** A bug in this CLI. Re-run with
`OPENSCAD_CLI_DEBUG=1` for a stack trace, and please report it.

**Exit code 5 — timeout.** The model is too expensive. Lower `$fn`, reduce the
`for` loop, cut `linear_extrude` `slices`, or raise `--timeout`. If it is
genuinely a large model, `--backend manifold` is usually an order of
magnitude faster than the default for booleans on large meshes.

## Nothing was produced

**`geometry.empty` — the model produced no geometry.**
The single most common cause is a conditional that evaluated false, often
because a `-D` value fell outside the range you expected. Check the `echo`
output and the values in `input.defines`. Second most common: a subtraction
removed everything it touched.

**No output file and no diagnostics.** Confirm the engine actually ran with
`--verbose`; a zero-byte output usually means the exporter failed rather than
the model being empty.

## The model is wrong

**`syntax.parse` / `syntax.unparsable` — the file did not parse.**
Nothing in the file was evaluated, so errors after the first one are usually
artifacts. Fix the first, re-run. Common causes: an unbalanced parenthesis, a
missing `;`, a missing operator between two expressions.

**`name.unknown` — a variable used before it was defined.**
Declare it at the top, or give it a default so `-D` can supply it. Remember
that OpenSCAD variables are immutable within a scope: a second assignment to
the same name produces a warning and is ignored.

**`module.arguments` / `module.arity` — the call does not match the signature.**
Add the parameter to the module, or fix the name at the call site. Positional
arguments are allowed; mixing them with named ones is legal but error-prone.

**`value.redefined` — a value is being replaced.**
Expected when you intentionally compute in stages; use `let` or a new name.
If you did not expect it, you have two assignments in one scope.

## Valid mesh, wrong shape

None of these produce a diagnostic, because the mesh really is valid. You find
them by measuring.

**The model is right but the size is not.** A `-D` value that did not apply, or
applied as a string. Check `input.defines` in the result JSON, and re-check
that the dimension actually reaching the geometry is the one you think.

**Curves are all but flat, or angles are wrong.** Check the trig convention.
This engine's `sin`/`cos`/`tan`/`asin`/`acos`/`atan` work in **degrees** while
`PI` is still pi, so any `cos(radians(x))`-style code returns a value very close
to 1 and every derived angle collapses. Confirm with
`echo(cos(180), acos(0.5));` — `-1, 60` means degree-trig. A degree-trig mistake
does not look like an error; it looks like a model that is slightly too small.
See `references/language.md` for the wrapper pattern.

**A volume that does not match the arithmetic.** Compute what the dimensions
imply and compare. A wall that should be 2 mm and measures 0.4 mm is a dimension
that collapsed, not a meshing problem.

**A feature that measures differently at different heights.** A cylinder in the
wrong place, a taper in the wrong direction, or cutters that were unioned
despite sharing a surface. Section the mesh at several z heights and compare.
Non-constant cross-section on a part that should be prismatic is the signature
of a coincident-face boolean: the kernel resolved the ambiguity its own way and
reported `status: "ok"`.

**A hole that is chamfered on one end only, or not at all.** Check where the
cone actually sits. A cone whose wide end is at the face and whose narrow end
is at depth cuts material; reversed, it sits outside the part and cuts nothing
while still exporting cleanly.

**Nothing at all, exit 1, no diagnostic on a 2D export.** The engine does not
project a 3D model for `--format dxf`. Add a `mode = "3d" | "2d"` switch and
render flat geometry in 2D mode, ideally built from the same profile module the
3D body extrudes so the two cannot disagree.

## The mesh is wrong

**`geometry.nonmanifold` — not a valid closed solid.**
Slicers will reject this. Almost always a boolean where two shapes touch
exactly along a face or edge instead of overlapping. Nudge the cutter so it
overlaps, or add a tiny epsilon. Also check for a `minkowski` whose operands
are large — it is the usual source of stray faces.

**`verify.not_closed` — the surface has holes.**
The signed volume came out near zero against a non-zero bounding box, which
means the surface does not close. Same root cause as `geometry.nonmanifold`.

**`geometry.degenerate` / `verify.degenerate` — zero-area triangles.**
A dimension reached zero, or a subtraction reduced a surface to nothing. A
common instance: `cube([w, h, 0])` because a parameter was out of range.

**`verify.sliver` — very thin triangles.**
A boolean that only grazed a surface. Nudging the offset by 0.01 usually
removes them. Harmless for printing, but they slow slicers.

Two causes worth recognising, because they scale with the model's detail and so
get worse the more carefully you draw something:

- *Duplicate vertices.* A `polygon()` whose point list repeats a point leaves a
  zero-length edge, and a zero-length edge triangulates into a sliver. It
  happens easily when two generated point runs share an endpoint — generate the
  tip land so it excludes both ends, or the first flank point.
- *A profile chord grazing a disc.* Closing a tooth profile exactly on the root
  circle leaves its closing chord skimming that surface. Start the profile well
  inside the disc instead and let the union do the work.

Raising the sampling density can make this worse rather than better: more points
along a tightly curved region means more slivers, not fewer.

**`geometry.triangulation` — part of the model did not triangulate.**
Raise `$fn`, or round the offending edge slightly. Check for coincident or
zero-thickness regions first.

**`verify.too_large` / `verify.too_many_triangles`.**
You asked for this with `--max-dim` or `--max-triangles`. Scale the model, or
raise the limit if the size is intended.

**Wrong bounding box.** Usually a child that escaped a `difference()` or was
never clipped — check for a missing `translate([0,0,-1])` on an extrude that
should be cut.

## Files and libraries

**`resource.missing` — a file could not be opened.**
Paths resolve relative to the **`.scad` file**, not the working directory. If a
model works when you run it from one directory and not another, this is why.
`include <relative.scad>` works; a bare `include <scad>` needs `OPENSCADPATH`
or an absolute path.

**`resource.library` — a library did not resolve.**
Prefer `use<>` over `include<>`: `include` executes the file's top-level
geometry, which both pollutes the result and makes error line numbers
meaningless. The bundled MCAD library is found through `OPENSCADPATH`; run
`doctor` to see whether it was located.

**`resource.network` — an `include <https://...>` failed.**
Network access at render time is fragile in sandboxes and CI. Vendor the file
locally instead.

**`resource.font` — `text()` could not resolve a font.**
Pass an explicit `font="<family>:<path>"`, or install the font. Font
resolution is machine-specific, so keep `text()` out of byte-comparison tests.

## Results look stale

The cache is dependency-aware, not just input-aware: it re-hashes every file
the engine reported through `-d`, so editing an `include`d library
invalidates the result. If you suspect staleness anyway, check
`cache.hit` in the result, or pass `--no-cache` to force a fresh render.

## Exit code 4 — validation failed

Only produced under `--strict`, when a warning was promoted to an error, or
when `--max-dim` was exceeded. The diagnostics array holds the reason. Run
without `--strict` to see the same run succeed with `status: "warn"`.
