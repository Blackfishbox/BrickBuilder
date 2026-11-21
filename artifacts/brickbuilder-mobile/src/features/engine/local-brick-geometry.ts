import { BoxGeometry, BufferGeometry, CylinderGeometry, EdgesGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BRICK_DEFINITIONS, BRICK_HEIGHT, type BrickType } from "../editor/model";

// Rendering dimensions only. Construction spacing and collision bounds still
// use BRICK_HEIGHT and the nominal stud footprint.
export function localBrickShape(type: BrickType) {
  const { studsX, studsZ } = BRICK_DEFINITIONS[type];
  const bodyHeight = BRICK_HEIGHT - 0.08;
  const studHeight = 0.16;
  return {
    width: studsX - 0.035,
    depth: studsZ - 0.035,
    bodyHeight,
    studHeight,
    studRadius: 0.27,
    studSegments: 16,
    studs: Array.from({ length: studsX * studsZ }, (_, index) => [
      Math.floor(index / studsZ) - (studsX - 1) / 2,
      bodyHeight + studHeight / 2,
      index % studsZ - (studsZ - 1) / 2,
    ] as const),
  };
}

/** Bottom-center origin; the caller owns and disposes the returned geometry. */
export function createLocalBrickGeometry(type: BrickType): BufferGeometry {
  const shape = localBrickShape(type);
  const pieces: BufferGeometry[] = [
    new BoxGeometry(shape.width, shape.bodyHeight, shape.depth)
      .translate(0, shape.bodyHeight / 2, 0),
    ...shape.studs.map(position =>
      new CylinderGeometry(shape.studRadius, shape.studRadius, shape.studHeight, shape.studSegments)
        .translate(...position)),
  ];
  try {
    const merged = mergeGeometries(pieces, false);
    if (!merged) throw new Error(`Could not build geometry for ${type}.`);
    merged.computeVertexNormals();
    return merged;
  } finally {
    for (const piece of pieces) piece.dispose();
  }
}

const triangleCache = new Map<BrickType, Float32Array>();
const edgeCache = new Map<BrickType, Float32Array>();

/** Read-only sharp edges for the compatibility renderer and GPU outline batches. */
export function localBrickEdges(type: BrickType): Float32Array {
  const cached = edgeCache.get(type);
  if (cached) return cached;
  const geometry = createLocalBrickGeometry(type);
  const edges = new EdgesGeometry(geometry, 0.65);
  try {
    const positions = new Float32Array(edges.getAttribute("position").array);
    edgeCache.set(type, positions);
    return positions;
  } finally {
    edges.dispose();
    geometry.dispose();
  }
}

/** Read-only local triangles for the interactive canvas fallback. */
export function localBrickTriangles(type: BrickType): Float32Array {
  const cached = triangleCache.get(type);
  if (cached) return cached;
  const geometry = createLocalBrickGeometry(type);
  const flat = geometry.toNonIndexed();
  try {
    const triangles = new Float32Array(flat.getAttribute("position").array);
    triangleCache.set(type, triangles);
    return triangles;
  } finally {
    flat.dispose();
    geometry.dispose();
  }
}
