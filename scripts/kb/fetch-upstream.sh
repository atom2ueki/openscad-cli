#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 the openscad-cli authors
#
# Fetch the upstream model corpus that the skill knowledge base distils.
#
#   scripts/kb/fetch-upstream.sh [commit]
#
# Clones github.com/jhermann/things into .kb-src/things (git-ignored) and checks
# out the pinned commit, so `scripts/kb/generate.mjs` produces the same catalog
# that is committed under skill/kb/. The upstream tree is not committed here: it
# is 140 MB, mostly binary assets that compliance check 9 forbids.
set -euo pipefail

UPSTREAM_URL="https://github.com/jhermann/things.git"
# The commit skill/kb/catalog.json records as its provenance. Bump it together
# with a regenerate commit.
PINNED_COMMIT="2ffef57550099362c5ef9659150969139f7c8a45"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$REPO_ROOT/.kb-src/things"
COMMIT="${1:-$PINNED_COMMIT}"

if [ -d "$TARGET/.git" ]; then
  echo "==> updating $TARGET"
  git -C "$TARGET" fetch --quiet origin
else
  echo "==> cloning $UPSTREAM_URL -> $TARGET"
  mkdir -p "$(dirname "$TARGET")"
  git clone --quiet --filter=blob:none --no-checkout "$UPSTREAM_URL" "$TARGET"
fi

git -C "$TARGET" checkout --quiet "$COMMIT"
echo "==> at $(git -C "$TARGET" rev-parse HEAD)"
echo "Now run: scripts/kb/generate.mjs $TARGET"
