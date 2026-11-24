import { BufferAttribute, BufferGeometry, EdgesGeometry, Matrix4 } from "three";
import type { Affine, ImportedModel } from "../formats/types";
import { IDENTITY, multiply, referenceLine } from "../formats/ldraw/parser";
import { candidates, normalizeReference } from "@workspace/ldraw-source";
import { deriveLineNormalPairs } from "./wide-lines";

export interface Surface {
  colorCode: string;
  positions: Float32Array;
  normals: Float32Array;
  edges: Float32Array;
}
export interface VisibleEdgeData {
  positions: Float32Array;
  normals: Float32Array;
  alternateNormals: Float32Array;
  colorCodes: string[];
}
interface PendingSurface { colorCode: string; positions: number[]; edges: number[] }
const cache = new WeakMap<ImportedModel, Map<string, Surface[]>>();
const MAX_VERTICES = 1_500_000;
const MAX_DERIVED_EDGE_TRIANGLES = 20_000;
const MAX_RENDER_EDGE_SEGMENTS = 100_000;
const DERIVED_EDGE_CREASE_ANGLE_DEGREES = 30;
const edgeSources = new WeakMap<readonly Surface[], { surface: Surface; positions: Float32Array }[]>();

function getEdgeSources(surfaces: readonly Surface[]) {
  const cached = edgeSources.get(surfaces);
  if (cached) return cached;
  const sources: { surface: Surface; positions: Float32Array }[] = [];
  for (const surface of surfaces) {
    let edges = surface.edges;
    if (!edges.length && surface.positions.length &&
      surface.positions.length / 9 <= MAX_DERIVED_EDGE_TRIANGLES) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(surface.positions, 3));
      // 30° suppresses the 22.5° facet seams on standard 16-sided LEGO studs,
      // while retaining actual body corners and authored LDraw line records.
      const creaseGeometry = new EdgesGeometry(geometry, DERIVED_EDGE_CREASE_ANGLE_DEGREES);
      geometry.dispose();
      edges = creaseGeometry.getAttribute("position").array as Float32Array;
      creaseGeometry.dispose();
    }
    if (edges.length) sources.push({ surface, positions: edges });
  }
  edgeSources.set(surfaces, sources);
  return sources;
}

function edgeLayout(surfaces: readonly Surface[]) {
  const sources = getEdgeSources(surfaces);
  const totalSegments = sources.reduce((sum, source) => sum + Math.floor(source.positions.length / 6), 0);
  const stride = Math.max(1, Math.ceil(totalSegments / MAX_RENDER_EDGE_SEGMENTS));
  return { sources, stride, selectedSegments: Math.ceil(totalSegments / stride) };
}

export function visibleEdgeCount(surfaces: readonly Surface[]): number {
  return edgeLayout(surfaces).selectedSegments;
}

/** Uses authored LDraw edges or derived creases without preparing wide-line lighting. */
export function visibleEdgeLines(surfaces: readonly Surface[]): Float32Array {
  const { sources, stride, selectedSegments } = edgeLayout(surfaces);
  if (sources.length === 1 && stride === 1) return sources[0].positions;
  const positions = new Float32Array(selectedSegments * 6);
  let sourceSegment = 0, outputSegment = 0;
  for (const source of sources) {
    for (let offset = 0; offset + 5 < source.positions.length; offset += 6, sourceSegment++) {
      if (sourceSegment % stride === 0) positions.set(source.positions.subarray(offset, offset + 6), outputSegment++ * 6);
    }
  }
  return positions;
}

