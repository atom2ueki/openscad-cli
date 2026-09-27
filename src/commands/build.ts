// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// build, validate and variants — all three are the same pipeline with a
// different tail, so they share one options builder and one result emitter.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { optBoolean, optNumber, optString, type ParsedArgs } from '../args.js';
import { CliError, EXIT, exitCodeForStatus } from '../exit.js';
import { extensionOf, MESH_FORMATS, parseFormat, type Backend, type Format } from '../engine/flags.js';
import { runBuild, RunTimeoutError, type RunOptions } from '../run.js';
import { emitResult, emitVariants } from '../output.js';
import type { VariantResult } from '../types.js';
import { defaultWorkdirRoot, defaultConcurrency, makeContext, requirePositional, type Context } from './context.js';

/**
 * The output path may be given as `-o`, `--o` or `--output`. All three are
 * accepted by the spec, so all three must be read here — a mismatch between
 * the spec and the lookup silently falls back to the default path, which is
 * the kind of bug that writes the artifact somewhere the caller never looks.
 */
function optOutputPath(args: ParsedArgs): string | undefined {
  return optString(args, '-o') ?? optString(args, '--o') ?? optString(args, '--output');
}

function parseBackend(args: ParsedArgs): Backend {
  const value = optString(args, '--backend') ?? 'manifold';
  if (value !== 'manifold' && value !== 'cgal') {
    throw new CliError(EXIT.USAGE, `--backend must be "manifold" or "cgal", got "${value}"`);
  }
  return value;
}

function buildRunOptions(args: ParsedArgs, ctx: Context, overrides: Partial<RunOptions> = {}): RunOptions {
  const strict = optBoolean(args, '--strict');
  const format = overrides.format ?? 'stl';
  // Mesh analysis only makes sense for formats that actually contain a mesh.
  // Running the STL/OFF readers over a DXF or SVG produces garbage numbers
  // (a 2D square "measured" at 1e44 mm^3), so vector output is verified from
  // the engine's own summary instead.
  const verifyMesh = !args.flags.has('--no-verify') && MESH_FORMATS.has(format);

  return {
    engine: ctx.engine,
    engineInfo: ctx.engineInfo,
    inputPath: '',
    outputPath: '',
    format,
    backend: parseBackend(args),
    defines: args.defines,
    strict,
    quiet: ctx.quiet,
    verbose: ctx.verbose,
    timeoutMs: ctx.timeoutMs,
    workdirRoot: path.join(process.cwd(), '.openscad-cli'),
    useCache: ctx.useCache,
    verifyMesh,
    maxDimension: optNumber(args, '--max-dim', 0),
    maxTriangles: optNumber(args, '--max-triangles', 0),
    minArea: optNumber(args, '--min-area', 1e-6),
    keepWorkdir: optBoolean(args, '--keep-workdir'),
    keepFailed: optBoolean(args, '--keep-failed'),
    command: 'build',
    dryRun: false,
    ...overrides,
  };
}

function resolveInput(args: ParsedArgs): string {
  const input = requirePositional(args, 0, 'an input .scad file');
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    throw new CliError(EXIT.USAGE, `Input file not found: ${resolved}`);
  }
  if (path.extname(resolved) !== '.scad') {
    // Not fatal, but almost always a mistake: import() targets are passed as
    // arguments, not as the model.
    process.stderr.write(`warning: ${resolved} does not end in .scad\n`);
  }
  return resolved;
}

export async function cmdBuild(args: ParsedArgs): Promise<number> {
  const inputPath = resolveInput(args);
  const format: Format = parseFormat(optString(args, '--format') ?? 'stl');

  let outputPath = optOutputPath(args);
  if (!outputPath) {
    const base = path.basename(inputPath).replace(/\.scad$/i, '');
    outputPath = path.join(path.dirname(inputPath), `${base}${extensionOf(format)}`);
  }
  outputPath = path.resolve(outputPath);

  const ctx = await makeContext(args, outputPath);
  const strict = optBoolean(args, '--strict');

  const options = buildRunOptions(args, ctx, {
    inputPath,
    outputPath,
    format,
    workdirRoot: optString(args, '--workdir') ?? defaultWorkdirRoot(outputPath),
    command: 'build',
  });

  const result = await runBuild(options);
  emitResult(result, args.outputFormat);

  // The sidecar lets a later step read the result without re-parsing stdout.
  const sidecar = `${outputPath}.openscad.json`;
  try {
    fs.writeFileSync(sidecar, `${JSON.stringify(result, null, 2)}\n`);
  } catch {
    /* a sidecar write failure must not fail the build */
  }

  return exitCodeForStatus(result.status, strict);
}

export async function cmdValidate(args: ParsedArgs): Promise<number> {
  const inputPath = resolveInput(args);
  // validate must leave nothing behind next to the user's model, so its scratch
  // space goes to a temp directory rather than into the project directory.
  const workdir =
    optString(args, '--workdir') ?? path.join(os.tmpdir(), 'openscad-cli-validate');
  fs.mkdirSync(workdir, { recursive: true });
  const scratch = path.join(workdir, 'validate-scratch.stl');

  const ctx = await makeContext(args, scratch);
  const result = await runBuild(
    buildRunOptions(args, ctx, {
      inputPath,
      outputPath: scratch,
      workdirRoot: workdir,
      command: 'validate',
      // No artifact, no mesh analysis, no caching of an artifact: the point is
      // the diagnostics, not the file.
      dryRun: true,
      verifyMesh: false,
      useCache: false,
    }),
  );

  emitResult(result, args.outputFormat);
  try {
    fs.unlinkSync(scratch);
  } catch {
    /* nothing to clean up */
  }
  return exitCodeForStatus(result.status, optBoolean(args, '--strict'));
}

