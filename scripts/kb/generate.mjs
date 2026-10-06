#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Generate the reusable-module catalog for the skill knowledge base
// (skill/kb/catalog.{json,md}) from a checkout of the upstream model corpus.
//
// The prose pages under skill/kb/ are written by hand and are the part with
// judgement in them. This script owns the mechanical half: every `module` and
// `function` definition in the reusable libraries, with its parameter list and
// the doc comment above it, recorded verbatim so nothing drifts from upstream.
//
//   scripts/kb/generate.mjs [upstream-dir]
//   THINGS_DIR=/path/to/things scripts/kb/generate.mjs
//
// The upstream checkout is not committed (it carries binary assets). Fetch it
// with scripts/kb/fetch-upstream.sh, which pins the same commit recorded in
// the generated provenance block.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const KB_DIR = join(ROOT, 'skill', 'kb');

// ---------------------------------------------------------------------------
// Topic table. Order matters: the first rule that matches a path wins, so the
// specific parts come before the catch-all `bosl2/` rule.
// ---------------------------------------------------------------------------
const TOPICS = [
  {
    id: 'threads',
    page: 'threads.md',
    title: 'Threaded containers',
    match: (p) => p === 'parts/threads.scad' || p === 'bosl2/threads.scad',
  },
  {
    id: 'springs',
    page: 'springs.md',
    title: 'Springs and flexures',
    match: (p) => p.startsWith('parts/springs/'),
  },
  {
    id: 'joining',
    page: 'joining.md',
    title: 'Joining printed pieces',
    match: (p) => p.startsWith('parts/joining/'),
  },
  {
    id: 'mechanisms',
    page: 'mechanisms.md',
    title: 'Print-in-place mechanisms',
    match: (p) => p.startsWith('parts/mechanisms/'),
  },
  {
    id: 'textures',
    page: 'textures.md',
    title: 'Surface textures',
    match: (p) =>
      p.startsWith('parts/textures/') ||
      /^bosl2\/(textures|texture-brushed-metal|texture-rough|sphere-top-textured)\.scad$/.test(p),
  },
  {
    id: 'solids',
    page: 'solids.md',
    title: 'Reusable solids',
    match: (p) => /^parts\/[^/]+\.scad$/.test(p) && p !== 'parts/threads.scad',
  },
  {
    id: 'bosl2',
    page: 'bosl2.md',
    title: 'BOSL2 idioms',
    match: (p) => p.startsWith('bosl2/'),
  },
  {
    id: 'models',
    page: 'models.md',
    title: 'Worked models',
    match: (p) => p.startsWith('models/'),
  },
];

// ---------------------------------------------------------------------------
// OpenSCAD scanning
// ---------------------------------------------------------------------------

/** Walk `text` from the `(` at `open`, returning the index of its match. */
function matchParen(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a parameter list on top-level commas, ignoring nested brackets and strings. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** `a=1` -> { name: 'a', default: '1' }; a bare name has default ''. */
function parseParam(part) {
  const eq = indexOfTopLevel(part, '=');
  if (eq < 0) return { name: part.trim(), default: '' };
  return { name: part.slice(0, eq).trim(), default: part.slice(eq + 1).trim() };
}

function indexOfTopLevel(text, needle) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === needle && depth === 0) return i;
  }
  return -1;
}

/** Contiguous `//` comment lines immediately above line `line`, top-down. */
function docAbove(lines, line) {
  const out = [];
  for (let i = line - 1; i >= 0; i -= 1) {
    const text = lines[i].trim();
    if (!text.startsWith('//')) break;
    out.unshift(text.replace(/^\/\/\/?\s?/, '').trimEnd());
  }
  while (out.length > 0 && out[0] === '') out.shift();
  return out.join(' ').trim();
}

/** Every `module` / `function` definition in an OpenSCAD source, in file order. */
export function extractDefinitions(source, file) {
  const lines = source.split('\n');
  const defs = [];
  const re = /^(module|function)\s+([A-Za-z_]\w*)\s*\(/;
  for (let i = 0; i < lines.length; i += 1) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    const kind = m[1];
    const name = m[2];
    // The parameter list may run across several lines; join until it closes.
    let text = lines[i];
    let start = i;
    while (matchParen(text, text.indexOf('(')) < 0 && start < lines.length - 1) {
      start += 1;
      text += `\n${lines[start]}`;
    }
    const open = text.indexOf('(');
    const close = matchParen(text, open);
    if (close < 0) continue;
    const raw = text.slice(open + 1, close);
    const params = splitTopLevel(raw).map(parseParam);
    const signature = `${kind} ${name}(${params
      .map((p) => (p.default === '' ? p.name : `${p.name}=${p.default}`))
      .join(', ')})`;
    defs.push({ file, kind, name, signature, params, doc: docAbove(lines, i) });
    i = start;
  }
  return defs;
}

