import { readFileSync } from "node:fs";
import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { moveImported, tiltImported } from "../editor/ldraw-editing";
import { commit, createHistory, redo, undo } from "../editor/history";
import { exportInternal, importInternal } from "../formats/internal/adapter";
import type { Affine, ImportedModel } from "../formats/types";
import { affine, matrix4 } from "./description";
import { activeConnections, constructionTransform, magneticConstructionTransform } from "./engine";
import { connectionFixture, partLine } from "./fixtures";

const plates = JSON.parse(readFileSync(new URL("../../../public/parts/ldraw-plates-2026-10-31.json", import.meta.url), "utf8"));
const plateResources = Object.fromEntries(plates.files.map((f: { path: string }) => [f.path, f])) as ImportedModel["resources"];

function tiltedPair(x: number, z: number, part = "3003") {
  let document = { ...createEmptyDocument(), imported: connectionFixture([
    partLine("3001", 4.6, -200, 3.4), partLine(part, 160, -200),
  ].join("\n")) };
  document.imported.resources = { ...document.imported.resources, ...plateResources };
  const [target, moving] = document.imported.instances;
  document = tiltImported(document, target.id, x, z) as typeof document;
  document = tiltImported(document, moving.id, x, z) as typeof document;
  // The underside of a brick is 24 LDU below its top; plates are 8 LDU.
  const expected = affine(matrix4(document.imported.instances[0].matrix)
    .multiply(new Matrix4().makeTranslation(0, part === "3003" ? -24 : -8, part === "3003" ? 0 : 10)));
  const desired = { x: expected[3] / 20 + 0.04, y: -expected[7] / 20, z: expected[11] / 20 + 0.03 };
  return { document, id: moving.id, expected, desired };
}

const basis = (matrix: Affine) => matrix.filter((_, i) => ![3, 7, 11].includes(i));
function expectMatrix(actual: Affine, expected: Affine) {
  actual.forEach((n, i) => expect(n, `matrix[${i}]`).toBeCloseTo(expected[i], 9));
}

