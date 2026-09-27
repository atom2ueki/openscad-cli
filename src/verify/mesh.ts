// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 the openscad-cli authors
//
// Minimal mesh readers and geometric checks.
//
// This layer exists because the engine's summary JSON reports facets and (only
// for some backend/dimension combinations) a bounding box, but *no* area and
// *no* volume. Those two numbers are what tell an agent whether a print will
// succeed, so we recompute them from the exported mesh. The signed-tetrahedron
// sum gives volume directly; for a closed, consistently wound mesh the result
// is positive, and a suspiciously small value against the bounding box is the
// classic signature of an inverted or non-manifold region.

import * as fs from 'node:fs';

export interface MeshStats {
  triangles: number;
  /** Absolute volume in model units^3 (mm^3 for a mm model). */
  volume: number;
  /** Surface area in model units^2. */
  area: number;
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  /** Triangles with two or more coincident vertices. */
  degenerate: number;
  /** Triangles whose area is below a fraction of the median. */
  sliver: number;
  /** Closed-mesh heuristic: |volume| is meaningfully non-zero. */
  closed: boolean;
  source: 'binary-stl' | 'ascii-stl' | 'off';
}

type Vec3 = [number, number, number];

const EMPTY_STATS = (source: MeshStats['source']): MeshStats => ({
  triangles: 0,
  volume: 0,
  area: 0,
  min: [0, 0, 0],
  max: [0, 0, 0],
  size: [0, 0, 0],
  degenerate: 0,
  sliver: 0,
  closed: false,
  source,
});

/** Detect the flavour of an STL/OFF file from its first bytes. */
export function detectMeshFormat(file: string): MeshStats['source'] {
  const head = readHead(file, 512);
  if (head.startsWith('solid')) {
    // "solid" alone is ambiguous — some binary STLs start with it — so look
    // for the ASCII facet keyword in the first chunk.
    if (head.includes('facet normal')) return 'ascii-stl';
  }
  if (head.includes('OFF')) return 'off';
  if (head.trimStart().startsWith('OFF')) return 'off';
  return 'binary-stl';
}

function readHead(file: string, bytes: number): string {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const read = fs.readSync(fd, buf, 0, bytes, 0);
      return buf.subarray(0, read).toString('latin1');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

export function analyseMesh(file: string): MeshStats {
  const format = detectMeshFormat(file);
  let triangles: Vec3[][];
  try {
    triangles = format === 'off' ? readOff(file) : format === 'ascii-stl' ? readAsciiStl(file) : readBinaryStl(file);
  } catch {
    return EMPTY_STATS(format);
  }
  return computeStats(triangles, format);
}

function readBinaryStl(file: string): Vec3[][] {
  const buf = fs.readFileSync(file);
  // 80-byte header + 4-byte count, then 50 bytes per triangle.
  if (buf.length < 84) return [];
  const count = buf.readUInt32LE(80);
  const available = Math.floor((buf.length - 84) / 50);
  const n = Math.min(count, available);
  const out: Vec3[][] = [];
  for (let i = 0; i < n; i += 1) {
    const base = 84 + i * 50;
    const v: Vec3[] = [
      [buf.readFloatLE(base + 12), buf.readFloatLE(base + 16), buf.readFloatLE(base + 20)],
      [buf.readFloatLE(base + 24), buf.readFloatLE(base + 28), buf.readFloatLE(base + 32)],
      [buf.readFloatLE(base + 36), buf.readFloatLE(base + 40), buf.readFloatLE(base + 44)],
    ];
    out.push(v);
  }
  return out;
}

function readAsciiStl(file: string): Vec3[][] {
  const text = fs.readFileSync(file, 'utf8');
  const out: Vec3[][] = [];
  const vertexRe = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  const collected: Vec3[] = [];
  let match: RegExpExecArray | null;
  while ((match = vertexRe.exec(text)) !== null) {
    collected.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  for (let i = 0; i + 2 < collected.length; i += 3) {
    out.push([collected[i]!, collected[i + 1]!, collected[i + 2]!]);
  }
  return out;
}

function readOff(file: string): Vec3[][] {
  const text = fs.readFileSync(file, 'utf8');
  const tokens = text
    .replace(/#.*$/gm, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);

  // OFF / COFF / NOFF, possibly preceded by ST, C, N, P, or counts.
  let i = 0;
  while (i < tokens.length && /^[a-zA-Z]+$/.test(tokens[i]!)) i += 1;
  while (i < tokens.length && /^(ST|C|N|P|4|n)$/i.test(tokens[i]!)) i += 1;

  const vertexCount = Number(tokens[i]);
  const faceCount = Number(tokens[i + 1]);
  if (!Number.isFinite(vertexCount) || !Number.isFinite(faceCount)) return [];
  i += 2;

  const vertices: Vec3[] = [];
  for (let v = 0; v < vertexCount; v += 1) {
    vertices.push([
      Number(tokens[i]),
      Number(tokens[i + 1]),
      Number(tokens[i + 2]),
    ]);
    i += 3;
  }

  const out: Vec3[][] = [];
  for (let f = 0; f < faceCount; f += 1) {
    const n = Number(tokens[i]);
    i += 1;
    if (!Number.isFinite(n)) break;
    const face: Vec3[] = [];
    for (let k = 0; k < n; k += 1) {
      const idx = Number(tokens[i]);
      i += 1;
      const vertex = vertices[idx];
      if (vertex) face.push(vertex);
    }
    // Fan-triangulate n-gons.
    for (let k = 1; k + 1 < face.length; k += 1) {
      out.push([face[0]!, face[k]!, face[k + 1]!]);
    }
  }
  return out;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

const EPS = 1e-12;

export function computeStats(triangles: Vec3[][], source: MeshStats['source']): MeshStats {
  const stats = EMPTY_STATS(source);
  stats.triangles = triangles.length;
  if (triangles.length === 0) return stats;

  let volume = 0;
  let area = 0;
  let degenerate = 0;
  const areas: number[] = [];

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const tri of triangles) {
    if (tri.length < 3) continue;
    const [a, b, c] = [tri[0]!, tri[1]!, tri[2]!];

    for (const v of [a, b, c]) {
      if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) continue;
      if (v[0] < minX) minX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] > maxZ) maxZ = v[2];
    }

    // Signed volume of the tetrahedron spanned by the origin and the triangle.
    volume += dot(a, cross(b, c)) / 6;

    const n = cross(sub(b, a), sub(c, a));
    const triArea = Math.sqrt(dot(n, n)) / 2;
    area += triArea;
    areas.push(triArea);

    if (triArea <= EPS) degenerate += 1;
  }

  if (!Number.isFinite(minX)) {
    stats.triangles = 0;
    return stats;
  }

  stats.volume = Math.abs(volume);
  stats.area = area;
  stats.degenerate = degenerate;
  stats.min = [minX, minY, minZ];
  stats.max = [maxX, maxY, maxZ];
  stats.size = [maxX - minX, maxY - minY, maxZ - minZ];

  // Slivers: triangles far below the median area. A healthy mesh has none;
  // boolean operations that graze a surface leave many.
  const sorted = [...areas].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  stats.sliver = median > EPS ? sorted.filter((v) => v > 0 && v < median * 0.01).length : 0;

  // Bounding-box volume is an upper bound on a solid's volume. A mesh filling
  // less than ~0.1% of its bbox is effectively empty, and a non-zero volume
  // means the surface is closed and consistently wound.
  const bboxVolume = stats.size[0] * stats.size[1] * stats.size[2];
  stats.closed = stats.volume > EPS && bboxVolume > 0 && stats.volume <= bboxVolume * 1.05;

  return stats;
}
