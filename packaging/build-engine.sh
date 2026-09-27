#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 the openscad-cli authors
#
# Build the headless OpenSCAD engine from the pinned submodule.
#
#   packaging/build-engine.sh [full|lite] [build-dir]
#
# `full` is the release profile: CGAL and Manifold, cairo and lib3mf when
# available, so every export format the engine supports is compiled in.
# `lite` is the development profile: Manifold only, which drops CGAL (the
# single heaviest dependency) and therefore builds much faster. `lite` has no
# NEF and no PDF output — `openscad-cli info` reports which profile is in use,
# because the capability difference is user-visible.
#
# The engine is configured with -DHEADLESS=ON -DNULLGL=ON, which drops the Qt
# GUI and the entire OpenGL renderer stack. That is a supported upstream
# configuration: the official openscad/openscad-wasm port is built exactly this
# way. The consequence is that PNG export is unavailable, which is why this
# project does geometry and vector output only.
#
# macOS dependencies (Homebrew):
#   brew install cmake ninja pkg-config boost eigen cgal glib freetype cairo \
#               libzip libxml2 fontconfig harfbuzz double-conversion tbb \
#               catch2 ccache
# Linux dependencies (Debian/Ubuntu):
#   apt-get install cmake ninja-build pkg-config libboost-regex-dev \
#       libboost-program-options-dev libeigen3-dev libcgal-dev libgmp-dev \
#       libmpfr-dev libcairo2-dev libglib2.0-dev libfreetype-dev libzip-dev \
#       libxml2-dev libfontconfig-dev libharfbuzz-dev libdouble-conversion-dev \
#       libtbb-dev flex bison lib3mf-dev gettext
#
# Three of those packages are load-bearing in a way that is easy to get wrong:
#
#   cairo      FindCairo.cmake parses cairo-version.h to satisfy
#              `find_package(Cairo 1.14)`. A runtime-only cairo leaves the
#              version empty and the configure step fails with "Required
#              version (1.14) is higher than found version ()". Cairo gates
#              export_pdf.cc, so losing it silently costs PDF export.
#   gettext    The `openscad` target shells out to msgfmt via
#              scripts/translation-update.sh to compile the .po catalogues.
#              Without it the link step dies with a bare "msgfmt: command
#              not found" and error 127, which reads like a linker fault.
#   lib3mf     Removed from homebrew-core, so it cannot be installed from a
#              formula on macOS at all. It is linked when the platform
#              provides it (Debian/Ubuntu) and omitted otherwise, which is
#              what the `full` profile has always claimed. A macOS engine has
#              no working 3MF import/export.
set -euo pipefail

PROFILE="${1:-full}"
BUILD_DIR="${2:-build/engine}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_SRC="$REPO_ROOT/engine"

case "$PROFILE" in
  full|lite) ;;
  *) echo "usage: $0 [full|lite] [build-dir]" >&2; exit 2 ;;
esac

if [ ! -f "$ENGINE_SRC/CMakeLists.txt" ]; then
  echo "error: engine submodule is not initialised at $ENGINE_SRC" >&2
  echo "hint:  git submodule update --init --recursive" >&2
  exit 1
fi

COMMON_ARGS=(
  -DCMAKE_BUILD_TYPE=Release
  -DHEADLESS=ON
  -DNULLGL=ON
  -DEXPERIMENTAL=ON
  -DINFO=ON
  -DUSE_MIMALLOC=ON
  -DUSE_CCACHE=ON
  -DUSE_BUILTIN_MANIFOLD=ON
  -DUSE_BUILTIN_CLIPPER2=ON
  # The engine's own ctest suite is wired for image comparison, which is
  # meaningless without a GL context; our tests live in test/ instead. It is
  # also not merely useless here, it is fatal: tests/CMakeLists.txt disables a
  # test called `export-3mf-stdio_3mf-export` on APPLE, and that test only
  # exists when lib3mf was found — so on a macOS runner without lib3mf,
  # set_tests_properties() names a test that is not in the suite and CMake
  # stops with "set_tests_properties ... cannot find test".
  -DENABLE_TESTS=OFF
  -DINFO=ON
  # lib3mf is optional on purpose, and this is the line that makes it so.
  # The engine defaults CMAKE_REQUIRE_FIND_PACKAGE_Lib3MF to ON, so a
  # platform without the library fails the whole configure step rather than
  # building without 3MF. The `full` profile has always been documented as
  # linking lib3mf "when available", so make the build agree: Debian/Ubuntu
  # installs lib3mf-dev and keeps 3MF, macOS has no formula for it and drops
  # 3MF. Anything stricter re-breaks the build the next time a formula is
  # retired upstream.
  -DCMAKE_REQUIRE_FIND_PACKAGE_Lib3MF=OFF
)

