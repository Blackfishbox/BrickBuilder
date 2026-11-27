import { yieldPdfExecution } from "../../platform/pdf-background";
import {
  Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Group,
  InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh,
  LineSegments, Material, Mesh, MeshLambertMaterial, ShaderMaterial, SRGBColorSpace,
} from "three";
import type { ImportedInstance, ImportedModel } from "../formats/types";
import { resolveColor } from "../formats/colors";
import { compilePart, visibleEdgeCount, visibleEdgeData, visibleEdgeLines, visibleEdgeColorCodes, worldMatrix, type Surface } from "./ldraw-geometry";
import { installInstructionFocus, FOCUS_ATTRIBUTE, FOCUS_FRAGMENT, FOCUS_FRAGMENT_HEADER, FOCUS_VERTEX, FOCUS_VERTEX_HEADER } from "./instruction-focus";
import { expandWideLines, wideLineMaterial } from "./wide-lines";
import { compactFaceAttributes } from "./compact-faces";
import { expandLegacyLines, legacyLineMaterial, LEGACY_EDGE_BYTES_PER_SEGMENT } from "./legacy-lines";
import { FALLBACK_EDGE_VERTEX, FALLBACK_EDGE_VERTEX_HEADER, needsWhiteEdges } from "./edge-contrast";
const sharedAttributes = new WeakMap<Float32Array, BufferAttribute>();
function sharedAttribute(array: Float32Array): BufferAttribute {
  let attribute = sharedAttributes.get(array);
  if (!attribute) { attribute = new BufferAttribute(array, 3); sharedAttributes.set(array, attribute); }
  return attribute;
}

export type SceneViewport = "standard" | "legacy" | "legacy-faces";
export interface SceneBuildOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  maxGeometryBytes?: number;
  viewport?: SceneViewport;
  /** Full instruction surfaces with lossless packing and bounded edge buffers. */
  instruction?: boolean;
}
export interface ImportedSceneDetail {
  compactFaces: boolean;
  edges: "wide" | "thin" | "legacy" | "none";
  legacyEdgeStride?: number;
}
const FULL_DETAIL: ImportedSceneDetail = { compactFaces: false, edges: "wide" };
export function importedSceneDetail(root: Group): ImportedSceneDetail {
  return root.userData.importedSceneDetail ?? FULL_DETAIL;
}
export const DEFAULT_GEOMETRY_BUDGET = 96 * 1024 * 1024;
// Wide edges expand each occurrence to two shaded triangles; bound frame work
// independently from the memory used by unique geometry buffers.
const MAX_WIDE_EDGE_OCCURRENCES = 500_000;
const WIDE_EDGE_BYTES_PER_SEGMENT = 6 * 18 * Float32Array.BYTES_PER_ELEMENT;
export class SceneBudgetExceeded extends Error {
  constructor() { super("Das Modell überschreitet das mobile Grafik-Speicherbudget."); }
}

export function measureImportedScene(root: Group): { bufferBytes: number; drawObjects: number; instanceRecords: number } {
  const buffers = new Set<ArrayBufferLike>();
  let bufferBytes = 0, instances = 0;
  for (const object of root.children) {
    if (!(object instanceof Mesh || object instanceof LineSegments)) continue;
    const attributes = [...Object.values(object.geometry.attributes), ...(object.geometry.index ? [object.geometry.index] : [])];
    if (object instanceof InstancedMesh) {
      attributes.push(object.instanceMatrix);
      if (object.instanceColor) attributes.push(object.instanceColor);
      instances += object.count;
    }
    for (const attribute of attributes) {
      const buffer = attribute.array.buffer;
      if (!buffers.has(buffer)) { buffers.add(buffer); bufferBytes += buffer.byteLength; }
    }
  }
  return { bufferBytes, drawObjects: root.children.length, instanceRecords: instances };
}

function material(alpha: number, vertexColors = false): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color: "#ffffff", side: DoubleSide, vertexColors,
    transparent: alpha < 255, opacity: alpha / 255, depthWrite: alpha === 255,
  });
}

