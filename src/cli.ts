#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors

import { parseArgs, type Spec } from './args.js';
import { CliError, EXIT, EXIT_MEANING, type ExitCode } from './exit.js';
import { emitError } from './output.js';
import { RunTimeoutError } from './run.js';
import { cmdBuild, cmdValidate, cmdVariants } from './commands/build.js';
import { cmdConvert, cmdDoctor, cmdInfo, cmdInspect, cmdRaw, cmdSkill } from './commands/inspect.js';

const GLOBAL_SPEC: Spec = {
  withValue: ['--output-format', '--engine', '--timeout', '--workdir'],
  boolean: [
    '--json',
    '--text',
    '--quiet',
    '--verbose',
    '--no-cache',
    '--keep-workdir',
    '--keep-failed',
    '--strict',
    '--no-verify',
    '--help',
    '-h',
    '--version',
    '-v',
  ],
};

const COMMAND_SPEC: Record<string, Spec> = {
  build: {
    ...GLOBAL_SPEC,
    withValue: [
      ...(GLOBAL_SPEC.withValue ?? []),
      '-o',
      '--format',
      '--o',
      '--output',
      '--backend',
      '--max-dim',
      '--max-triangles',
      '--min-area',
      '-p',
      '-P',
    ],
  },
  validate: { ...GLOBAL_SPEC, withValue: [...(GLOBAL_SPEC.withValue ?? []), '--backend', '-p', '-P'] },
  variants: {
    ...GLOBAL_SPEC,
    withValue: [...(GLOBAL_SPEC.withValue ?? []), '--format', '-o', '--o', '--output', '--backend', '--param', '--out-dir', '--jobs'],
    // --param must be repeatable: each occurrence names a different variable.
    // Without this the last --param silently overwrote the earlier ones and a
    // whole dimension of the sweep was never applied.
    repeatable: ['--param'],
    boolean: [...(GLOBAL_SPEC.boolean ?? []), '--ordered'],
  },
  inspect: {
    ...GLOBAL_SPEC,
    withValue: [...(GLOBAL_SPEC.withValue ?? []), '-o', '--o', '--output', '--out-dir', '-p', '-P'],
    boolean: [...(GLOBAL_SPEC.boolean ?? []), '--ast', '--csg', '--echo', '--params'],
  },
  convert: {
    ...GLOBAL_SPEC,
    withValue: [...(GLOBAL_SPEC.withValue ?? []), '-o', '--o', '--output', '--format', '--backend'],
  },
  info: GLOBAL_SPEC,
  doctor: GLOBAL_SPEC,
  skill: GLOBAL_SPEC,
  raw: GLOBAL_SPEC,
};

const HELP = `openscad-cli — drive the OpenSCAD core engine from a script or an agent.

USAGE
  openscad-cli <command> [options]

COMMANDS
  build <file.scad>            Render and export a model. The main command.
  validate <file.scad>         Parse and evaluate without producing an artifact.
  variants <file.scad>         Render a Cartesian product of parameter values.
  inspect <file.scad>          Language-level dumps: --ast --csg --echo --params
  convert <file.scad>          Re-export through import(); also converts meshes.
  info                         Engine version, formats, capabilities, license.
  doctor                       Diagnose the environment; exits 3 if unusable.
  skill                        Print the agent skill bundle for this CLI build.
  raw -- <engine-args...>      Forward arguments to the engine untouched.

GLOBAL OPTIONS
  -D name=value        Override a top-level variable (repeatable). The value is
                       an OpenSCAD expression, so strings need inner quotes.
  --output-format json|text
                       How results are printed. Default: json. On build and
                       convert, --format names the EXPORT format instead.
  --engine <path>      Use a specific OpenSCAD executable.
  --timeout <seconds>  Kill the engine after this long. Default: ${Math.round(
    Number(process.env.OPENSCAD_CLI_DEFAULT_TIMEOUT ?? 300),
  )}.
  --strict             Treat the first engine warning as fatal.
  --no-cache           Ignore and do not write the run cache.
  --no-verify          Skip independent mesh analysis of the output.
  --workdir <dir>      Where to keep the work directory (default: beside -o).
  --keep-workdir       Keep the work directory even on success.
  --keep-failed        Keep partial artifacts from a failed run.
  --quiet              Suppress the engine's own logging.
  --verbose            Let the engine log to stderr.
  --help, --version

BUILD OPTIONS
  -o, --output <file>  Output path. Default: the input name with the format's
                       extension, written next to the input.
  --format <name>      stl off obj wrl 3mf dxf svg pdf csg ast echo param pov
                       Default: stl (always exported as binary STL).
  --backend <name>     manifold (default) or cgal.
  --max-dim <n>        Fail if the model exceeds this largest axis length.
  --max-triangles <n>  Warn above this triangle count.
  --min-area <n>       Warn below this surface area (catches near-empty solids).
  -p <file>            Customizer parameter file.
  -P <name>            Customizer parameter set within -p.

VARIANTS OPTIONS
  --param name=v1,v2   A value list. Also accepts ranges: 0:1:10 or 0:3.
  --jobs <n>           Concurrent engine processes. Default: half the cores.
  --out-dir <dir>      Where to write the variants.
  --ordered            Emit results in input order instead of completion order.

EXIT CODES
${Object.entries(EXIT_MEANING)
  .map(([code, meaning]) => `  ${code}  ${meaning}`)
  .join('\n')}

EXAMPLES
  openscad-cli build bracket.scad -o bracket.stl
  openscad-cli build bracket.scad -D width=80 -D 'label="ACME"' --strict
  openscad-cli variants bracket.scad --param width=40,60,80 --out-dir out/
  openscad-cli validate sketch.scad --format text
  openscad-cli info | jq .capabilities
  openscad-cli doctor

LICENSE
  GPL-2.0-or-later. The complete corresponding source for this tool and the
  OpenSCAD engine it embeds is published with every release.
`;

