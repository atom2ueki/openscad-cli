// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// A small, dependency-free argument parser. It is deliberately strict: an
// unknown flag is a usage error rather than something silently ignored,
// because a silently dropped `--max-dim` would be a correctness problem for an
// agent that believes it is being protected.

import { CliError, EXIT } from './exit.js';
import type { OutputFormat } from './output.js';

export interface ParsedArgs {
  command: string;
  positionals: string[];
  defines: Array<[string, string]>;
  options: Record<string, string | boolean | string[]>;
  flags: Set<string>;
  /** Everything after a bare `--`, preserved verbatim. */
  passthrough: string[];
  outputFormat: OutputFormat;
  quiet: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export interface Spec {
  /** Flags that take a value, either `--flag v` or `--flag=v`. */
  withValue?: string[];
  /** Boolean flags. */
  boolean?: string[];
  /** Repeatable value flags (each occurrence is kept). */
  repeatable?: string[];
}

export function parseArgs(argv: string[], spec: Spec): ParsedArgs {
  const withValue = new Set(spec.withValue ?? []);
  const boolean = new Set(spec.boolean ?? []);
  const repeatable = new Set(spec.repeatable ?? []);

  const options: Record<string, string | boolean | string[]> = {};
  const flags = new Set<string>();
  const positionals: string[] = [];
  const passthrough: string[] = [];
  let defines: Array<[string, string]> = [];
  let sawSeparator = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    if (sawSeparator) {
      passthrough.push(arg);
      continue;
    }
    if (arg === '--') {
      sawSeparator = true;
      continue;
    }

    // -D is special: it is a value flag whose value is `name=expression`.
    if (arg === '-D' || arg === '--D') {
      const value = argv[i + 1];
      if (value === undefined) throw new CliError(EXIT.USAGE, '-D requires a name=value argument');
      const eq = value.indexOf('=');
      if (eq <= 0) {
        throw new CliError(
          EXIT.USAGE,
          `-D expects name=value, got "${value}". Remember the value is an OpenSCAD expression.`,
        );
      }
      defines.push([value.slice(0, eq), value.slice(eq + 1)]);
      i += 1;
      continue;
    }

    if (arg.startsWith('-') && arg !== '-') {
      const eq = arg.indexOf('=');
      const name = eq >= 0 ? arg.slice(0, eq) : arg;
      const inlineValue = eq >= 0 ? arg.slice(eq + 1) : undefined;

      if (boolean.has(name) || withValue.has(name) || repeatable.has(name)) {
        if (boolean.has(name)) {
          flags.add(name);
          options[name] = true;
          continue;
        }
        let value = inlineValue;
        if (value === undefined) {
          value = argv[i + 1];
          if (value === undefined) throw new CliError(EXIT.USAGE, `${name} requires a value`);
          i += 1;
        }
        if (repeatable.has(name)) {
          const existing = options[name];
          if (Array.isArray(existing)) existing.push(value);
          else options[name] = [value];
        } else {
          options[name] = value;
        }
        continue;
      }

      throw new CliError(
        EXIT.USAGE,
        `Unknown option "${name}". Run with --help to see the supported options for this command.`,
      );
    }

    positionals.push(arg);
  }

  const command = positionals.shift() ?? '';

  // Output format is selected with --output-format, or the --json / --text
  // shorthands. It is deliberately NOT --format: on `build` and `convert`,
  // --format names the *export* format (stl, 3mf, dxf …), and overloading one
  // flag for two meanings made `build --format json` fail confusingly.
  const formatOption = options['--output-format'];
  let outputFormat: OutputFormat = 'json';
  if (flags.has('--json')) outputFormat = 'json';
  else if (flags.has('--text')) outputFormat = 'text';
  else if (typeof formatOption === 'string') {
    if (formatOption !== 'json' && formatOption !== 'text') {
      throw new CliError(EXIT.USAGE, `--format must be "json" or "text", got "${formatOption}"`);
    }
    outputFormat = formatOption;
  }

  return {
    command,
    positionals,
    defines,
    options,
    flags,
    passthrough,
    outputFormat,
    quiet: flags.has('--quiet') || flags.has('-q'),
    verbose: flags.has('--verbose'),
    help: flags.has('--help') || flags.has('-h'),
    version: flags.has('--version') || flags.has('-v'),
  };
}

export function optString(args: ParsedArgs, name: string): string | undefined {
  const value = args.options[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[value.length - 1] as string;
  return undefined;
}

export function optNumber(args: ParsedArgs, name: string, fallback: number): number {
  const value = optString(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CliError(EXIT.USAGE, `${name} expects a number, got "${value}"`);
  return parsed;
}

export function optBoolean(args: ParsedArgs, name: string): boolean {
  return args.flags.has(name) || args.options[name] === true;
}

export function optStrings(args: ParsedArgs, name: string): string[] {
  const value = args.options[name];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  return [];
}
