# Joining printed pieces

Five primitives for putting separately printed parts together. All are BOSL2
except `vertical-sturdy-plug.scad`, which is plain OpenSCAD.

| Primitive | File | Job |
|---|---|---|
| square dowel | `parts/joining/square-dowel.scad` | chamfered flat bar + snap bumps, two half-cubes sandwiching it on the diagonal |
| dovetail | `parts/joining/dovetail.scad` | self-supporting slide-in joint, cut in place into an existing object |
| heat-set insert | `parts/joining/heat-insert.scad` | bore plus concentric slit rings that add perimeters to the boss |
| grip fins | `parts/joining/grip-fins.scad` | inward-flexing fins around a hole, for a friction hold |
| tapered plug | `parts/joining/vertical-sturdy-plug.scad` | ribbed tapered plug into a straight-walled hole |

Two rules from `parts/joining/README.md` apply to all of them:

- **A slot on a side face must print vertically**, so its overhangs never exceed
  45°; a slot on the top or bottom face should be rotated 45° to stay far from
  the object's sides.
- **The dovetail cutter is applied to an existing object and only splits it** —
  it does not change the object's outer dimensions.

## Dovetail — the flank geometry is the trick

The path is six points: a flat flange track along the face, in to the neck, down
to the base, and mirrored back.

```openscad
w_neck = width + 2 * tolerance;
w_base = w_neck + 2 * depth;   // base widens 1 mm per 1 mm of depth => exactly 45°
```

The cutter is **the stroke, not the path** — the clearance kerf *is* the line
width:

```openscad
smooth_path = round_corners(dt_path, radius=1.5 * chamfer, closed=false);
linear_extrude(height=3 * object_thickness + tolerance, center=true)
    stroke(smooth_path, width=dovetail_gap, closed=false);
```

A dovetail that widens 1:1 is self-supporting at 45° whether it prints as a slot
or a rail — no supports either way.

**Upstream wart:** `angle = 45` is a parameter of
`dovetail_flanged_wall_path()` but is never used; the 45° comes from
`w_base - w_neck = 2 * depth`. Changing `angle` does nothing.

## Heat-set insert — slit rings, not a bigger boss

A heat-set insert needs plastic around the bore. Instead of thickening the wall,
the cutter adds **concentric rings of short radial slits** which the slicer turns
into extra perimeter paths:

```openscad
for (ring = [0 : concentric_rings - 1])
    zrot(360 / slits_per_ring / 2 * ring)          // half-pitch offset per ring
        zrot_copies(n=slits_per_ring, r=diameter / 2 + ring * ring_pitch + 2.5 * tolerance)
            up(slit_end_clearance)
                cuboid([slit_length, slit_width, depth - 2 * slit_end_clearance], anchor=LEFT);
```

Slits stop `slit_end_clearance` short of both faces so they stay enclosed
instead of opening the top. Note the ring radius adds **2.5 × tolerance**
(0.5 mm upstream), not one.

**Upstream wart:** the README quotes a 4.7 mm × 15 mm insert, but the source
default is `hole_depth = 6` (slider 5–30). Set `depth` from your actual insert.

## Grip fins — compliance instead of clearance

A ring of rounded fins that flex inward against an inserted pin. Count and size
come from the hole, not the other way round:

```openscad
fin_thickness = 1.5 * layer_height;                          // 0.3 mm
fins          = floor((2 * PI * radius) / (2.5 * fin_thickness));
fin_extend    = fin_size * (1 - cos(angle));                 // angle = 75

offset_sweep(circle(radius), height=depth,
             top    = os_chamfer(width=-chamfer),            // negative = outward lip
             bottom = os_chamfer(width=-fin_extend),
             anchor = TOP);

down(depth / 2) zrot_copies(n=fins, r=radius - tolerance)
    zrot(angle) cuboid([fin_size + tolerance, fin_thickness, depth],
                       anchor=LEFT, rounding=layer_height / 2);
```

Fins are placed at `radius - tolerance` and built `fin_size + tolerance` long,
so they start inside the wall and push inward — a `+tolerance`/`-tolerance`
pair that guarantees the fin roots fuse with the wall.

## Tapered plug — interference at depth, ease at entry

The plug grows from tip to base while the hole stays straight:

```openscad
plug_tip_radius  = plug_radius - plug_variance / 2;   // 4.875
plug_base_radius = plug_radius + plug_variance / 2;   // 5.125
hole_radius      = plug_radius + hole_clearance;      // 5.05
```

So entry is 0.175 mm loose and full insertion is 0.075 mm *interference* — the
part tightens as it goes in, which is what makes it hold. Three more features
carry the design:

- **Ribs cut halfway into the wall** (`rib_radius = 0.5 * plug_wall_thickness`,
  10 of them) add perimeters and let the wall flex, and stop `chamfer_size`
  short of the base so they do not break the base chamfer.
- **A cross-shaped hollow** through the plug and into the parent cuboid adds
  walls and protects the joint from separating.
- **Chamfers at both ends**: hull-built bottom perimeter chamfer on the
  cuboid (`chamfer_size = plug_wall_thickness / 3`) and a `r1 → r2 =
  hole_radius + chamfer_size` cone at the hole rim, to guide entry.

Recommended print settings upstream: Arachne walls, gyroid infill.

## Square dowel

A chamfered flat bar (`cuboid([...], chamfer=dowel_chamfer, edges=[TOP,BOTTOM])`)
that slides into a groove cut by the bar's own profile, tipped 45° onto a corner
and swept corner-to-corner across a half-cube:

```openscad
groove_length = cube_size * sqrt(2) + dowel_size;
slot(angle) = up(half_height) zrot(45 + angle) xrot(90) down(dowel_thickness / 2) zrot(45)
                  square_dowel(edge_gap);
```

Two spheroid bumps on opposite corners (`protrude = .75 * dowel_chamfer + gap`,
`bump_diameter = 1.5 * dowel_thickness`) poke past the face and snap into the
matching groove. `square_dowel()` is wrapped in `union()` so it can be used
directly inside a `difference()`.

Upstream module-level defaults: `dowel_size=10`, `dowel_thickness=3`,
`dowel_chamfer=.75`, `cube_size=25`, `edge_gap=0.15`.

## Catalogue

Every module, parameter and default: [`catalog.md`](./catalog.md#joining-printed-pieces--joiningmd).
