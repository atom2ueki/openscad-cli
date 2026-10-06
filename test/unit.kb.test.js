// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Tests for the skill knowledge base: the routing table must not point at a
// missing page, a page must not be unreachable from it, and the generated
// catalogue must stay consistent with the topics the pages live in. These are
// the failure modes an agent actually hits — it follows a link from INDEX.md,
// or greps catalog.md for a module it saw referenced.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractDefinitions } from '../scripts/kb/generate.mjs';

const KB = fileURLToPath(new URL('../skill/kb/', import.meta.url));

const read = (name) => fs.readFileSync(path.join(KB, name), 'utf8');
/** Topic pages: everything except the index itself and the generated catalog. */
const pages = () => fs.readdirSync(KB).filter((f) => f.endsWith('.md') && !['INDEX.md', 'catalog.md'].includes(f));
const catalog = () => JSON.parse(read('catalog.json'));

/** Every `](./something.md)` link target in a markdown document. */
function localLinks(markdown) {
  const out = new Set();
  for (const m of markdown.matchAll(/\]\(\.\/([^)#\s]+\.md)/g)) out.add(m[1]);
  return [...out];
}

test('kb: the index links every page and no page is orphaned', () => {
  const index = read('INDEX.md');
  const listed = new Set(localLinks(index));
  // catalog.md is generated and named explicitly in the index prose, so accept
  // either a link or a bare mention of it.
  assert.ok(index.includes('catalog.md'), 'INDEX.md must mention catalog.md');

  for (const page of pages()) {
    assert.ok(listed.has(page), `${page} exists but INDEX.md never links it — unreachable`);
  }
  for (const link of listed) {
    assert.ok(fs.existsSync(path.join(KB, link)), `INDEX.md links ./${link}, which does not exist`);
  }
});

test('kb: every markdown link inside a kb page resolves', () => {
  for (const page of fs.readdirSync(KB).filter((f) => f.endsWith('.md'))) {
    for (const link of localLinks(read(page))) {
      assert.ok(
        fs.existsSync(path.join(KB, link)),
        `${page} links ./${link}, which does not exist`,
      );
    }
  }
});

test('kb: catalog.md anchors referenced by pages resolve to a heading', () => {
  // Pages deep-link into the generated catalogue; a renamed topic would leave
  // the agent at a page top with no explanation.
  const md = read('catalog.md');
  const slugs = new Set(
    [...md.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
      m[1]
        // GitHub slugs the rendered heading text, so drop link targets first.
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        // GitHub replaces each space with a hyphen and does not collapse runs,
        // so "a — b" becomes "a--b".
        .replace(/\s/g, '-'),
    ),
  );

  let checked = 0;
  for (const page of fs.readdirSync(KB).filter((f) => f.endsWith('.md'))) {
    for (const m of read(page).matchAll(/\]\(\.\/catalog\.md#([^)\s]+)\)/g)) {
      checked += 1;
      assert.ok(slugs.has(m[1]), `${page} links catalog.md#${m[1]}, which has no matching heading`);
    }
  }
  assert.ok(checked > 0, 'no page deep-links into catalog.md — did the anchors get dropped?');
});

test('kb: catalog.json is well formed and its topic pages exist', () => {
  const c = catalog();
  assert.equal(c.schema, 'openscad-cli/kb-catalog@1');
  assert.match(c.upstream.commit, /^[0-9a-f]{40}$/, 'upstream commit must be pinned');
  assert.equal(c.upstream.license, 'Apache-2.0');

  assert.ok(c.modules.length > 100, `catalogue looks truncated: ${c.modules.length} definitions`);
  assert.ok(c.topics.length >= 8, `expected at least 8 topics, got ${c.topics.length}`);

  const ids = new Set(c.topics.map((t) => t.id));
  for (const topic of c.topics) {
    assert.ok(fs.existsSync(path.join(KB, topic.page)), `topic ${topic.id} points at missing ${topic.page}`);
    assert.ok(topic.files.length > 0, `topic ${topic.id} has no files`);
  }
  for (const def of c.modules) {
    assert.ok(ids.has(def.topic), `${def.file}/${def.name} has unknown topic ${def.topic}`);
    assert.match(def.signature, /^(module|function) [A-Za-z_]\w*\(/);
    assert.ok(Array.isArray(def.params));
    for (const p of def.params) assert.equal(typeof p.name, 'string');
  }
});

test('kb: a definition appears in exactly one topic', () => {
  const seen = new Map();
  for (const def of catalog().modules) {
    const key = `${def.file}:${def.name}`;
    assert.ok(!seen.has(key), `${key} is catalogued twice (topics ${seen.get(key)} and ${def.topic})`);
    seen.set(key, def.topic);
  }
});

test('kb: catalog.md renders every catalogued definition', () => {
  const md = read('catalog.md');
  for (const def of catalog().modules) {
    assert.ok(md.includes(`\`${def.signature}\``), `catalog.md omits ${def.file}: ${def.signature}`);
  }
});

test('kb: extractDefinitions keeps nested defaults intact', () => {
  const source = [
    '// A documented module.',
    '// Second line.',
    'module outer(a, b = fn(1, 2), c = [3, 4], d = "x,y") {',
    '    cube(1);',
    '}',
    '',
    'function scalar(x = 1) = x * 2;',
    '',
    'module multiline(',
    '    first,',
    '    second = 2',
    ') {',
    '    sphere(1);',
    '}',
  ].join('\n');

  const defs = extractDefinitions(source, 'demo.scad');
  assert.deepEqual(
    defs.map((d) => d.name),
    ['outer', 'scalar', 'multiline'],
  );

  const outer = defs[0];
  assert.equal(outer.signature, 'module outer(a, b=fn(1, 2), c=[3, 4], d="x,y")');
  assert.deepEqual(
    outer.params,
    [
      { name: 'a', default: '' },
      { name: 'b', default: 'fn(1, 2)' },
      { name: 'c', default: '[3, 4]' },
      { name: 'd', default: '"x,y"' },
    ],
  );
  assert.equal(outer.doc, 'A documented module. Second line.');

  assert.equal(defs[1].kind, 'function');
  assert.equal(defs[2].params.length, 2, 'a multi-line parameter list must be fully captured');
});

test('kb: install-skill.sh installs the knowledge base into a runtime', () => {
  // `openscad-cli skill` and packaging/install-skill.sh both ship skill/, and a
  // nested directory used to be skipped by the installer. Exercise the real
  // script into a throwaway skills dir rather than trusting the source text.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'openscad-cli-skill-'));
  try {
    execFileSync('bash', [
      fileURLToPath(new URL('../packaging/install-skill.sh', import.meta.url)),
      target,
    ]);
    const installed = path.join(target, 'openscad-cli');
    for (const rel of ['SKILL.md', 'references/commands.md', 'kb/INDEX.md', 'kb/catalog.json', 'kb/printing.md']) {
      assert.ok(fs.existsSync(path.join(installed, rel)), `install-skill.sh did not install ${rel}`);
    }
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
