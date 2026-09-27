// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Process invocation. Everything about how we talk to the engine lives here:
// argv (never a shell), environment scrubbing, timeout with process-group
// kill, and stream capture.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface InvokeOptions {
  enginePath: string;
  argv: string[];
  cwd: string;
  /** Kill after this many milliseconds. */
  timeoutMs: number;
  /** Grace period between SIGTERM and SIGKILL. */
  killGraceMs?: number;
  /** Extra environment on top of the scrubbed default. */
  env?: Record<string, string>;
  /** Cap on captured output, to bound memory on a runaway model. */
  maxOutputBytes?: number;
}

export interface InvokeResult {
  /** null when the process was killed by a signal. */
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  /** True when stdout was truncated at maxOutputBytes. */
  truncated: boolean;
}

const DEFAULT_MAX_OUTPUT = 64 * 1024 * 1024;

/**
 * The environment the engine gets.
 *
 * OPENSCADPATH is how the engine finds its bundled MCAD library. It is derived
 * from the engine location when we can work it out, and otherwise inherited.
 * DISPLAY is deliberately left alone: the headless engine ignores it, and
 * stripping it would make the run differ from how a user invokes it.
 */
export function buildEnv(extra?: Record<string, string>, enginePath?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (extra) Object.assign(env, extra);
  if (enginePath && !env.OPENSCADPATH) {
    const guess = guessMcadPath(enginePath);
    if (guess) env.OPENSCADPATH = guess;
  }
  return env;
}

/**
 * Locate an MCAD library relative to the engine. Handles both layouts we
 * ship: a co-installed bundle with `libraries/`, and a macOS .app bundle.
 */
export function guessMcadPath(enginePath: string): string | undefined {
  const candidates: string[] = [];
  let dir = path.dirname(path.resolve(enginePath));

  for (let i = 0; i < 6; i += 1) {
    candidates.push(path.join(dir, 'libraries'));
    candidates.push(path.join(dir, 'Resources', 'libraries'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'MCAD'))) return candidate;
  }
  return undefined;
}

export function invokeEngine(options: InvokeOptions): Promise<InvokeResult> {
  const started = Date.now();
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const grace = options.killGraceMs ?? 5_000;

  return new Promise<InvokeResult>((resolve, reject) => {
    // `detached` puts the child in its own process group so a timeout can kill
    // the whole tree: the engine may fork helpers (fontconfig, curl for
    // include<https://…>) that would otherwise survive and hold the work dir.
    const child = spawn(options.enginePath, options.argv, {
      cwd: options.cwd,
      env: buildEnv(options.env, options.enginePath),
      shell: false, // load-bearing; see engine/flags.ts
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch {
        /* already gone */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree('SIGTERM');
      setTimeout(() => killTree('SIGKILL'), grace).unref();
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes < maxOutput) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      } else {
        truncated = true;
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes < maxOutput) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      } else {
        truncated = true;
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - started,
        timedOut,
        truncated,
      });
    });
  });
}
