// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Result emission. JSON is the default because the primary consumer is an
// agent; text exists for humans reading a terminal.

import type { BuildResult, Diagnostic, VariantResult } from './types.js';
import { EXIT_MEANING } from './exit.js';

export type OutputFormat = 'json' | 'text';

export function emitResult(result: BuildResult, format: OutputFormat, stream = process.stdout): void {
  if (format === 'json') {
    stream.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  // The trailing newline matters: without it a text result runs straight into
  // the next shell prompt, and an agent parsing the stream sees a truncated
  // final line.
  stream.write(`${renderText(result)}\n`);
}

export function emitVariants(results: VariantResult[], format: OutputFormat, stream = process.stdout): void {
  if (format === 'json') {
    // NDJSON: one self-contained object per line, so a consumer can stream
    // results as they finish rather than waiting for the whole batch.
    for (const result of results) stream.write(`${JSON.stringify(result)}\n`);
    return;
  }
  for (const result of results) {
    stream.write(`${renderText(result)}\n`);
  }
}

export function renderText(result: BuildResult): string {
  const lines: string[] = [];
  const target = result.outputs[0];

  lines.push(`${result.status.toUpperCase()}  ${result.command}  (${target?.path ?? 'no artifact'})`);

  if (result.outputs.length > 0) {
    for (const out of result.outputs) {
      lines.push(
        `  wrote ${out.format}  ${out.path}  ${out.bytes ?? 0} bytes  sha256:${(out.sha256 ?? '').slice(0, 12)}`,
      );
    }
  }

  const size = result.stats.boundingBox?.size;
  if (size && size.length) {
    lines.push(`  bbox  ${size.map((n) => round(n)).join(' x ')}`);
  }
  if (result.stats.volume !== undefined) {
    lines.push(`  volume ${round(result.stats.volume)} mm^3   area ${round(result.stats.area ?? 0)} mm^2`);
  }
  if (result.stats.triangles !== undefined) {
    lines.push(`  triangles ${result.stats.triangles}`);
  }

  lines.push(
    `  engine ${result.engine.version} (${result.engine.backends.join('+') || 'unknown'}, ${
      result.engine.profile
    })   render ${result.timings.renderMs} ms   total ${result.timings.totalMs} ms`,
  );

  if (result.cache.hit) lines.push('  cache hit');

  if (result.echo.length > 0) {
    lines.push('  echo:');
    for (const line of result.echo) lines.push(`    ${line}`);
  }

  if (result.diagnostics.length > 0) {
    lines.push(`  ${result.diagnostics.length} diagnostic(s):`);
    for (const d of result.diagnostics) lines.push(...formatDiagnostic(d));
  }

  return lines.join('\n');
}

export function formatDiagnostic(d: Diagnostic): string[] {
  const where = d.file ? ` (${d.file}${d.line ? `:${d.line}` : ''})` : '';
  const out = [`    ${d.severity.toUpperCase()} [${d.code}] ${d.message}${where}`];
  if (d.hint) out.push(`      hint: ${d.hint}`);
  return out;
}

/** Error output for conditions that never produce a BuildResult. */
export function emitError(code: number, message: string, detail: unknown, stream = process.stderr): void {
  if (detail === undefined) {
    stream.write(`error: ${message}\n`);
    return;
  }
  stream.write(
    `${JSON.stringify(
      { schema: 'openscad-cli/error@1', status: 'error', exitCode: code, meaning: EXIT_MEANING[code], message, detail },
      null,
      2,
    )}\n`,
  );
}

function round(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