function addFaces(root: Group, surfaces: Surface[], instances: ImportedInstance[], alpha: number, inherited: boolean, compact: boolean): void {
  const length = surfaces.reduce((sum, surface) => sum + surface.positions.length, 0);
  if (!length || !instances.length) return;
  const geometry = new BufferGeometry();
  if (compact) {
    compactFaceAttributes(geometry, surfaces, !inherited);
  } else if (surfaces.length === 1) {
    geometry.setAttribute("position", sharedAttribute(surfaces[0].positions));
    geometry.setAttribute("normal", sharedAttribute(surfaces[0].normals));
  } else {
    const positions = new Float32Array(length), normals = new Float32Array(length);
    let offset = 0;
    for (const surface of surfaces) {
      positions.set(surface.positions, offset); normals.set(surface.normals, offset);
      offset += surface.positions.length;
    }
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  }
  if (!inherited && !compact) {
    const colors = new Float32Array(length);
    let offset = 0;
    for (const surface of surfaces) {
      const color = new Color(resolveColor(surface.colorCode)?.hex ?? "#ff00ff");
      for (let i = 0; i < surface.positions.length; i += 3) {
        colors[offset++] = color.r; colors[offset++] = color.g; colors[offset++] = color.b;
      }
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
  }
  const mesh = new InstancedMesh(geometry, material(alpha, !inherited), instances.length);
  const color = new Color();
  instances.forEach((instance, index) => {
    mesh.setMatrixAt(index, worldMatrix(instance.matrix));
    if (inherited) mesh.setColorAt(index, color.set(resolveColor(instance.colorCode)?.hex ?? "#ff00ff"));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.name = `ldraw:${instances[0].reference}`;
  mesh.userData.brickIds = instances.map(instance => instance.id);
  mesh.userData.batchKey = `${instances[0].reference.toLowerCase()}|faces|${inherited ? "inherited" : "fixed"}|${alpha}`;
  mesh.userData.inherited = inherited;
  installInstructionFocus(mesh);
  mesh.frustumCulled = false; // Per-ID bounds are maintained by the incremental index.
  root.add(mesh);
}

function compactLineMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { instructionFocusEnabled: { value: false } },
    vertexShader: FOCUS_VERTEX_HEADER + `
      ${FALLBACK_EDGE_VERTEX_HEADER}
      attribute vec4 instanceRow0;
      attribute vec4 instanceRow1;
      attribute vec4 instanceRow2;
      void main() {
        ${FOCUS_VERTEX}
        ${FALLBACK_EDGE_VERTEX}
        vec4 p = vec4(position, 1.0);
        vec3 v = vec3(dot(instanceRow0, p), dot(instanceRow1, p), dot(instanceRow2, p));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(v, 1.0);
        gl_Position.z -= 0.000002 * gl_Position.w;
      }`,
    fragmentShader: FOCUS_FRAGMENT_HEADER + `
      uniform bool instructionFocusEnabled;
      varying float vContrastInk;
      void main() {
        gl_FragColor = vec4(vec3(vContrastInk), 1.0);
        if (instructionFocusEnabled && vInstructionFocus > 0.5 && vInstructionFocus < 1.5) {
          gl_FragColor.a *= 0.12;
        }
        ${FOCUS_FRAGMENT}
        #include <colorspace_fragment>
      }`,
  });
}

