// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Small filesystem and hashing helpers. Deliberately dependency-free: the npm
// package ships zero runtime dependencies.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(file: string): string | undefined {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return undefined;
  }
}

/**
 * Deterministic JSON: object keys sorted recursively, so that two structurally
 * equal inputs always produce the same bytes. Required for stable cache keys.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write a file atomically: write to a sibling temp file, then rename. A
 * process killed mid-write can therefore never leave a truncated manifest
 * that a later run would read as valid.
 */
export function writeFileAtomic(file: string, data: string | Buffer): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw err;
  }
}

export function readJsonFile<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function fileExists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

export function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Human-readable byte count, for text output only. */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}
