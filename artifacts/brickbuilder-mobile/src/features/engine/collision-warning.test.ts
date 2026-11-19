import { describe, expect, it, vi } from "vitest";
import type { Brick } from "../editor/model";
import { engineFixture } from "./engine-fixtures";
import { collisionWarnings, collisionWarningsInWorker } from "./collision-warning";
import { connectionFixture, partLine } from "../connections/fixtures";
import { activeConnections } from "../connections/engine";

const brick: Brick = { id: "a", type: "brick-1x2", color: "#fff", x: 0, y: 0, z: 0, rotation: 0 };
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
  it("aborts obsolete calculations instead of applying their results", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collisionWarnings([brick], undefined, controller.signal)).rejects.toHaveProperty("name", "AbortError");
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
    class WorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor() {}
      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: {
          boxes: [["a", [0, 0, 0], [1, 1, 1]], ["b", [1, 0, 0], [2, 1, 1]]],
          uncertain: true,
        } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", WorkerStub);
    const result = await collisionWarningsInWorker([brick], undefined, new AbortController().signal);
    expect([...result.boxes.keys()]).toEqual(["a", "b"]);
    expect(result.boxes.get("a")?.min.toArray()).toEqual([0, 0, 0]);
    expect(result.boxes.get("b")?.max.toArray()).toEqual([2, 1, 1]);
    expect(result.uncertain).toBe(true);
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
