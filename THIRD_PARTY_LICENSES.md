# Third-party licenses

`openscad-cli` is licensed GPL-2.0-or-later (see `LICENSE`). It drives the
OpenSCAD core engine, which is redistributed unmodified as a git submodule.
This file enumerates every third-party component that ships inside the
distributed artifacts, as required by GPL sections 1 and 6.

## Redistributed in full

### OpenSCAD — the core engine

- Upstream: <https://github.com/openscad/openscad>
- Copyright: Copyright (C) 2005-2026 The OpenSCAD Developers
- License: **GPL-2.0-or-later**, with this special exception from `COPYING`:

  > As a special exception, you have permission to link this program with the
  > CGAL library and distribute executables, as long as you follow the
  > requirements of the GNU GPL in regard to all of the software in the
  > executable aside from CGAL.

- Modifications: none. The pinned commit is recorded as a gitlink in the
  `engine/` path of this repository.

### Code vendored inside the OpenSCAD engine (`src/ext/`)

| Component | Path in engine | License |
|---|---|---|
| nlohmann/json | `src/ext/json/json.hpp` | MIT |
| libtess2 (Mikko Mononen) | `src/ext/libtess2/` | SGI Free Software License B |
| lodepng | `src/ext/lodepng/` | zlib |
| lexertl | `src/ext/lexertl/` | Boost Software License 1.0 |
| hidapi | `src/ext/hidapi/` | GPL-3 / BSD-2-Clause / original (tri-licensed) |
| CGAL `Mark_bounded_volumes` | `src/ext/CGAL/` | GPL-3-or-later **or** commercial license |
| CGAL `OGL_helper` | `src/ext/CGAL/OGL_helper.h` | GPL-3-or-later **or** commercial license |
| glad (OpenGL loader) | `src/ext/glad/` | MIT-style (not compiled in `NULLGL` builds) |

### Per-directory license exception inside the engine

| Component | Path in engine | License |
|---|---|---|
| libsvg | `src/libsvg/` | **MIT** — an explicit per-directory exception inside the otherwise-GPL tree, by Torsten Paul and Marius Kintel (see `src/libsvg/LICENSE`) |

Note that these permissive components do not loosen the license of the
OpenSCAD-authored code around them: the combined engine remains
GPL-2.0-or-later, and the CGAL exception applies to CGAL alone.

## Linked as external build dependencies (not vendored)

These are resolved at build time and linked into the engine binary:

| Dependency | License | Required for |
|---|---|---|
| CGAL | GPL-3-or-later or commercial | the `cgal` geometry backend |
| GMP, MPFR | LGPL-3-or-later | pulled in by CGAL |
| Boost (regex, program_options) | BSL-1.0 | language runtime |
| Eigen | MPL-2.0 | linear algebra |
| oneTBB | Apache-2.0 | Manifold backend |
| HarfBuzz | MIT (Old style) | `text()` font rendering |
| FontConfig | MIT-style | font lookup |
| FreeType | FTL / GPL-2-or-later | font rasterisation |
| GLib | LGPL-2.1-or-later | string utilities |
| libxml2 | MIT | SVG import |
| libzip | BSD-3-Clause | 3MF packaging |
| OpenSSL | Apache-2.0 | TLS for `include <https://…>` |
| double-conversion | BSD-3-Clause | number formatting |
| Clipper2 | BSL-1.0 | 2D boolean ops (engine submodule) |
| manifold | Apache-2.0 | `manifold` geometry backend (engine submodule) |
| mimalloc | MIT | allocator (engine submodule) |
| cairo | LGPL-2.1-or-later / MPL-1.1 | PDF export only (`ENABLE_CAIRO`) |
| lib3mf | LGPL-2.1-or-later | 3MF export/import |
| flex, bison | FSFPL / GPL-2.0-or-later | generating the SCAD parser |

## Documentation derived from third-party work

### jhermann/things — the skill knowledge base

- Upstream: <https://github.com/jhermann/things>
- Copyright: Copyright (c) the `things` authors
- License: **Apache-2.0**
- Relation: the pages under `skill/kb/` are written here, but they describe and
  catalogue the models, reusable parts and design notes of that repository, and
  `skill/kb/catalog.md` reproduces its `module` and `function` signatures
  verbatim. `skill/kb/catalog.json` records the upstream commit they were taken
  from. No upstream file is redistributed, and no upstream binary asset is
  copied; `scripts/kb/fetch-upstream.sh` retrieves the source on demand.

## Our own dependencies

The npm package ships **pure JavaScript with zero runtime dependencies**. The
only build-time dependencies are `typescript` and `@types/node` (both Apache-2.0
/ MIT), and the test suite uses the Node.js built-in test runner.

## MCAD library

The `libraries/MCAD` submodule in the engine tree is redistributed under
its own terms; see the headers in the vendored `.scad` files.
