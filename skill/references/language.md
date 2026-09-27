# OpenSCAD language, for agents

A practical subset — enough to write a correct model on the first try.

## Structure

```openscad
// comment
/* block comment */
x = 10;                      // assignment
y = "text";                  // string
z = [1, 2, 3];               // vector
m = [[1,0],[0,1]];           // matrix

module thing(a, b = 5) { ... }   // module, with a default
function twice(n) = n * 2;      // function (single expression)
```

A module that is never *called* does nothing. Top-level module instantiations
are what produce geometry.

## Control flow

```openscad
if (cond) { ... } else { ... }
for (i = [0:9])            { ... }   // inclusive range
for (i = [0:2:20])         { ... }   // with step
for (i = [0:0.5:2], j = [0:3]) { ... }
let (n = 5) expr                   // scoped temporary
each                                 // iterate a list
```

**Variables cannot be reassigned inside the same scope.** The first assignment
wins and a later one produces a warning. To compute something new, use a new
name or a `let`.

```openscad
w = 10;
w = 20;                 // WARNING: the model uses 10
let (w2 = w * 2) ...    // correct
```

## Primitives

```openscad
cube(size, center=false);                 // size is a number or [x,y,z]
sphere(r = 10, $fn = 64);
cylinder(h = 20, r1 = 5, r2 = 2, center = false, $fn = 64);  // r = r1
square(10, center = false);
circle(r = 5, $fn = 64);
polygon(points, paths = [[0,1,2]], convexity = 10);
polyhedron(points, faces, convexity = 10);
text("HELLO", size = 10, font = "Sans:bold", halign = "center");
```

## Resolution

```openscad
$fn = 64;        // fixed number of segments (everywhere in scope)
$fa = 5;         // minimum face angle in degrees
$fs = 0.5;       // minimum fragment size
```

- `$fn` is exact and predictable — good for small parts and visible fillets.
- `$fa`/`$fs` scale automatically: few segments on big shapes, many on small
  ones. Prefer them for large curved parts.
- A value set on a module call applies to that call's children only.

## Transformations

```openscad
translate([x, y, z]) child();
rotate(a)            child();   // degrees about Z
rotate([x, y, z])    child();   // degrees about each axis, applied X then Y then Z
scale(v)             child();   // v may be a scalar or [x,y,z]; negative mirrors
mirror([1, 0, 0])    child();
resize(newsize, auto = false) child();
color("red", 0.5)    child();
offset(r = 1, $fn = 64) child();   // 2D: grow or shrink
hull()  { children(); }            // convex hull of all children
minkowski() { children(); }        // slow; keep the operands tiny
```

## Trigonometry

**`sin`, `cos`, `tan`, `asin`, `acos` and `atan` take and return DEGREES on this
engine, while the `PI` constant is the radian pi.** Stock OpenSCAD uses radians
for both. This is the single most damaging difference between the two, because
nothing reports it: the model renders, the mesh is watertight, and the shape is
wrong.

```openscad
echo(cos(180), cos(360), sin(90), acos(0.5));
// this engine:     -1,  1,        1,       60
// stock OpenSCAD:  -0.59846, -0.283691, 0.893997, 1.047198
```

`rotate`, `$fa`, `$fs` and everything else angle-shaped were always degrees and
are unaffected — only the trig functions moved.

Write the model in radians and convert at the boundary:

```openscad
TRIG_DEGREES = true;                // false for stock OpenSCAD
function to_engine(a)   = TRIG_DEGREES ? a * 180 / PI : a;
function from_engine(a) = TRIG_DEGREES ? a * PI / 180 : a;
function sin_r(a)  = sin(to_engine(a));
function cos_r(a)  = cos(to_engine(a));
function tan_r(a)  = tan(to_engine(a));
function acos_r(x) = from_engine(acos(x));
```

Angle-only formulae are the trap. The involute function `tan(a) - a` is only
valid in radians, and the wrapper does not save you: `tan(to_engine(a)) - a`
converts only the first term, and `tan(to_engine(a)) - a` is the correct form
while `tan(a) - a` is not. Degrees in one term and radians in the other looks
entirely reasonable and is not.

## Boolean operations

```openscad
union()       { children(); }   // all of them
difference()  { children(); }   // first minus the rest
intersection(){ children(); }   // all of them
```

Two distinct touching problems, opposite in cause:

- A cutter that only *touches* the target along a face or an edge has no
  overlap to cut, so the result is non-manifold. Nudge the cutter so it
  genuinely overlaps — extend it 1 mm past each face, which is what the
  `translate([0,0,-1]) cube(...)` idiom in the tray example does. A cutter
  positioned entirely outside the part is the same mistake taken further: it
  cuts nothing, and the parameter that was supposed to matter does nothing.
- Two *cutters* that share a surface exactly should not be `union`ed with each
  other. Union the bore cylinder and a chamfer cone narrowing to the same bore
  radius and their coincident faces have no unambiguous answer; the result is a
  valid-looking mesh whose bore is neither straight nor chamfered. List them as
  separate children of `difference()` instead, so each is subtracted
  independently.

## Extrusion

```openscad
linear_extrude(height = 10, center = false, twist = 0, slices = 10, scale = 1)
rotate_extrude(angle = 360, $fn = 64)
projection(cut = true)
```

- `linear_extrude` scales a 2D shape as it rises when `scale` is given, and
  twists it when `twist` is given. `slices` controls the vertical resolution;
  leave it low unless you are printing a twist.
- `rotate_extrude` requires the 2D shape to sit entirely in `x >= 0`.
- `projection(cut = true)` flattens a 3D shape along Z.

## Lists and functions

```openscad
xs = [for (i = [0:4]) i * i];          // [0, 1, 4, 9, 16]
pts = [[x, 0] for (x = [0:10:2])];
a = len(xs);                           // 5
b = concat([1], [2, 3]);               // [1, 2, 3]
c = lookup(1.5, [[0,0],[2,10]]);       // 5
d = str(42, " ", [1,2]);               // "42 [1, 2]"
e = norm([3, 4]);                      // 5
f = cross([1,0,0], [0,1,0]);           // [0,0,1]
```

Common functions: `abs sin cos tan atan2 asin acos floor ceil round min max
sqrt pow exp ln log sign` and the list forms `min([..]) max([..]) sum concat
sort reverse`.

Type tests: `is_undef(x) is_num(x) is_string(x) is_list(x) is_bool(x)`.

## Includes and imports

```openscad
include <MCAD/gears.scad>      // textually inlines: runs its top-level code
use <MCAD/gears.scad>          // only exposes modules and functions — prefer this
include <relative/file.scad>   // relative to THIS file, not the working directory
import("model.stl");           // loads a mesh
import("plate.svg");            // loads a 2D shape
import("heightmap.png");       // a greyscale height field for surface()
```

## Customizer parameters

```openscad
/* [Size] */
width = 60;   // [20:1:120]
tall  = true; // checkbox
label = "v1"; // text field
```

These comments are what `variants --param` and the `-p` preset files drive.
Give every dimension a range.

## Things that quietly do nothing

- A module defined but never called.
- A variable used before its assignment.
- `if (false)` from a `-D` value that fell outside the intended range.
- A subtraction that removed everything (you get `geometry.empty`).
- `include` of a file whose top-level code produced geometry you did not want.
- A cutter positioned entirely outside the part it was meant to cut.
- A chamfer or fillet whose cone runs to the wrong end, so it clears the
  material instead of biting into it.
- `cos(angle)` computed under the wrong convention — still a number, still a
  valid mesh, wrong shape.
- A 2D export from a 3D-only model: the engine exits 1 and prints nothing.
