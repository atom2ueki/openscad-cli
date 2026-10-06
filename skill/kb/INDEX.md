# Knowledge base — index

A distilled, agent-oriented knowledge base for parametric part design. It
consolidates the model corpus at
[jhermann/things](https://github.com/jhermann/things) (Apache-2.0) into pages an
agentic model maker can actually use: techniques, exact numbers, and the
gotchas the original sources call out in comments.

**Read this page first, then one topic page.** Do not read the whole KB.

## Route by what you are building

| You are building | Read |
|---|---|
| anything that must print — walls, overhangs, fits, first layer | [`printing.md`](./printing.md) |
| a screw-on container, lid, or any threaded pair | [`threads.md`](./threads.md) |
| a clip, clamp, flexure, spring, or a snap fit | [`springs.md`](./springs.md) |
| two printed pieces that must join | [`joining.md`](./joining.md) |
| a hinge, latch, or any joint that must print already assembled | [`mechanisms.md`](./mechanisms.md) |
| grip, knurling, ribbing, or any surface pattern | [`textures.md`](./textures.md) |
| a torus, rounded cube, hull blend, I-beam, or support gusset | [`solids.md`](./solids.md) |
| anything with BOSL2 — and the canonical file skeleton | [`bosl2.md`](./bosl2.md) |
| a whole part end to end, with its parameter table | [`models.md`](./models.md) |
| a `module`/`function` by name, with its parameters | [`catalog.md`](./catalog.md) |

## The two rules that decide most failures

1. **Every force path must lie in-plane with the layer lines.** Springs, hinges
   and snap fingers that bend across layers delaminate. This is why every spring
   in the corpus is a 2D profile extruded through the print axis.
2. **Never let CSG faces be exactly coincident.** Give every cutter or stacked
   solid a pad — `epsilon = 0.05`, `edge_pad`, `clearance`, or a negative
   `os_chamfer` — so it crosses the surface instead of grazing it. Upstream calls
   this out repeatedly; a coincident face renders as a non-manifold seam.

## Non-negotiable numbers

| Quantity | Value | Where |
|---|---|---|
| Minimum wall | 1 mm | `printing.md` |
| Layer height | 0.2 mm | `printing.md` |
| Clearance, moving/compliant joint | 0.3 mm | `printing.md` |
| Working fit tolerance, printed parts | 0.2–0.25 mm | `threads.md`, `springs.md` |
| CSG anti-coplanar pad | 0.05 mm | everywhere |
| Thread radial clearance (male in lid) | 0.30 mm | `threads.md` |
| Thread base overlap into the neck | 0.30 mm | `threads.md` |
| Softest survivable spring band | 1 mm thick | `springs.md` |
| Do not use | helical coil springs, living hinges | `springs.md`, `printing.md` |

## What is here

| Page | Content |
|---|---|
| [`printing.md`](./printing.md) | process rules: walls, overhangs, bed contact, tolerances, textures, mechanisms, the corpus's modelling conventions |
| [`threads.md`](./threads.md) | trapezoidal thread profile, hulled-slice sweep, recessed neck, overlapped thread base, both implementations |
| [`springs.md`](./springs.md) | six flat-pack springs, the wave-band formula, the chord-sagitta leaf, the omega geometry, snap-fit |
| [`joining.md`](./joining.md) | dovetail, heat-set insert slit rings, grip fins, tapered plug, square dowel |
| [`mechanisms.md`](./mechanisms.md) | conical print-in-place hinge, over-center latch, filament-pin knuckle |
| [`textures.md`](./textures.md) | seven procedural wall patterns with their formulas and depth budget |
| [`solids.md`](./solids.md) | torus, hull constructions, chamfered cube, bodies of revolution, support fin |
| [`bosl2.md`](./bosl2.md) | anchors/attach/diff, negative chamfer, `$slop`, `texture()`, bridged pockets, the canonical file skeleton |
| [`models.md`](./models.md) | ten worked models with their parameter tables and the techniques each demonstrates |
| [`catalog.md`](./catalog.md) | every `module`/`function` in the corpus's libraries, signature + parameters, generated |

`catalog.json` is the same catalogue in machine-readable form: `topics[]`,
`modules[]` (file, name, signature, params, doc comment), plus the upstream
provenance block.

## Provenance and regeneration

- Upstream: <https://github.com/jhermann/things>, Apache-2.0.
- Pinned commit: `2ffef57550099362c5ef9659150969139f7c8a45` (2026-10-05), recorded
  in `catalog.json → upstream`.
- The pages here are written for this CLI; `catalog.md` reproduces upstream
  signatures verbatim. No upstream file is redistributed. See
  `THIRD_PARTY_LICENSES.md` at the repository root.

```console
scripts/kb/fetch-upstream.sh          # clone the pinned corpus into .kb-src/ (git-ignored)
node scripts/kb/generate.mjs          # regenerate catalog.md + catalog.json
```

The prose pages are hand-written; only the catalogue is generated. Bump the
pinned commit in `scripts/kb/fetch-upstream.sh` and the provenance above in the
same commit as a regenerate, or the catalogue silently describes an older
corpus.
