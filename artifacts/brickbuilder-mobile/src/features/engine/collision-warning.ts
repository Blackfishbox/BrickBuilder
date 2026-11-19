import { BRICK_DEFINITIONS, BRICK_HEIGHT, type Brick } from "../editor/model";
import type { ImportedModel } from "../formats/types";
import { Box3, Euler, Matrix3, Matrix4, Vector3 } from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";
import { importedWarningQuery } from "./imported-collision";
import { stackingBounds } from "./stacking";
import { activeConnections } from "../connections/engine";
import { candidates } from "@workspace/ldraw-source";
import { referenceLine } from "../formats/ldraw/parser";

export interface CollisionWarnings {
  boxes: Map<string, Box3>;
  uncertain: boolean;
}

function warningVolume(brick: Brick) {
  const { studsX, studsZ } = BRICK_DEFINITIONS[brick.type];
  const { tiltX = 0, tiltZ = 0 } = brick as Brick & { tiltX?: number; tiltZ?: number };
  const rotation = new Matrix4().makeRotationFromEuler(new Euler(
    tiltX * Math.PI / 180, brick.rotation * Math.PI / 180, tiltZ * Math.PI / 180, "XYZ",
  ));
  const matrix = rotation.clone().setPosition(brick.x, brick.y, brick.z);
  const half = new Vector3(studsX / 2, BRICK_HEIGHT / 2, studsZ / 2);
  return {
    bounds: new Box3(half.clone().negate(), half.clone()).translate(new Vector3(0, BRICK_HEIGHT / 2, 0)).applyMatrix4(matrix),
    // Shrink only by contact tolerance, so rotated face contact is not penetration.
    solid: new OBB(new Vector3(0, BRICK_HEIGHT / 2, 0).applyMatrix4(matrix),
      half.clone().addScalar(-0.00001), new Matrix3().setFromMatrix4(rotation)),
  };
}

/** Broad-phase sweep with yielding and cancellation between narrow-phase queries.
 * Bounds only select candidate pairs. Only positive geometric evidence can
 * produce a warning; unknown geometry is deliberately left unmarked.
 */
export async function collisionWarnings(
  bricks: Brick[], model: ImportedModel | undefined, signal: AbortSignal, importedOffset?: number,
): Promise<CollisionWarnings> {
  const importedBoxes = model ? stackingBounds(model) : new Map<string, Box3>();
  const total = new Box3();
  for (const box of importedBoxes.values()) total.union(box);
  const offset = model ? importedOffset ?? (total.isEmpty() ? 0 : Math.max(0, -total.min.y)) : 0;
  const volumes = new Map(bricks.map(brick => [brick.id, warningVolume(brick)]));
  // The overlay adds the imported display offset to all diagnostic boxes.
  // Express local bricks in the same source space, including in mixed builds.
  for (const volume of volumes.values()) {
    volume.bounds.translate(new Vector3(0, -offset, 0));
    volume.solid.center.y -= offset;
  }
  const entries = [...new Map([...importedBoxes, ...[...volumes].map(([id, volume]) => [id, volume.bounds] as const)])]
    .filter(([, box]) => !box.isEmpty()).sort((a, b) => a[1].min.x - b[1].min.x);
  const instances = new Map(model?.instances.map(instance => [instance.id, instance]));
  const query = model ? importedWarningQuery(model) : null;
  const connectedTargets = new Map<string, Set<string>>();
  const boxes = new Map<string, Box3>();
  let uncertain = false, sliceStart = performance.now(), work = 0;
  const checkpoint = async () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (++work % 32 === 0 || performance.now() - sliceStart > 8) {
      await new Promise(resolve => setTimeout(resolve, 0));
      sliceStart = performance.now();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    }
  };
  for (let i = 0; i < entries.length; i++) {
    await checkpoint();
    const [id, box] = entries[i];
    for (let j = i + 1; j < entries.length && entries[j][1].min.x < box.max.x - 0.0001; j++) {
      await checkpoint();
      const [otherId, other] = entries[j];
      if (box.min.y >= other.max.y - 0.0001 || other.min.y >= box.max.y - 0.0001 ||
          box.min.z >= other.max.z - 0.0001 || other.min.z >= box.max.z - 0.0001) continue;
      let overlap: boolean;
      const a = instances.get(id), b = instances.get(otherId);
      if (a && b && query) {
        if (model) {
          let connected = connectedTargets.get(id);
          if (!connected) {
            connected = new Set(activeConnections(model, id).map(contact => contact.targetId));
            connectedTargets.set(id, connected);
          }
          // The connector engine also checks the insertion slab for obstructions.
          // Do not flag ordinary stud engagement merely because its open mesh
          // cannot provide a watertight solid proof.
          if (connected.has(otherId)) continue;
        }
        const result = query(a.reference, a.matrix, b.reference, b.matrix);
        overlap = result === "overlap";
        if (result === "unknown") uncertain = true;
      } else if (volumes.has(id) && volumes.has(otherId)) {
        overlap = volumes.get(id)!.solid.intersectsOBB(volumes.get(otherId)!.solid);
      } else {
        overlap = false;
        uncertain = true;
      }
      if (overlap) { boxes.set(id, box); boxes.set(otherId, other); }
    }
  }
  return { boxes, uncertain };
}

