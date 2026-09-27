#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// GPL-2.0 compliance gate.
//
// Nine checks, mirroring the release requirements. Each one is a real
// obligation, not paperwork: a public binary that links OpenSCAD must convey
// its licence, must offer the complete corresponding source, and must not
// restrict what its recipients may do with it.
//
//   1. LICENSE carries the full GPL-2.0 text and an "or later" grant
//   2. every source file carries an SPDX identifier (check-license-headers)
//   3. THIRD_PARTY_LICENSES.md enumerates the engine's third-party components
//   4. the source-tarball script can produce a complete source bundle
//   5. LICENSE / NOTICE / THIRD_PARTY_LICENSES.md ship in the npm package
//   6. `info` reports the licence and the source URL
//   7. no EULA, telemetry gate, or network call in the shipped sources
//   8. the engine submodule is pinned to a specific commit
//   9. package.json declares GPL-2.0-or-later

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const has = (rel) => existsSync(join(ROOT, rel));

const checks = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail: detail ?? '' });
  } catch (err) {
    checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
};

const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

check('1. LICENSE is GPL-2.0 with an "or later" grant', () => {
  const text = read('LICENSE');
  assert(text.includes('GNU GENERAL PUBLIC LICENSE'), 'LICENSE has no GPL text');
  assert(text.includes('Version 2, June 1991'), 'LICENSE is not the GPLv2 text');
  // The grant statement is wrapped across lines in a real licence header, so
  // compare against a whitespace-normalised copy.
  const flat = text.replace(/\s+/g, ' ');
  assert(
    /either version 2 of the License, or \(at your option\) any later version/.test(flat),
    'LICENSE has no "or later" grant',
  );
  assert(text.includes('SPDX-License-Identifier: GPL-2.0-or-later'), 'LICENSE has no SPDX identifier');
  assert(text.includes('special exception'), 'LICENSE does not carry the OpenSCAD CGAL linking exception');
  return `${text.split('\n').length} lines`;
});

check('2. every source file carries an SPDX identifier', () => {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-license-headers.mjs')], {
    encoding: 'utf8',
  });
  return out.trim();
});

check('3. THIRD_PARTY_LICENSES.md enumerates engine components', () => {
  assert(has('THIRD_PARTY_LICENSES.md'), 'THIRD_PARTY_LICENSES.md is missing');
  const text = read('THIRD_PARTY_LICENSES.md');
  const required = ['OpenSCAD', 'CGAL', 'nlohmann/json', 'libtess2', 'lodepng', 'lexertl', 'hidapi', 'libsvg'];
  const missing = required.filter((r) => !text.includes(r));
  assert(missing.length === 0, `missing entries: ${missing.join(', ')}`);
  return `${required.length} components documented`;
});

check('4. the corresponding-source bundle can be produced', () => {
  const script = join(ROOT, 'packaging', 'make-source-tarball.sh');
  assert(existsSync(script), 'packaging/make-source-tarball.sh is missing');
  const text = read('packaging/make-source-tarball.sh');
  assert(text.includes('git archive'), 'source tarball script does not embed the engine tree');
  assert(text.includes('ENGINE_COMMIT'), 'source tarball script does not record the pinned commit');
  return 'script present and embeds the engine tree';
});

check('5. licence files ship in the npm package', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const required of ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.md']) {
    assert(pkg.files.includes(required), `package.json "files" does not include ${required}`);
  }
  assert(existsSync(join(ROOT, 'LICENSE')), 'LICENSE missing from the working tree');
  return `${pkg.files.filter((f) => /LICENSE|NOTICE/.test(f)).join(', ')} included`;
});

check('6. `info` reports the licence and source URL', () => {
  const text = read('src/commands/inspect.ts');
  assert(text.includes('LICENSE_SPDX'), 'info does not report the SPDX identifier');
  assert(text.includes('SOURCE_URL'), 'info does not report the source URL');
  return 'src/commands/inspect.ts exposes both';
});

check('7. no usage restriction, telemetry, or network egress', () => {
  const banned = [
    /\baccept\s+(?:these\s+)?terms\b/i,
    /\bend[-\s]?user\s+licen[sc]e\s+agreement\b/i,
    /\btelemetry\b/i,
    /\banalytics\b/i,
    /https?:\/\/(?!github\.com\/atom2ueki|www\.gnu\.org|opensource\.org|spdx\.org|json-schema\.org)[\w.-]+/i,
  ];
  // Only our own sources; the engine legitimately talks to the network for
  // include<https://…>, and third-party notices cite external URLs.
  const files = ['src/cli.ts', 'src/index.ts', 'src/run.ts', 'src/args.ts', 'src/output.ts', 'src/types.ts',
    'src/exit.ts', 'src/engine/invoke.ts', 'src/engine/flags.ts', 'src/engine/locate.ts',
    'src/cache/index.ts', 'src/verify/rules.ts', 'src/verify/mesh.ts', 'src/util/fsx.ts',
    'src/diagnostics/parse.ts', 'src/diagnostics/codes.ts',
    'src/commands/build.ts', 'src/commands/inspect.ts', 'src/commands/context.ts'];
  for (const rel of files) {
    const text = read(rel);
    for (const pattern of banned) {
      assert(!pattern.test(text), `${rel} matches ${pattern}`);
    }
  }
  return `${files.length} files clean`;
});

check('8. the engine submodule is pinned to a commit', () => {
  const gitmodules = has('.gitmodules') ? read('.gitmodules') : '';
  assert(gitmodules.includes('openscad/openscad'), 'engine submodule is not registered');
  const out = execFileSync('git', ['ls-files', '-s', 'engine'], { cwd: ROOT, encoding: 'utf8' });
  const sha = out.trim().split(/\s+/)[1] ?? '';
  assert(/^[0-9a-f]{40}$/.test(sha), `engine is not pinned to a commit (got "${sha}")`);
  return `pinned at ${sha.slice(0, 12)}`;
});

check('9. package.json declares GPL-2.0-or-later', () => {
  const pkg = JSON.parse(read('package.json'));
  assert(pkg.license === 'GPL-2.0-or-later', `license is "${pkg.license}"`);
  assert(pkg.type === 'module', 'package must be an ES module');
  return pkg.license;
});

let failed = 0;
for (const c of checks) {
  if (!c.ok) failed += 1;
  process.stdout.write(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? `\n        ${c.detail}` : ''}\n`);
}

if (failed > 0) {
  process.stderr.write(`\n${failed} compliance check(s) failed. The release must not be published.\n`);
  process.exit(1);
}
process.stdout.write(`\nall ${checks.length} compliance checks passed\n`);
