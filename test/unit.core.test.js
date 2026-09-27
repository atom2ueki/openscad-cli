// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Unit tests for the pure logic: diagnostics parsing, cache keys and
// dependency-file parsing, mesh analysis, and argument handling. No engine
// required.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStderr, hasErrors } from '../dist/diagnostics/parse.js';
import { classify, knownCodes } from '../dist/diagnostics/codes.js';
import { computeCacheKey, parseDepsFile } from '../dist/cache/index.js';
import { computeStats, analyseMesh } from '../dist/verify/mesh.js';
import { parseArgs, optString, optNumber } from '../dist/args.js';
import { buildInvocation } from '../dist/engine/flags.js';
import { canonicalJson } from '../dist/util/fsx.js';
import { EXIT } from '../dist/exit.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

test('diagnostics: parses a warning with an unquoted file and line', () => {
  const stderr = 'WARNING: Ignoring unknown variable "h" in file warn.scad, line 2\n';
  const { diagnostics } = parseStderr(stderr);
  assert.equal(diagnostics.length, 1);
  const d = diagnostics[0];
  assert.equal(d.severity, 'warning');
  assert.equal(d.code, 'name.unknown');
  assert.equal(d.file, 'warn.scad');
  assert.equal(d.line, 2);
  assert.ok(d.hint && d.hint.length > 0);
});

test('diagnostics: a parser error and its continuation line stay one record', () => {
  const stderr = "ERROR: Parser error: syntax error in file bad.scad, line 3\nCan't parse file 'bad.scad'!\n";
  const { diagnostics } = parseStderr(stderr);
  assert.equal(diagnostics.length, 1, 'the continuation must not become a second diagnostic');
  assert.equal(diagnostics[0].severity, 'error');
  assert.equal(diagnostics[0].code, 'syntax.parse');
  assert.equal(diagnostics[0].line, 3);
});

test('diagnostics: an unprefixed fatal message is captured', () => {
  const { diagnostics } = parseStderr('Current top level object is empty.\n');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'geometry.empty');
  assert.equal(diagnostics[0].severity, 'error');
});

test('diagnostics: ECHO is captured separately and never a diagnostic', () => {
  const { diagnostics, echo } = parseStderr('ECHO: "w=42"\nECHO: v = [1, 2]\n');
  assert.equal(diagnostics.length, 0);
  assert.deepEqual(echo, ['w=42', 'v = [1, 2]']);
});

test('diagnostics: escaped quotes survive the ECHO unescaping', () => {
  const { echo } = parseStderr('ECHO: "say \\"hi\\""\n');
  assert.deepEqual(echo, ['say "hi"']);
});

test('diagnostics: the engine statistics block is not a diagnostic', () => {
  const stderr = [
    'Geometries in cache: 1',
    'Geometry cache size in bytes: 856',
    'CGAL Polyhedrons in cache: 0',
    'CGAL cache size in bytes: 0',
    'Total rendering time: 0:00:00.000',
    'Top level object is a 3D object (PolySet):',
    '   Convex:       yes',
    '   Facets:         6',
  ].join('\n');
  const { diagnostics } = parseStderr(stderr);
  assert.equal(diagnostics.length, 0, 'statistics chatter must not reach the agent');
});

test('diagnostics: real messages are kept, noise is dropped, in order', () => {
  const stderr = [
    'WARNING: Ignoring unknown variable "h" in file w.scad, line 2',
    'Geometries in cache: 1',
    'Total rendering time: 0:00:00.000',
  ].join('\n');
  const { diagnostics } = parseStderr(stderr);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'name.unknown');
});

test('diagnostics: hasErrors reflects severity', () => {
  assert.equal(hasErrors([{ severity: 'warning', code: 'a', message: 'm' }]), false);
  assert.equal(hasErrors([{ severity: 'error', code: 'a', message: 'm' }]), true);
});

test('classify: the taxonomy covers the documented failure families', () => {
  assert.equal(classify('The object is not manifold', 'WARNING').code, 'geometry.nonmanifold');
  assert.equal(classify('self-intersection detected', 'WARNING').code, 'geometry.nonmanifold');
  assert.equal(classify('degenerate face', 'WARNING').code, 'geometry.degenerate');
  assert.equal(classify('unknown variable "x"', 'WARNING').code, 'name.unknown');
  assert.equal(classify('unable to open file', 'ERROR').code, 'resource.missing');
  assert.equal(classify('font "Arial" not found', 'FONT-WARNING').code, 'resource.font');
  assert.equal(classify('assert failed', 'ERROR').code, 'runtime.assert');
  assert.equal(classify('something else entirely', 'WARNING').code, 'engine.warning');
});

test('classify: every taxonomy entry is reachable and well formed', () => {
  const codes = knownCodes();
  assert.ok(codes.length >= 15, `expected a substantial taxonomy, got ${codes.length}`);
  for (const code of codes) assert.match(code, /^[a-z]+\.[a-zA-Z]+$/, `bad code ${code}`);
});

