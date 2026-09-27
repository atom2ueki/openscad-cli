// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Parser for the OpenSCAD engine's stderr stream.
//
// Verified against OpenSCAD 2026.09.23. Real samples:
//
//   ERROR: Parser error: syntax error in file bad1.scad, line 3
//   Can't parse file 'bad1.scad'!
//   WARNING: Ignoring unknown variable "y" in file warn1.scad, line 2
//   TRACE: called by 'echo' in file warn1.scad, line 2
//   ECHO: "w=42"
//   WARNING: variable "center" not specified as parameter in file nm.scad, line 1
//   Current top level object is empty.
//
// Note the location suffix is `in file <name>, line <N>` with an *unquoted*
// name and no trailing colon, which is not the shape the older documentation
// implies; both forms are accepted here.

import type { Diagnostic, Severity } from '../types.js';
import { classify } from './codes.js';

/** Groups the engine uses, per src/utils/printutils.h Message::str(). */
const GROUP_RE =
  /^(WARNING|ERROR|FONT-WARNING|EXPORT-WARNING|EXPORT-ERROR|PARSER-ERROR|TRACE|DEPRECATED|ECHO):[ \t]*(.*)$/;

/**
 * Trailing location. Handles `in file foo.scad, line 12`, `in file "foo.scad",
 * line 12:` and the `at line N in file "foo.scad"` ordering.
 */
const LOCATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bin file\s+"?([^",\n]+?)"?,\s*line\s+(\d+)/i,
  /\bat line\s+(\d+)\s+in file\s+"?([^",\n]+?)"?/i,
];

interface Record_ {
  group: string;
  lines: string[];
}

function extractLocation(text: string): { file?: string; line?: number; message: string } {
  let file: string | undefined;
  let line: number | undefined;
  let message = text;

  for (const [index, pattern] of LOCATION_PATTERNS.entries()) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (index === 1) {
      line = Number(match[1]);
      file = match[2]?.trim();
    } else {
      file = match[1]?.trim();
      line = Number(match[2]);
    }
    // Strip the location suffix so it does not appear twice.
    message = text.replace(pattern, '').replace(/[\s:.]+$/, '');
    break;
  }

  return { file, line, message };
}

function splitRecords(stderr: string): Record_[] {
  const records: Record_[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const match = GROUP_RE.exec(raw);
    if (match) {
      records.push({ group: match[1] as string, lines: [match[2] ?? ''] });
      continue;
    }
    if (records.length > 0) {
      // Continuation of the previous record. The engine emits multi-line
      // messages (tracebacks, "Can't parse file" follow-ups) this way.
      records[records.length - 1]!.lines.push(raw);
    } else if (raw.trim() !== '') {
      // A message printed before any group line, e.g. "Current top level
      // object is empty." Treated as an unclassified error.
      records.push({ group: 'ENGINE', lines: [raw] });
    }
  }
  return records;
}

export interface ParseResult {
  diagnostics: Diagnostic[];
  /** ECHO payloads, in emission order, with surrounding quotes removed. */
  echo: string[];
}

export function parseStderr(stderr: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const echo: string[] = [];

  for (const record of splitRecords(stderr)) {
    if (isEngineNoise(record)) continue;

    const joined = record.lines.join('\n').trim();
    if (joined === '') continue;

    const located = extractLocation(joined);
    const { severity, code, hint } = classify(located.message, record.group);

    if (record.group === 'ECHO') {
      echo.push(stripEchoQuotes(joined));
      continue;
    }

    const diagnostic: Diagnostic = {
      severity: severity as Severity,
      code,
      message: located.message,
    };
    if (located.file) diagnostic.file = located.file;
    if (located.line !== undefined && Number.isFinite(located.line)) diagnostic.line = located.line;
    if (hint) diagnostic.hint = hint;
    diagnostic.group = record.group;
    diagnostics.push(diagnostic);
  }

  return { diagnostics, echo };
}

/** `ECHO: "w=42"` -> `w=42`; `ECHO: v = [1, 2]` -> `v = [1, 2]`. */
/**
 * The engine prints a human statistics block after every run. It is not a
 * diagnostic, and it must not be mistaken for one — but it can only be
 * suppressed with `--quiet`, which also suppresses ECHO and the
 * "Current top level object is empty." error. So we do not pass `--quiet`, and
 * instead drop these records here.
 *
 * Note `Current top level object is empty.` is deliberately NOT in this list:
 * it is the only signal the engine gives for an empty model.
 */
const NOISE_RE =
  /^(?:Geometries in cache:|Geometry cache size in bytes:|CGAL Polyhedrons in cache:|CGAL cache size in bytes:|Total rendering time:|Top level object is a \d[Dd] object|Rendering (?:Polygon Mesh|Image)|Compiling design|Parsing design|Geometries in cache)/;

function isEngineNoise(record: Record_): boolean {
  const first = (record.lines[0] ?? '').trim();
  return NOISE_RE.test(first);
}

function stripEchoQuotes(text: string): string {
  const body = text.replace(/^ECHO:[ \t]*/, '');
  const match = /^"([\s\S]*)"$/.exec(body);
  return match ? (match[1] as string).replace(/\\"/g, '"') : body;
}

/**
 * Parse an `.echo` export file.
 *
 * The engine writes echo output to this file in its full message-group form
 * (`ECHO: "..."`), so the same prefix and quote stripping as the stderr path
 * must be applied here. Otherwise `inspect --echo` reports the raw envelope
 * instead of the values the model actually produced.
 */
export function parseEchoFile(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(stripEchoQuotes);
}

/** True when any diagnostic should be treated as fatal to the run. */
export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
