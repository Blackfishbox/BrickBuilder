import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { liftOverlaps, stackedPosition, stackingBounds } from "./stacking";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";
import { Matrix4 } from "three";
import { importedCollisionQuery, importedPartsOverlap } from "./imported-collision";
import { compilePart, installCompiledPart, reuseGeometryCache } from "./ldraw-geometry";
import { collisionFixture, hollowCup, identity, solidBox } from "./stacking-fixtures";
import { constructionTransform } from "../connections/engine";

const box = (x: number, y: number, z: number, height = 1.2) =>
  new Box3(new Vector3(x, y, z), new Vector3(x + 1, y + height, z + 1));

describe("conservative automatic stacking", () => {
  it("raises overlapping parts above a stack", () => {
    expect(liftOverlaps(box(0, 0, 0), [box(0, 1.2, 0), box(0, 0, 0)])).toBeCloseTo(2.4);
  });
  it("removes the temporary lift after moving away", () => {
    const obstacles = [box(0, 0, 0)];
    expect(liftOverlaps(box(0, 0, 0), obstacles)).toBeCloseTo(1.2);
    expect(liftOverlaps(box(2, 0, 0), obstacles)).toBe(0);
  });
  it("does not raise touching edges or parts that are already above", () => {
    expect(liftOverlaps(box(1, 0, 0), [box(0, 0, 0)])).toBe(0);
    expect(liftOverlaps(box(0, 1.2, 0), [box(0, 0, 0)])).toBe(0);
  });
  it("does not jump onto unrelated overhead parts", () => {
    expect(liftOverlaps(box(0, 0, 0), [box(0, 5, 0)])).toBe(0);
  });
  it("preserves source matrices and handles LDraw downward Y coordinates", () => {
    const sourceText = "0 Fixture\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat\n1 4 40 0 0 1 0 0 0 1 0 0 0 1 test.dat\n";
    const model: ImportedModel = {
      version: 1, format: "ldr", sourceName: "fixture.ldr", sourceText,
      originalBytes: [], ...parseLDraw(sourceText), legalDocuments: [],
      resources: { "parts/test.dat": {
        path: "parts/test.dat", author: "Synthetic fixture", license: "CC0-1.0", sourceUrl: "https://example.invalid/test.dat",
        content: "0 Synthetic bounding triangles\n3 16 0 0 0 20 0 20 0 -24 0\n",
      } },
    };
    model.instances.forEach(value => { value.part.status = "resolved"; });
    const id = model.instances[1].id;
    const original = JSON.stringify(model);
    expect(stackedPosition(model, id, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(1.2);
    expect(stackedPosition(model, id, { x: 2, y: 0, z: 0 }).y).toBe(0);
    expect(stackingBounds(model)).toBe(stackingBounds(model));
    expect(JSON.stringify(model)).toBe(original);
  });
});

describe("imported concave solid placement", () => {
  const parts = {
    "cup.dat": hollowCup(),
    "cube.dat": solidBox([-0.5, -1, -0.5], [0.5, 0, 0.5]),
  };
  const fixture = () => collisionFixture(parts, ["cup.dat", "cube.dat"]);
  it("keeps a solid inside a real cavity and lifts it when it enters a wall", () => {
    const model = fixture(), id = model.instances[1].id;
    expect(stackedPosition(model, id, { x: 0, y: 0, z: 0 }).y).toBe(0);
    expect(stackedPosition(model, id, { x: 1.25, y: 0, z: 0 }).y).toBeCloseTo(3);
    expect(stackedPosition(model, id, { x: 0, y: 0, z: 0 }).y).toBe(0);
  });
  it("does not lift face, edge or corner contact inside the cavity", () => {
    const model = fixture(), id = model.instances[1].id;
    for (const position of [{ x: 0.5, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0.5 }, { x: 0.5, y: 1, z: 0.5 }]) {
      expect(stackedPosition(model, id, position)).toEqual(position);
    }
  });
  it("uses the same narrow phase in the actual no-connector drag path", () => {
    const model = fixture(), id = model.instances[1].id;
    expect(constructionTransform(model, id, { x: 0, y: 0, z: 0 }).matrix[7]).toBeCloseTo(0);
    expect(constructionTransform(model, id, { x: 1.5, y: 0, z: 0 }).matrix[7]).toBeCloseTo(-60);
  });
  it("detects full containment and coincident solids without surface crossings", () => {
    const model = collisionFixture({
      "large.dat": solidBox([-2, -2, -2], [2, 0, 2]),
      "small.dat": parts["cube.dat"],
    }, ["large.dat", "small.dat"]);
    expect(importedPartsOverlap(model, "small.dat", identity, "large.dat", identity)).toBe("overlap");
    expect(importedPartsOverlap(model, "small.dat", identity, "small.dat", identity)).toBe("overlap");
  });
  it("does not mistake overlapping solid shells for an empty cavity", () => {
    const model = collisionFixture({
      "shells.dat": [
        solidBox([-2, -2, -2], [1, 1, 1]),
        solidBox([-1, -1, -1], [2, 2, 2]),
      ].join("\n"),
      "small.dat": solidBox([-0.1, -0.1, -0.1], [0.1, 0.1, 0.1]),
    }, ["shells.dat", "small.dat"]);
    // The cube is wholly inside BOTH shells. XOR parity used to claim clear.
    expect(importedPartsOverlap(model, "small.dat", identity, "shells.dat", identity)).toBe("unknown");
    expect(importedPartsOverlap(model, "shells.dat", identity, "small.dat", identity)).toBe("unknown");
    expect(stackedPosition(model, model.instances[1].id, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(2.1);
  });
  it("keeps nested and touching component shells conservative too", () => {
    for (const other of [
      solidBox([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]),
      solidBox([1, 1, 1], [2, 2, 2]),
      solidBox([-1, -3, -1], [1, -1, 1]),
    ]) {
      const model = collisionFixture({
        "shells.dat": `${solidBox([-1, -1, -1], [1, 1, 1])}\n${other}`,
        "small.dat": parts["cube.dat"],
      }, ["shells.dat", "small.dat"]);
      expect(importedPartsOverlap(model, "small.dat", identity, "shells.dat", identity)).toBe("unknown");
    }
  });
  it("handles reflection, tilt and non-uniform scale without filling a cavity", () => {
    const model = fixture();
    for (const basis of [
      new Matrix4().makeRotationZ(0.37),
      new Matrix4().makeScale(-1, 0.8, 1.2),
      new Matrix4().set(1, 0.3, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1),
    ]) {
      const e = basis.elements;
      const affine = [e[0], e[4], e[8], 0, e[1], e[5], e[9], 0, e[2], e[6], e[10], 0] as typeof identity;
      expect(importedPartsOverlap(model, "cube.dat", affine, "cup.dat", affine)).toBe("clear");
      expect(importedPartsOverlap(model, "cube.dat", affine, "cube.dat", affine)).toBe("overlap");
      const touching = [...affine] as typeof identity;
      touching[3] = e[0] * 20; touching[7] = e[1] * 20; touching[11] = e[2] * 20;
      expect(importedPartsOverlap(model, "cube.dat", touching, "cube.dat", affine)).toBe("clear");
    }
  });
  it("distinguishes incomplete geometry from geometric clearance", () => {
    const model = collisionFixture({
      ...parts, "open.dat": "3 16 -20 0 -20 20 0 20 0 -20 0",
    }, ["cup.dat", "open.dat"]);
    expect(importedPartsOverlap(model, "open.dat", identity, "cup.dat", identity)).toBe("unknown");
    expect(importedPartsOverlap(model, "missing.dat", identity, "cup.dat", identity)).toBe("unknown");
    expect(stackedPosition(model, model.instances[1].id, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(3);
  });
  it("rechecks a previously clear cavity after another obstacle lifts the part", () => {
    const model = collisionFixture({ ...parts, "base.dat": solidBox([-0.75, -1.5, -0.75], [0.75, 0, 0.75]) },
      ["cup.dat", "cube.dat", "base.dat"]);
    model.instances[2].matrix[3] = 0;
    expect(stackedPosition(model, model.instances[1].id, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(3);
  });
  it("detects crossed thin bodies whose vertices and face centers are outside each other", () => {
    const model = collisionFixture({
      "x.dat": solidBox([-2, -0.1, -0.1], [2, 0.1, 0.1]),
      "z.dat": solidBox([-0.1, -0.1, -2], [0.1, 0.1, 2]),
    }, ["x.dat", "z.dat"]);
    const shift = [...identity] as typeof identity;
    shift[3] = 12; shift[11] = 8;
    expect(importedPartsOverlap(model, "x.dat", identity, "z.dat", shift)).toBe("overlap");
  });
  it("checks small disconnected solids instead of sampling only some faces", () => {
    const remote = Array.from({ length: 40 }, (_, i) => solidBox([10 + i * 2, -1, 0], [11 + i * 2, 0, 1]));
    const model = collisionFixture({ ...parts, "assembly.dat": [...remote, parts["cube.dat"]].join("\n") }, ["assembly.dat", "cube.dat"]);
    expect(importedPartsOverlap(model, "assembly.dat", identity, "cube.dat", identity)).toBe("overlap");
  });
  it("reuses prepared source geometry across repeated queries and immutable model edits", () => {
    const model = fixture(), surfaces = compilePart(model, "cup.dat", "16");
    expect(importedPartsOverlap(model, "cube.dat", identity, "cup.dat", identity)).toBe("clear");
    // A prepared source must not read the renderer's buffers again.
    const original = surfaces[0].positions;
    Object.defineProperty(surfaces[0], "positions", { get() { throw new Error("Unexpected geometry rebuild"); }, configurable: true });
    const next = { ...model, instances: [...model.instances] };
    reuseGeometryCache(model, next);
    try {
      for (let i = 0; i < 10; i++) expect(importedPartsOverlap(next, "cube.dat", identity, "cup.dat", identity)).toBe("clear");
    } finally {
      Object.defineProperty(surfaces[0], "positions", { value: original, writable: true, configurable: true });
    }
    // A worker-installed replacement gets a different cache identity.
    installCompiledPart(next, "cup.dat", compilePart(model, "cube.dat", "16"));
    expect(importedPartsOverlap(next, "cube.dat", identity, "cup.dat", identity)).toBe("overlap");
  });
  it("uses one bounded work budget for all neighbours of a placement", () => {
    const model = fixture(), query = importedCollisionQuery(model);
    let result = query("cube.dat", identity, "cup.dat", identity), calls = 1;
    expect(result).toBe("clear");
    while (result === "clear" && calls < 1000) {
      result = query("cube.dat", identity, "cup.dat", identity); calls++;
    }
    expect(result).toBe("unknown");
    expect(calls).toBeLessThan(1000);
    expect(query("cube.dat", identity, "cup.dat", identity)).toBe("unknown");
    expect(importedPartsOverlap(model, "cube.dat", identity, "cup.dat", identity)).toBe("clear");
  });
  it("keeps oversized meshes conservative rather than spending unbounded drag time", () => {
    const model = fixture(), sample = compilePart(model, "cube.dat", "16")[0];
    installCompiledPart(model, "large.dat", [{ ...sample, positions: new Float32Array(20001 * 9) }]);
    expect(importedPartsOverlap(model, "large.dat", identity, "cup.dat", identity)).toBe("unknown");
  });
});