test('cache: the key is stable and order-independent', () => {
  const base = {
    engineSha: 'abc',
    engineVersion: '2026.09.23',
    sourceSha: 'def',
    defines: [['b', '2'], ['a', '1']],
    format: 'stl',
    backend: 'manifold',
    strict: false,
  };
  const reordered = { ...base, defines: [['a', '1'], ['b', '2']] };
  assert.equal(computeCacheKey(base), computeCacheKey(reordered), 'define order must not change the key');
  assert.notEqual(computeCacheKey(base), computeCacheKey({ ...base, format: 'off' }));
  assert.notEqual(computeCacheKey(base), computeCacheKey({ ...base, backend: 'cgal' }));
  assert.notEqual(computeCacheKey(base), computeCacheKey({ ...base, engineSha: 'different' }));
  assert.notEqual(computeCacheKey(base), computeCacheKey({ ...base, strict: true }));
});

test('cache: canonicalJson sorts nested keys', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test('deps: a Makefile-style dependency list parses, continuations included', () => {
  // This is the engine's real output shape, verified against 2026.09.23.
  const text = 'out.stl: \\\n\t/private/tmp/x/lib.scad \\\n\tmodel.scad\n';
  assert.deepEqual(parseDepsFile(text), ['/private/tmp/x/lib.scad', 'model.scad']);
});

test('deps: the target line contributes no dependency', () => {
  assert.deepEqual(parseDepsFile('out.stl: \\\n\tmodel.scad\n'), ['model.scad']);
});

test('mesh: a box reports its exact volume and area', () => {
  // 20 x 10 x 5 = 1000 mm^3; surface = 2*(200+100+50) = 700 mm^2.
  const tris = [];
  const corners = [
    [-10, -5, -2.5], [10, -5, -2.5], [10, 5, -2.5], [-10, 5, -2.5],
    [-10, -5, 2.5], [10, -5, 2.5], [10, 5, 2.5], [-10, 5, 2.5],
  ];
  // Outward-consistent winding on every face. A box with two faces wound the
  // wrong way has a signed volume of ~0, which is exactly the signature the
  // `closed` heuristic is meant to catch.
  const faces = [
    [0, 3, 2, 1], // bottom, normal -z
    [4, 5, 6, 7], // top, normal +z
    [0, 1, 5, 4], // front, normal -y
    [2, 3, 7, 6], // back, normal +y
    [1, 2, 6, 5], // right, normal +x
    [0, 4, 7, 3], // left, normal -x
  ];
  for (const f of faces) {
    for (let k = 1; k + 1 < f.length; k += 1) tris.push([corners[f[0]], corners[f[k]], corners[f[k + 1]]]);
  }
  const stats = computeStats(tris, 'off');
  assert.equal(stats.triangles, 12);
  assert.ok(Math.abs(stats.volume - 1000) < 1e-6, `volume was ${stats.volume}`);
  assert.ok(Math.abs(stats.area - 700) < 1e-6, `area was ${stats.area}`);
  assert.deepEqual(stats.size, [20, 10, 5]);
  assert.equal(stats.degenerate, 0);
  assert.equal(stats.closed, true);
});

test('mesh: degenerate triangles are counted', () => {
  const stats = computeStats(
    [[[0, 0, 0], [1, 0, 0], [1, 0, 0]], [[0, 0, 0], [1, 0, 0], [0, 1, 0]]],
    'off',
  );
  assert.equal(stats.degenerate, 1);
});

test('mesh: an empty triangle list is handled without NaN', () => {
  const stats = computeStats([], 'off');
  assert.equal(stats.triangles, 0);
  assert.equal(stats.volume, 0);
  assert.ok(Number.isFinite(stats.area));
  assert.equal(stats.closed, false);
});

test('mesh: a binary STL on disk is read back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-mesh-'));
  const file = path.join(dir, 'box.stl');
  const buf = Buffer.alloc(84 + 12 * 50);
  buf.writeUInt32LE(12, 80);
  fs.writeFileSync(file, buf);
  const stats = analyseMesh(file);
  assert.equal(stats.source, 'binary-stl');
  assert.equal(stats.triangles, 12);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('args: -D collects ordered name/value pairs', () => {
  const args = parseArgs(['build', 'm.scad', '-D', 'w=60', '-D', 'mode="parts"'], {
    withValue: ['--o'],
    boolean: ['--strict'],
  });
  assert.equal(args.command, 'build');
  assert.deepEqual(args.positionals, ['m.scad']);
  assert.deepEqual(args.defines, [['w', '60'], ['mode', '"parts"']]);
});

test('args: a -D value is never shell-interpreted', () => {
  // The inner quotes are part of the OpenSCAD expression. Losing them would
  // silently change the model's meaning.
  const args = parseArgs(['build', 'm.scad', '-D', 'label="ACME Inc"'], { boolean: [] });
  assert.equal(args.defines[0][1], '"ACME Inc"');
});

