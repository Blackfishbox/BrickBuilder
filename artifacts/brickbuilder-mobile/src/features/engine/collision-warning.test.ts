import { describe, expect, it } from "vitest";
import type { Brick } from "../editor/model";
import { engineFixture } from "./engine-fixtures";
import { collisionWarnings } from "./collision-warning";

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
  it("labels overlapping open imported geometry as possible, not confirmed", async () => {
    const model = engineFixture(2, 1);
    model.instances[1].matrix = [...model.instances[0].matrix];
    const warnings = await collisionWarnings([], model, new AbortController().signal);
    expect(warnings.boxes.size).toBe(2);
    expect(warnings.uncertain).toBe(true);
  });
  it("aborts obsolete calculations instead of applying their results", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collisionWarnings([brick], undefined, controller.signal)).rejects.toHaveProperty("name", "AbortError");
  });
});
