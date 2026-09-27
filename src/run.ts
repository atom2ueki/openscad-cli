// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// The build pipeline. One function, `runBuild`, implements the flow:
//
//   resolve engine -> key -> cache lookup -> invoke -> collect -> verify -> emit
//
// and is shared by `build`, `validate` and `variants` so the contract cannot
// drift between commands.
//
// Note on working directory: the engine resolves relative include/use/import
// paths against the *including file's* directory, so the model is invoked in
// place with absolute paths rather than copied into the work directory.
// Copying only the top-level .scad would break `include <lib.scad>`, and
// copying the whole tree would be both slower and lossy. Passing absolute
// paths still makes the run independent of the caller's cwd, which is what
// reproducibility requires.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { lookupCache, computeCacheKey, parseDepsFile, storeCache, workDirFor } from './cache/index.js';
import { buildInvocation, type Backend, type Format } from './engine/flags.js';
import { invokeEngine } from './engine/invoke.js';
import type { ResolvedEngine } from './engine/locate.js';
import { hasErrors, parseEchoFile, parseStderr } from './diagnostics/parse.js';
import { verify } from './verify/rules.js';
import {
  LICENSE_SPDX,
  RESULT_SCHEMA,
  SOURCE_URL,
  type BuildResult,
  type Diagnostic,
  type EngineInfo,
} from './types.js';
import { ensureDir, fileExists, sha256, sha256File, writeFileAtomic } from './util/fsx.js';

export interface RunOptions {
  engine: ResolvedEngine;
  engineInfo: EngineInfo;
  /** Absolute path to the .scad file. */
  inputPath: string;
  /** Absolute path for the output artifact. */
  outputPath: string;
  format: Format;
  backend: Backend;
  defines: Array<[string, string]>;
  paramFile?: string;
  paramSet?: string;
  strict: boolean;
  quiet: boolean;
  verbose: boolean;
  timeoutMs: number;
  workdirRoot: string;
  useCache: boolean;
  verifyMesh: boolean;
  maxDimension: number;
  maxTriangles: number;
  minArea: number;
  keepWorkdir: boolean;
  keepFailed: boolean;
  command: string;
  /** When true, do not write an artifact; used by `validate`. */
  dryRun: boolean;
}

export class RunTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`The engine did not finish within ${Math.round(ms / 1000)}s and was killed.`);
    this.name = 'RunTimeoutError';
  }
}

