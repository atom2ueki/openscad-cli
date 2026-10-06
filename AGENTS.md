# AGENTS.md

Agent-facing CLI that drives the OpenSCAD core engine to build, validate and
export parametric 3D/2D models, returning JSON so programs and agents can branch
on structured results instead of scraping logs.

## Setup commands

- Install deps: `npm ci` (Node ≥ 20; `npm install` if you are changing deps)
- Build:        `npm run build`          → `dist/` (ES modules, zero runtime deps)
- Test:         `npm test`               → 63 tests; engine tests skip if no engine
- Test w/ engine: `OPENSCAD_ENGINE=<path> npm run test:integration`
- Typecheck:    `npm run typecheck`      (TypeScript strict, `noUncheckedIndexedAccess`)
- Compliance:   `npm run compliance`     (9-point GPL gate; must pass to release)
- Build engine: `packaging/build-engine.sh full|lite`  (needs cmake + native deps)
- Install skill: `packaging/install-skill.sh`
- Fetch/extend the knowledge base: `scripts/kb/fetch-upstream.sh` then `node scripts/kb/generate.mjs`

On a machine with no Node/Homebrew, `source .tools/env.sh` first: it puts the
project-local Node on PATH and points `OPENSCAD_ENGINE` at a downloaded nightly.

## Project layout

- `src/` — the CLI (TypeScript). `engine/` discovery + argv + spawn, `diagnostics/`
  stderr→structured, `verify/` mesh maths, `cache/` content-addressed store,
  `commands/` one module per command, `util/` helpers
- `engine/` — **git submodule**: the pinned OpenSCAD source. Do not edit
- `packaging/` — build-engine.sh, source tarball, install-skill.sh, Homebrew, AppImage, Docker
- `skill/` — the agent skill; source of truth, also printed by `openscad-cli skill`.
  `skill/references/` is the CLI's own manual; `skill/kb/` is the design corpus
  (hand-written topic pages plus a generated `catalog.{md,json}`)
- `test/` — `unit.core.test.js` (no engine), `integration.build.test.js` (real engine), `fixtures/`
- `scripts/` — licence-header lint and the compliance gate; `scripts/kb/`
  fetches and catalogues the upstream model corpus
- `.github/workflows/` — `ci` (test), `compliance` (GPL gate), `release`

## Code style

- TypeScript strict; ESM (`"type": "module"`); `.js` extensions in relative imports
- No runtime dependencies, ever. The npm tarball must stay pure JavaScript
- Node built-ins only in tests: `node:test` + `node:assert/strict`
- `spawn` with `argv`, never a shell — `-D 'label="ACME"'` must survive intact
- Two-space indent, single quotes, trailing commas (match the surrounding code)

## Invariants that will bite you if you break them

- **Never pass `--quiet` to the engine by default.** It hides `echo()` output and
  the "Current top level object is empty." error. Filter the engine's statistics
  chatter in `diagnostics/parse.ts` instead.
- **`--summary=all` is mandatory.** Without it the engine writes literal `null`.
- **`--summary-file` must point at a file, never `-`.** Stdout carries our own JSON.
- **The engine's `geometry` object is backend- and dimension-dependent.**
  Manifold 3D has no `bounding_box`; CGAL 3D does. Never assume a key exists.
- **STL is always `binstl`.** The engine's CLI default is ASCII.
- **Mesh analysis runs only for mesh formats.** An STL reader over a DXF invents
  volumes of 1e44.
- **`--format` is the export format; `--output-format` is the output format.**
  They were once conflated and it failed confusingly.
- **Run the model in place with absolute paths.** The engine resolves relative
  `include<>` against the including file, so copying only the `.scad` into a work
  directory breaks the model.

## Testing instructions

- Unit tests (`test/unit.core.test.js`) cover the engine-facing logic against
  real captured output: diagnostics parsing, cache keys, deps-file parsing, mesh
  maths, argument rejection. No engine needed — keep it that way.
- `test/unit.kb.test.js` guards the knowledge base's structure: no dead link and
  no orphan page under `skill/kb/`, the generated catalogue matching its topics,
  and `install-skill.sh` really installing the nested tree.
- Integration tests need a real engine and skip cleanly without one.
- **Add a test for every behaviour change**, especially any claim about what the
  engine prints. Verify a claim against the real engine before encoding it.
- `npm test` and `npm run compliance` must both be green before opening a PR.

## The engine pin

`engine/` is pinned by the gitlink commit recorded in git. Bumping it is a
deliberate, reviewed act: `git -C engine fetch && git -C engine checkout <sha>`,
then commit the gitlink change. CI fails if the submodule moved without that.
Bumping is release-visible: it changes the cache key and appears in `info`.

## PR & commit conventions

- Branch from `main`; never push to it directly
- Conventional commits (`feat:` / `fix:` / `docs:` / `refactor:` / `test:`)
- Update `skill/` in the same PR as any CLI change, then run
  `packaging/install-skill.sh` — the skill must never document a flag that does
  not exist
- Keep the engine submodule pinned unless the PR is explicitly an engine bump
- `skill/kb/catalog.{md,json}` are generated. Never hand-edit them: change
  `scripts/kb/generate.mjs`, then regenerate. A corpus bump is the pinned commit
  in `scripts/kb/fetch-upstream.sh` plus a regenerate, in one commit

## Security and licensing

- **Never commit secrets.** The project has no runtime config and talks to no
  service; anything auth-shaped reaching a file is a mistake.
- **Never commit binaries.** Compliance check 9 fails the release if a `.stl`,
  `.dmg`, `.AppImage` or tarball is tracked. Model assets belong in
  `test/fixtures/assets/`, which `.gitignore` re-includes.
- **Every source file needs `SPDX-License-Identifier: GPL-2.0-or-later`.**
  Enforced by `npm run lint:license`.
- This project is **GPL-2.0-or-later** and embeds OpenSCAD, which is the same
  licence plus a CGAL linking exception. Do not narrow the grant, do not add
  EULA/terms/telemetry, and keep `packaging/make-source-tarball.sh` able to
  produce the complete corresponding source — compliance checks 1–4 and 7
  enforce this.