type CommandFn = (args: ReturnType<typeof parseArgs>) => Promise<number>;

const COMMANDS: Record<string, CommandFn> = {
  build: cmdBuild,
  validate: cmdValidate,
  variants: cmdVariants,
  inspect: cmdInspect,
  convert: cmdConvert,
  info: cmdInfo,
  doctor: cmdDoctor,
  skill: cmdSkill,
  raw: cmdRaw,
};

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    process.stdout.write(HELP);
    return EXIT.USAGE;
  }

  const first = argv[0] as string;

  // Global --help / --version must work even with an unknown command.
  if (first === '--help' || first === '-h' || first === 'help') {
    process.stdout.write(HELP);
    return EXIT.OK;
  }
  if (first === '--version' || first === '-v') {
    process.stdout.write(`${await readVersion()}\n`);
    return EXIT.OK;
  }

  const command = COMMANDS[first];
  if (!command) {
    process.stderr.write(
      `error: unknown command "${first}".\n\nRun \`openscad-cli --help\` for the command list.\n`,
    );
    return EXIT.USAGE;
  }

  try {
    const spec = COMMAND_SPEC[first] ?? GLOBAL_SPEC;
    const args = parseArgs(argv, spec);

    if (args.help) {
      process.stdout.write(HELP);
      return EXIT.OK;
    }

    return await command(args);
  } catch (err) {
    return handleError(err, first);
  }
}

function handleError(err: unknown, command: string): ExitCode {
  if (err instanceof CliError) {
    emitError(err.code, err.message, err.detail);
    return err.code;
  }
  if (err instanceof RunTimeoutError) {
    emitError(EXIT.TIMEOUT, err.message, undefined);
    return EXIT.TIMEOUT;
  }
  const message = err instanceof Error ? err.message : String(err);
  emitError(EXIT.INTERNAL, `internal error in \`${command}\`: ${message}`, undefined);
  if (process.env.OPENSCAD_CLI_DEBUG) {
    process.stderr.write(`${err instanceof Error ? err.stack ?? '' : ''}\n`);
  }
  return EXIT.INTERNAL;
}

async function readVersion(): Promise<string> {
  try {
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [resolve(here, '..', 'package.json'), resolve(here, '..', '..', 'package.json')]) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (parsed.version) return `${parsed.name ?? 'openscad-cli'} ${parsed.version}`;
      } catch {
        /* next candidate */
      }
    }
  } catch {
    /* fall through */
  }
  return 'openscad-cli 0.0.0';
}

// Only run when invoked directly, so tests can import main().
const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('cli.ts') || process.argv[1].endsWith('openscad-cli'));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      process.exitCode = EXIT.INTERNAL;
    });
}