/** One instanced line draw per part, never one Object3D per brick. */
function addEdges(root: Group, surfaces: Surface[], instances: ImportedInstance[], detail: ImportedSceneDetail): void {
  const mode = detail.edges;
  if (mode === "none") return;
  const geometry = new InstancedBufferGeometry();
  if (mode === "thin") {
    const positions = visibleEdgeLines(surfaces);
    if (!positions.length) return;
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
  } else if (mode === "legacy") {
    const positions = visibleEdgeLines(surfaces, true);
    if (!positions.length) return;
    const expanded = expandLegacyLines(positions, detail.legacyEdgeStride);
    for (const [name, attribute] of Object.entries(expanded.attributes)) geometry.setAttribute(name, attribute);
    expanded.dispose();
  } else {
    const source = visibleEdgeData(surfaces);
    if (!source.positions.length) return;
    const expanded = expandWideLines(source.positions, source.normals, source.alternateNormals);
    for (const [name, attribute] of Object.entries(expanded.attributes)) geometry.setAttribute(name, attribute);
    expanded.dispose();
    const edgeBaseColors = geometry.getAttribute("edgeBaseColor");
    const edgeUseInstanceColor = geometry.getAttribute("edgeUseInstanceColor");
    const color = new Color();
    source.colorCodes.forEach((code, segment) => {
      const inherited = code === "16";
      const base = color.set(inherited ? "#ffffff" : resolveColor(code)?.hex ?? "#ff00ff");
      for (let vertex = 0; vertex < 6; vertex++) {
        const index = segment * 6 + vertex;
        edgeBaseColors.setXYZ(index, base.r, base.g, base.b);
        edgeUseInstanceColor.setX(index, inherited ? 1 : 0);
      }
    });
  }
  if (mode === "thin" || mode === "legacy") {
    const codes = visibleEdgeColorCodes(surfaces, mode === "legacy");
    const stride = mode === "legacy" ? detail.legacyEdgeStride ?? 1 : 1;
    const verticesPerSegment = mode === "thin" ? 2 : 6;
    const ink = new Uint8Array(geometry.getAttribute("position").count);
    const color = new Color();
    for (let segment = 0, output = 0; segment < codes.length; segment += stride, output++) {
      const code = codes[segment];
      const value = code === "16" ? 2 : Number(needsWhiteEdges(color.set(resolveColor(code)?.hex ?? "#ff00ff")));
      ink.fill(value, output * verticesPerSegment, (output + 1) * verticesPerSegment);
    }
    geometry.setAttribute("edgeContrastOverride", new BufferAttribute(ink, 1));
  }
  const rows = [new Float32Array(instances.length * 4), new Float32Array(instances.length * 4), new Float32Array(instances.length * 4)];
  const bounds = new Box3(), transformed = new Box3();
  geometry.computeBoundingBox();
  const local = geometry.boundingBox!.clone();
  instances.forEach((instance, index) => {
    const matrix = worldMatrix(instance.matrix);
    const e = matrix.elements;
    for (let row = 0; row < 3; row++) rows[row].set([e[row], e[4 + row], e[8 + row], e[12 + row]], index * 4);
    bounds.union(transformed.copy(local).applyMatrix4(matrix));
  });
  rows.forEach((row, index) => geometry.setAttribute(`instanceRow${index}`, new InstancedBufferAttribute(row, 4)));
  {
    const edgeColors = new Uint8Array(instances.length * 3);
    const color = new Color();
    instances.forEach((instance, index) => {
      const encoded = color.set(resolveColor(instance.colorCode)?.hex ?? "#ff00ff").getHex(SRGBColorSpace);
      edgeColors.set([(encoded >> 16) & 0xff, (encoded >> 8) & 0xff, encoded & 0xff], index * 3);
    });
    geometry.setAttribute("instanceEdgeColor", new InstancedBufferAttribute(edgeColors, 3, true));
  }
  geometry.setAttribute(FOCUS_ATTRIBUTE, new InstancedBufferAttribute(new Float32Array(instances.length), 1));
  geometry.instanceCount = instances.length;
  geometry.boundingBox = bounds;
  geometry.computeBoundingSphere();
  const lines = mode === "thin" ? new LineSegments(geometry, compactLineMaterial())
    : new Mesh(geometry, mode === "legacy" ? legacyLineMaterial() : wideLineMaterial());
  // The shader's per-instance transform is not represented by Object3D.matrix.
  lines.frustumCulled = false;
  lines.name = "ldraw:instanced-edges";
  lines.userData.isWideEdgeMesh = mode !== "thin";
  lines.userData.legacyEdges = mode === "legacy";
  lines.userData.brickIds = instances.map(instance => instance.id);
  lines.userData.batchKey = `${instances[0].reference.toLowerCase()}|edges`;
  lines.userData.localBounds = local;
  if (mode !== "legacy") lines.renderOrder = 10;
  root.add(lines);
}

function instanceGroups(model: ImportedModel): Map<string, ImportedInstance[]> {
  const parts = new Map<string, ImportedInstance[]>();
  for (const instance of model.instances) {
    if (instance.part.status !== "resolved") continue;
    const key = instance.reference.toLowerCase();
    const batch = parts.get(key) ?? [];
    batch.push(instance); parts.set(key, batch);
  }
  return parts;
}

function addPartFaces(root: Group, surfaces: Surface[], instances: ImportedInstance[], compact: boolean): void {
  const inherited = surfaces.filter(surface => surface.colorCode === "16" && surface.positions.length);
  const variants = new Map<number, ImportedInstance[]>();
  for (const instance of instances) {
    const alpha = resolveColor(instance.colorCode)?.alpha ?? 255;
    const batch = variants.get(alpha) ?? [];
    batch.push(instance); variants.set(alpha, batch);
  }
  for (const [alpha, batch] of variants) addFaces(root, inherited, batch, alpha, true, compact);
  const fixed = new Map<number, Surface[]>();
  for (const surface of surfaces) {
    if (surface.colorCode === "16" || !surface.positions.length) continue;
    const alpha = resolveColor(surface.colorCode)?.alpha ?? 255;
    const batch = fixed.get(alpha) ?? [];
    batch.push(surface); fixed.set(alpha, batch);
  }
  for (const [alpha, batch] of fixed) addFaces(root, batch, instances, alpha, false, compact);
}

export function createImportedGroup(model: ImportedModel, detail = FULL_DETAIL): Group {
  const root = new Group();
  root.userData.importedSceneDetail = detail;
  try {
    for (const [reference, instances] of instanceGroups(model)) {
      const surfaces = compilePart(model, reference, "16");
      addPartFaces(root, surfaces, instances, detail.compactFaces);
      addEdges(root, surfaces, instances, detail);
    }
  }
  catch (error) { disposeImportedScene(root); throw error; }
  return root;
}

