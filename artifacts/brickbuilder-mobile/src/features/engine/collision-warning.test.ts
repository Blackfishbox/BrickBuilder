import { describe, expect, it, vi } from "vitest";
import { Box3, Euler, Matrix4, Vector3 } from "three";
import { BRICK_HEIGHT, type Brick } from "../editor/model";
import type { Affine } from "../formats/types";
import { engineFixture } from "./engine-fixtures";
import { collisionWarnings, collisionWarningsInWorker } from "./collision-warning";
import { connectionFixture, partLine } from "../connections/fixtures";
import { activeConnections, snapConnection } from "../connections/engine";
import { importedWarningQuery } from "./imported-collision";
import { worldMatrix } from "./ldraw-geometry";
import { stackingBounds } from "./stacking";

const brick: Brick = { id: "a", type: "brick-1x2", color: "#fff", x: 0, y: 0, z: 0, rotation: 0 };
function rotateAssemblyMatrix(matrix: Affine, rotation: Matrix4): Affine {
  const world = rotation.clone().multiply(worldMatrix(matrix)), e = world.elements;
  return [
    e[0] * 20, e[4] * 20, e[8] * 20, e[12] * 20,
    -e[1] * 20, -e[5] * 20, -e[9] * 20, -e[13] * 20,
    e[2] * 20, e[6] * 20, e[10] * 20, e[14] * 20,
  ] as Affine;
}

