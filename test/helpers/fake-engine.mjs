#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// A stand-in for the OpenSCAD engine, used by the unit tests so the pipeline
// can be tested without a 100 MB native dependency.
//
// It reproduces the behaviours that actually matter to the CLI, all of which
// were verified against OpenSCAD 2026.09.23:
//
//   - every human-readable message, including --version, goes to STDERR
//   - --summary-file writes JSON, but only for sections named by --summary;
//     with no --summary it writes a literal `null`
//   - the geometry object is backend-dependent: the Manifold 3D shape has no
//     bounding_box, while the cgal shape does
//   - -d writes a Makefile dependency list with backslash continuations
//   - exit codes are only ever 0 or 1
//   - "Current top level object is empty." is printed with no severity prefix
//
// Behaviour is driven by the *name* of the input file, so a test can ask for a
// specific engine response by choosing a fixture.

import * as fs from 'node:fs';
import * as path from 'node:path';

const argv = process.argv.slice(2);

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

if (argv.includes('--version')) {
  process.stderr.write('OpenSCAD version 0.0.0-fake\n');
  process.exit(0);
}

const input = argv[argv.length - 1];
const base = input ? path.basename(input) : '';
const out = flagValue('-o');
const summary = flagValue('--summary-file');
const deps = flagValue('-d');
const backend = flagValue('--backend') ?? 'manifold';
const quiet = argv.includes('--quiet');
const hard = argv.includes('--hardwarnings');
const defines = argv.reduce((acc, a, i) => (a === '-D' ? [...acc, argv[i + 1]] : acc), []);

const say = (line) => {
  if (!quiet) process.stderr.write(`${line}\n`);
};

// A fixture may encode its response, so one file can produce warnings, errors
// or an empty result without needing a separate fake binary.
const control = /FAKE:(\w+)/.exec(safeRead(input));
const scenario = control?.[1] ?? 'ok';

if (scenario === 'syntax') {
  process.stderr.write('ERROR: Parser error: syntax error in file fake.scad, line 3\n');
  process.stderr.write("Can't parse file 'fake.scad'!\n");
  process.exit(1);
}

if (scenario === 'empty') {
  process.stderr.write('Current top level object is empty.\n');
  process.exit(1);
}

if (scenario === 'warn') {
  process.stderr.write('WARNING: Ignoring unknown variable "h" in file fake.scad, line 2\n');
  if (hard) {
    process.stderr.write("TRACE: called by 'echo' in file fake.scad, line 2\n");
    process.exit(1);
  }
}

if (scenario === 'echo') {
  for (const d of defines) process.stderr.write(`ECHO: "${d}"\n`);
}

if (scenario === 'crash') {
  process.kill(process.pid, 'SIGSEGV');
}

// Geometry statistics, shaped per the verified backend matrix.
const size = [20, 10, 5];
const geometry =
  backend === 'cgal'
    ? { bounding_box: { min: [-10, -5, -2.5], max: [10, 5, 2.5], size }, convex: true, dimensions: 3, facets: 6, triangular: false }
    : { dimensions: 3, facets: 12, simple: true, vertices: 8 };

if (summary) {
  // The engine only reports the sections that --summary enabled, and writes
  // `null` when none were.
  const requested = argv.includes('--summary') ? flagValue('--summary') : undefined;
  const payload = requested
    ? { geometry, time: { hours: 0, minutes: 0, seconds: 0, milliseconds: 0, time: '0:00:00.000', total: 0 } }
    : null;
  fs.writeFileSync(summary, `${JSON.stringify(payload)}\n`);
}

if (deps) {
  fs.writeFileSync(deps, `${out}: \\\n\t${input}\n`);
}

if (out) {
  if (scenario === 'nowrite') {
    process.exit(0);
  }
  if (/\.stl$/i.test(out)) {
    // A real 20x10x5 box: 12 triangles, 84-byte header.
    const body = Buffer.alloc(84 + 12 * 50);
    body.writeUInt32LE(12, 80);
    fs.writeFileSync(out, body);
  } else {
    fs.writeFileSync(out, 'fake output\n');
  }
}

if (!quiet) {
  process.stderr.write('Geometries in cache: 1\n');
  process.stderr.write('Geometry cache size in bytes: 856\n');
  process.stderr.write('CGAL Polyhedrons in cache: 0\n');
  process.stderr.write('CGAL cache size in bytes: 0\n');
  process.stderr.write('Total rendering time: 0:00:00.000\n');
  process.stderr.write('Top level object is a 3D object (PolySet):\n');
  process.stderr.write('   Convex:       yes\n');
  process.stderr.write('   Facets:         6\n');
}

process.exit(0);

function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
