import { Box3, BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { BRICK_DEFINITIONS, BRICK_HEIGHT, type Brick } from "../editor/model";

export const MAX_STUD_GRID_LINES = 201;
export const CONSTRUCTION_FLOOR_MARGIN = 3;
const EMPTY_HALF_EXTENT = 17;

export interface ConstructionArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  gridStride: number;
}

export function brickConstructionBounds(brick: Brick): Box3 {
  const definition = BRICK_DEFINITIONS[brick.type];
  const angle = brick.rotation * Math.PI / 180;
  const bounds = new Box3();
  for (const [localX, localZ] of [
    [-definition.studsX / 2, -definition.studsZ / 2],
    [definition.studsX / 2, -definition.studsZ / 2],
    [definition.studsX / 2, definition.studsZ / 2],
    [-definition.studsX / 2, definition.studsZ / 2],
  ]) {
    bounds.expandByPoint(new Vector3(
      brick.x + localX * Math.cos(angle) + localZ * Math.sin(angle),
      brick.y,
      brick.z - localX * Math.sin(angle) + localZ * Math.cos(angle),
    ));
  }
  bounds.max.y += BRICK_HEIGHT;
  return bounds;
}

/** Keep the empty workspace familiar; grow populated workspaces in whole studs. */
export function constructionArea(bounds: Box3): ConstructionArea {
  let minX: number, maxX: number, minZ: number, maxZ: number;
  if (bounds.isEmpty()) {
    minX = -EMPTY_HALF_EXTENT;
    maxX = EMPTY_HALF_EXTENT;
    minZ = -EMPTY_HALF_EXTENT;
    maxZ = EMPTY_HALF_EXTENT;
  } else {
    minX = Math.floor(bounds.min.x - CONSTRUCTION_FLOOR_MARGIN);
    maxX = Math.ceil(bounds.max.x + CONSTRUCTION_FLOOR_MARGIN);
    minZ = Math.floor(bounds.min.z - CONSTRUCTION_FLOOR_MARGIN);
    maxZ = Math.ceil(bounds.max.z + CONSTRUCTION_FLOOR_MARGIN);
  }
  const width = maxX - minX;
  const depth = maxZ - minZ;
  return {
    minX, maxX, minZ, maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width, depth,
    gridStride: Math.max(1, Math.ceil(Math.max(width, depth) / (MAX_STUD_GRID_LINES - 1))),
  };
}

/** Stud-aligned grid lines, sampled at whole-stud intervals for bounded geometry. */
export function createStudGridGeometry(area: ConstructionArea): BufferGeometry {
  const positions: number[] = [];
  const firstX = Math.ceil(area.minX / area.gridStride) * area.gridStride;
  const lastX = Math.floor(area.maxX / area.gridStride) * area.gridStride;
  const firstZ = Math.ceil(area.minZ / area.gridStride) * area.gridStride;
  const lastZ = Math.floor(area.maxZ / area.gridStride) * area.gridStride;
  for (let x = firstX; x <= lastX; x += area.gridStride) {
    positions.push(x, 0, area.minZ, x, 0, area.maxZ);
  }
  for (let z = firstZ; z <= lastZ; z += area.gridStride) {
    positions.push(area.minX, 0, z, area.maxX, 0, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}
