import { describe, expect, it } from "vitest";
import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { applyInstructionCameraRotation } from "../engine/instruction-camera";
import { createEmptyDocument } from "../editor/model";
import { instructionParts } from "./pdf";
import { IDENTITY } from "../formats/ldraw/parser";

describe("live instruction rotations", () => {
  for (const angles of [[90, 0, 0], [0, 90, 0], [0, 0, 90], [25, -70, 130], [0, 0, 0]] as [number, number, number][]) {
    it(`matches the PDF model-pivot rotation ${angles.join("/")}, including roll`, () => {
      const target = new Vector3(4, 2, -3), source = new Vector3(6, 3, -2);
      const camera = new PerspectiveCamera(42, 0.8, 0.1, 2000);
      camera.position.copy(target).add(new Vector3(12, 9, 15)); camera.lookAt(target); camera.updateMatrixWorld();
      const rotation = new Quaternion().setFromEuler(new Euler(...angles.map(a => a * Math.PI / 180) as [number, number, number], "XYZ"));
      const expected = source.clone().sub(target).applyQuaternion(rotation).add(target).project(camera);
      const distance = camera.position.distanceTo(target);
      applyInstructionCameraRotation(camera, target, angles);
      const actual = source.clone().project(camera);
      expect(actual.distanceTo(expected)).toBeLessThan(1e-10);
      expect(camera.position.distanceTo(target)).toBeCloseTo(distance);
      expect(target.toArray()).toEqual([4, 2, -3]);
      const forward = target.clone().sub(camera.position).normalize();
      const softwareRight = new Vector3().crossVectors(forward, camera.up).normalize();
      expect(softwareRight.distanceTo(new Vector3().setFromMatrixColumn(camera.matrixWorld, 0))).toBeLessThan(1e-10);
    });
  }

  it("resets the up vector and handles large finite angles without overflow", () => {
    const camera = new PerspectiveCamera(), target = new Vector3();
    const base = new Vector3(10, 10, 10);
    camera.position.copy(base); applyInstructionCameraRotation(camera, target, [0, 0, 90]);
    expect(camera.up.distanceTo(new Vector3(0, 1, 0))).toBeGreaterThan(0.1);
    camera.position.copy(base); applyInstructionCameraRotation(camera, target);
    expect(camera.up.toArray()).toEqual([0, 1, 0]);
    camera.position.copy(base); applyInstructionCameraRotation(camera, target, [1e300, 0, 0]);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
  });
});

it("shows confirmed part numbers without a BrickLink prefix and keeps fallback IDs distinguishable", () => {
  const document = createEmptyDocument();
  document.imported = {
    version: 1, format: "ldr", originalBytes: [], sourceName: "test.ldr", sourceText: "",
    root: "main.ldr", sections: {}, resources: {}, legalDocuments: [], issues: [],
    instances: [true, true, false].map((confirmed, index) => ({
      id: String(index), reference: "3004.dat", colorCode: "4", matrix: [...IDENTITY], sourcePath: [],
      part: { ldrawId: "3004", ...(confirmed ? { brickLinkId: "3004" } : {}), status: "missing" },
    })),
  };
  const rows = instructionParts(document, ["0", "1", "2"]);
  expect(rows).toEqual(["2 × 3004 · Red", "1 × LDraw 3004 · Red"]);
  expect(rows.join(" ")).not.toMatch(/BrickLink/i);
});
