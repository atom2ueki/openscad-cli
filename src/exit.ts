// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Exit-code policy. The engine only ever returns 0 or 1, which is not enough
// for an agent to branch on, so the CLI maps outcomes onto a richer set.

export const EXIT = {
  /** Success. Warnings may still be present in the result JSON. */
  OK: 0,
  /** The model failed: parse, evaluate, or render error. */
  MODEL_ERROR: 1,
  /** Bad invocation: unknown flag, missing input file. */
  USAGE: 2,
  /** The engine is missing, unusable, or version-mismatched. */
  ENGINE_UNAVAILABLE: 3,
  /** Validation failed under --strict. */
  VALIDATION: 4,
  /** The engine exceeded --timeout and was killed. */
  TIMEOUT: 5,
  /** A bug in this CLI. */
  INTERNAL: 6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export const EXIT_MEANING: Record<number, string> = {
  0: 'success',
  1: 'model error (parse/evaluate/render failed)',
  2: 'usage error',
  3: 'engine unavailable',
  4: 'validation failed (--strict)',
  5: 'timeout',
  6: 'internal CLI error',
};

/** Raised to unwind to the top level with a specific exit code. */
export class CliError extends Error {
  readonly code: ExitCode;
  readonly detail?: unknown;

  constructor(code: ExitCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.detail = detail;
  }
}

/** Map a result status onto the process exit code. */
export function exitCodeForStatus(status: 'ok' | 'warn' | 'error', strict: boolean): ExitCode {
  if (status === 'error') return strict ? EXIT.VALIDATION : EXIT.MODEL_ERROR;
  return EXIT.OK;
}
