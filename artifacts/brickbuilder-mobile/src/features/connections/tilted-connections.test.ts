import { readFileSync } from "node:fs";
import { Euler, Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { moveImported, tiltImported } from "../editor/ldraw-editing";
import { commit, createHistory, redo, undo } from "../editor/history";
import { exportInternal, importInternal } from "../formats/internal/adapter";
import type { Affine, ImportedModel } from "../formats/types";
import { affine, describeConnections, matrix4, transformConnector } from "./description";
import { axes, intervals, potentialPair, profileOverlap } from "./profiles";
import { activeConnections, constructionTransform, magneticConstructionTransform, snapConnection } from "./engine";
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

function mechanicalPlacement(
  targetPart: string, movingPart: string, x: number, z: number, extraRoll = 0,
  orientationReference = targetPart, allowIncompatible = false, profileCase?: "axle" | "round-in-axle",
  tilts?: { target: readonly [number, number]; moving: readonly [number, number]; compensate?: boolean },
) {
  let document = { ...createEmptyDocument(), imported: connectionFixture([
    partLine(orientationReference), partLine(movingPart, 160),
  ].join("\n")) };
  let model = document.imported;
  const [target, moving] = model.instances;
  const approach: Record<string, { x: number; y: number; z: number }> = {
    "3700/2780": { x: 0.03, y: -0.5, z: 0.5 },
    "32064/3705": { x: 0.02, y: -0.5, z: 0.02 },
    "4085a/30374": { x: 0.02, y: -0.2, z: -1.02 },
  };
  const snap = snapConnection(model, moving.id, approach[`${orientationReference}/${movingPart}`]);
  if (!snap) throw new Error(`Could not orient licensed example ${movingPart}/${orientationReference}`);
  const aligned = matrix4(snap.matrix).setPosition(0, 0, 0);
  if (tilts?.compensate !== false) {
    const [targetX, targetZ] = tilts?.target ?? [x, z];
    const [movingX, movingZ] = tilts?.moving ?? [x, z];
    const targetTilt = new Matrix4().makeRotationFromEuler(new Euler(
      targetX * Math.PI / 180, 0, targetZ * Math.PI / 180, "XYZ",
    ));
    const movingTilt = new Matrix4().makeRotationFromEuler(new Euler(
      movingX * Math.PI / 180, 0, movingZ * Math.PI / 180, "XYZ",
    ));
    const ldrawToWorld = new Matrix4().makeScale(1, -1, 1);
    const compensation = ldrawToWorld.clone()
      .multiply(movingTilt.invert().multiply(targetTilt))
      .multiply(ldrawToWorld);
    aligned.premultiply(compensation);
  }
  if (extraRoll) {
    const targetHole = describeConnections(`${targetPart}.dat`, model).connectors
      .map(c => transformConnector(c, target.matrix)).find(c => c?.gender === "F" && c.sections.some(s => s.shape === "A"));
    if (!targetHole) throw new Error(`No real axle hole found in ${targetPart}`);
    aligned.premultiply(new Matrix4().makeRotationAxis(axes(targetHole).y, extraRoll * Math.PI / 180));
  }
  const orientedMoving = { ...moving, matrix: affine(aligned.setPosition(moving.matrix[3], moving.matrix[7], moving.matrix[11])) };
  model = { ...model, instances: [target, orientedMoving] };
  document = { ...document, imported: model };
  const [targetX, targetZ] = tilts?.target ?? [x, z];
  const [movingX, movingZ] = tilts?.moving ?? [x, z];
  document = tiltImported(document, target.id, targetX, targetZ) as typeof document;
  document = tiltImported(document, moving.id, movingX, movingZ) as typeof document;
  model = document.imported!;
  const tiltedTarget = model.instances[0], tiltedMoving = model.instances[1];
  const targets = describeConnections(`${targetPart}.dat`, model).connectors
    .map(c => transformConnector(c, tiltedTarget.matrix)).filter((c): c is NonNullable<typeof c> => !!c);
  const movers = describeConnections(`${movingPart}.dat`, model).connectors
    .map(c => transformConnector(c, tiltedMoving.matrix)).filter((c): c is NonNullable<typeof c> => !!c);
  for (const a of movers) for (const b of targets) {
    if (!potentialPair(a, b)) continue;
    if (profileCase === "axle" && (!a.sections.some(s => s.shape === "A") || !b.sections.some(s => s.shape === "A"))) continue;
    if (profileCase === "round-in-axle" && (a.gender !== "M" || !a.sections.some(s => s.shape === "R") ||
      b.gender !== "F" || !b.sections.some(s => s.shape === "A"))) continue;
    const aa = axes(a), bb = axes(b), direction = aa.y.dot(bb.y) > 0 ? 1 : -1;
    if (Math.abs(Math.abs(aa.y.dot(bb.y)) - 1) > 1e-4) continue;
    const offsets = intervals(a).flatMap(s => [s.lo * direction, s.hi * direction])
      .flatMap(m => intervals(b).flatMap(s => [s.lo - m, s.hi - m]));
    for (const offset of offsets) {
      if (!allowIncompatible && !extraRoll && !profileOverlap(a, b, offset, direction, aa.x.dot(bb.x))) continue;
      const delta = bb.position.clone().addScaledVector(bb.y, offset).sub(aa.position);
      return {
        document, id: tiltedMoving.id, targetId: tiltedTarget.id, movingConnectorId: a.id,
        targetConnectorId: b.id, offset, direction,
        desired: {
          x: (tiltedMoving.matrix[3] + delta.x) / 20,
          y: -(tiltedMoving.matrix[7] + delta.y) / 20,
          z: (tiltedMoving.matrix[11] + delta.z) / 20,
        },
      };
    }
  }
  throw new Error(`No compatible source-profile pair found for ${movingPart}/${targetPart}`);
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

  for (const [targetPart, movingPart] of [["3700", "2780"], ["32064", "3705"], ["4085a", "30374"]] as const) {
    for (const [x, z] of [[30, 0], [0, -25], [27, -18]] as const) {
      it(`snaps licensed ${movingPart}/${targetPart} profiles at X=${x}, Z=${z} without rotating them`, () => {
        const pair = mechanicalPlacement(targetPart, movingPart, x, z);
        const model = pair.document.imported!;
        const moving = model.instances.find(i => i.id === pair.id)!;
        const result = constructionTransform(model, pair.id, pair.desired);
        expect(result.contacts.some(c => c.movingConnectorId === pair.movingConnectorId &&
          c.targetConnectorId === pair.targetConnectorId), `${movingPart}/${targetPart}`).toBe(true);
        expect(basis(result.matrix)).toEqual(basis(moving.matrix));
        expect(moving.tiltX).toBe(x);
        expect(moving.tiltZ).toBe(z);
        const committed = { ...model, instances: model.instances.map(i =>
          i.id === pair.id ? { ...i, matrix: result.matrix } : i) };
        expect(activeConnections(committed, pair.id).some(c =>
          c.movingConnectorId === pair.movingConnectorId && c.targetConnectorId === pair.targetConnectorId)).toBe(true);
      });
    }
  }

  for (const [targetPart, movingPart] of [["3700", "2780"], ["32064", "3705"], ["4085a", "30374"]] as const) {
    it(`connects licensed ${movingPart}/${targetPart} profiles with different aligned editor tilts`, () => {
      const tilts = { target: [30, -12] as const, moving: [-15, 24] as const };
      const pair = mechanicalPlacement(targetPart, movingPart, 0, 0, 0, targetPart, false,
        targetPart === "32064" ? "axle" : undefined, tilts);
      const model = pair.document.imported!;
      const target = model.instances.find(i => i.id === pair.targetId)!;
      const moving = model.instances.find(i => i.id === pair.id)!;
      const result = constructionTransform(model, pair.id, pair.desired);
      expect(result.contacts.some(c => c.movingConnectorId === pair.movingConnectorId &&
        c.targetConnectorId === pair.targetConnectorId), `${movingPart}/${targetPart}`).toBe(true);
      expect(moving.tiltX).toBe(tilts.moving[0]);
      expect(moving.tiltZ).toBe(tilts.moving[1]);
      expect(target.tiltX).toBe(tilts.target[0]);
      expect(target.tiltZ).toBe(tilts.target[1]);
      expect(basis(result.matrix)).toEqual(basis(moving.matrix));
      const committed = { ...model, instances: model.instances.map(i =>
        i.id === pair.id ? { ...i, matrix: result.matrix } : i) };
      expect(activeConnections(committed, pair.id).some(c =>
        c.movingConnectorId === pair.movingConnectorId && c.targetConnectorId === pair.targetConnectorId)).toBe(true);
    });

    it(`holds and cleanly releases a mixed-angle ${movingPart}/${targetPart} joint during drag jitter`, () => {
      const tilts = { target: [30, -12] as const, moving: [-15, 24] as const };
      const pair = mechanicalPlacement(targetPart, movingPart, 0, 0, 0, targetPart, false,
        targetPart === "32064" ? "axle" : undefined, tilts);
      const model = pair.document.imported!;
      const target = model.instances.find(i => i.id === pair.targetId)!;
      const moving = model.instances.find(i => i.id === pair.id)!;
      const initial = magneticConstructionTransform(model, pair.id, pair.desired);

      expect(initial.latch).toBeDefined();
      expect(initial.transform.contacts.some(c => c.movingConnectorId === pair.movingConnectorId &&
        c.targetConnectorId === pair.targetConnectorId)).toBe(true);

      const firstJitter = magneticConstructionTransform(model, pair.id, {
        x: pair.desired.x + 0.25, y: pair.desired.y + 0.2, z: pair.desired.z - 0.25,
      }, initial.latch);
      expect(firstJitter.transform).toBe(initial.transform);
      const secondJitter = magneticConstructionTransform(model, pair.id, {
        x: pair.desired.x - 0.4, y: pair.desired.y - 0.2, z: pair.desired.z + 0.2,
      }, firstJitter.latch);
      expect(secondJitter.transform).toBe(initial.transform);
      expect(secondJitter.transform.contacts.length).toBeGreaterThan(0);

      const freePosition = { x: 13.271, y: pair.desired.y, z: 6.427 };
      const released = magneticConstructionTransform(model, pair.id, freePosition, secondJitter.latch);
      expect(released.latch).toBeUndefined();
      expect(released.transform.status).toBe("unconnected");
      expect(released.transform.contacts).toHaveLength(0);
      expect(released.transform.matrix[3]).toBe(freePosition.x * 20);
      expect(released.transform.matrix[7]).toBe(-freePosition.y * 20);
      expect(released.transform.matrix[11]).toBe(freePosition.z * 20);
      expect(basis(released.transform.matrix)).toEqual(basis(moving.matrix));

      const verticalReleasePosition = { ...pair.desired, y: pair.desired.y + 1.1 };
      const verticalRelease = magneticConstructionTransform(model, pair.id, verticalReleasePosition, initial.latch);
      expect(verticalRelease.latch).toBeUndefined();
      expect(verticalRelease.transform.contacts).toHaveLength(0);
      expect(verticalRelease.transform.matrix[3]).toBe(verticalReleasePosition.x * 20);
      expect(verticalRelease.transform.matrix[7]).toBe(-verticalReleasePosition.y * 20);
      expect(verticalRelease.transform.matrix[11]).toBe(verticalReleasePosition.z * 20);
      expect(basis(verticalRelease.transform.matrix)).toEqual(basis(moving.matrix));

      const committed = moveImported(pair.document, pair.id, freePosition, false, released.transform.matrix);
      const committedTarget = committed.imported!.instances.find(i => i.id === pair.targetId)!;
      const committedMoving = committed.imported!.instances.find(i => i.id === pair.id)!;
      expect([committedTarget.tiltX, committedTarget.tiltZ]).toEqual(tilts.target);
      expect([committedMoving.tiltX, committedMoving.tiltZ]).toEqual(tilts.moving);
      expect(basis(committedMoving.matrix)).toEqual(basis(moving.matrix));
    });

    it(`does not latch licensed ${movingPart}/${targetPart} near-misses with different tilts`, () => {
      const tilts = { target: [30, -12] as const, moving: [-15, 24] as const };
      const aligned = mechanicalPlacement(targetPart, movingPart, 0, 0, 0, targetPart, false,
        targetPart === "32064" ? "axle" : undefined, tilts);
      const document = tiltImported(aligned.document, aligned.id, 0, 4) as typeof aligned.document;
      const pair = { ...aligned, document };
      const model = document.imported!;
      const targetConnector = describeConnections(`${targetPart}.dat`, model).connectors
        .map(c => transformConnector(c, model.instances[0].matrix))
        .find(c => c?.id === pair.targetConnectorId)!;
      const movingConnector = describeConnections(`${movingPart}.dat`, model).connectors
        .map(c => transformConnector(c, model.instances[1].matrix))
        .find(c => c?.id === pair.movingConnectorId)!;
      expect(Math.abs(axes(targetConnector).y.dot(axes(movingConnector).y))).toBeLessThan(1 - 1e-4);
      const targetAxes = axes(targetConnector), movingAxes = axes(movingConnector);
      const delta = targetAxes.position.clone().addScaledVector(targetAxes.y, pair.offset).sub(movingAxes.position);
      const moving = model.instances.find(i => i.id === pair.id)!;
      const desired = {
        x: (moving.matrix[3] + delta.x) / 20,
        y: -(moving.matrix[7] + delta.y) / 20,
        z: (moving.matrix[11] + delta.z) / 20,
      };
      const result = magneticConstructionTransform(model, pair.id, desired);
      expect(result.transform.contacts.some(c => c.movingConnectorId === pair.movingConnectorId &&
        c.targetConnectorId === pair.targetConnectorId)).toBe(false);
      expect(result.latch).toBeUndefined();
      expect(result.transform.status).toBe("unconnected");
      expect(basis(result.transform.matrix)).toEqual(basis(model.instances[1].matrix));
      expect(result.transform.matrix[3]).toBe(desired.x * 20);
      expect(result.transform.matrix[7]).toBe(-desired.y * 20);
      expect(result.transform.matrix[11]).toBe(desired.z * 20);
    });
  }

  it("rejects a tilted round pin in an axle hole and preserves exact free placement", () => {
    const targetPart = "32064", movingPart = "2780";
    const pair = mechanicalPlacement(targetPart, movingPart, 27, -18, 0, "3700", true, "round-in-axle");
    const model = pair.document.imported!, a = describeConnections(`${movingPart}.dat`, model).connectors
      .map(c => transformConnector(c, model.instances[1].matrix)).filter((c): c is NonNullable<typeof c> => !!c)
      .find(c => c.id === pair.movingConnectorId)!;
    const b = describeConnections(`${targetPart}.dat`, model).connectors
      .map(c => transformConnector(c, model.instances[0].matrix)).filter((c): c is NonNullable<typeof c> => !!c)
      .find(c => c.id === pair.targetConnectorId)!;
    const aa = axes(a), bb = axes(b);
    expect(Math.abs(Math.abs(aa.y.dot(bb.y)) - 1)).toBeLessThan(1e-4);
    expect(profileOverlap(a, b, pair.offset, pair.direction, aa.x.dot(bb.x))).toBe(false);
    const rejected = constructionTransform(model, pair.id, pair.desired);
    expect(rejected.contacts.some(c => c.movingConnectorId === pair.movingConnectorId &&
      c.targetConnectorId === pair.targetConnectorId)).toBe(false);
    expect(basis(rejected.matrix)).toEqual(basis(model.instances[1].matrix));
    const delta = bb.position.clone().sub(aa.position), freePosition = { x: 14.137, y: 9.432, z: -7.283 };
    const desired = {
      x: (model.instances[1].matrix[3] + delta.x) / 20 + freePosition.x,
      y: -(model.instances[1].matrix[7] + delta.y) / 20,
      z: (model.instances[1].matrix[11] + delta.z) / 20 + freePosition.z,
    };
    const result = constructionTransform(model, model.instances[1].id, desired);
    expect(result.contacts).toHaveLength(0);
    expect(basis(result.matrix)).toEqual(basis(model.instances[1].matrix));
    expect(result.matrix[3]).toBe(desired.x * 20);
    expect(result.matrix[7]).toBe(-desired.y * 20);
    expect(result.matrix[11]).toBe(desired.z * 20);
  });

  it("rejects a tilted axle at an incompatible 45-degree roll but permits release", () => {
    const pair = mechanicalPlacement("32064", "3705", 27, -18, 45, "32064", false, "axle");
    const model = pair.document.imported!;
    const axle = describeConnections("3705.dat", model).connectors
      .map(c => transformConnector(c, model.instances[1].matrix)).find(c => c?.id === pair.movingConnectorId)!;
    const hole = describeConnections("32064.dat", model).connectors
      .map(c => transformConnector(c, model.instances[0].matrix)).find(c => c?.id === pair.targetConnectorId)!;
    const aa = axes(axle), bb = axes(hole);
    expect(Math.abs(Math.abs(aa.y.dot(bb.y)) - 1)).toBeLessThan(1e-4);
    expect(profileOverlap(axle, hole, pair.offset, pair.direction, aa.x.dot(bb.x))).toBe(false);
    const result = constructionTransform(model, pair.id, pair.desired);
    expect(result.contacts).toHaveLength(0);
    expect(basis(result.matrix)).toEqual(basis(model.instances[1].matrix));
    expect(result.matrix.slice(0, 3)).toEqual(model.instances[1].matrix.slice(0, 3));
    const released = magneticConstructionTransform(model, pair.id,
      { x: 13.271, y: -4.613, z: 6.427 });
    expect(released.latch).toBeUndefined();
    expect(released.transform.contacts).toHaveLength(0);
    expect(released.transform.matrix[3]).toBe(13.271 * 20);
    expect(released.transform.matrix[7]).toBe(4.613 * 20);
    expect(released.transform.matrix[11]).toBe(6.427 * 20);
  });
});
