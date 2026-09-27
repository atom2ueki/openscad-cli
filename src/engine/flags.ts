// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// The single source of truth for translating our curated flags into the
// engine's own command line. Nothing else in the codebase builds engine argv.

import { CliError, EXIT } from '../exit.js';

export type Format =
  | 'stl'
  | 'off'
  | 'obj'
  | 'wrl'
  | '3mf'
  | 'dxf'
  | 'svg'
  | 'pdf'
  | 'csg'
  | 'ast'
  | 'echo'
  | 'param'
  | 'pov';

export type Backend = 'manifold' | 'cgal';

/**
 * Format -> the value passed to `--export-format`.
 *
 * `stl` is special: the engine's CLI default for a `.stl` output is ASCII, and
 * ASCII is ~7x larger and slower to parse, so we always request binary
 * explicitly rather than relying on the default.
 */
const EXPORT_FORMAT: Record<Format, string> = {
  stl: 'binstl',
  off: 'off',
  obj: 'obj',
  wrl: 'wrl',
  '3mf': '3mf',
  dxf: 'dxf',
  svg: 'svg',
  pdf: 'pdf',
  csg: 'csg',
  ast: 'ast',
  echo: 'echo',
  param: 'param',
  pov: 'pov',
};

const EXTENSION: Record<Format, string> = {
  stl: '.stl',
  off: '.off',
  obj: '.obj',
  wrl: '.wrl',
  '3mf': '.3mf',
  dxf: '.dxf',
  svg: '.svg',
  pdf: '.pdf',
  csg: '.csg',
  ast: '.ast',
  echo: '.echo',
  param: '.param',
  pov: '.pov',
};

export const ALL_FORMATS = Object.keys(EXPORT_FORMAT) as Format[];

/** Formats that carry 3D solid geometry and can be mesh-verified. */
export const MESH_FORMATS: ReadonlySet<Format> = new Set<Format>(['stl', 'off', 'obj', '3mf']);

/** Formats that are 2D vector output, for laser cutting and drawing. */
export const VECTOR_2D_FORMATS: ReadonlySet<Format> = new Set<Format>(['dxf', 'svg', 'pdf', 'pov']);

export function exportFormatOf(format: Format): string {
  return EXPORT_FORMAT[format];
}

export function extensionOf(format: Format): string {
  return EXTENSION[format];
}

export function parseFormat(value: string): Format {
  const key = value.toLowerCase();
  if (key in EXPORT_FORMAT) return key as Format;
  throw new CliError(
    EXIT.USAGE,
    `Unknown --format "${value}". Supported: ${ALL_FORMATS.join(', ')}`,
  );
}

export interface BuildInvocationOptions {
  /** Path to the copied .scad file inside the work directory. */
  inputFile: string;
  /** Absolute path of the output artifact. */
  outputFile: string;
  format: Format;
  backend: Backend;
  /** Where to write the engine's JSON stats. */
  summaryFile: string;
  /** Where to write the engine's Makefile-format dependency list. */
  depsFile: string;
  /** Ordered key/value pairs; values are SCAD expressions, passed verbatim. */
  defines: Array<[string, string]>;
  strict: boolean;
  quiet: boolean;
  verbose: boolean;
  /** Customizer parameter file (-p) and set (-P). */
  paramFile?: string;
  paramSet?: string;
  /** Extra flags appended verbatim by `raw`; disables our own defaults. */
  passthrough?: string[];
}

/**
 * Build the engine argv.
 *
 * Two rules that are easy to get wrong and are load-bearing:
 *
 *  - `shell: false` everywhere. `-D 'mode="parts"'` must reach the engine
 *    byte-for-byte; letting a shell interpret the quotes is the classic way
 *    this breaks, and the failure is silent (the variable just becomes the
 *    wrong value).
 *  - `--summary-file` must point at a *file*, never at `-`. Using `-` would
 *    write JSON to stdout, where our own result JSON also goes.
 */
export function buildInvocation(options: BuildInvocationOptions): string[] {
  if (options.passthrough) {
    // `raw` hands argv to the engine untouched. We still append --quiet only
    // if the caller did not ask for verbosity, and never add --summary-file.
    return options.passthrough;
  }

  const argv: string[] = ['--export-format', exportFormatOf(options.format)];

  argv.push('--backend', options.backend);

  // The engine reports geometry stats only for the sections explicitly
  // enabled; without --summary it writes a literal `null` to the file.
  argv.push('--summary=all');
  argv.push('--summary-file', options.summaryFile);

  argv.push('-d', options.depsFile);
  argv.push('-o', options.outputFile);

  for (const [key, value] of options.defines) {
    argv.push('-D', `${key}=${value}`);
  }

  if (options.paramFile) argv.push('-p', options.paramFile);
  if (options.paramSet) argv.push('-P', options.paramSet);

  if (options.strict) argv.push('--hardwarnings');
  // NOTE: `--quiet` is deliberately NOT passed by default. The engine's
  // `--quiet` suppresses everything except errors, which includes ECHO output
  // and the "Current top level object is empty." message — both of which we
  // need. The engine's statistics block is filtered out in diagnostics/parse.ts
  // instead. Callers who want silence pass --quiet explicitly.
  if (options.quiet) argv.push('--quiet');

  argv.push(options.inputFile);
  return argv;
}

/** Formats the engine can emit that this CLI deliberately does not expose. */
export const INTENTIONALLY_UNSUPPORTED: ReadonlyArray<{ format: string; reason: string }> = [
  { format: 'png', reason: 'requires an OpenGL context; the headless (NULLGL) engine cannot export it' },
  { format: 'nef3 / nefdbg', reason: 'available only in the cgal backend' },
  { format: 'term', reason: 'OpenCSG preview term; only meaningful with a GL preview' },
];