interface WorkerCollisionResult {
  boxes: [string, [number, number, number], [number, number, number]][];
  uncertain: boolean;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/** Keep only the geometry dependencies the checker needs before transferring
 * the model. This avoids cloning unrelated archive data and library resources.
 */
async function collisionModelSnapshot(model: ImportedModel, signal: AbortSignal): Promise<ImportedModel> {
  const resources: ImportedModel["resources"] = {};
  const pending: string[] = [];
  const instances: ImportedModel["instances"] = [];
  let work = 0, sliceStart = performance.now();
  const checkpoint = async () => {
    if (signal.aborted) throw abortError();
    if (++work % 128 === 0 || performance.now() - sliceStart > 8) {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (signal.aborted) throw abortError();
      sliceStart = performance.now();
    }
  };
  for (const instance of model.instances) {
    instances.push({
      id: instance.id,
      reference: instance.reference,
      colorCode: instance.colorCode,
      matrix: [...instance.matrix] as typeof instance.matrix,
      sourcePath: [],
      part: { ldrawId: instance.part.ldrawId, status: instance.part.status },
    });
    if (instance.part.status === "resolved") pending.push(instance.reference);
    await checkpoint();
  }
  while (pending.length) {
    await checkpoint();
    const reference = pending.pop()!;
    let path: string | undefined;
    try { path = candidates(reference).find(candidate => Object.hasOwn(model.resources, candidate)); }
    catch { continue; }
    if (!path || Object.hasOwn(resources, path)) continue;
    const source = model.resources[path];
    // Geometry compilation and connector descriptions only read `content`.
    resources[path] = { content: source.content } as ImportedModel["resources"][string];
    let start = 0;
    while (start < source.content.length) {
      const newline = source.content.indexOf("\n", start);
      const end = newline < 0 ? source.content.length : newline;
      const line = source.content.slice(start, end);
      start = end + 1;
      if (/^\s*1\s/.test(line)) {
        try { pending.push(referenceLine(line).reference); } catch { /* Invalid lines are handled as unknown by the worker. */ }
      }
      await checkpoint();
    }
  }
  return {
    version: 1,
    format: model.format,
    sourceName: model.sourceName,
    originalBytes: [],
    sourceText: "",
    root: model.root,
    sections: {},
    instances,
    issues: [],
    resources,
    legalDocuments: [],
  };
}

/** Run the optional diagnostic off the UI thread. Terminating the dedicated
 * worker makes cancellation immediate, even during a synchronous geometry
 * compilation, connection-index build, or narrow-phase query.
 */
export async function collisionWarningsInWorker(
  bricks: Brick[], model: ImportedModel | undefined, signal: AbortSignal, importedOffset?: number,
): Promise<CollisionWarnings> {
  if (signal.aborted) throw abortError();
  // Non-browser test and server environments have no Worker implementation.
  if (typeof Worker === "undefined") return collisionWarnings(bricks, model, signal, importedOffset);
  const snapshot = model ? await collisionModelSnapshot(model, signal) : undefined;
  if (signal.aborted) throw abortError();

  const worker = new Worker(new URL("./collision-warning.worker.ts", import.meta.url), { type: "module" });
  return new Promise<CollisionWarnings>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    signal.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerCollisionResult | { error: { name: string; message: string } }>) => {
      const result = event.data;
      if ("error" in result) {
        finish(() => reject(Object.assign(new Error(result.error.message), { name: result.error.name })));
        return;
      }
      finish(() => resolve({
        boxes: new Map(result.boxes.map(([id, min, max]) => [id, new Box3(new Vector3(...min), new Vector3(...max))])),
        uncertain: result.uncertain,
      }));
    };
    worker.onerror = event => finish(() => reject(new Error(event.message || "Collision worker failed")));
    worker.onmessageerror = () => finish(() => reject(new Error("Collision worker response could not be read")));
    worker.postMessage({ bricks, model: snapshot, importedOffset });
  });
}