/** Prefer the historic edge layout; sample decorations only when it would exceed mobile budgets. */
function legacyEdgeStride(batches: { segments: number; instances: number }[], budget: number): number | undefined {
  let high = Math.max(1, ...batches.map(batch => batch.segments));
  let low = 1;
  const fits = (stride: number) => {
    let bytes = 0, repeatedSegments = 0;
    for (const batch of batches) {
      const count = Math.ceil(batch.segments / stride);
      bytes += count * LEGACY_EDGE_BYTES_PER_SEGMENT + batch.instances * 55;
      repeatedSegments += count * batch.instances;
    }
    return bytes <= budget && repeatedSegments <= MAX_WIDE_EDGE_OCCURRENCES;
  };
  if (!fits(high)) return undefined;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) high = middle;
    else low = middle + 1;
  }
  return low;
}

export async function createImportedGroupAsync(model: ImportedModel, options: SceneBuildOptions = {}): Promise<Group> {
  const root = new Group();
  const budget = options.maxGeometryBytes ?? DEFAULT_GEOMETRY_BUDGET;
  const { signal, onProgress, viewport, instruction } = options;
  const parts = instanceGroups(model);
  let slice = performance.now();
  const yieldFrame = async () => {
    if (performance.now() - slice >= 6) {
      await yieldPdfExecution();
      slice = performance.now();
    }
    signal?.throwIfAborted();
  };
  try {
    let rawFaceBytes = 0, wideEdgeBytes = 0, thinEdgeBytes = 0, edgeOccurrences = 0;
    const legacyBatches: { segments: number; instances: number }[] = [];
    if (viewport || instruction) {
      for (const [reference, instances] of parts) {
        signal?.throwIfAborted();
        const surfaces = compilePart(model, reference, "16");
        for (const surface of surfaces) {
          rawFaceBytes += surface.positions.byteLength * (surface.colorCode === "16" ? 2 : 3);
        }
        if (viewport !== "legacy-faces") {
          const segments = visibleEdgeCount(surfaces, viewport === "legacy");
          if (segments > 0) {
            if (viewport === "legacy") legacyBatches.push({ segments, instances: instances.length });
            else {
              wideEdgeBytes += segments * WIDE_EDGE_BYTES_PER_SEGMENT + instances.length * 55;
              thinEdgeBytes += segments * 26 + instances.length * 55;
              edgeOccurrences += segments * instances.length;
            }
          }
        }
        await yieldFrame();
      }
    }
    const compactFaces = instruction === true || viewport === "legacy-faces" ||
      !!(viewport && rawFaceBytes > budget * (viewport === "legacy" ? 0.6 : 0.75));
    let done = 0;
    const total = parts.size * 2;
    for (const [reference, instances] of parts) {
      signal?.throwIfAborted();
      addPartFaces(root, compilePart(model, reference, "16"), instances, compactFaces);
      if (measureImportedScene(root).bufferBytes > budget) throw new SceneBudgetExceeded();
      onProgress?.(++done, total);
      await yieldFrame();
    }
    const edgeBudget = budget - measureImportedScene(root).bufferBytes;
    let detail: ImportedSceneDetail = { compactFaces, edges: "none" };
    if (viewport === "legacy") {
      const stride = legacyEdgeStride(legacyBatches, edgeBudget);
      if (stride !== undefined) detail = { compactFaces, edges: "legacy", legacyEdgeStride: stride };
    } else if (viewport !== "legacy-faces") {
      if ((!viewport && !instruction) || (wideEdgeBytes <= edgeBudget && edgeOccurrences <= MAX_WIDE_EDGE_OCCURRENCES)) detail.edges = "wide";
      else if (thinEdgeBytes <= edgeBudget) detail.edges = "thin";
    }
    // A PDF must not silently discard all seams to satisfy a viewport budget.
    if (instruction && thinEdgeBytes > 0 && detail.edges === "none") throw new SceneBudgetExceeded();
    root.userData.importedSceneDetail = detail;
    if (detail.edges !== "none") {
      for (const [reference, instances] of parts) {
        signal?.throwIfAborted();
        addEdges(root, compilePart(model, reference, "16"), instances, detail);
        if (measureImportedScene(root).bufferBytes > budget) throw new SceneBudgetExceeded();
        onProgress?.(++done, total);
        await yieldFrame();
      }
    }
    signal?.throwIfAborted();
    return root;
  } catch (error) { disposeImportedScene(root); throw error; }
}

/** Dispose instancing buffers as well as shared geometry/materials exactly once. */
export function disposeImportedScene(root: Group): void {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
  root.traverse(object => {
    if (object instanceof InstancedMesh) object.dispose();
    if (object instanceof Mesh || object instanceof LineSegments) {
      geometries.add(object.geometry);
      for (const value of Array.isArray(object.material) ? object.material : [object.material]) materials.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(value => value.dispose());
  root.clear();
}
