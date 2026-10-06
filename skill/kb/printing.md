# Rules for parts that print reliably

Distilled from the design notes of the upstream corpus
([`jhermann/things`](https://github.com/jhermann/things),
`.github/skills/3d-modelling/design-principles.md` and
`.github/copilot-instructions.md`). These are process rules, not OpenSCAD
syntax — they decide whether the part you model survives the slicer.

## Wall thickness and corners

- **Never model a wall below 1 mm.** A 0.4 mm nozzle needs two passes to make a
  structural wall; 0.8 mm is the floor, 1 mm with side extrusion is reliable.
- **Add material, do not hollow.** A thin shelled box is weaker and slicer-
  dependent; a chunky wall with honeycomb infill is not.
- **Fillet or chamfer every vertical edge.** A sharp 90° corner stops the
  printhead, kills acceleration and shows on the outer surface. Use
  `rounding=`/`chamfer=` on BOSL2 primitives, or `offset()` a 2D profile before
  extruding.
- **No feature thinner than the layer height (0.2 mm).** A 0.1 mm chamfer is not
  reproduced; it is noise in the mesh.

## Overhangs and supports

- **A horizontal ledge needs a support; a chamfer does not.** Under any
  protrusion, replace the flat underside with a 45° chamfer.
- **Design your own support when you must.** `parts/support-fin.scad` is a
  parametric triangular gusset with tines: minimal bed contact, snaps off by
  hand. On the upstream cube test it cost 1.85 g for two fins against a 9.98 g
  part (15.6 % of the total) — cheaper than slicer support and it leaves a
  clean surface.

## First layer and bed contact

- **Simplify the first layer.** No text, no fine detail, no sharp corners on
  the bottom face; a round footprint adheres most reliably.
- **Minimise bed contact** if the part is printed in a batch: standing a box on
  a 45° edge instead of a face removes a large flat footprint and a surface
  finish you would have to hide.

## Tolerances and press fits

- **Never tune the fit in the slicer.** Shrinkage varies by colour, brand and
  machine; a gap you dial in for one spool is wrong for the next.
- **Put a lead-in on every mating edge** — a chamfer or a wedge gives the press
  fit several starting dimensions instead of one.
- **Prefer compliance to clearance.** Thin walls, slotted corners and grip fins
  (`parts/joining/grip-fins.scad`) absorb the printer's variation; a rigid bore
  plus a nominal pin does not.
- **0.3 mm minimum gap for any moving or compliant joint** that must print
  separate. Below that the two surfaces fuse.
- **0.2 mm is the working fit tolerance** the corpus uses for parts printed to
  fit each other (see `parts/threads.scad` `clearance = 0.30` for a threaded
  pair, `parts/mechanisms/hinge.scad` `tolerance = 0.25`).
- **Overlap cutters; do not just touch them.** A subtractive solid that shares
  a face with its target produces a coplanar CSG artifact. The corpus idiom is a
  small `edge_pad`/`epsilon`/`clearance` (`0.25`, `0.05`, `0.3`) added to the
  cutter so it crosses the surface instead of grazing it. This is the same rule
  `SKILL.md` states as "keep cutters overlapping the target".

## Surface finish

- **Do not buy resolution to hide layer lines.** Apply a texture instead:
  `parts/textures/` has knurling, ribbing, waves, diamonds, stippled bumps and
  organic ripples; each is a formula over the wall, not a finer mesh.

## Print-in-place mechanisms

- **All load must be in-plane with the layer lines.** A spring, hinge or snap
  that bends across layers delaminates — the layers "unzip". This is the single
  rule that decides whether a printed mechanism survives.
- **Circular/toothed flexures beat living hinges.** A thin flap fatigues in
  tens of cycles; a circular hinge
  (`parts/mechanisms/hinge.scad`) spreads the same strain over a larger
  surface and springs back.
- **Axles print horizontally, or as cones.** A conical pivot
  (`hinge.scad`: `outer_diameter` cone over `inner_diameter` tip,
  `tolerance = 0.25` clearance) locks the two halves together while printing
  them apart, with no assembly step.
- **Do not print a helical coil spring.** Its turns are stacked across layers
  and split under load. Model springs as a flat profile extruded in-plane —
  `parts/springs/` is six variations of exactly that.
- **Stiffness is a dimension, not a material.** Band width and band thickness in
  the print plane set spring rate; the extrusion height sets strength. Springs
  go down to 1 mm thick for soft deflection and get thicker for stiffness.
- **Snap fits need a ramp and a return catch.** `parts/springs/snap-fit.scad`
  is the reference: cantilever finger, ramped barb, hinged bars.

## Modelling conventions the corpus standardises on

- Millimetres, always. One variable per dimension, derived values computed once
  from the parameters rather than repeated as literals.
- BOSL2 designs start with `include <BOSL2/std.scad>`.
- User-facing parameters go first in `/* [Section] */` blocks with the customizer
  range in the trailing comment (`wall = 2; // [1:0.2:6]`), and derived values
  go under `/* [Hidden] */`. MakerWorld's Parametric Model Maker reads these
  annotations.
- `$preview` makes the interactive preview coarse and the final render smooth:
  `$fa = $preview ? 16 : 2; $fs = $preview ? 2 : 0.2;`. Models that need a fixed
  quality expose `$fn` as a parameter instead. Preserve whichever style the file
  already uses.
- Compose the final shape from named feature modules with explicit CSG; put the
  assembly at the end of the file.
- Reusable parts must render a useful default scene without arguments — they are
  what the tiled previews show.
