---
name: openscad-cli
description: >-
  Build, validate and export parametric 3D-printable and laser-cuttable models
  with the OpenSCAD engine through the openscad-cli command. Use this whenever
  the task involves designing a physical part, a 3D-printable object, a
  machined component, a bracket or enclosure, a 2D plate for laser cutting, a
  mesh format conversion, or a batch of size variants — or when the user wants
  to iterate on a `.scad` model until it renders cleanly.
license: GPL-2.0-or-later
metadata:
  version: "0.1.0"
---

# openscad-cli

Design parametric parts in OpenSCAD and compile them to fabrication output.
Every command returns **JSON on stdout** so you can branch on structured
results rather than scraping text.

## Running the CLI

The command is `openscad-cli`. If it is not on your `PATH`, the launcher is at:

```
~/.local/bin/openscad-cli
```

It needs no environment setup — it locates Node.js and the OpenSCAD engine
itself. Run `openscad-cli doctor` first; exit code 0 means everything is ready.
If it exits 3, the output lists every location searched and what was missing.

Everything is also available as absolute paths if you prefer:

- project: `~/Documents/sph/openscad-cli`
- launcher: `~/.local/bin/openscad-cli`
- engine:   set via `$OPENSCAD_ENGINE` (the launcher supplies a default)

The engine is the official OpenSCAD nightly, used headlessly. **PNG and
interactive preview do not exist** — that is a property of the engine, not a
missing feature here.

## The loop

1. **Check the environment once.** `openscad-cli doctor` — exits 0 when ready.
2. **Write the model** as a `.scad` file, with the dimensions the user cares
   about as top-level variables so they can be overridden.
3. **Validate first, export second.** `openscad-cli validate model.scad` is
   fast and writes nothing. Fix every reported diagnostic.
4. **Build.** `openscad-cli build model.scad -o part.stl`.
5. **Read the result JSON.** Check `status`, `diagnostics`, and
   `stats.volume` / `stats.boundingBox`. A `warn` is still a successful build.
6. **Iterate** by changing the model, not by hand-editing the mesh.

## Commands

| Goal | Command |
|---|---|
| Render a mesh | `openscad-cli build m.scad -o part.stl` |
| Override dimensions | `openscad-cli build m.scad -D width=80 -D wall=3` |
| Check without writing | `openscad-cli validate m.scad` |
| Size variants | `openscad-cli variants m.scad --param width=40,60,80 --out-dir out/` |
| 2D for laser cutting | `openscad-cli build m.scad -o plate.dxf --format dxf` |
| Format conversion | `openscad-cli convert m.scad -o part.3mf --format 3mf` |
| See variables/messages | `openscad-cli inspect m.scad --echo` |
| Engine capabilities | `openscad-cli info` |
| Anything unlisted | `openscad-cli raw -- <engine-args>` |

Formats: `stl` (default, always binary) `off` `obj` `wrl` `3mf` for meshes;
`dxf` `svg` `pdf` `pov` for 2D; `csg` `ast` `echo` `param` for inspection.

## Reading the result

```json
{
  "status": "ok | warn | error",
  "outputs": [{ "format": "stl", "path": "part.stl", "bytes": 13284 }],
  "stats": { "triangles": 224, "volume": 1000, "area": 700, "boundingBox": { "size": [20, 10, 5] } },
  "diagnostics": [{ "severity": "warning", "code": "geometry.nonmanifold",
                    "message": "...", "file": "m.scad", "line": 12, "hint": "..." }],
  "echo": ["w=60"],
  "cache": { "key": "sha256:...", "hit": false }
}
```

`diagnostics[].code` is stable; branch on the code, never on the message text.
Every diagnostic carries a `hint`. The codes that matter most:

- `geometry.nonmanifold` — not a valid closed solid; **slicers will reject it**
- `geometry.degenerate` — a region collapsed to zero thickness
- `verify.not_closed` — the surface has holes
- `geometry.empty` — the model produced nothing (check `if` conditions and `-D` values)
- `name.unknown` — a variable was used before it was defined
- `syntax.parse` — fix the first parse error; nothing after it was evaluated
- `resource.missing` — a referenced file could not be opened

Exit codes: `0` success, `1` model error, `2` bad invocation, `3` engine
missing, `4` validation failed under `--strict`, `5` timeout, `6` internal error.

## Rules that will save you

**Variables are immutable within a scope.** Reassigning in the same scope
produces a warning; the *first* assignment wins. Use `is_undef(x)`, never
`x == undef`, to test for a missing value.

**Use `use<>`, not `include<>`.** `include` textually copies the file and
executes its top-level geometry, which both confuses error line numbers and
pollutes the result. `use` exposes modules and functions only.

**`-D` values are OpenSCAD expressions, not strings.** Write `-D w=60` for a
number and `-D 'label="ACME"'` for a string — the inner quotes are part of the
expression. Never wrap the whole thing in shell quotes twice.

**Mesh exports always evaluate the full geometry.** `--render` only affects
image output, which this CLI does not do. A plain build is always a real mesh.

**STL is binary by default here.** Do not add `--export-format asciistl`; if a
downstream tool needs ASCII, convert it afterwards.

**Validate before you declare success.** A zero exit code with `status: "warn"`
can still mean an unprintable mesh. Check `diagnostics` for `geometry.*`.

**Set `$fn` deliberately.** The default is too coarse for a curved surface and
too slow for a big one. `$fn=64` is a good default for a visible fillet;
`$fa`/`$fs` are better for large curved parts.

**No PNG.** This engine is built headless, so image rendering and the
interactive preview do not exist. If the user asks to see the model, export
the mesh and offer to inspect the numbers, or hand them the `.scad` to open in
OpenSCAD themselves.

## Writing a good model

```openscad
// [Overall size]
width  = 60;   // [20:1:120]   total width in mm
depth  = 40;   // [10:1:80]
height = 12;   // [4:1:40]
wall   = 2.4;  // [1:0.2:6]    wall thickness; keep >= 3 nozzle widths

module tray() {
    difference() {
        cube([width, depth, height], center = true);
        translate([0, 0, -1])
            cube([width - 2*wall, depth - 2*wall, height], center = true);
    }
}

tray();
```

Always give units (`[20:1:120]` in a `//` comment) — that is what makes the
model adjustable, and what `variants --param` then sweeps.

## References

- `references/language.md` — OpenSCAD syntax you will actually need
- `references/commands.md` — every flag, and what the JSON contains
- `references/design.md` — printability rules for real parts
- `references/troubleshooting.md` — every diagnostic code, cause and fix
