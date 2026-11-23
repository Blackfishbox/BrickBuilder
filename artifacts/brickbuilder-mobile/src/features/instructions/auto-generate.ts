import { Vector3 } from "three";
import { brickConstructionBounds } from "../engine/construction-floor";
import { activeConnections } from "../connections/engine";
import { describeConnections, transformConnector } from "../connections/description";
import type { BuilderDocument, Brick } from "../editor/model";
import type { InstructionStep } from "./types";

const MAX_PARTS_PER_STEP = 8;
const LAYER_EPSILON = 0.025;
const IMPORT_SUPPORT_HEIGHT_EPSILON = 0.08;
const NATIVE_CELL = 0.5;

interface Node {
  id: string;
  y: number;
  x: number;
  z: number;
  order: number;
}

export interface AutoInstructionProgress {
  completed: number;
  total: number;
}

export interface AutoInstructionResult {
  steps: InstructionStep[];
  unconnectedPartIds: string[];
  missingGeometryPartIds: string[];
  fallbackPartIds: string[];
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function addEdge(
  a: string,
  b: string,
  nodes: Map<string, Node>,
  neighbours: Map<string, Set<string>>,
  supports: Map<string, Set<string>>,
  provenSupport?: [string, string],
) {
  if (a === b || !nodes.has(a) || !nodes.has(b)) return;
  neighbours.get(a)!.add(b);
  neighbours.get(b)!.add(a);
  if (provenSupport) {
    supports.get(provenSupport[1])!.add(provenSupport[0]);
  }
}

function nativeSupportPairs(bricks: readonly Brick[]): [string, string][] {
  const topByCell = new Map<string, string[]>();
  const boundsById = new Map(bricks.map(brick => [brick.id, brickConstructionBounds(brick)]));
  const cellsById = new Map<string, { xs: number[]; zs: number[] }>();
  const supported: [string, string][] = [];
  const layerKey = (value: number) => Math.round(value / LAYER_EPSILON);
  const cells = (min: number, max: number) => {
    const first = Math.floor(min / NATIVE_CELL);
    const last = Math.floor((max - 1e-6) / NATIVE_CELL);
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
  };

  for (const brick of bricks) {
    const bounds = boundsById.get(brick.id)!;
    const upright = Math.abs(brick.tiltX ?? 0) < 0.001 && Math.abs(brick.tiltZ ?? 0) < 0.001 &&
      Math.abs(brick.rotation / 90 - Math.round(brick.rotation / 90)) < 0.001;
    if (!upright) continue;
    const xs = cells(bounds.min.x, bounds.max.x), zs = cells(bounds.min.z, bounds.max.z);
    cellsById.set(brick.id, { xs, zs });
    const topLayer = layerKey(bounds.max.y);
    for (const x of xs) for (const z of zs) {
      const key = `${topLayer}:${x}:${z}`;
      const ids = topByCell.get(key) ?? [];
      ids.push(brick.id);
      topByCell.set(key, ids);
    }
  }
  for (const brick of bricks) {
    const cells = cellsById.get(brick.id);
    if (!cells) continue;
    const layer = layerKey(boundsById.get(brick.id)!.min.y);
    const candidates = new Set<string>();
    for (const x of cells.xs) for (const z of cells.zs) {
      for (const id of topByCell.get(`${layer}:${x}:${z}`) ?? []) candidates.add(id);
    }
    for (const lowerId of candidates) supported.push([lowerId, brick.id]);
  }
  return supported;
}

function orderedComponents(nodes: Map<string, Node>, neighbours: Map<string, Set<string>>): Node[][] {
  const remaining = new Set(nodes.keys());
  const components: Node[][] = [];
  const compare = (a: Node, b: Node) => a.y - b.y || a.z - b.z || a.x - b.x || a.order - b.order;
  for (const first of [...nodes.values()].sort(compare)) {
    if (!remaining.delete(first.id)) continue;
    const component: Node[] = [], queue = [first.id];
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      component.push(nodes.get(id)!);
      for (const neighbour of neighbours.get(id) ?? []) {
        if (!remaining.delete(neighbour)) continue;
        queue.push(neighbour);
      }
    }
    components.push(component.sort(compare));
  }
  return components.sort((a, b) => {
    const firstA = a[0], firstB = b[0];
    return firstA.y - firstB.y || firstA.z - firstB.z || firstA.x - firstB.x || firstA.order - firstB.order;
  });
}