describe("tilted construction contacts", () => {
  for (const part of ["3003", "3023"]) for (const [x, z] of [[30, 0], [0, -25], [27, -18], [90, 0]]) {
    it(`snaps ${part} at X=${x}, Z=${z} without changing its tilt`, () => {
      const { document, id, expected, desired } = tiltedPair(x, z, part);
      const model = document.imported;
      const result = constructionTransform(model, id, desired);
      expect(result.status).toBe("candidate");
      expect(result.contacts.length).toBeGreaterThan(0);
      expectMatrix(result.matrix, expected);
      expect(basis(result.matrix)).toEqual(basis(model.instances[1].matrix));
      const moved = moveImported(document, id, desired, false, result.matrix);
      expect(activeConnections(moved.imported!, id).length).toBeGreaterThan(0);
      // Reapplying the same tilt must not restore an obsolete pre-snap pivot.
      expectMatrix(tiltImported(moved, id, x, z).imported!.instances[1].matrix, result.matrix);
      expect(document.imported).toBe(model);
    });
  }

  it("does not flatten a tilted brick onto an upright target", () => {
    const original = tiltedPair(30, 15);
    const document = tiltImported(original.document, original.document.imported.instances[0].id, 0, 0);
    const desired = { x: 0.237, y: 11.2, z: 0.183 };
    const result = constructionTransform(document.imported!, original.id, desired);
    expect(result.status).toBe("unconnected");
    expect(result.contacts).toHaveLength(0);
    expect(basis(result.matrix)).toEqual(basis(document.imported!.instances[1].matrix));
    expect(result.matrix[3]).toBe(desired.x * 20);
    expect(result.matrix[7]).toBe(-desired.y * 20);
    expect(result.matrix[11]).toBe(desired.z * 20);
  });

  it("holds a tilted contact during jitter and releases into exact free placement", () => {
    const { document, id, desired } = tiltedPair(27, -18);
    const first = magneticConstructionTransform(document.imported, id, desired);
    expect(first.latch).toBeDefined();
    const held = magneticConstructionTransform(document.imported, id,
      { ...desired, x: desired.x + 0.3 }, first.latch);
    expect(held.transform).toBe(first.transform);
    const freePosition = { x: 12.137, y: desired.y, z: -7.283 };
    const free = magneticConstructionTransform(document.imported, id, freePosition, held.latch);
    expect(free.latch).toBeUndefined();
    expect(free.transform.status).toBe("unconnected");
    expect(free.transform.matrix[3]).toBe(freePosition.x * 20);
    expect(free.transform.matrix[11]).toBe(freePosition.z * 20);
    expect(basis(free.transform.matrix)).toEqual(basis(document.imported.instances[1].matrix));
  });

  it("commits tilted contacts through undo, redo, save and tilt reset", () => {
    const { document, id, desired } = tiltedPair(27, -18);
    const result = constructionTransform(document.imported, id, desired);
    expect(result.contacts.length).toBeGreaterThan(0);
    const moved = moveImported(document, id, desired, false, result.matrix);
    const history = commit(createHistory(document), moved);
    expect(undo(history).document).toBe(document);
    expect(redo(undo(history)).document).toBe(moved);
    const loaded = importInternal(exportInternal(moved));
    const instance = loaded.imported!.instances[1];
    expectMatrix(instance.matrix, result.matrix);
    expect(activeConnections(loaded.imported!, instance.id).length).toBeGreaterThan(0);
    const reset = tiltImported(loaded, instance.id, 0, 0).imported!.instances[1];
    expect(reset.matrix).toEqual(instance.tiltBaseMatrix);
    expect(basis(reset.matrix)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(moved.imported!.originalBytes).toBe(document.imported.originalBytes);
  });

  it("uses the source rotation of imported parts without requiring editor tilt fields", () => {
    const { document, id, desired, expected } = tiltedPair(27, -18);
    const model = { ...document.imported, instances: document.imported.instances.map(instance => {
      const { tiltX: _x, tiltZ: _z, tiltBaseMatrix: _base, ...source } = instance;
      return source;
    }) };
    const result = constructionTransform(model, id, desired);
    expect(result.contacts.length).toBeGreaterThan(0);
    expectMatrix(result.matrix, expected);
  });

  it("does not reuse an occupied tilted socket", () => {
    const { document, id, expected, desired } = tiltedPair(27, -18, "3023");
    const model = { ...document.imported, instances: [
      ...document.imported.instances,
      { ...document.imported.instances[1], id: "already-connected", matrix: expected },
    ] };
    const result = constructionTransform(model, id, desired);
    // A different nearby free stud is permissible; the occupied pair is not.
    const occupied = activeConnections(model, "already-connected");
    expect(occupied.length).toBeGreaterThan(0);
    for (const candidate of result.contacts) {
      expect(occupied.some(c => c.targetId === candidate.targetId &&
        c.targetConnectorId === candidate.targetConnectorId)).toBe(false);
    }
  });

  it("allows exact free placement when a tilted part has no usable connection metadata", () => {
    const { document, id } = tiltedPair(27, -18);
    const moving = document.imported.instances[1];
    const model = { ...document.imported, resources: { ...document.imported.resources,
      "parts/no-connectors.dat": { ...document.imported.resources["parts/3003.dat"],
        path: "parts/no-connectors.dat", content: "0 Test geometry without connectors\n3 16 0 0 0 20 0 0 0 20 0" },
    }, instances: [document.imported.instances[0], { ...moving, reference: "no-connectors.dat" }] };
    const desired = { x: 14.137, y: 9.432, z: -7.283 };
    const result = magneticConstructionTransform(model, id, desired);
    expect(result.transform.status).toBe("no-data");
    expect(result.latch).toBeUndefined();
    expect(result.transform.contacts).toHaveLength(0);
    expect(basis(result.transform.matrix)).toEqual(basis(moving.matrix));
    expect(result.transform.matrix[3]).toBe(desired.x * 20);
    expect(result.transform.matrix[7]).toBe(-desired.y * 20);
    expect(result.transform.matrix[11]).toBe(desired.z * 20);
  });
});
