#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 the openscad-cli authors
#
# Install (or refresh) the agent skill for Mavis and any other agent runtime
# that reads skills from a data directory.
#
#   packaging/install-skill.sh [target-skills-dir]
#
# The repo's skill/ directory is the source of truth. This copies it into
# <target>/openscad-cli/ so a running agent can load it with the skill tool.
# Re-run it after editing skill/ — the CLI's own `openscad-cli skill` command
# prints the same bundle, so the three can always be compared.
#
# Why a copy and not a symlink: skill discovery walks the skills directory and
# most implementations skip symlinked entries, because a directory symlink
# reports as a symlink rather than a directory. A real directory is portable
# and predictable.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$REPO_ROOT/skill"
DATA_DIR="${OPENSCAD_CLI_DATA_DIR:-$HOME/.minimax}"
TARGET_ROOT="${1:-$DATA_DIR/skills}"
TARGET="$TARGET_ROOT/openscad-cli"

if [ ! -f "$SOURCE/SKILL.md" ]; then
  echo "error: $SOURCE/SKILL.md not found" >&2
  exit 1
fi

echo "==> installing $SOURCE -> $TARGET"
mkdir -p "$TARGET/references"

# Replace the payload atomically-ish: clear references first so a deleted
# reference file does not linger and get read as if it still existed.
cp "$SOURCE/SKILL.md" "$TARGET/SKILL.md"
for f in "$SOURCE"/references/*.md; do
  [ -e "$f" ] || continue
  cp "$f" "$TARGET/references/$(basename "$f")"
done
# Drop references that no longer exist upstream.
for stale in "$TARGET"/references/*.md; do
  [ -e "$stale" ] || continue
  base=$(basename "$stale")
  [ -f "$SOURCE/references/$base" ] || { echo "    removing stale reference $base"; rm -f "$stale"; }
done

echo "==> installed:"
ls -1 "$TARGET" "$TARGET/references" | sed 's/^/    /'
echo
echo "The skill takes effect in the next session (no runtime restart needed)."
echo "Verify with:  skill({ name: \"openscad-cli\" })"
echo
echo "Make sure the CLI itself is reachable:"
echo "  ~/.local/bin/openscad-cli doctor"