/** Derive a conservative build order from confirmed contacts and upright native-brick support. */
export async function generateAutomaticInstructionSteps(
  document: BuilderDocument,
  signal?: AbortSignal,
  onProgress?: (progress: AutoInstructionProgress) => void,
): Promise<AutoInstructionResult> {
  const allParts = [...document.bricks, ...(document.imported?.instances ?? [])];
  if (!allParts.length) return {
    steps: [], unconnectedPartIds: [], missingGeometryPartIds: [], fallbackPartIds: [],
  };

  const nodes = new Map<string, Node>();
  const neighbours = new Map<string, Set<string>>();
  const supports = new Map<string, Set<string>>();
  const connectorUpAxes = new Map<string, Map<string, number>>();
  const missingGeometryPartIds: string[] = [];
  const imported = document.imported;

  document.bricks.forEach((brick, index) => {
    const box = brickConstructionBounds(brick);
    const center = box.getCenter(new Vector3());
    nodes.set(brick.id, { id: brick.id, y: center.y, x: center.x, z: center.z, order: index });
    neighbours.set(brick.id, new Set());
    supports.set(brick.id, new Set());
  });
  const importedInstances = imported?.instances ?? [];
  importedInstances.forEach((instance, index) => {
    const x = instance.matrix[3] / 20, y = -instance.matrix[7] / 20, z = instance.matrix[11] / 20;
    nodes.set(instance.id, {
      id: instance.id,
      y, x, z,
      order: document.bricks.length + index,
    });
    neighbours.set(instance.id, new Set());
    supports.set(instance.id, new Set());
    if (instance.part.status !== "resolved") missingGeometryPartIds.push(instance.id);
  });

  for (const [lower, upper] of nativeSupportPairs(document.bricks)) {
    addEdge(lower, upper, nodes, neighbours, supports, [lower, upper]);
  }

  for (const [index, instance] of importedInstances.entries()) {
    checkAbort(signal);
    connectorUpAxes.set(instance.id, new Map(describeConnections(instance.reference, imported).connectors.flatMap(connector => {
      const transformed = transformConnector(connector, instance.matrix);
      return transformed ? [[transformed.id, transformed.frame[5]] as const] : [];
    })));
    for (const contact of activeConnections(imported!, instance.id)) {
      if (instance.id >= contact.targetId) continue;
      const movingY = connectorUpAxes.get(instance.id)?.get(contact.movingConnectorId) ?? 0;
      const targetY = connectorUpAxes.get(contact.targetId)?.get(contact.targetConnectorId) ?? contact.orientation[5];
      // Connector frames remain in source LDraw axes (positive Y points down).
      let support: [string, string] | undefined = movingY < -0.75
        ? [instance.id, contact.targetId]
        : targetY < -0.75 ? [contact.targetId, instance.id] : undefined;
      if (!support && Math.abs(movingY) > 0.75 && Math.abs(targetY) > 0.75) {
        const heightDifference = nodes.get(instance.id)!.y - nodes.get(contact.targetId)!.y;
        if (Math.abs(heightDifference) > IMPORT_SUPPORT_HEIGHT_EPSILON) {
          support = heightDifference < 0
            ? [instance.id, contact.targetId]
            : [contact.targetId, instance.id];
        }
      }
      addEdge(instance.id, contact.targetId, nodes, neighbours, supports, support);
    }
    if (index % 8 === 0 || index === importedInstances.length - 1) {
      onProgress?.({ completed: document.bricks.length + index + 1, total: allParts.length });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  const components = orderedComponents(nodes, neighbours);
  const steps: InstructionStep[] = [];
  const fallbackPartIds: string[] = [];
  for (const component of components) {
    const pending = new Set(component.map(part => part.id));
    const placed = new Set<string>();

    while (pending.size) {
      checkAbort(signal);
      const ready = [...pending].map(id => nodes.get(id)!)
        .filter(part => {
          const lowerParts = supports.get(part.id)!;
          if ([...lowerParts].some(id => pending.has(id))) return false;
          // Independent subassemblies can be started before their bridge or
          // mounting parts connect them to the main structure.
          if (!lowerParts.size) return true;
          return [...neighbours.get(part.id)!].some(id => placed.has(id));
        })
        .sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.order - b.order);

      // A malformed or cyclic connection graph should never omit a part. Keep
      // the export complete, but surface that this fallback could not be proven.
      const batch = ready.length ? ready.slice(0, MAX_PARTS_PER_STEP) : [nodes.get(
        [...pending].map(id => nodes.get(id)!).sort((a, b) => a.y - b.y || a.order - b.order)[0].id,
      )!];
      if (!ready.length) fallbackPartIds.push(batch[0].id);
      steps.push({
        id: `auto-step-${steps.length + 1}`,
        title: `Step ${steps.length + 1}`,
        notes: "",
        partIds: batch.map(part => part.id),
      });
      for (const part of batch) {
        pending.delete(part.id);
        placed.add(part.id);
      }
    }
  }

  const unconnectedPartIds = [...neighbours].filter(([, adjacent]) => adjacent.size === 0).map(([id]) => id);
  onProgress?.({ completed: allParts.length, total: allParts.length });
  return { steps, unconnectedPartIds, missingGeometryPartIds, fallbackPartIds };
}