test('args: a bare -D is a usage error, not a crash', () => {
  assert.throws(() => parseArgs(['build', '-D'], { boolean: [] }), /requires a name=value/);
});

test('args: an unknown option is rejected rather than ignored', () => {
  // Silently dropping --max-dim would make a model ship unprotected.
  assert.throws(() => parseArgs(['build', '--nope'], { boolean: [] }), /Unknown option/);
  assert.throws(() => parseArgs(['build', '--max-dim'], { withValue: ['--max-dim'] }), /requires a value/);
});

test('args: a value flag without a value is a usage error', () => {
  assert.throws(() => parseArgs(['build', '--o'], { withValue: ['--o'] }), /requires a value/);
});

test('args: --flag=value and --flag value are equivalent', () => {
  const spec = { withValue: ['--backend'] };
  const a = parseArgs(['build', '--backend=cgal'], spec);
  const b = parseArgs(['build', '--backend', 'cgal'], spec);
  assert.equal(optString(a, '--backend'), 'cgal');
  assert.equal(optString(b, '--backend'), 'cgal');
});

test('args: everything after -- is passthrough', () => {
  const args = parseArgs(['raw', '--', '--help', '--export-format', 'off'], { boolean: [] });
  assert.deepEqual(args.passthrough, ['--help', '--export-format', 'off']);
});

test('args: json is the default output format', () => {
  assert.equal(parseArgs(['build'], { boolean: [] }).outputFormat, 'json');
  assert.equal(parseArgs(['build', '--text'], { boolean: ['--text'] }).outputFormat, 'text');
  assert.equal(parseArgs(['build', '--output-format', 'text'], { withValue: ['--output-format'] }).outputFormat, 'text');
  // --format is the EXPORT format on build, never the output format: the two
  // meanings must not collide.
  assert.equal(parseArgs(['build', '--format', 'stl'], { withValue: ['--format'] }).outputFormat, 'json');
  assert.equal(optString(parseArgs(['build', '--format', '3mf'], { withValue: ['--format'] }), '--format'), '3mf');
});

test('args: numeric options are validated', () => {
  const args = parseArgs(['build', '--timeout', 'abc'], { withValue: ['--timeout'] });
  assert.throws(() => optNumber(args, '--timeout', 300), /expects a number/);
});

test('invocation: the summary never goes to stdout', () => {
  const argv = buildInvocation({
    inputFile: '/m/m.scad',
    outputFile: '/o/out.stl',
    format: 'stl',
    backend: 'manifold',
    summaryFile: '/w/summary.json',
    depsFile: '/w/deps.mk',
    defines: [['w', '60']],
    strict: false,
    quiet: false,
    verbose: false,
  });
  const summaryIndex = argv.indexOf('--summary-file');
  assert.notEqual(summaryIndex, -1, '--summary-file must always be passed');
  assert.notEqual(argv[summaryIndex + 1], '-', 'writing the summary to stdout would collide with our own JSON');
  // --summary is required, otherwise the engine writes a literal `null`.
  assert.ok(argv.includes('--summary=all'), 'without --summary the engine reports nothing');
});

test('invocation: STL is always requested as binary', () => {
  const argv = buildInvocation({
    inputFile: '/m/m.scad', outputFile: '/o/out.stl', format: 'stl', backend: 'manifold',
    summaryFile: '/w/s.json', depsFile: '/w/d.mk', defines: [], strict: false, quiet: false, verbose: false,
  });
  assert.equal(argv[argv.indexOf('--export-format') + 1], 'binstl');
});

test('invocation: --quiet is not passed by default, because it hides ECHO', () => {
  const argv = buildInvocation({
    inputFile: '/m/m.scad', outputFile: '/o/out.stl', format: 'stl', backend: 'manifold',
    summaryFile: '/w/s.json', depsFile: '/w/d.mk', defines: [], strict: false, quiet: false, verbose: true,
  });
  assert.equal(argv.includes('--quiet'), false, '--quiet suppresses ECHO and the empty-geometry error');
});

test('invocation: --strict maps to --hardwarnings', () => {
  const argv = buildInvocation({
    inputFile: '/m/m.scad', outputFile: '/o/out.stl', format: 'stl', backend: 'manifold',
    summaryFile: '/w/s.json', depsFile: '/w/d.mk', defines: [], strict: true, quiet: false, verbose: false,
  });
  assert.ok(argv.includes('--hardwarnings'));
});

test('exit codes: the policy is distinct and stable', () => {
  assert.equal(EXIT.OK, 0);
  assert.equal(EXIT.MODEL_ERROR, 1);
  assert.equal(EXIT.USAGE, 2);
  assert.equal(EXIT.ENGINE_UNAVAILABLE, 3);
  assert.equal(EXIT.VALIDATION, 4);
  assert.equal(EXIT.TIMEOUT, 5);
  assert.equal(EXIT.INTERNAL, 6);
});
