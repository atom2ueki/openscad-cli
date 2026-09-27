// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Shared context for every command: engine resolution, engine identification,
// and the defaults that the global flags control.

import * as os from 'node:os';
import * as path from 'node:path';
import { CliError, EXIT } from '../exit.js';
import type { ParsedArgs } from '../args.js';
import { optNumber, optString } from '../args.js';
import { engineDirname, readEngineVersion, resolveEngine, type ResolvedEngine } from '../engine/locate.js';
import { guessMcadPath } from '../engine/invoke.js';
import type { EngineInfo } from '../types.js';

export const DEFAULT_TIMEOUT_MS = 300_000;

export interface Context {
  engine: ResolvedEngine;
  engineInfo: EngineInfo;
  timeoutMs: number;
  useCache: boolean;
  quiet: boolean;
  verbose: boolean;
  engineFlag?: string;
}

/** Default work directory, beside the artifact so it travels with it. */
export function defaultWorkdirRoot(outputPath: string): string {
  return path.join(path.dirname(outputPath), '.openscad-cli');
}

export async function makeContext(args: ParsedArgs, outputPath = process.cwd()): Promise<Context> {
  const engineFlag = optString(args, '--engine');
  const engine = resolveEngine(engineFlag);
  const version = readEngineVersion(engine.path) ?? 'unknown';

  // Build a profile fingerprint from what the engine reports, rather than
  // trusting a hard-coded list: `cgal --help` mentions CGAL, and the presence
  // of the nef/3mf formats varies with how the engine was configured.
  const profile: EngineInfo['profile'] = process.env.OPENSCAD_CLI_PROFILE === 'lite' ? 'lite' : 'full';

  const engineInfo: EngineInfo = {
    version,
    // A packaged engine records its own build; a git checkout of ours records
    // the submodule SHA. Both are recorded in the result so a cached artifact
    // can never be reused across an engine change.
    sha: process.env.OPENSCAD_ENGINE_SHA ?? `v${version}`,
    profile,
    backends: [process.env.OPENSCAD_CLI_BACKEND ?? 'manifold'],
    path: engine.path,
  };

  return {
    engine,
    engineInfo,
    timeoutMs: optNumber(args, '--timeout', DEFAULT_TIMEOUT_MS) * 1000,
    useCache: !args.flags.has('--no-cache'),
    quiet: args.quiet,
    verbose: args.verbose,
    ...(engineFlag ? { engineFlag } : {}),
  };
}

export function requirePositional(args: ParsedArgs, index: number, what: string): string {
  const value = args.positionals[index];
  if (!value) throw new CliError(EXIT.USAGE, `Missing ${what}.`);
  return value;
}

/** Where a variant's engine-side summary and deps land. */
export function workdirForVariant(root: string, tag: string): string {
  return path.join(root, tag);
}

export function defaultConcurrency(): number {
  const cpus = os.availableParallelism?.() ?? os.cpus().length ?? 1;
  return Math.max(1, Math.floor(cpus / 2));
}
