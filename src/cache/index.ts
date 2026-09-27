// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Content-addressed run cache.
//
// The cache key covers the engine identity, the model text, the -D defines and
// the export settings. Validity is then narrowed by the engine's own
// dependency list (`-d deps.mk`), which names every file the run read. That is
// what makes editing an `include`d library invalidate correctly, which a
// key-over-the-main-file-only cache would silently get wrong.
//
// Only successful runs are stored: a failed or timed-out render must never
// poison the cache.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalJson, ensureDir, fileExists, readJsonFile, sha256, sha256File, writeFileAtomic } from '../util/fsx.js';

export interface CacheKeyInput {
  engineSha: string;
  engineVersion: string;
  /** SHA-256 of the .scad text. */
  sourceSha: string;
  defines: Array<[string, string]>;
  format: string;
  backend: string;
  strict: boolean;
  /** Anything else that changes the result, e.g. customizer params. */
  extra?: Record<string, unknown>;
}

export function computeCacheKey(input: CacheKeyInput): string {
  return sha256(
    canonicalJson({
      engineSha: input.engineSha,
      engineVersion: input.engineVersion,
      sourceSha: input.sourceSha,
      defines: Object.fromEntries(input.defines),
      format: input.format,
      backend: input.backend,
      strict: input.strict,
      extra: input.extra ?? {},
      // Bump when the CLI's own output contract changes in a way that would
      // invalidate a previously cached artifact.
      contract: 1,
    }),
  );
}

export interface CachedRun {
  schema: 'openscad-cli/cache@1';
  key: string;
  /** Absolute paths of every file the engine read, with their hashes then. */
  dependencies: Record<string, string>;
  /** Cached copy of the artifact, inside the work dir. */
  artifact: string;
  artifactFormat: string;
  artifactSha256: string;
  artifactBytes: number;
  result: unknown;
}

export function workDirFor(root: string, key: string): string {
  return path.join(root, key.slice(0, 16));
}

export function manifestPath(workDir: string): string {
  return path.join(workDir, 'manifest.json');
}

/**
 * Parse a Makefile-format dependency file. The engine emits:
 *
 *   out.stl: \
 *       /abs/path/lib.scad \
 *       model.scad
 *
 * The first token is the target; every backslash-continued token after it is a
 * prerequisite. We only want the prerequisites.
 */
export function parseDepsFile(text: string): string[] {
  const deps: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Strip the line-continuation backslash first. Without this a line reads
    // as "/abs/path/lib.scad \" and every dependency silently fails to hash,
    // which disables dependency-driven invalidation without any visible error.
    const trimmed = raw.trim().replace(/\\+$/, '').trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    // The first real line is "target: rest-of-line"; skip the target name.
    const targetLine = /^[^:\s][^:]*:\s*(.*)$/.exec(trimmed);
    if (targetLine) {
      for (const token of (targetLine[1] ?? '').split(/\s+/)) {
        if (token !== '') deps.push(token);
      }
    } else {
      deps.push(trimmed);
    }
  }
  return deps.filter((d) => d !== '' && d !== '\\');
}

export interface CacheLookup {
  hit: boolean;
  entry?: CachedRun;
  /** Why the entry was rejected, when it existed but was stale. */
  staleReason?: string;
}

export function lookupCache(workDir: string): CacheLookup {
  const manifest = readJsonFile<CachedRun>(manifestPath(workDir));
  if (!manifest || manifest.schema !== 'openscad-cli/cache@1') return { hit: false };
  if (!fileExists(manifest.artifact)) {
    return { hit: false, staleReason: 'cached artifact is missing' };
  }
  // Dependency-driven invalidation: every file the engine read must still be
  // byte-identical.
  for (const [file, hash] of Object.entries(manifest.dependencies)) {
    const resolved = path.resolve(file);
    if (!fileExists(resolved)) {
      return { hit: false, staleReason: `dependency removed: ${file}` };
    }
    const current = sha256File(resolved);
    if (current !== hash) {
      return { hit: false, staleReason: `dependency changed: ${file}` };
    }
  }
  return { hit: true, entry: manifest };
}

export function storeCache(
  workDir: string,
  entry: Omit<CachedRun, 'schema' | 'key' | 'artifactSha256' | 'artifactBytes'> & {
    key: string;
  },
  artifactSource: string,
): CachedRun {
  ensureDir(workDir);
  const cachedArtifact = path.join(workDir, `artifact${path.extname(artifactSource) || '.out'}`);
  fs.copyFileSync(artifactSource, cachedArtifact);

  const full: CachedRun = {
    schema: 'openscad-cli/cache@1',
    key: entry.key,
    dependencies: entry.dependencies,
    artifact: cachedArtifact,
    artifactFormat: entry.artifactFormat,
    artifactSha256: sha256File(cachedArtifact) ?? '',
    artifactBytes: fs.statSync(cachedArtifact).size,
    result: entry.result,
  };

  // The manifest is written last and atomically, so a crash mid-copy can
  // never leave a manifest that points at a half-copied artifact.
  writeFileAtomic(manifestPath(workDir), JSON.stringify(full, null, 2));
  return full;
}

/** Remove work directories older than maxAgeMs. Best effort. */
export function pruneWorkDirs(root: string, maxAgeMs: number): number {
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  const cutoff = Date.now() - maxAgeMs;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      /* best effort */
    }
  }
  return removed;
}