// ---------------------------------------------------------------------------
// Upstream checkout
// ---------------------------------------------------------------------------

function locateUpstream() {
  const arg = process.argv[2] ?? process.env.THINGS_DIR;
  const candidates = [arg, join(ROOT, '.kb-src', 'things')].filter(Boolean);
  for (const dir of candidates) {
    if (dir && existsSync(join(dir, 'parts')) && existsSync(join(dir, 'bosl2'))) return dir;
  }
  process.stderr.write(
    'error: no upstream checkout found.\n' +
      '       pass a path, set THINGS_DIR, or run scripts/kb/fetch-upstream.sh\n',
  );
  process.exit(2);
}

function* walkScad(dir, base = dir) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '.git' || entry === 'assets') continue;
      yield* walkScad(full, base);
    } else if (entry.endsWith('.scad')) {
      yield posix.join(...relative(base, full).split(sep));
    }
  }
}

function upstreamCommit(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function upstreamDate(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'log', '-1', '--format=%ad', '--date=short'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Catalog rendering
// ---------------------------------------------------------------------------

function renderMarkdown(catalog) {
  const out = [];
  out.push('<!-- Generated by scripts/kb/generate.mjs. Do not edit by hand. -->');
  out.push('');
  out.push('# Reusable-module catalog');
  out.push('');
  out.push(
    `Every \`module\` and \`function\` in the upstream library sources, extracted verbatim. ` +
      `${catalog.modules.length} definitions across ${catalog.topics.length} topics. ` +
      'Signatures show upstream defaults; read the page linked under each topic for when to reach for them.',
  );
  for (const topic of catalog.topics) {
    out.push('');
    out.push(`## ${topic.title} — [${topic.page}](./${topic.page})`);
    out.push('');
    for (const file of topic.files) {
      const defs = catalog.modules.filter((m) => m.file === file);
      if (defs.length === 0) continue;
      out.push(`### \`${file}\``);
      out.push('');
      for (const def of defs) {
        out.push(`- \`${def.signature}\`${def.doc ? ` — ${def.doc}` : ''}`);
      }
      out.push('');
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function main() {
  const upstream = locateUpstream();
  const files = [...walkScad(upstream)];
  const modules = [];
  const topics = [];

  // One topic per file: first rule wins, so `bosl2/threads.scad` is a threads
  // page member and never also a generic BOSL2 one. Without this the file was
  // scanned twice and every definition appeared in two topics.
  const assignment = new Map();
  for (const file of files) {
    const topic = TOPICS.find((t) => t.match(file));
    if (topic) assignment.set(file, topic);
  }

  for (const topic of TOPICS) {
    const matched = files.filter((f) => assignment.get(f)?.id === topic.id);
    if (matched.length === 0) continue;
    for (const file of matched) {
      const source = readFileSync(join(upstream, ...file.split('/')), 'utf8');
      modules.push(...extractDefinitions(source, file).map((d) => ({ topic: topic.id, ...d })));
    }
    topics.push({
      id: topic.id,
      title: topic.title,
      page: topic.page,
      files: matched.filter((f) => modules.some((m) => m.file === f)),
    });
  }

  const catalog = {
    schema: 'openscad-cli/kb-catalog@1',
    upstream: {
      repo: 'https://github.com/jhermann/things',
      commit: upstreamCommit(upstream),
      date: upstreamDate(upstream),
      license: 'Apache-2.0',
      note: 'Source of the techniques the prose pages under skill/kb/ distil.',
    },
    topics,
    modules,
  };

  mkdirSync(KB_DIR, { recursive: true });
  writeFileSync(join(KB_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(join(KB_DIR, 'catalog.md'), renderMarkdown(catalog));
  process.stdout.write(
    `kb: ${modules.length} definitions, ${topics.length} topics -> skill/kb/catalog.{md,json}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
