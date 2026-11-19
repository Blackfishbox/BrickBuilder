import { Box3, Vector3 } from "three";
import { BRICK_DEFINITIONS, BRICK_HEIGHT, type Brick } from "../editor/model";
import { brickTransformMatrix } from "../editor/brick-transform";

// World-space tolerance: shared faces, edges and corners are not penetrations.
const CONTACT_EPSILON = 1e-7;
const CELL_SIZE = 4;

export interface BrickVolume {
  center: Vector3;
  axes: [Vector3, Vector3, Vector3];
  halfSize: [number, number, number];
  bounds: Box3;
}

/** Solid construction envelope, using the same bottom-origin transform as the editor. */
export function brickVolume(brick: Brick): BrickVolume {
  const { studsX, studsZ } = BRICK_DEFINITIONS[brick.type];
  const matrix = brickTransformMatrix(brick);
  const axes: BrickVolume["axes"] = [
    new Vector3().setFromMatrixColumn(matrix, 0),
    new Vector3().setFromMatrixColumn(matrix, 1),
    new Vector3().setFromMatrixColumn(matrix, 2),
  ];
  const halfSize: BrickVolume["halfSize"] = [studsX / 2, BRICK_HEIGHT / 2, studsZ / 2];
  const center = new Vector3(0, BRICK_HEIGHT / 2, 0).applyMatrix4(matrix);
  const extent = new Vector3();
  for (let i = 0; i < 3; i++) {
    extent.x += Math.abs(axes[i].x) * halfSize[i];
    extent.y += Math.abs(axes[i].y) * halfSize[i];
    extent.z += Math.abs(axes[i].z) * halfSize[i];
  }
  return {
    center, axes, halfSize,
    bounds: new Box3(center.clone().sub(extent), center.clone().add(extent)),
  };
}

/** Strict OBB intersection: all 15 separating axes, not just face normals. */
export function brickVolumesOverlap(a: BrickVolume, b: BrickVolume): boolean {
  for (const axis of ["x", "y", "z"] as const) {
    if (a.bounds.max[axis] <= b.bounds.min[axis] + CONTACT_EPSILON ||
        b.bounds.max[axis] <= a.bounds.min[axis] + CONTACT_EPSILON) return false;
  }
  const delta = b.center.clone().sub(a.center);
  const separated = (axis: Vector3) => {
    let radius = 0;
    for (let i = 0; i < 3; i++) {
      radius += a.halfSize[i] * Math.abs(a.axes[i].dot(axis)) +
        b.halfSize[i] * Math.abs(b.axes[i].dot(axis));
    }
    return Math.abs(delta.dot(axis)) >= radius - CONTACT_EPSILON;
  };
  for (const axis of a.axes) if (separated(axis)) return false;
  for (const axis of b.axes) if (separated(axis)) return false;
  const cross = new Vector3();
  for (const axisA of a.axes) {
    for (const axisB of b.axes) {
      cross.crossVectors(axisA, axisB);
      // Parallel axes supply no separating direction. Normalize all others so
      // the contact tolerance stays in world units even for almost parallel parts.
      if (cross.lengthSq() > 1e-20 && separated(cross.normalize())) return false;
    }
  }
  return true;
}

/**
 * Bounded-size bricks touch only a handful of coarse cells. Store every occupant
 * and test each candidate pair once, without retaining a quadratic pair set.
 * This runs in the analysis worker, never in the pointer/drag render path.
 */
export function countBrickOverlaps(volumes: readonly BrickVolume[]): number {
  const cells = new Map<string, number[]>();
  let count = 0;
  volumes.forEach((volume, index) => {
    const { min, max } = volume.bounds;
    const seen = new Set<number>();
    for (let x = Math.floor(min.x / CELL_SIZE); x <= Math.floor(max.x / CELL_SIZE); x++) {
      for (let y = Math.floor(min.y / CELL_SIZE); y <= Math.floor(max.y / CELL_SIZE); y++) {
        for (let z = Math.floor(min.z / CELL_SIZE); z <= Math.floor(max.z / CELL_SIZE); z++) {
          const key = `${x}:${y}:${z}`;
          const occupants = cells.get(key);
          if (!occupants) {
            cells.set(key, [index]);
            continue;
          }
          for (const other of occupants) {
            if (seen.has(other)) continue;
            seen.add(other);
            if (brickVolumesOverlap(volume, volumes[other])) count++;
          }
          occupants.push(index);
        }
      }
    }
  });
  return count;
}
