#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Compliance gate 1: every source file we add must carry an SPDX identifier.
//
// This is enforced by a script rather than by review, because it is the kind
// of requirement that rots. A new file added without a header is a release
// blocker, not a nitpick.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.tools', 'engine', 'coverage']);
const REQUIRED_EXT = new Set(['.ts', '.mjs', '.js', '.sh', '.yml', '.yaml']);
const SPDX = 'SPDX-License-Identifier: GPL-2.0-or-later';

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) yield* walk(full);
    else if (REQUIRED_EXT.has(extname(entry))) yield full;
  }
}

const offenders = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  // The engine's own sources are covered by upstream's headers.
  if (rel.startsWith('engine/')) continue;
  const text = readFileSync(file, 'utf8');
  checked += 1;
  if (!text.includes(SPDX)) offenders.push(rel);
}

if (offenders.length > 0) {
  process.stderr.write(`FAIL  ${offenders.length} file(s) are missing "${SPDX}":\n`);
  for (const f of offenders) process.stderr.write(`        ${f}\n`);
  process.exit(1);
}

process.stdout.write(`ok    ${checked} source files carry ${SPDX}\n`);
