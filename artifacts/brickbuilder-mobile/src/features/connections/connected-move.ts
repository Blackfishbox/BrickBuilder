import { Vector3 } from "three";
import type { Brick } from "../editor/model";
import { brickConstructionBounds } from "../engine/construction-floor";
import { stackingBounds } from "../engine/stacking";
import type { ImportedModel } from "../formats/types";
import { activeConnections } from "./engine";

const CONTACT_EPSILON = 0.025;
const NATIVE_CELL_SIZE = 1;

function heightKey(value: number): number {
  return Math.round(value / CONTACT_EPSILON);
}

function addNativePartToIndex(
  index: Map<string, Set<string>>,
  brick: Brick,
): void {
  const bounds = brickConstructionBounds(brick);
  const layer = heightKey(bounds.min.y);
  const minX = Math.floor(bounds.min.x / NATIVE_CELL_SIZE);
  const maxX = Math.floor((bounds.max.x - 1e-6) / NATIVE_CELL_SIZE);
  const minZ = Math.floor(bounds.min.z / NATIVE_CELL_SIZE);
  const maxZ = Math.floor((bounds.max.z - 1e-6) / NATIVE_CELL_SIZE);
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    const key = `${layer}:${x}:${z}`;
    const parts = index.get(key) ?? new Set<string>();
    parts.add(brick.id);
    index.set(key, parts);
  }
}

function nativePartsAbove(
  brick: Brick,
  bricksById: Map<string, Brick>,
  index: Map<string, Set<string>>,
): string[] {
  const bounds = brickConstructionBounds(brick);
  const layer = heightKey(bounds.max.y);
  const minX = Math.floor(bounds.min.x / NATIVE_CELL_SIZE);
  const maxX = Math.floor((bounds.max.x - 1e-6) / NATIVE_CELL_SIZE);
  const minZ = Math.floor(bounds.min.z / NATIVE_CELL_SIZE);
  const maxZ = Math.floor((bounds.max.z - 1e-6) / NATIVE_CELL_SIZE);
  const centerY = bounds.getCenter(new Vector3()).y;
  const candidates = new Set<string>();
  for (let nearbyLayer = layer - 1; nearbyLayer <= layer + 1; nearbyLayer++) {
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      for (const id of index.get(`${nearbyLayer}:${x}:${z}`) ?? []) candidates.add(id);
    }
  }
  return [...candidates].filter(id => {
    if (id === brick.id) return false;
    const above = bricksById.get(id);
    if (!above) return false;
    const aboveBounds = brickConstructionBounds(above);
    if (Math.abs(aboveBounds.min.y - bounds.max.y) > CONTACT_EPSILON) return false;
    if (aboveBounds.getCenter(new Vector3()).y <= centerY + CONTACT_EPSILON) return false;
    const overlapX = Math.min(bounds.max.x, aboveBounds.max.x) - Math.max(bounds.min.x, aboveBounds.min.x);
    const overlapZ = Math.min(bounds.max.z, aboveBounds.max.z) - Math.max(bounds.min.z, aboveBounds.min.z);
    return overlapX > CONTACT_EPSILON && overlapZ > CONTACT_EPSILON;
  });
}

/**
 * Returns the roots plus every physically connected part above them.
 * Imported models use verified connector contacts; the simple built-in brick
 * types use touching, overlapping top/bottom surfaces.
 */
export function connectedPartsAbove(
  imported: ImportedModel | undefined,
  bricks: readonly Brick[],
  roots: Iterable<string>,
): Set<string> {
  const result = new Set(roots);
  const queue = [...result];
  const importedInstances = new Map((imported?.instances ?? []).map(instance => [instance.id, instance]));
  const importedBounds = imported ? stackingBounds(imported) : new Map();
  const bricksById = new Map(bricks.map(brick => [brick.id, brick]));
  const nativeIndex = new Map<string, Set<string>>();
  for (const brick of bricks) addNativePartToIndex(nativeIndex, brick);

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    const sourceBounds = importedBounds.get(id);
    if (sourceBounds && imported) {
      const sourceCenterY = sourceBounds.getCenter(new Vector3()).y / 20;
      for (const contact of activeConnections(imported, id)) {
        const targetBounds = importedBounds.get(contact.targetId);
        if (!targetBounds || targetBounds.getCenter(new Vector3()).y <= sourceBounds.getCenter(new Vector3()).y + CONTACT_EPSILON) continue;
        // Contact positions use UI units (studs, positive upward). A contact
        // above the source center identifies an upward attachment rather than
        // the lower support that should remain in place.
        if (contact.position[1] <= sourceCenterY + CONTACT_EPSILON) continue;
        if (!result.has(contact.targetId)) {
          result.add(contact.targetId);
          queue.push(contact.targetId);
        }
      }
    }

    const brick = bricksById.get(id);
    if (brick) {
      for (const aboveId of nativePartsAbove(brick, bricksById, nativeIndex)) {
        if (!result.has(aboveId)) {
          result.add(aboveId);
          queue.push(aboveId);
        }
      }
    }
  }
  return result;
}
