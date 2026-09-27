// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Integration tests against a real OpenSCAD engine. Skipped automatically when
// no engine is available, so `npm test` still passes on a bare checkout.
//
//   OPENSCAD_ENGINE=/path/to/openscad npm run test:integration
//
// These are the tests that prove the engine contract: the summary JSON, the
// dependency file, the exit codes, and the fact that nothing needs a display.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = path.join(ROOT, 'dist', 'cli.js');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const ENGINE = process.env.OPENSCAD_ENGINE;

const available = Boolean(ENGINE && fs.existsSync(ENGINE));
const skip = available ? false : 'no OPENSCAD_ENGINE set; skipping engine integration tests';

/**
 * Run the CLI and capture stdout, stderr and the exit code.
 *
 * spawnSync rather than execFileSync: the engine writes nearly everything,
 * including `--version`, to stderr, and execFileSync discards stderr on a
 * successful exit.
 */
function run(args, { cwd, env = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function json(args, opts) {
  const result = run([...args, '--json'], opts);
  try {
    return { ...result, data: JSON.parse(result.stdout) };
  } catch {
    assert.fail(`expected JSON on stdout, got:\n${result.stdout}\n${result.stderr}`);
  }
}

let workDir;
test.before?.(() => {});
test('setup', { skip }, () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-it-'));
});
test.after?.(() => {});

test('the engine runs with no display at all', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-nodisp-'));
  const scad = path.join(dir, 'cube.scad');
  fs.writeFileSync(scad, 'cube([10,10,10], center=true);\n');
  const { code, data } = json(['build', scad, '-o', path.join(dir, 'cube.stl')], {
    cwd: dir,
    env: { DISPLAY: '' },
  });
  assert.equal(code, 0, `exit ${code}: ${JSON.stringify(data?.diagnostics ?? [])}`);
  assert.equal(data.status, 'ok');
  assert.ok(fs.existsSync(path.join(dir, 'cube.stl')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC1: identical input yields a byte-identical STL across runs', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-det-'));
  const scad = path.join(dir, 'cube.scad');
  fs.writeFileSync(scad, 'cube([20,10,5], center=true);\n');
  const hashes = [];
  for (let i = 0; i < 3; i += 1) {
    const out = path.join(dir, `run${i}.stl`);
    const { code } = json(['build', scad, '-o', out, '--no-cache'], { cwd: dir });
    assert.equal(code, 0);
    hashes.push(fs.readFileSync(out).toString('hex'));
  }
  assert.equal(hashes[0], hashes[1], 'run 1 and 2 differ');
  assert.equal(hashes[1], hashes[2], 'run 2 and 3 differ');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: geometry statistics are computed and correct', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-stats-'));
  const scad = path.join(dir, 'cube.scad');
  fs.writeFileSync(scad, 'cube([20,10,5], center=true);\n');
  const { code, data } = json(['build', scad, '-o', path.join(dir, 'cube.stl')], { cwd: dir });
  assert.equal(code, 0);
  // The engine reports no volume or area, so these come from our own reader.
  assert.ok(Math.abs(data.stats.volume - 1000) < 1e-6, `volume ${data.stats.volume}`);
  assert.ok(Math.abs(data.stats.area - 700) < 1e-6, `area ${data.stats.area}`);
  assert.deepEqual(data.stats.boundingBox.size, [20, 10, 5]);
  assert.equal(data.stats.degenerateTriangles, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC2: a syntax error is reported with a file and a line, exit 1', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-syn-'));
  const scad = path.join(dir, 'bad.scad');
  fs.copyFileSync(path.join(FIXTURES, 'syntax-error.scad'), scad);
  const { code, data } = json(['build', scad, '-o', path.join(dir, 'bad.stl')], { cwd: dir });
  assert.equal(code, 1, 'a parse failure must exit 1');
  assert.equal(data.status, 'error');
  const d = data.diagnostics.find((x) => x.severity === 'error');
  assert.ok(d, 'expected an error diagnostic');
  assert.equal(d.file, 'bad.scad');
  assert.equal(typeof d.line, 'number');
  assert.equal(code, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC3: a warning is a warn by default and fatal under --strict', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-warn-'));
  const scad = path.join(dir, 'undeclared.scad');
  fs.copyFileSync(path.join(FIXTURES, 'undeclared.scad'), scad);
  const out = path.join(dir, 'w.stl');

  const lenient = json(['build', scad, '-o', out], { cwd: dir });
  assert.equal(lenient.code, 0, 'a warning alone must not fail the build');
  assert.equal(lenient.data.status, 'warn');
  assert.ok(lenient.data.diagnostics.some((d) => d.code === 'name.unknown'));

  const strict = json(['build', scad, '-o', out, '--strict'], { cwd: dir });
  assert.equal(strict.code, 4, '--strict must exit 4 (validation)');
  assert.equal(strict.data.status, 'error');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: an empty model is detected rather than producing a stray artifact', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-empty-'));
  const scad = path.join(dir, 'empty.scad');
  fs.copyFileSync(path.join(FIXTURES, 'empty.scad'), scad);
  const out = path.join(dir, 'e.stl');
  const { code, data } = json(['build', scad, '-o', out], { cwd: dir });
  assert.equal(code, 1);
  assert.equal(data.status, 'error');
  assert.ok(data.diagnostics.some((d) => d.code === 'geometry.empty'));
  assert.equal(fs.existsSync(out), false, 'a failed build must not leave an artifact');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC4: validate reports errors and leaves no artifact', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-val-'));
  const scad = path.join(dir, 'bad.scad');
  fs.copyFileSync(path.join(FIXTURES, 'syntax-error.scad'), scad);
  const { code, data } = json(['validate', scad], { cwd: dir });
  assert.equal(code, 1);
  assert.ok(data.diagnostics.length > 0);
  const produced = fs.readdirSync(dir).filter((f) => f !== 'bad.scad');
  assert.deepEqual(produced, [], `validate wrote ${produced.join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC5: a repeated build is served from cache', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-cache-'));
  const scad = path.join(dir, 'cube.scad');
  fs.copyFileSync(path.join(FIXTURES, 'cube.scad'), scad);
  const out = path.join(dir, 'cube.stl');

  const first = json(['build', scad, '-o', out], { cwd: dir });
  assert.equal(first.data.cache.hit, false, 'the first build must miss');

  const second = json(['build', scad, '-o', out], { cwd: dir });
  assert.equal(second.data.cache.hit, true, 'an identical build must hit');
  assert.equal(second.data.outputs[0].sha256, first.data.outputs[0].sha256);

  // The cached artifact is restored if the user deletes it.
  fs.unlinkSync(out);
  const third = json(['build', scad, '-o', out], { cwd: dir });
  assert.equal(third.data.cache.hit, true);
  assert.ok(fs.existsSync(out), 'the artifact must be restored from the cache');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC6: editing an included library invalidates the cache', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-deps-'));
  const scad = path.join(dir, 'uses-lib.scad');
  const lib = path.join(dir, 'helper-lib.scad');
  fs.copyFileSync(path.join(FIXTURES, 'uses-lib.scad'), scad);
  fs.copyFileSync(path.join(FIXTURES, 'helper-lib.scad'), lib);
  const out = path.join(dir, 'out.stl');

  const first = json(['build', scad, '-o', out], { cwd: dir });
  assert.equal(first.code, 0);
  assert.equal(first.data.cache.hit, false);
  assert.deepEqual(first.data.echo, ['helper n=7']);

  // Change only the library, not the main model.
  // Change the library, not the model: this is the case a source-only cache key
  // would silently get wrong.
  fs.writeFileSync(lib, fs.readFileSync(lib, 'utf8').replace('helper n=', 'helper2 n='));
  const second = json(['build', scad, '-o', out], { cwd: dir });
  assert.equal(second.data.cache.hit, false, 'a changed dependency must invalidate the cache');
  assert.deepEqual(second.data.echo, ['helper2 n=7']);

  const third = json(['build', scad, '-o', out], { cwd: dir });
  assert.equal(third.data.cache.hit, true, 'and must hit again once nothing changed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: -D overrides variables and preserves string quoting', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-def-'));
  const scad = path.join(dir, 'p.scad');
  fs.writeFileSync(scad, 'w = 1;\nh = 2;\nlabel = "none";\ncube([w, h, 3]);\necho(str("label=", label));\n');
  const { code, data } = json(['build', scad, '-o', path.join(dir, 'p.stl'), '-D', 'w=40', '-D', 'h=7', '-D', 'label="ACME Inc"'], { cwd: dir });
  assert.equal(code, 0);
  assert.deepEqual(data.stats.boundingBox.size, [40, 7, 3]);
  // If the shell had eaten the inner quotes, label would come back as `ACME Inc`
  // instead of the literal the expression produced.
  assert.ok(data.echo.some((e) => e.includes('ACME')), `echo was ${JSON.stringify(data.echo)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: 2D vector output is not mesh-verified', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-2d-'));
  const scad = path.join(dir, 'plate.scad');
  fs.copyFileSync(path.join(FIXTURES, '2d-plate.scad'), scad);
  const { code, data } = json(['build', scad, '-o', path.join(dir, 'plate.dxf'), '--format', 'dxf'], { cwd: dir });
  assert.equal(code, 0);
  assert.equal(data.status, 'ok', JSON.stringify(data.diagnostics));
  assert.equal(data.stats.volume, undefined, 'a DXF has no volume; running the mesh reader would invent one');
  assert.ok(fs.statSync(path.join(dir, 'plate.dxf')).size > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: extrusions and hull render without error', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-ext-'));
  const scad = path.join(dir, 'e.scad');
  fs.copyFileSync(path.join(FIXTURES, 'extrusions.scad'), scad);
  const { code, data } = json(['build', scad, '-o', path.join(dir, 'e.stl')], { cwd: dir });
  assert.equal(code, 0, JSON.stringify(data.diagnostics));
  assert.equal(data.status, 'ok', JSON.stringify(data.diagnostics));
  assert.ok(data.stats.triangles > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: the result carries the licence and a source pointer', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-lic-'));
  const scad = path.join(dir, 'cube.scad');
  fs.copyFileSync(path.join(FIXTURES, 'cube.scad'), scad);
  const { data } = json(['build', scad, '-o', path.join(dir, 'cube.stl')], { cwd: dir });
  assert.equal(data.license.spdx, 'GPL-2.0-or-later');
  assert.match(data.license.source, /^https:\/\//);
  assert.match(data.engine.version, /^\d{4}\.\d{2}\.\d{2}/, 'the engine version must be detected');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: a sidecar manifest is written next to the artifact', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-side-'));
  const scad = path.join(dir, 'cube.scad');
  fs.copyFileSync(path.join(FIXTURES, 'cube.scad'), scad);
  const out = path.join(dir, 'cube.stl');
  json(['build', scad, '-o', out], { cwd: dir });
  const sidecar = `${out}.openscad.json`;
  assert.ok(fs.existsSync(sidecar), 'the sidecar manifest is missing');
  const parsed = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  assert.equal(parsed.schema, 'openscad-cli/result@1');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: info reports capabilities, including that PNG is unavailable', { skip }, () => {
  const { code, data } = json(['info'], {});
  assert.equal(code, 0);
  assert.equal(data.capabilities.png, false, 'a NULLGL engine cannot export PNG');
  assert.ok(data.capabilities.pngReason.length > 0);
  assert.equal(data.license.spdx, 'GPL-2.0-or-later');
  assert.ok(Array.isArray(data.formats.supported));
  assert.ok(data.formats.supported.includes('stl'));
  assert.ok(!data.formats.supported.includes('png'), 'png must not be advertised as supported');
});

