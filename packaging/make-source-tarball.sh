#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 the openscad-cli authors
#
# Assemble the complete corresponding source for a release.
#
#   packaging/make-source-tarball.sh <version> <output-dir>
#
# GPL section 6 requires that anyone receiving the object code can obtain the
# complete machine-readable source of the combined work. Because the combined
# work includes the OpenSCAD engine, that means our source PLUS the engine tree
# at the exact pinned commit PLUS any patches we apply. A link to the git
# repository is not sufficient on its own: the submodule pin can be moved, and
# the release must remain reconstructible years later.
#
# Output: openscad-cli-<version>-src.tar.gz plus a .sha256 and a MANIFEST that
# records the engine commit and the file inventory.
set -euo pipefail

VERSION="${1:-0.0.0}"
OUT_DIR="${2:-dist}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE="$(mktemp -d)"
NAME="openscad-cli-${VERSION}"
OUT="$OUT_DIR/$NAME-src.tar.gz"

cd "$REPO_ROOT"
mkdir -p "$OUT_DIR"

# The pinned engine commit, read from the gitlink rather than the working
# tree: the working tree may have been advanced locally without being pinned.
ENGINE_COMMIT="$(git ls-files -s engine | awk '{print $2}')"
if [ -z "$ENGINE_COMMIT" ]; then
  echo "error: engine submodule is not registered" >&2
  exit 1
fi

echo "==> staging $NAME"
TARGET="$STAGE/$NAME"
mkdir -p "$TARGET"

# 1. Our own tree, from the tag (or HEAD when tagging is skipped in a dry run).
#    `git archive` honours .gitignore and .gitattributes, so node_modules, the
#    engine checkout and build output are excluded by construction.
git archive --format=tar HEAD | tar -x -C "$TARGET"

# 2. The engine at the pinned commit, including its own submodules.
echo "==> embedding engine $ENGINE_COMMIT"
if [ -d "$REPO_ROOT/engine/.git" ] || [ -f "$REPO_ROOT/engine/.git" ]; then
  git -C "$REPO_ROOT/engine" archive --format=tar "$ENGINE_COMMIT" | tar -x -C "$TARGET/engine"
else
  echo "warning: engine submodule is not checked out; fetching $ENGINE_COMMIT" >&2
  git -C "$STAGE" clone --quiet --no-checkout https://github.com/openscad/openscad.git engine-tmp
  git -C "$STAGE/engine-tmp" archive --format=tar "$ENGINE_COMMIT" | tar -x -C "$TARGET/engine"
  rm -rf "$STAGE/engine-tmp"
fi

# 3. Our patches to the engine, which are part of the corresponding source.
if [ -d "$REPO_ROOT/packaging/patches" ] && [ -n "$(ls -A "$REPO_ROOT/packaging/patches" 2>/dev/null)" ]; then
  echo "==> including engine patches"
  mkdir -p "$TARGET/packaging/patches"
  cp -R "$REPO_ROOT/packaging/patches/." "$TARGET/packaging/patches/"
fi

# 4. A manifest so the offer is self-describing even years from now.
echo "==> writing MANIFEST"
ENGINE_VERSION="$(grep -m1 -oE '[0-9]{4}\.[0-9]{2}\.[0-9]{2}' <<<"${ENGINE_COMMIT}" || echo unknown)"
cat > "$TARGET/MANIFEST" <<EOF
openscad-cli ${VERSION}
Source license: GPL-2.0-or-later
OpenSCAD engine: ${ENGINE_VERSION} (commit ${ENGINE_COMMIT})
  https://github.com/openscad/openscad/tree/${ENGINE_COMMIT}

This archive is the complete corresponding source for the openscad-cli
binaries of the same version. It contains:

  dist/        the openscad-cli sources (TypeScript)
  engine/      the OpenSCAD sources at the pinned commit above
  packaging/   our build scripts, including any engine patches

Build it with:
  node -v   # >= 20
  npm install && npm run build
  packaging/build-engine.sh full
EOF

# 5. Tar it, deterministically enough to be diffable.
echo "==> writing $OUT"
tar -czf "$OUT" -C "$STAGE" "$NAME"
( cd "$OUT_DIR" && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256" )

echo "==> done"
ls -lh "$OUT" "$OUT.sha256"
rm -rf "$STAGE"
