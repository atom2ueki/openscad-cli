// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Turns raw engine output into a verdict.
//
// Inputs: the engine's summary JSON, the parsed diagnostics, the output
// artifact, and (optionally) our own mesh analysis. The engine's `geometry`
// object is backend- and dimension-dependent — see types.ts for the three
// verified shapes — so nothing here may assume a key exists.

import type { Diagnostic, EngineGeometryStats, EngineStats } from '../types.js';
import { analyseMesh, type MeshStats } from './mesh.js';
import { readJsonFile } from '../util/fsx.js';

export interface VerifyOptions {
  summaryFile: string;
  outputFile: string;
  diagnostics: Diagnostic[];
  /** Run our own STL/OFF analysis. */
  verifyMesh: boolean;
  /** Fail when the largest bounding-box dimension exceeds this. 0 disables. */
  maxDimension: number;
  /** Warn when the triangle count exceeds this. 0 disables. */
  maxTriangles: number;
  /** Minimum plausible surface area, to catch an effectively empty solid. */
  minArea: number;
}

export interface VerifyOutcome {
  status: 'ok' | 'warn' | 'error';
  stats: EngineStats;
  /** Diagnostics this layer added on top of the engine's own. */
  diagnostics: Diagnostic[];
  mesh?: MeshStats;
}

export function readEngineSummary(file: string): {
  geometry?: EngineGeometryStats;
  time?: Record<string, unknown>;
  cache?: Record<string, unknown>;
  camera?: Record<string, unknown>;
} | undefined {
  const parsed = readJsonFile<Record<string, unknown>>(file);
  // The engine writes a literal `null` when no --summary section is enabled.
  if (!parsed || typeof parsed !== 'object') return undefined;
  return parsed as never;
}

export function verify(options: VerifyOptions): VerifyOutcome {
  const summary = readEngineSummary(options.summaryFile);
  const geometry = summary?.geometry;
  const diagnostics: Diagnostic[] = [...options.diagnostics];
  const stats: EngineStats = {
    ...(summary?.time ? { time: summary.time } : {}),
    ...(summary?.cache ? { cache: summary.cache } : {}),
  };

  // ---- bounding box: prefer the engine's, fall back to our own mesh --------
  let bbox = geometry?.bounding_box;
  let mesh: MeshStats | undefined;

  if (options.verifyMesh) {
    mesh = analyseMesh(options.outputFile);
    stats.triangles = mesh.triangles;
    stats.volume = mesh.volume;
    stats.area = mesh.area;
    stats.degenerateTriangles = mesh.degenerate;
    if (!bbox) {
      bbox = { min: mesh.min, max: mesh.max, size: mesh.size };
    }
    if (mesh.triangles === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'verify.mesh_empty',
        message: `The exported mesh contains no triangles (${mesh.source} reader).`,
        hint: 'The engine reported success but produced an empty mesh. Re-run with --verbose to see the engine log.',
      });
    } else if (mesh.degenerate > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'verify.degenerate',
        message: `${mesh.degenerate} of ${mesh.triangles} triangles are degenerate (zero area).`,
        hint: 'A boolean operation probably reduced a surface to zero thickness. Check for coincident faces and zero-height extrusions.',
      });
    }
    if (mesh.sliver > 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'verify.sliver',
        message: `${mesh.sliver} sliver triangles detected (area below 1% of median).`,
        hint: 'Slivers usually come from a boolean that only grazes a surface. Nudging the offset by 0.01 usually removes them.',
      });
    }
    if (mesh.triangles > 0 && !mesh.closed) {
      diagnostics.push({
        severity: 'warning',
        code: 'verify.not_closed',
        message: `Mesh is not a closed solid (volume ${fmt(mesh.volume)} against bounding box ${fmt(
          mesh.size[0] * mesh.size[1] * mesh.size[2],
        )} mm^3).`,
        hint: 'The exported surface has holes, so slicers will produce unpredictable results. Often caused by coincident faces in a boolean.',
      });
    }
  }

  const size = bbox?.size;
  if (size && Array.isArray(size) && size.length > 0) {
    stats.boundingBox = {
      min: (bbox?.min as number[]) ?? [],
      max: (bbox?.max as number[]) ?? [],
      size,
    };

    if (options.maxDimension > 0) {
      const largest = Math.max(...size);
      if (largest > options.maxDimension) {
        diagnostics.push({
          severity: 'error',
          code: 'verify.too_large',
          message: `Model is ${largest.toFixed(2)} units on its largest axis, over the --max-dim limit of ${options.maxDimension}.`,
          hint: 'Scale the model down, or raise --max-dim if the size is intended.',
        });
      }
    }
  }

  if (options.maxTriangles > 0 && mesh && mesh.triangles > options.maxTriangles) {
    diagnostics.push({
      severity: 'warning',
      code: 'verify.too_many_triangles',
      message: `${mesh.triangles} triangles exceeds the --max-triangles limit of ${options.maxTriangles}.`,
      hint: 'A high triangle count means slow slicing and a large file. Lower $fn or the slice count.',
    });
  }

  // ---- emptiness, from whichever signals we have --------------------------
  const areaForCheck = stats.area ?? mesh?.area ?? 0;
  const facets = geometry?.facets;
  const isEmpty =
    options.diagnostics.some((d) => d.code === 'geometry.empty') ||
    (typeof facets === 'number' && facets === 0) ||
    (mesh !== undefined && mesh.triangles === 0) ||
    (geometry?.dimensions === 2 && facets === 0);

  if (isEmpty && !diagnostics.some((d) => d.severity === 'error')) {
    diagnostics.push({
      severity: 'error',
      code: 'geometry.empty',
      message: 'The model produced no geometry.',
      hint: 'Check the top-level conditional and the -D values: an out-of-range parameter can silently disable the body.',
    });
  } else if (areaForCheck > 0 && areaForCheck < options.minArea) {
    diagnostics.push({
      severity: 'warning',
      code: 'verify.tiny_surface',
      message: `Surface area is only ${fmt(areaForCheck)} square units.`,
      hint: 'This is close to degenerate. Check for zero-height extrusions and zero-thickness walls.',
    });
  }

  const status = deriveStatus(diagnostics, options.diagnostics);
  return { status, stats, diagnostics, mesh };
}

/**
 * A run is `error` if the engine itself errored, or if verification found
 * something fatal. It is `warn` if anything else is worth passing on.
 * The engine's own diagnostics are seeded into the list first, so their
 * severities are preserved.
 */
function deriveStatus(all: Diagnostic[], engineOnly: Diagnostic[]): 'ok' | 'warn' | 'error' {
  if (all.some((d) => d.severity === 'error')) return 'error';
  if (all.some((d) => d.severity === 'warning')) return 'warn';
  if (engineOnly.length > 0) return 'warn';
  return 'ok';
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}
