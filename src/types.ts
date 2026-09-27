// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Shared types for the openscad-cli result contract. The shapes in this file
// are the public, machine-readable surface that agents consume; they are
// versioned by the `schema` field so a breaking change is a visible event.

/** Version of the Result JSON contract implemented by this build. */
export const RESULT_SCHEMA = 'openscad-cli/result@1' as const;

/** SPDX identifier of this program, also of the engine it embeds. */
export const LICENSE_SPDX = 'GPL-2.0-or-later' as const;

/** Where users can obtain the complete corresponding source. */
export const SOURCE_URL = 'https://github.com/atom2ueki/openscad-cli' as const;

export type Severity = 'error' | 'warning' | 'note';

/**
 * A structured diagnostic parsed out of the engine's stderr.
 *
 * `code` is a stable identifier that agents may branch on; `hint` is a short
 * actionable suggestion. Upstream message text is preserved verbatim in
 * `message` so nothing is lost in translation.
 */
export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  file?: string;
  line?: number;
  hint?: string;
  /** Verbatim upstream group, e.g. WARNING, PARSER-ERROR, ECHO. */
  group?: string;
}

export interface OutputArtifact {
  format: string;
  path: string;
  sha256?: string;
  bytes?: number;
}

export interface EngineInfo {
  version: string;
  /** Git commit of the engine, when it could be determined. */
  sha: string;
  /** Build profile compiled into the engine: `full` or `lite`. */
  profile: 'full' | 'lite';
  backends: string[];
  /** Absolute path of the engine executable that was used. */
  path?: string;
}

/**
 * Geometry stats as reported by the engine's `--summary` JSON.
 *
 * IMPORTANT: this object is backend- and dimension-dependent. Verified
 * against OpenSCAD 2026.09.23:
 *   - cgal 3D      -> { bounding_box, convex, dimensions, facets, triangular }
 *   - manifold 3D  -> { dimensions, facets, simple, vertices }   (no bounding_box)
 *   - manifold 2D  -> { bounding_box, contours, convex, dimensions }
 * The engine reports no area or volume, so those are computed from the
 * exported mesh instead. See verify/mesh.ts.
 */
export interface EngineGeometryStats {
  dimensions?: number;
  facets?: number;
  vertices?: number;
  contours?: number;
  convex?: boolean;
  simple?: boolean;
  triangular?: boolean;
  bounding_box?: { min?: number[]; max?: number[]; size?: number[] };
  [key: string]: unknown;
}

export interface EngineStats {
  geometry?: EngineGeometryStats;
  boundingBox?: { min: number[]; max: number[]; size: number[] };
  area?: number;
  volume?: number;
  triangles?: number;
  degenerateTriangles?: number;
  time?: Record<string, unknown>;
  cache?: Record<string, unknown>;
}

export type ResultStatus = 'ok' | 'warn' | 'error';

export interface BuildResult {
  schema: typeof RESULT_SCHEMA;
  status: ResultStatus;
  command: string;
  engine: EngineInfo;
  input: { path: string; sha256: string; defines: Record<string, string> };
  outputs: OutputArtifact[];
  stats: EngineStats;
  diagnostics: Diagnostic[];
  cache: { key: string; hit: boolean };
  timings: { totalMs: number; renderMs: number };
  license: { spdx: typeof LICENSE_SPDX; source: string };
  /** Echo output captured from the model, in emission order. */
  echo: string[];
}

/** Result of a `variants` job: a BuildResult plus its position in the matrix. */
export interface VariantResult extends BuildResult {
  seq: number;
  /** The defines that produced this particular variant. */
  variant: Record<string, string>;
}