/** Retain the source surface appearance and lighting normal for wide edges. */
export function visibleEdgeData(surfaces: readonly Surface[]): VisibleEdgeData {
  const { sources, stride, selectedSegments } = edgeLayout(surfaces);
  const positions = new Float32Array(selectedSegments * 6);
  const normals = new Float32Array(selectedSegments * 6);
  const alternateNormals = new Float32Array(selectedSegments * 6);
  const colorCodes: string[] = [];
  let sourceSegment = 0, outputSegment = 0;
  for (const { surface, positions: edges } of sources) {
    const lineNormals = deriveLineNormalPairs(edges, surface.positions, surface.normals);
    for (let offset = 0; offset + 5 < edges.length; offset += 6, sourceSegment++) {
      if (sourceSegment % stride !== 0) continue;
      positions.set(edges.subarray(offset, offset + 6), outputSegment * 6);
      normals.set(lineNormals.primary.subarray(offset, offset + 6), outputSegment * 6);
      alternateNormals.set(lineNormals.alternate.subarray(offset, offset + 6), outputSegment * 6);
      colorCodes.push(surface.colorCode);
      outputSegment++;
    }
  }
  return { positions, normals, alternateNormals, colorCodes };
}
/** Undo may remove newly acquired but now unused files without invalidating live parts. */
export function sameSceneSources(previous: ImportedModel, next: ImportedModel): boolean {
  if (previous.originalBytes !== next.originalBytes || previous.sourceText !== next.sourceText || previous.root !== next.root) return false;
  if (previous.resources === next.resources) return true;
  const removed = new Set<string>();
  for (const [path, file] of Object.entries(previous.resources)) {
    if (!next.resources[path]) removed.add(path);
    else if (next.resources[path].content !== file.content) return false;
  }
  if (!removed.size) return true;
  const visited = new Set<string>();
  const references = next.instances.filter(instance => instance.part.status === "resolved").map(instance => instance.reference);
  while (references.length) {
    const reference = references.pop()!;
    const path = candidates(reference).find(path => Object.hasOwn(next.resources, path)) ??
      candidates(reference).find(path => Object.hasOwn(previous.resources, path));
    if (!path || removed.has(path)) return false;
    if (visited.has(path)) continue;
    visited.add(path);
    for (const line of next.resources[path].content.split(/\r?\n/)) {
      if (/^\s*1\s/.test(line)) references.push(referenceLine(line).reference);
    }
  }
  return true;
}
export function invalidateGeometry(model: ImportedModel) { cache.delete(model); }
export function reuseGeometryCache(previous: ImportedModel | undefined, next: ImportedModel): void {
  if (!previous || previous === next || cache.has(next)) return;
  const compiled = cache.get(previous);
  if (compiled && previous.resources === next.resources) {
    cache.set(next, compiled);
    return;
  }
  if (compiled && Object.entries(previous.resources).every(([path, file]) => next.resources[path]?.content === file.content)) {
    cache.set(next, new Map(compiled));
  }
}
export function hasCompiledPart(model: ImportedModel, reference: string): boolean {
  return cache.get(model)?.has(normalizeReference(reference)) ?? false;
}
export function getCompiledPart(model: ImportedModel, reference: string): Surface[] | undefined {
  return cache.get(model)?.get(normalizeReference(reference));
}
export function installCompiledPart(model: ImportedModel, reference: string, surfaces: Surface[]): void {
  let modelCache = cache.get(model);
  if (!modelCache) { modelCache = new Map(); cache.set(model, modelCache); }
  modelCache.set(normalizeReference(reference), surfaces);
}
function point(m: Affine, x: number, y: number, z: number): number[] {
  return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
}
/** Shared original LDU geometry; no procedural substitutions, no external fetches. */
export function compilePart(model: ImportedModel, reference: string, color: string): Surface[] {
  let modelCache = cache.get(model);
  if (!modelCache) { modelCache = new Map(); cache.set(model, modelCache); }
  const key = normalizeReference(reference);
  const cached = modelCache.get(key);
  if (cached) return resolveSurfaces(cached, color);
  const surfaces = new Map<string, PendingSurface>();
  let vertices = 0, visits = 0;
  function visit(path: string, matrix: Affine, currentColor: string, stack: string[]) {
    if (stack.includes(path) || stack.length > 48 || ++visits > 50000) throw new Error(`Geometriehierarchie ungültig: ${path}`);
    const file = model.resources[path];
    if (!file) throw new Error(`Geometrie fehlt: ${path}`);
    for (const line of file.content.split(/\r?\n/)) {
      const tokens = line.trim().split(/\s+/);
      const type = tokens[0];
      if (type === "1") {
        const ref = referenceLine(line);
        const child = candidates(ref.reference).find(path => Object.hasOwn(model.resources, path));
        if (!child) throw new Error(`Geometrie fehlt: ${ref.reference}`);
        visit(child, multiply(matrix, ref.matrix), ref.color === "16" ? currentColor : ref.color, [...stack, path]);
      } else if (["2", "3", "4"].includes(type)) {
        const expected = type === "2" ? 6 : type === "3" ? 9 : 12;
        const values = tokens.slice(2, expected + 2).map(Number);
        const trailing = tokens.slice(expected + 2).map(Number);
        // Studio custom meshes append three UV pairs to type-3 triangle records.
        // UVs are not part of LDraw's geometry; retain the source and render the
        // standard triangle coordinates while validating the extension strictly.
        const hasStudioTriangleUv = type === "3" && trailing.length === 6 &&
          trailing.every(v => Number.isFinite(v) && Math.abs(v) <= 1e7);
        if (values.length !== expected || (tokens.length !== expected + 2 && !hasStudioTriangleUv) ||
            values.some(v => !Number.isFinite(v) || Math.abs(v) > 1e7)) {
          throw new Error(`Ungültige Geometriezeile: ${path}`);
        }
        const code = tokens[1] === "16" || tokens[1] === "24" ? currentColor : tokens[1];
        let surface = surfaces.get(code);
        if (!surface) { surface = { colorCode: code, positions: [], edges: [] }; surfaces.set(code, surface); }
        const points = [];
        for (let index = 0; index < values.length; index += 3) points.push(point(matrix, values[index], values[index + 1], values[index + 2]));
        if (type === "2") surface.edges.push(...points[0], ...points[1]);
        else {
          surface.positions.push(...points[0], ...points[1], ...points[2]);
          if (type === "4") surface.positions.push(...points[0], ...points[2], ...points[3]);
        }
        vertices += type === "4" ? 6 : Number(type);
        if (vertices > MAX_VERTICES) throw new Error("Teil überschreitet das sichere Geometriebudget.");
      }
    }
  }
   const root = candidates(reference).find(path => Object.hasOwn(model.resources, path));
   if (!root) throw new Error(`Geometrie fehlt: ${reference}`);
   visit(root, IDENTITY, "16", []);
  const result: Surface[] = [...surfaces.values()].map(surface => {
    const positions = new Float32Array(surface.positions);
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i + 3] - positions[i], ay = positions[i + 4] - positions[i + 1], az = positions[i + 5] - positions[i + 2];
      const bx = positions[i + 6] - positions[i], by = positions[i + 7] - positions[i + 1], bz = positions[i + 8] - positions[i + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const length = Math.hypot(nx, ny, nz) || 1;
      for (let vertex = 0; vertex < 9; vertex += 3) {
        normals[i + vertex] = nx / length;
        normals[i + vertex + 1] = ny / length;
        normals[i + vertex + 2] = nz / length;
      }
    }
    return { colorCode: surface.colorCode, positions, normals, edges: new Float32Array(surface.edges) };
  });
  modelCache.set(key, result);
  return resolveSurfaces(result, color);
}
function resolveSurfaces(surfaces: Surface[], color: string): Surface[] {
  if (color === "16") return surfaces;
  // Only lightweight wrappers vary by appearance; vertex buffers are shared.
  return surfaces.map(surface => surface.colorCode === "16" ? { ...surface, colorCode: color } : surface);
}
/** LDraw: 20 LDU per stud, Y down. Preserve all 12 source coefficients. */
export function worldMatrix(m: Affine): Matrix4 {
  return new Matrix4().set(
    m[0] / 20, m[1] / 20, m[2] / 20, m[3] / 20,
    -m[4] / 20, -m[5] / 20, -m[6] / 20, -m[7] / 20,
    m[8] / 20, m[9] / 20, m[10] / 20, m[11] / 20,
    0, 0, 0, 1,
  );
}
export { createImportedGroup } from "./imported-scene";
