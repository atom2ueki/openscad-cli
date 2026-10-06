#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 the openscad-cli authors
#
# Install (or refresh) the agent skill for every agent runtime on this machine
# that reads skills from a data directory.
#
#   packaging/install-skill.sh [skills-dir ...]
#
# The repo's skill/ directory is the source of truth. With no arguments this
# copies it into <data-dir>/skills/openscad-cli for each runtime that is
# present:
#
#   ~/.minimax   Mavis                   ($OPENSCAD_CLI_DATA_DIR overrides)
#   ~/.agents    omp, and anything else on the .agent[s]/skills layout
#   ~/.agent     the same layout under its older singular spelling
#
# Pass one or more directories to install into those instead of detecting.
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

if [ ! -f "$SOURCE/SKILL.md" ]; then
  echo "error: $SOURCE/SKILL.md not found" >&2
  exit 1
fi

# install_into <skills-dir> <label>
install_into() {
  local skills_dir="$1" label="$2"
  local target="$skills_dir/openscad-cli"

  echo "==> installing $SOURCE -> $target ($label)"
  mkdir -p "$skills_dir"

  # The target is entirely ours, so rebuild it rather than reconcile it: a
  # page deleted or renamed upstream must not linger, and a directory tree
  # (references/, kb/) must arrive whole. The old flat copy of references/*.md
  # silently skipped every subdirectory.
  rm -rf "$target"
  mkdir -p "$target"
  cp -R "$SOURCE"/. "$target"/

  find "$target" -type f | sed "s|$target/|    |" | sort
  echo "    ($(find "$target" -type f | wc -l | tr -d ' ') files)"
}

# Runtime data directories, in install order, with parallel labels.
runtime_dirs=()
runtime_labels=()

if [ "$#" -gt 0 ]; then
  for dir in "$@"; do
    runtime_dirs+=("$dir")
    runtime_labels+=("explicit")
  done
else
  mavis_data_dir="${OPENSCAD_CLI_DATA_DIR:-$HOME/.minimax}"
  if [ -d "$mavis_data_dir" ]; then
    runtime_dirs+=("$mavis_data_dir/skills")
    runtime_labels+=("Mavis")
  fi
  # omp discovers .agent[s]/skills. The two spellings are one layout, so install
  # into a single one of them: both would surface as a duplicate skill name.
  if [ -d "$HOME/.agents" ]; then
    runtime_dirs+=("$HOME/.agents/skills")
    runtime_labels+=("omp")
  elif [ -d "$HOME/.agent" ]; then
    runtime_dirs+=("$HOME/.agent/skills")
    runtime_labels+=("omp")
  fi
fi

if [ "${#runtime_dirs[@]}" -eq 0 ]; then
  echo "error: no agent runtime found — looked for \${OPENSCAD_CLI_DATA_DIR}, ~/.minimax, ~/.agents, ~/.agent" >&2
  echo "usage: packaging/install-skill.sh [skills-dir ...]" >&2
  exit 1
fi

for i in "${!runtime_dirs[@]}"; do
  install_into "${runtime_dirs[$i]}" "${runtime_labels[$i]}"
done

echo
echo "Installed into ${#runtime_dirs[@]} runtime(s). The skill takes effect in the"
echo "next session (no runtime restart needed). Verify with:"
echo "  omp read skill://openscad-cli        (omp, from a shell)"
echo '  skill({ name: "openscad-cli" })      (Mavis, inside a session)'
echo
echo "Make sure the CLI itself is reachable:"
echo "  ~/.local/bin/openscad-cli doctor"