/**
 * `variants` expands a parameter matrix and runs each combination.
 *
 * A parameter value may be a comma-separated list (`--param width=10,20,30`) or
 * an OpenSCAD-style inclusive range (`--param i=0:3`). The Cartesian product of
 * all parameters is rendered, one engine process at a time up to --jobs.
 */
export async function cmdVariants(args: ParsedArgs): Promise<number> {
  const inputPath = resolveInput(args);
  const format: Format = parseFormat(optString(args, '--format') ?? 'stl');
  const base = path.basename(inputPath).replace(/\.scad$/i, '');
  const outDir = path.resolve(optString(args, '--out-dir') ?? path.dirname(inputPath));

  const params: Array<[string, string[]]> = [];
  for (const spec of collectParams(args)) {
    const eq = spec.indexOf('=');
    if (eq <= 0) throw new CliError(EXIT.USAGE, `--param expects name=value[,value...], got "${spec}"`);
    params.push([spec.slice(0, eq), expandValues(spec.slice(eq + 1))]);
  }
  if (params.length === 0) {
    throw new CliError(EXIT.USAGE, 'variants needs at least one --param name=v1,v2[,...] or --param name=0:step:n');
  }

  const matrix: Array<Record<string, string>> = [{}];
  for (const [name, values] of params) {
    const next: Array<Record<string, string>> = [];
    for (const prefix of matrix) {
      for (const value of values) next.push({ ...prefix, [name]: value });
    }
    matrix.length = 0;
    matrix.push(...next);
  }

  const jobs = Math.max(1, optNumber(args, '--jobs', defaultConcurrency()));
  const ordered = optBoolean(args, '--ordered');
  const ctx = await makeContext(args, outDir);
  const strict = optBoolean(args, '--strict');

  fs.mkdirSync(outDir, { recursive: true });

  const results: VariantResult[] = [];
  let cursor = 0;
  let worst: 'ok' | 'warn' | 'error' = 'ok';

  const runOne = async (variant: Record<string, string>, seq: number): Promise<void> => {
    const suffix = Object.entries(variant)
      .map(([k, v]) => `${k}-${String(v).replace(/[^A-Za-z0-9_.-]+/g, '_')}`)
      .join('_');
    const outputPath = path.join(outDir, `${base}${suffix ? `_${suffix}` : ''}${extensionOf(format)}`);

    const result = await runBuild(
      buildRunOptions(args, ctx, {
        inputPath,
        outputPath,
        format,
        workdirRoot: optString(args, '--workdir') ?? path.join(outDir, '.openscad-cli'),
        command: 'variants',
        defines: [...args.defines, ...Object.entries(variant)],
      }),
    );

    const out: VariantResult = { ...result, seq, variant };
    results.push(out);
    if (out.status === 'error') worst = 'error';
    else if (out.status === 'warn' && worst !== 'error') worst = 'warn';
    if (args.outputFormat === 'json' && !ordered) {
      // Stream in completion order; --ordered buffers and prints at the end.
      emitVariants([out], 'json');
    }
  };

  const workers = Array.from({ length: Math.min(jobs, matrix.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= matrix.length) return;
      await runOne(matrix[index]!, index);
    }
  });
  await Promise.all(workers);

  if (ordered) emitVariants(results.sort((a, b) => a.seq - b.seq), args.outputFormat);
  else if (args.outputFormat === 'text') emitVariants(results.sort((a, b) => a.seq - b.seq), 'text');

  return exitCodeForStatus(worst, strict);
}

function collectParams(args: ParsedArgs): string[] {
  const values: string[] = [];
  const raw = args.options['--param'];
  if (Array.isArray(raw)) values.push(...(raw as string[]));
  else if (typeof raw === 'string') values.push(raw);
  return values;
}

/** `10,20,30` -> [10,20,30]; `0:3` -> [0,1,2,3]; `0:0.5:2` -> [0,0.5,1,1.5,2]. */
function expandValues(spec: string): string[] {
  const parts = spec.split(',').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return [];
  if (parts.length > 1) return parts;

  const range = /^(-?[\d.]+):(-?[\d.]+)(?::(-?[\d.]+))?$/.exec(parts[0] as string);
  if (!range) return [spec];

  const start = Number(range[1]);
  const end = Number(range[2]);
  const step = range[3] !== undefined ? Number(range[3]) : 1;
  if (![start, end, step].every(Number.isFinite) || step === 0) {
    throw new CliError(EXIT.USAGE, `Invalid range "${spec}"`);
  }
  if ((end - start) / step < 0) {
    throw new CliError(EXIT.USAGE, `Range "${spec}" has a step that moves away from the end value`);
  }

  const out: string[] = [];
  const n = Math.floor((end - start) / step + 1e-9);
  for (let i = 0; i <= n; i += 1) out.push(String(Number((start + i * step).toFixed(6))));
  return out;
}