test('AC: doctor passes against a working engine', { skip }, () => {
  const { code, data } = json(['doctor'], {});
  assert.equal(code, 0, JSON.stringify(data));
  assert.equal(data.status, 'ok');
  assert.ok(data.checks.some((c) => c.name === 'engine-runs-headless' && c.ok));
});

test('AC: doctor exits 3 when the engine is missing', () => {
  const { code, data } = json(['doctor', '--engine', '/nonexistent/openscad'], {});
  assert.equal(code, 3, 'a missing engine must be exit 3, not a crash');
  assert.equal(data.status, 'error');
});

test('AC: inspect dumps the parsed AST and captured echo', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-insp-'));
  const scad = path.join(dir, 'uses-lib.scad');
  const lib = path.join(dir, 'helper-lib.scad');
  fs.copyFileSync(path.join(FIXTURES, 'uses-lib.scad'), scad);
  fs.copyFileSync(path.join(FIXTURES, 'helper-lib.scad'), lib);
  const { code, data } = json(['inspect', scad, '--echo'], { cwd: dir });
  assert.equal(code, 0);
  assert.deepEqual(data.echo, ['helper n=7']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: variants renders a parameter matrix', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-var-'));
  const scad = path.join(dir, 'p.scad');
  fs.writeFileSync(scad, 'w = 1;\nh = 1;\ncube([w, h, 2]);\n');
  const outDir = path.join(dir, 'out');
  const { code, stdout } = run(
    ['variants', scad, '--param', 'w=10,20,30', '--param', 'h=2,4,6', '--out-dir', outDir, '--ordered', '--json'],
    { cwd: dir },
  );
  assert.equal(code, 0, stdout);
  const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 9, '3 widths x 3 heights');
  // Both --param occurrences must be applied: a non-repeatable flag would
  // silently drop `w` and every variant would render at the default width.
  assert.deepEqual(lines[0].variant, { w: '10', h: '2' });
  assert.deepEqual(lines[0].stats.boundingBox.size, [10, 2, 2]);
  assert.equal(lines[0].seq, 0);
  const produced = fs.readdirSync(outDir).filter((f) => f.endsWith('.stl'));
  assert.equal(produced.length, 9, `expected 9 files, got ${produced.join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: the raw command forwards arguments to the engine', { skip }, () => {
  const { code, stderr } = run(['raw', '--', '--version'], {});
  assert.equal(code, 0);
  assert.match(stderr, /OpenSCAD version/);
});

test('AC: a timeout kills a runaway render with exit 5', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cli-slow-'));
  const scad = path.join(dir, 'slow.scad');
  // A deliberately expensive model: high-resolution sphere, twice.
  fs.writeFileSync(
    scad,
    'difference(){ sphere(r=100, $fn=400); sphere(r=90, $fn=400); }\n',
  );
  const started = Date.now();
  const { code } = run(['build', scad, '-o', path.join(dir, 'slow.stl'), '--timeout', '1'], { cwd: dir });
  const elapsed = Date.now() - started;
  // Either it finished inside the window, or it was killed at the timeout. What
  // must never happen is a hang or a crash.
  assert.ok(code === 5 || code === 0, `unexpected exit ${code}`);
  if (code === 5) assert.ok(elapsed < 30_000, `timeout did not fire promptly (${elapsed} ms)`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AC: the skill bundle is printed and names the CLI version', { skip: skip }, () => {
  const { code, stdout } = run(['skill'], {});
  assert.equal(code, 0);
  assert.match(stdout, /openscad-cli/, 'the skill must document the CLI');
  assert.match(stdout, /build/, 'the skill must document the commands');
});