export async function runBuild(options: RunOptions): Promise<BuildResult> {
  const startedAt = Date.now();
  const sourceText = fs.readFileSync(options.inputPath, 'utf8');
  const sourceSha = sha256(sourceText);

  const key = computeCacheKey({
    engineSha: options.engineInfo.sha,
    engineVersion: options.engineInfo.version,
    sourceSha,
    defines: options.defines,
    format: options.format,
    backend: options.backend,
    strict: options.strict,
    extra: {
      paramFile: options.paramFile,
      paramSet: options.paramSet,
      verifyMesh: options.verifyMesh,
    },
  });

  const workDir = workDirFor(options.workdirRoot, key);
  const summaryFile = path.join(workDir, 'summary.json');
  const depsFile = path.join(workDir, 'deps.mk');

  // ---- cache lookup --------------------------------------------------------
  if (options.useCache) {
    const lookup = lookupCache(workDir);
    if (lookup.hit && lookup.entry) {
      const result = lookup.entry.result as BuildResult;
      // Restore the artifact if the user deleted or moved it.
      if (!options.dryRun && !fileExists(options.outputPath)) {
        ensureDir(path.dirname(options.outputPath));
        fs.copyFileSync(lookup.entry.artifact, options.outputPath);
      }
      return { ...result, cache: { key, hit: true } };
    }
  }

  ensureDir(workDir);

  // ---- invoke --------------------------------------------------------------
  const argv = buildInvocation({
    inputFile: options.inputPath,
    outputFile: options.outputPath,
    format: options.format,
    backend: options.backend,
    summaryFile,
    depsFile,
    defines: options.defines,
    strict: options.strict,
    quiet: options.quiet,
    verbose: options.verbose,
    ...(options.paramFile ? { paramFile: options.paramFile } : {}),
    ...(options.paramSet ? { paramSet: options.paramSet } : {}),
  });

  const invocation = await invokeEngine({
    enginePath: options.engine.path,
    argv,
    // Run in the model's own directory so relative includes resolve, while
    // every path we pass is absolute.
    cwd: path.dirname(options.inputPath),
    timeoutMs: options.timeoutMs,
  });

  if (invocation.timedOut) {
    throw new RunTimeoutError(options.timeoutMs);
  }

  // ---- collect -------------------------------------------------------------
  const { diagnostics: engineDiagnostics, echo: stderrEcho } = parseStderr(invocation.stderr);
  const diagnostics: Diagnostic[] = [...engineDiagnostics];
  let echo = stderrEcho;

  // With the `echo` export format the engine routes echo() output to the
  // output file rather than stderr, so read it back from the artifact. Without
  // this, `inspect --echo` would always report an empty list.
  if (options.format === 'echo' && fileExists(options.outputPath)) {
    try {
      const fromFile = parseEchoFile(fs.readFileSync(options.outputPath, 'utf8'));
      if (fromFile.length > 0) echo = fromFile;
    } catch {
      /* keep whatever came from stderr */
    }
  }

  if (invocation.signal) {
    diagnostics.push({
      severity: 'error',
      code: 'engine.crashed',
      message: `The engine terminated on signal ${invocation.signal} (exit code ${invocation.exitCode}).`,
      hint: 'This is an engine crash, usually out of memory on a very large model. Try lowering $fn, or --backend manifold.',
    });
  }

  // The engine only ever exits 0 or 1, and it can exit 1 after already writing
  // the artifact (e.g. an export warning it chose to treat as fatal). Anything
  // it did not explain becomes a synthetic diagnostic so no failure is silent.
  if (invocation.exitCode !== 0 && !hasErrors(diagnostics)) {
    diagnostics.push({
      severity: 'error',
      code: 'engine.failed',
      message: `The engine exited with code ${invocation.exitCode} without reporting an error.`,
      hint: 'Re-run with --verbose to see the full engine log, and --debug=all for internal tracing.',
    });
  }

  // ---- verify --------------------------------------------------------------
  const verification = verify({
    summaryFile,
    outputFile: options.outputPath,
    diagnostics,
    verifyMesh: options.verifyMesh && !options.dryRun && fileExists(options.outputPath),
    maxDimension: options.maxDimension,
    maxTriangles: options.maxTriangles,
    minArea: options.minArea,
  });

  const totalMs = Date.now() - startedAt;
  const renderMs = readRenderMs(verification.stats.time);

  const outputs = [];
  if (!options.dryRun && fileExists(options.outputPath)) {
    outputs.push({
      format: options.format,
      path: options.outputPath,
      sha256: sha256File(options.outputPath) ?? '',
      bytes: fs.statSync(options.outputPath).size,
    });
  }

  const result: BuildResult = {
    schema: RESULT_SCHEMA,
    status: verification.status,
    command: options.command,
    engine: options.engineInfo,
    input: {
      path: options.inputPath,
      sha256: sourceSha,
      defines: Object.fromEntries(options.defines),
    },
    outputs,
    stats: verification.stats,
    diagnostics: verification.diagnostics,
    cache: { key, hit: false },
    timings: { totalMs, renderMs },
    license: { spdx: LICENSE_SPDX, source: SOURCE_URL },
    echo,
  };

  // ---- cleanup and caching -------------------------------------------------
  if (result.status === 'error' && !options.keepFailed && outputs.length > 0) {
    // A failed render may have left a truncated or invalid artifact behind.
    for (const out of outputs) {
      try {
        fs.unlinkSync(out.path);
      } catch {
        /* best effort */
      }
    }
    result.outputs = [];
  }

  if (options.useCache && result.status !== 'error' && outputs.length > 0) {
    const depsText = fileExists(depsFile) ? fs.readFileSync(depsFile, 'utf8') : '';
    const dependencies: Record<string, string> = {};
    for (const dep of parseDepsFile(depsText)) {
      const resolved = path.resolve(path.dirname(options.inputPath), dep);
      const hash = sha256File(resolved);
      if (hash) dependencies[resolved] = hash;
    }
    try {
      storeCache(
        workDir,
        {
          key,
          dependencies,
          artifact: options.outputPath,
          artifactFormat: options.format,
          result: { ...result, cache: { key, hit: true } },
        },
        options.outputPath,
      );
    } catch {
      /* a cache write failure must never fail the build */
    }
  }

  if (!options.keepWorkdir && result.status === 'error') {
    // Keep the work dir for the failing case: it holds summary.json and
    // deps.mk, which are the first thing anyone debugs.
  }

  if (options.keepFailed || options.keepWorkdir) {
    result.stats = { ...result.stats, workDir } as typeof result.stats;
  }

  return result;
}

/** Render time in ms from the engine's `time` block, when present. */
function readRenderMs(time: Record<string, unknown> | undefined): number {
  if (!time) return 0;
  const ms = time['milliseconds'];
  const seconds = time['seconds'];
  const minutes = time['minutes'];
  const hours = time['hours'];
  const numeric = [ms, seconds, minutes, hours].map((v) => (typeof v === 'number' ? v : 0));
  return numeric[0]! + numeric[1]! * 1000 + numeric[2]! * 60_000 + numeric[3]! * 3_600_000;
}