case "$(uname -s)" in
  Darwin)
    COMMON_ARGS+=(-DAPPLE_UNIX=ON -DUSE_QT6=0)
    ;;
esac

# Work around an upstream wiring bug in the pinned engine's CMakeLists.txt.
# It links fontconfig and glib and harfbuzz, and adds the include directory for
# glib and harfbuzz -- but never for fontconfig. On Linux that is invisible,
# because /usr/include/fontconfig/fontconfig.h is the only one on the search
# path. On macOS the runner has an older fontconfig header further along the
# default search path, so the compiler picks that one, links against the
# current 2.18.3 library, and then fails to compile FontCache.cc with "use of
# undeclared identifier 'FC_FONT_FEATURES'".
#
# The submodule is pinned and must not be patched, so put the correct include
# directory on the command line instead, where it precedes everything the
# compiler would otherwise search. On Linux this expands to -I/usr/include and
# changes nothing.
FONTCONFIG_CFLAGS=""
if command -v pkg-config >/dev/null 2>&1; then
  FONTCONFIG_CFLAGS="$(pkg-config --cflags-only-I fontconfig 2>/dev/null || true)"
fi
if [ -n "$FONTCONFIG_CFLAGS" ]; then
  COMMON_ARGS+=(-DCMAKE_CXX_FLAGS="$FONTCONFIG_CFLAGS")
  echo "==> fontconfig include flags: $FONTCONFIG_CFLAGS"
fi

if [ "$PROFILE" = "lite" ]; then
  COMMON_ARGS+=(-DENABLE_CGAL=OFF -DENABLE_CAIRO=OFF)
else
  COMMON_ARGS+=(-DENABLE_CGAL=ON)
fi

echo "==> configuring engine ($PROFILE profile)"
cmake -S "$ENGINE_SRC" -B "$REPO_ROOT/$BUILD_DIR" "${COMMON_ARGS[@]}"

# The configure summary is the only reliable way to confirm the GUI really was
# dropped. If Qt shows up here, a NULLGL build did not happen and every later
# assumption about the binary is wrong.
if [ -f "$REPO_ROOT/$BUILD_DIR/CMakeCache.txt" ]; then
  echo "==> resolved options"
  grep -E '^(HEADLESS|NULLGL|ENABLE_CGAL|ENABLE_MANIFOLD|USE_QT6|ENABLE_CAIRO|CMAKE_REQUIRE_FIND_PACKAGE_Lib3MF):' \
    "$REPO_ROOT/$BUILD_DIR/CMakeCache.txt" || true
fi

echo "==> building"
JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu || echo 4 )}"
cmake --build "$REPO_ROOT/$BUILD_DIR" --parallel "$JOBS"

# Locate the binary. Two portability notes:
#   * `-perm +111` is BSD-only syntax; GNU find removed it in findutils
#     4.5.12 (2013), where it is a hard error, not a warning. `-perm -u+x` is
#     POSIX and means the same thing on both.
#   * stderr is deliberately NOT discarded. It used to be, which turned that
#     find error into a silent empty result and then reported "no engine
#     binary produced" for a binary that had just linked successfully.
BINARY="$(find "$REPO_ROOT/$BUILD_DIR" -maxdepth 3 -type f -name 'openscad*' -perm -u+x | head -1 || true)"
if [ -z "$BINARY" ]; then
  echo "error: no engine binary produced" >&2
  echo "hint:  searched $REPO_ROOT/$BUILD_DIR (maxdepth 3) for an executable named 'openscad*'" >&2
  echo "hint:  the build above claimed success, so the binary is elsewhere or not executable" >&2
  find "$REPO_ROOT/$BUILD_DIR" -maxdepth 3 -name 'openscad*' 2>/dev/null | sed 's/^/       found: /' >&2 || true
  exit 1
fi

echo "==> built $BINARY"
"$BINARY" --version || true
echo "==> export OPENSCAD_ENGINE=\"$BINARY\" to use it"
