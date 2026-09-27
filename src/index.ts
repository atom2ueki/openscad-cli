// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Library entry point. The CLI is the primary interface, but these exports
// let a host application drive the same pipeline in-process.

export { main } from './cli.js';
export { runBuild, RunTimeoutError, type RunOptions } from './run.js';
export { EXIT, EXIT_MEANING, CliError, exitCodeForStatus, type ExitCode } from './exit.js';
export {
  LICENSE_SPDX,
  RESULT_SCHEMA,
  SOURCE_URL,
  type BuildResult,
  type Diagnostic,
  type EngineInfo,
  type EngineStats,
  type OutputArtifact,
  type ResultStatus,
  type VariantResult,
} from './types.js';
export { parseStderr, hasErrors } from './diagnostics/parse.js';
export { classify, knownCodes } from './diagnostics/codes.js';
export { analyseMesh, computeStats, type MeshStats } from './verify/mesh.js';
export { verify, type VerifyOptions, type VerifyOutcome } from './verify/rules.js';
export { resolveEngine, readEngineVersion, type ResolvedEngine } from './engine/locate.js';
export { invokeEngine, type InvokeOptions, type InvokeResult } from './engine/invoke.js';
export { buildInvocation, ALL_FORMATS, MESH_FORMATS, VECTOR_2D_FORMATS, type Format, type Backend } from './engine/flags.js';
export { computeCacheKey, lookupCache, parseDepsFile, type CachedRun } from './cache/index.js';
