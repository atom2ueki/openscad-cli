# Command and flag reference

## Global options

| Flag | Meaning |
|---|---|
| `-D name=value` | Override a top-level variable. Repeatable. The value is an OpenSCAD expression, not a string. |
| `--format json\|text` | Output format. `json` is the default. |
| `--json` / `--text` | Shorthand for the above. |
| `--engine <path>` | Use a specific OpenSCAD executable. |
| `--timeout <seconds>` | Kill the engine after this long. Default 300. Exit code 5. |
| `--workdir <dir>` | Where to keep scratch state. Default: `.openscad-cli/` beside the output. |
| `--no-cache` | Ignore the cache and do not write to it. |
| `--no-verify` | Skip the independent mesh analysis. |
| `--strict` | Treat the first engine warning as fatal (`--hardwarnings`). |
| `--keep-workdir` | Keep scratch state even on success. |
| `--keep-failed` | Keep a partial artifact from a failed run. |
| `--quiet` / `--verbose` | Silence or show the engine's own log. |
| `--help`, `--version` | |

## build

```
openscad-cli build <file.scad> [-o <out>] [--format <name>] [-D k=v ...] [options]
```

| Flag | Meaning |
|---|---|
| `-o, --output <file>` | Output path. Default: the input name with the format's extension, next to the input. |
| `--format <name>` | `stl off obj wrl 3mf dxf svg pdf csg ast echo param pov`. Default `stl`. |
| `--backend <name>` | `manifold` (default, fast) or `cgal` (slow, legacy, needed for NEF). |
| `--max-dim <n>` | Fail if the largest axis exceeds this. 0 disables. |
| `--max-triangles <n>` | Warn above this triangle count. 0 disables. |
| `--min-area <n>` | Warn below this surface area. Catches near-empty solids. Default 1e-6. |
| `-p <file>` | Customizer parameter file. |
| `-P <name>` | Parameter set within `-p`. |

Always writes a sidecar manifest at `<output>.openscad.json` containing the
full result, so a later step can read it without re-parsing stdout.

## validate

```
openscad-cli validate <file.scad>
```

Parses and evaluates without producing an artifact. Same diagnostics, exit 1
on a model error, and it writes nothing outside its work directory. Use it as
the fast inner loop.

## variants

```
openscad-cli variants <file.scad> --param w=10,20,30 --param h=0:1:4 --out-dir out/
```

| Flag | Meaning |
|---|---|
| `--param name=v1,v2` | A value list. Also `name=0:3` (step 1) and `name=0:0.5:2`. |
| `--out-dir <dir>` | Where to write the variants. Default: beside the input. |
| `--jobs <n>` | Concurrent engine processes. Default: half the cores. |
| `--ordered` | Emit in input order rather than completion order. |

Output is NDJSON, one result object per line, in completion order unless
`--ordered`. Files are named `<base>_<param>-<value>_<param>-<value>.stl`.

## inspect

```
openscad-cli inspect <file.scad> --ast    # the parsed program, re-serialised
openscad-cli inspect <file.scad> --csg    # the CSG tree with calls applied
openscad-cli inspect <file.scad> --echo   # echo() output
openscad-cli inspect <file.scad> --params # customizer parameters
```

Combine flags to get several at once. With `--format text` the dumps are
printed directly rather than as a result object.

## convert

```
openscad-cli convert <file.scad> -o part.3mf --format 3mf
```

Generates a wrapper that `import()`s the input and re-exports it. Also the way
to convert a mesh: `convert model.stl -o model.3mf` is not supported directly,
because the model argument must be a `.scad`; wrap the import yourself.

## info

Reports the resolved engine, its version, the detected build profile, the
formats the profile supports, the diagnostic code list, the exit-code table,
and the licence and source URL. Exits 3 with a search report if no engine is
found. Does not shell out to the engine's own `--info`, which requires a GL
context and therefore fails on a headless build.

## doctor

Environment checks: engine found, engine runs headless, work directory
writable, MCAD library present, Node version. Exits 3 if the engine is unusable.

## skill

Prints this skill bundle from inside the installed CLI, so the documentation
can never describe flags that a given build does not have.

## raw

```
openscad-cli raw -- --help
openscad-cli raw -- --export-format=off -o model.off model.scad
```

Arguments after `--` go straight to the engine, untouched. This is the escape
hatch for anything the curated commands do not cover.

## Result schema

`openscad-cli/result@1`:

| Field | Type | Notes |
|---|---|---|
| `status` | `ok \| warn \| error` | `warn` is a successful build with something to fix. |
| `engine` | object | `version`, `sha`, `profile`, `backends`, `path`. |
| `input` | object | `path`, `sha256`, `defines`. |
| `outputs[]` | array | `format`, `path`, `sha256`, `bytes`. |
| `stats` | object | See below. |
| `diagnostics[]` | array | `severity`, `code`, `message`, `file`, `line`, `hint`, `group`. |
| `cache` | object | `key`, `hit`. |
| `timings` | object | `totalMs`, `renderMs`. |
| `license` | object | `spdx`, `source`. |
| `echo[]` | array | `echo()` output, in emission order. |

`stats`:

| Field | Source | Notes |
|---|---|---|
| `boundingBox` | engine, else our mesh reader | `{min, max, size}`. |
| `triangles` | our mesh reader | Mesh formats only. |
| `volume`, `area` | our mesh reader | Mesh formats only. The engine reports neither. |
| `degenerateTriangles` | our mesh reader | Triangles with zero area. |
| `time`, `cache` | engine | Engine render time and cache statistics. |

The engine's own `geometry` object is backend- and dimension-dependent, and is
not passed through verbatim: a Manifold 3D result has no `bounding_box` while
a CGAL one does. `stats.boundingBox` is always populated from whichever
source is available.

## Exit codes

| Code | Meaning | Typical cause |
|---|---|---|
| 0 | success | possibly with warnings |
| 1 | model error | parse, evaluation or render failure |
| 2 | usage error | unknown flag, missing input file |
| 3 | engine unavailable | not installed, or `--engine` path is wrong |
| 4 | validation failed | `--strict` plus a warning, or `--max-dim` exceeded |
| 5 | timeout | the engine exceeded `--timeout` and was killed |
| 6 | internal error | a bug in this CLI; set `OPENSCAD_CLI_DEBUG=1` for a stack trace |
