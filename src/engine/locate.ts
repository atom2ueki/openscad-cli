// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Engine discovery. Resolution order, most specific first:
//
//   1. --engine <path>            explicit, always wins
//   2. $OPENSCAD_ENGINE           set by the Homebrew formula / dev env script
//   3. co-installed path          alongside this CLI, e.g. <prefix>/lib/openscad-engine/openscad
//   4. `openscad` on $PATH        a system or brew install
//   5. failure                    exit code 3 with actionable guidance
//
// There is deliberately no download-on-demand in this build: a public release
// hands users a package manager (Homebrew bottle, AppImage, Docker) rather
// than fetching binaries behind their back.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliError, EXIT } from '../exit.js';
import { fileExists, isExecutable } from '../util/fsx.js';

export interface ResolvedEngine {
  /** Absolute path to the executable. */
  path: string;
  /** How it was found, for `info` and `doctor`. */
  source: 'flag' | 'env' | 'co-installed' | 'path';
}

/** Candidate co-installed locations, relative to this module's location. */
function coInstalledCandidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/engine/locate.js -> package root
  const root = path.resolve(here, '..', '..');
  const exe = process.platform === 'win32' ? 'openscad.exe' : 'openscad';
  return [
    path.join(root, 'vendor', 'openscad-engine', exe),
    path.join(root, 'node_modules', 'openscad-engine', 'bin', exe),
    path.join(path.dirname(process.execPath), exe),
  ];
}

function firstExecutableOnPath(names: string[]): string | undefined {
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

export function resolveEngine(explicit?: string): ResolvedEngine {
  const names =
    process.platform === 'win32'
      ? ['openscad.exe', 'openscad.com']
      : ['openscad', 'OpenSCAD'];

  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fileExists(resolved)) {
      throw new CliError(EXIT.ENGINE_UNAVAILABLE, `--engine path does not exist: ${resolved}`);
    }
    return { path: resolved, source: 'flag' };
  }

  const fromEnv = process.env.OPENSCAD_ENGINE;
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (fileExists(resolved) && isExecutable(resolved)) {
      return { path: resolved, source: 'env' };
    }
    throw new CliError(
      EXIT.ENGINE_UNAVAILABLE,
      `OPENSCAD_ENGINE is set to ${fromEnv} but that is not an executable file.`,
    );
  }

  for (const candidate of coInstalledCandidates()) {
    if (isExecutable(candidate)) {
      return { path: path.resolve(candidate), source: 'co-installed' };
    }
  }

  const onPath = firstExecutableOnPath(names);
  if (onPath) return { path: onPath, source: 'path' };

  throw new CliError(
    EXIT.ENGINE_UNAVAILABLE,
    [
      'Could not find the OpenSCAD engine.',
      '',
      'Install it with one of:',
      '  macOS            brew install atom2ueki/tap/openscad-cli',
      '  Linux            the AppImage or Docker image from the project releases',
      '  any platform     point $OPENSCAD_ENGINE at an OpenSCAD executable',
      '',
      'Run `openscad-cli doctor` for a full environment report.',
    ].join('\n'),
  );
}

/**
 * Candidate paths worth probing when reporting, so `doctor` can say exactly
 * which hooks were checked rather than just "not found".
 */
export function engineSearchReport(): Array<{ where: string; path: string; found: boolean }> {
  const rows: Array<{ where: string; path: string; found: boolean }> = [
    { where: '$OPENSCAD_ENGINE', path: process.env.OPENSCAD_ENGINE ?? '(unset)', found: false },
  ];
  for (const candidate of coInstalledCandidates()) {
    rows.push({ where: 'co-installed', path: candidate, found: isExecutable(candidate) });
  }
  const names = process.platform === 'win32' ? ['openscad.exe'] : ['openscad'];
  const onPath = firstExecutableOnPath(names);
  rows.push({ where: 'PATH', path: onPath ?? '(not found)', found: Boolean(onPath) });
  if (process.env.OPENSCAD_ENGINE) rows[0]!.found = fileExists(process.env.OPENSCAD_ENGINE);
  return rows;
}

/** Best-effort engine version string, e.g. "2026.09.23". */
export function readEngineVersion(enginePath: string): string | undefined {
  try {
    // The engine routes ALL of its human-readable output to stderr, including
    // `--version` (verified against 2026.09.23: stdout is empty, stderr holds
    // "OpenSCAD version 2026.09.23"). Reading only stdout silently yields "".
    const run = spawnSync(enginePath, ['--version'], {
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const match = /(\d{4}\.\d{2}\.\d{2}(?:-[0-9A-Za-z.]+)?)/.exec(out);
    if (match?.[1]) return match[1];
    const trimmed = out.trim();
    return trimmed === '' ? undefined : trimmed;
  } catch {
    return undefined;
  }
}

/** Whether the engine looks like a GUI app bundle rather than a CLI binary. */
export function isMacAppBundle(enginePath: string): boolean {
  return enginePath.includes('.app/Contents/MacOS/');
}

export function engineDirname(enginePath: string): string {
  return path.dirname(fs.realpathSync(enginePath));
}