function boxModel(halfSize: [number, number, number], center = new Vector3(), rotation = new Matrix4()): ReturnType<typeof engineFixture> {
  const model = engineFixture(1, 1);
  const vertices = [
    [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
  ].map(([x, y, z]) => new Vector3(x * halfSize[0] * 20, y * halfSize[1] * 20, z * halfSize[2] * 20));
  const triangles = [
    [0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6],
    [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7],
    [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5],
  ];
  model.resources["parts/test.dat"].content = triangles.map(([a, b, c]) =>
    `3 16 ${vertices[a].x} ${vertices[a].y} ${vertices[a].z} ${vertices[b].x} ${vertices[b].y} ${vertices[b].z} ${vertices[c].x} ${vertices[c].y} ${vertices[c].z}`,
  ).join("\n");
  const instance = model.instances[0];
  instance.matrix = rotateAssemblyMatrix(instance.matrix, rotation);
  instance.matrix[3] = center.x * 20;
  instance.matrix[7] = -center.y * 20;
  instance.matrix[11] = center.z * 20;
  return model;
}

function tiltedBrickAt(center: Vector3, tiltZ: number, importedOffset: number): Brick & { tiltZ: number } {
  return {
    ...brick,
    x: center.x,
    y: center.y - BRICK_HEIGHT / 2 + importedOffset,
    z: center.z,
    tiltZ,
  };
}
describe("optional collision diagnostics", () => {
  it("marks both intersecting bricks, but not touching or separated bricks", async () => {
    const controller = new AbortController();
    const colliding = await collisionWarnings([brick, { ...brick, id: "b" }], undefined, controller.signal);
    expect([...colliding.boxes.keys()].sort()).toEqual(["a", "b"]);
    expect(colliding.uncertain).toBe(false);
    const clear = await collisionWarnings([brick, { ...brick, id: "b", x: 1 }], undefined, controller.signal);
    expect(clear.boxes.size).toBe(0);
  });
  it("does not turn overlapping bounds or coplanar open surfaces into warnings", async () => {
    const model = engineFixture(2, 1);
    model.instances[1].matrix = [...model.instances[0].matrix];
    const warnings = await collisionWarnings([], model, new AbortController().signal);
    expect(warnings.boxes.size).toBe(0);
    expect(warnings.uncertain).toBe(true);
  });
  it("does not warn about legitimate stud engagement on standard bricks", async () => {
    const model = connectionFixture([partLine("3001", 0, -24), partLine("3003", 0, -48)].join("\n"));
    expect(activeConnections(model, model.instances[1].id).length).toBeGreaterThan(0);
    const warnings = await collisionWarnings([], model, new AbortController().signal);
    expect(warnings.boxes.size).toBe(0);
  });
  it.each(["1 0 0 0 1 0 0 0 1", "0 0 1 0 1 0 -1 0 0"])(
    "keeps ordinary connected stacks and touching neighbours unmarked (%s)", async basis => {
      const model = connectionFixture([
        partLine("3001", 0, -24, 0, basis),
        partLine("3003", 0, -48, 0, basis),
        partLine("3003", 0, -72, 0, basis),
      ].join("\n"));
      expect(activeConnections(model, model.instances[2].id).length).toBeGreaterThan(0);
      expect((await collisionWarnings([], model, new AbortController().signal)).boxes.size).toBe(0);
      const neighbours = connectionFixture([partLine("3003", 0, -24), partLine("3003", 40, -24)].join("\n"));
      expect((await collisionWarnings([], neighbours, new AbortController().signal)).boxes.size).toBe(0);
    },
  );
  it("detects actual transverse intersections in open geometry, but not edge contact", async () => {
    const model = engineFixture(2, 1);
    model.resources["parts/test.dat"].content = "3 16 -20 0 -20 20 0 -20 0 0 20";
    model.instances[0].matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    model.instances[1].matrix = [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
    const crossing = await collisionWarnings([], model, new AbortController().signal);
    expect(crossing.boxes.size).toBe(2);
    expect(crossing.uncertain).toBe(false);
    const touching = {
      ...model, instances: model.instances.map((instance, index) => index === 0 ? instance : {
        ...instance, matrix: [0, -1, 0, 20, 1, 0, 0, 0, 0, 0, 1, 0] as typeof instance.matrix,
      }),
    };
    expect((await collisionWarnings([], touching, new AbortController().signal)).boxes.size).toBe(0);
  });
  it("detects intersecting standard bricks rather than accepting their overlapping bounds alone", async () => {
    const model = connectionFixture([partLine("3001", 0, -24), partLine("3003", 13, -35, 7)].join("\n"));
    const warnings = await collisionWarnings([], model, new AbortController().signal);
    expect(warnings.boxes.size).toBe(2);
  });
  it.each([
    ["pin", "3700", "2780", 160, 10, 0, { x: 0.03, y: -0.5, z: 0.5 }],
    ["axle", "32064", "3705", 160, 0, 0, { x: 0.02, y: -0.5, z: 0.02 }],
    ["clip", "4085a", "30374", 160, 0, 0, { x: 0.02, y: -0.2, z: -1.02 }],
    ["hinge", "h1", "h2", 160, 20, 0, { x: 0.02, y: -1, z: 0.02 }, "-1 0 0 0 -1 0 0 0 1"],
  ] as const)("does not warn for real licensed %s connections", async (_name, target, moving, x, y, z, position, basis = "1 0 0 0 1 0 0 0 1") => {
    const source = connectionFixture([partLine(target), partLine(moving, x, y, z, basis)].join("\n"));
    const id = source.instances[1].id;
    const snap = snapConnection(source, id, position);
    expect(snap).not.toBeNull();
    const model = { ...source, instances: source.instances.map(instance =>
      instance.id === id ? { ...instance, matrix: snap!.matrix } : instance) };
    const tilt = new Matrix4().makeRotationFromEuler(new Euler(0.31, 0, -0.24));
    const tilted = { ...model, instances: model.instances.map(instance => ({
      ...instance, matrix: rotateAssemblyMatrix(instance.matrix, tilt),
    })) };
    for (const candidate of [model, tilted]) {
      expect(activeConnections(candidate, id).length).toBeGreaterThan(0);
      const [targetInstance, movingInstance] = candidate.instances;
      expect(importedWarningQuery(candidate)(targetInstance.reference, targetInstance.matrix,
        movingInstance.reference, movingInstance.matrix)).toBe("unknown");
      const warnings = await collisionWarnings([], candidate, new AbortController().signal);
      expect(warnings.boxes.size).toBe(0);
    }
  });
  it.each([
    ["pin", "3700", "2780"],
    ["axle", "32064", "3705"],
    ["clip", "4085a", "30374"],
  ] as const)("reports proven penetration in coincident licensed %s parts", async (_name, target, moving) => {
    const model = connectionFixture([partLine(target), partLine(moving)].join("\n"));
    const [a, b] = model.instances;
    const result = importedWarningQuery(model)(a.reference, a.matrix, b.reference, b.matrix);
    expect(result).toBe("overlap");
    const warnings = await collisionWarnings([], model, new AbortController().signal);
    expect([...warnings.boxes.keys()].sort()).toEqual([a.id, b.id].sort());
  });
  it("still warns when a connected real pin pair has additional proven penetration", async () => {
    const source = connectionFixture([partLine("3700"), partLine("2780", 160, 10)].join("\n"));
    const original = source.instances[1], snap = snapConnection(source, original.id, { x: 0.03, y: -0.5, z: 0.5 });
    expect(snap).not.toBeNull();
    let found: { model: typeof source; target: typeof source.instances[number]; moving: typeof original } | undefined;
    for (const axis of [3, 7, 11]) for (const delta of [-20, -12, -8, -4, -2, 2, 4, 8, 12, 20]) {
      const matrix = [...snap!.matrix] as typeof original.matrix;
      matrix[axis] += delta;
      const model = { ...source, instances: source.instances.map((instance, index) =>
        index === 1 ? { ...instance, matrix } : instance) };
      const target = model.instances[0], moving = model.instances[1];
      if (!activeConnections(model, moving.id).some(contact => contact.targetId === target.id)) continue;
      if (importedWarningQuery(model)(target.reference, target.matrix, moving.reference, moving.matrix) === "overlap") {
        found = { model, target, moving };
        break;
      }
    }
    expect(found).toBeDefined();
    const warnings = await collisionWarnings([], found!.model, new AbortController().signal);
    expect([...warnings.boxes.keys()].sort()).toEqual([found!.target.id, found!.moving.id].sort());
  });
  it("warns when a real imported brick penetrates a local brick", async () => {
    const model = connectionFixture([partLine("3001", 0, -12)].join("\n"));
    const importedId = model.instances[0].id;
    const local = { ...brick, type: "brick-2x4" as const };
    const warnings = await collisionWarnings([local], model, new AbortController().signal, 0);
    expect([...warnings.boxes.keys()].sort()).toEqual([local.id, importedId].sort());
    expect(warnings.uncertain).toBe(false);
  });
  it("uses the imported display offset for mixed collision checks", async () => {
    const model = connectionFixture([partLine("3001", 0, -12)].join("\n"));
    const importedId = model.instances[0].id;
    const shiftedBrick = { ...brick, type: "brick-2x4" as const, y: 2 };
    const shifted = await collisionWarnings([shiftedBrick], model, new AbortController().signal, 2);
    expect([...shifted.boxes.keys()].sort()).toEqual([shiftedBrick.id, importedId].sort());
    expect(shifted.boxes.get(shiftedBrick.id)?.min.y).toBeCloseTo(0);

    const unshifted = await collisionWarnings([brick], model, new AbortController().signal, 2);
    expect(unshifted.boxes.size).toBe(0);
  });
  it("warns when a tilted local brick penetrates imported geometry with a display offset", async () => {
    const model = boxModel([1, 2, 4], new Vector3(0, 0.6, 0));
    const importedId = model.instances[0].id;
    const local = tiltedBrickAt(new Vector3(0, 0.6, 0), 30, 2);
    const warnings = await collisionWarnings([local], model, new AbortController().signal, 2);
    expect([...warnings.boxes.keys()].sort()).toEqual([local.id, importedId].sort());
    expect(warnings.uncertain).toBe(false);
  });
  it("does not warn when tilted imported and local faces only touch", async () => {
    const tiltZ = 30, angle = tiltZ * Math.PI / 180;
    const model = boxModel(
      [1, BRICK_HEIGHT / 2, 2],
      new Vector3(0, BRICK_HEIGHT / 2, 0),
      new Matrix4().makeRotationFromEuler(new Euler(0, 0, angle)),
    );
    const localCenter = new Vector3(2 * Math.cos(angle), BRICK_HEIGHT / 2 + 2 * Math.sin(angle), 0);
    const local = tiltedBrickAt(localCenter, tiltZ, 2);
    const localBounds = new Box3(
      new Vector3(localCenter.x - Math.cos(angle) - Math.sin(angle) * BRICK_HEIGHT / 2,
        localCenter.y - Math.sin(angle) - Math.cos(angle) * BRICK_HEIGHT / 2, -2),
      new Vector3(localCenter.x + Math.cos(angle) + Math.sin(angle) * BRICK_HEIGHT / 2,
        localCenter.y + Math.sin(angle) + Math.cos(angle) * BRICK_HEIGHT / 2, 2),
    );
    expect(stackingBounds(model).get(model.instances[0].id)?.intersectsBox(localBounds)).toBe(true);
    const warnings = await collisionWarnings([local], model, new AbortController().signal, 2);
    expect(warnings.boxes.size).toBe(0);
    expect(warnings.uncertain).toBe(false);
  });
  it("does not warn when tilted local bounds overlap but the solids are separate", async () => {
    const importedCenter = new Vector3(-1.05, -0.3, 0);
    const model = boxModel([0.05, 0.05, 0.1], importedCenter);
    const local = tiltedBrickAt(new Vector3(0, BRICK_HEIGHT / 2, 0), 30, 2);
    const angle = Math.PI / 6;
    const localBounds = new Box3(
      new Vector3(-Math.cos(angle) - Math.sin(angle) * BRICK_HEIGHT / 2,
        BRICK_HEIGHT / 2 - Math.sin(angle) - Math.cos(angle) * BRICK_HEIGHT / 2, -2),
      new Vector3(Math.cos(angle) + Math.sin(angle) * BRICK_HEIGHT / 2,
        BRICK_HEIGHT / 2 + Math.sin(angle) + Math.cos(angle) * BRICK_HEIGHT / 2, 2),
    );
    expect(stackingBounds(model).get(model.instances[0].id)?.intersectsBox(localBounds)).toBe(true);
    const warnings = await collisionWarnings([local], model, new AbortController().signal, 2);
    expect(warnings.boxes.size).toBe(0);
    expect(warnings.uncertain).toBe(false);
  });
  it("does not warn from overlapping bounds when imported geometry is uncertain", async () => {
    const model = engineFixture(1, 1);
    model.resources["parts/test.dat"].content = "3 16 0 0 0 4 0 0 0 4 0";
    model.instances[0].matrix[7] = -12;
    const warnings = await collisionWarnings([brick], model, new AbortController().signal, 0);
    expect(warnings.boxes.size).toBe(0);
    expect(warnings.uncertain).toBe(true);
  });
  it("aborts obsolete calculations instead of applying their results", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collisionWarnings([brick], undefined, controller.signal)).rejects.toHaveProperty("name", "AbortError");
  });
  it("reports regular, increasing progress while checking candidate pairs", async () => {
    for (const bricks of [
      Array.from({ length: 24 }, (_, index) => ({ ...brick, id: `dense-${index}` })),
      Array.from({ length: 96 }, (_, index) => ({ ...brick, id: `sparse-${index}`, x: index * 20 })),
    ]) {
      const progress: { phase: string; percent: number }[] = [];
      await collisionWarnings(bricks, undefined, new AbortController().signal, undefined, value => progress.push(value));
      const checking = progress.filter(value => value.phase === "checking").map(value => value.percent);
      expect(checking.length).toBeGreaterThan(2);
      expect(checking.at(-1)).toBe(100);
      expect(checking.slice(1).every((value, index) => value >= checking[index])).toBe(true);
    }
  });
  it("terminates a running worker as soon as its model becomes obsolete", async () => {
    let instance: { terminated: boolean } | undefined;
    class WorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      constructor() { instance = this; }
      postMessage() {}
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal("Worker", WorkerStub);
    const controller = new AbortController();
    const result = collisionWarningsInWorker([brick], undefined, controller.signal);
    controller.abort();
    await expect(result).rejects.toHaveProperty("name", "AbortError");
    expect(instance?.terminated).toBe(true);
  });
  it("restores verified warning boxes returned by the worker", async () => {
    const progress: { phase: string; percent: number }[] = [];
    class WorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor() {}
      postMessage() {
        queueMicrotask(() => {
          this.onmessage?.({ data: { progress: { phase: "checking", percent: 42 } } } as MessageEvent);
          this.onmessage?.({ data: {
            boxes: [["a", [0, 0, 0], [1, 1, 1]], ["b", [1, 0, 0], [2, 1, 1]]],
            uncertain: true,
          } } as MessageEvent);
        });
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", WorkerStub);
    const result = await collisionWarningsInWorker([brick], undefined, new AbortController().signal, undefined, value => progress.push(value));
    expect([...result.boxes.keys()]).toEqual(["a", "b"]);
    expect(result.boxes.get("a")?.min.toArray()).toEqual([0, 0, 0]);
    expect(result.boxes.get("b")?.max.toArray()).toEqual([2, 1, 1]);
    expect(result.uncertain).toBe(true);
    expect(progress).toContainEqual({ phase: "checking", percent: 42 });
  });
  it("reports progress while snapshotting a large recursive imported model", async () => {
    const model = engineFixture(1, 1);
    const geometry = "2 24 0 0 0 20 0 0\n".repeat(2_000);
    const reference = (name: string) => `1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${name}\n`;
    model.resources["parts/test.dat"].content = `${geometry}${reference("sub1.dat")}`;
    model.resources["parts/sub1.dat"] = { content: `${geometry}${reference("sub2.dat")}` } as typeof model.resources[string];
    model.resources["parts/sub2.dat"] = { content: geometry } as typeof model.resources[string];

    class WorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor() {}
      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: { boxes: [], uncertain: false } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", WorkerStub);
    const progress: { phase: string; percent: number }[] = [];
    await collisionWarningsInWorker([], model, new AbortController().signal, undefined, value => progress.push(value));

    const snapshot = progress.filter(value => value.phase === "snapshot").map(value => value.percent);
    expect(snapshot.length).toBeGreaterThan(2);
    expect(snapshot.at(-1)).toBe(100);
    expect(snapshot.slice(1).every((value, index) => value >= snapshot[index])).toBe(true);
  });
  it("ignores snapshot progress after the imported model is canceled", async () => {
    const model = engineFixture(1, 1);
    model.resources["parts/test.dat"].content = "2 24 0 0 0 20 0 0\n".repeat(20_000);
    class WorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor() { throw new Error("Canceled snapshots must not start a worker"); }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal("Worker", WorkerStub);
    const controller = new AbortController();
    const progress: { phase: string; percent: number }[] = [];
    let updatesAfterAbort = 0;
    await expect(collisionWarningsInWorker([], model, controller.signal, undefined, value => {
      if (controller.signal.aborted) updatesAfterAbort++;
      progress.push(value);
      if (value.phase === "snapshot" && value.percent > 0) controller.abort();
    })).rejects.toHaveProperty("name", "AbortError");
    expect(progress.filter(value => value.phase === "snapshot").at(-1)?.percent).toBeGreaterThan(0);
    expect(updatesAfterAbort).toBe(0);
  });
  it("still checks local bricks when an imported model is present", async () => {
    const warnings = await collisionWarnings(
      [brick, { ...brick, id: "b" }], engineFixture(1, 1), new AbortController().signal, 2,
    );
    expect(warnings.boxes.has("a")).toBe(true);
    expect(warnings.boxes.has("b")).toBe(true);
    expect(warnings.boxes.get("a")!.min.y).toBe(-2);
  });
});
