import { expect, it, vi } from "vitest";
import { Box3, Color, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { instructionDisplayColor } from "./highlight-color";
import { instructionDisplayColor as engineColor } from "../engine/instruction-focus";
import { applyPdfStepCamera } from "./camera";
import {
  applyInstructionCameraRotation,
  DEFAULT_INSTRUCTION_PHI,
  DEFAULT_INSTRUCTION_THETA,
  instructionRotationFromCameraPose,
} from "../engine/instruction-camera";
import { drawInstructionOutlines } from "./outlines";
import { instructionStepSchema } from "./types";
import { readStudioInstructions, writeStudioInstructions } from "./studio";
import { DEFAULT_INSTRUCTION_PHI } from "../engine/instruction-camera";

it("keeps new parts unchanged and fades old parts without removing their hue", () => {
  const original = new Color("#e21b30");
  for (const convert of [instructionDisplayColor, engineColor]) {
    expect(convert(original.clone(), true)).toEqual(original);
    const faded = convert(original.clone(), false);
    expect(faded.r).toBeGreaterThan(faded.g);
    expect(faded.g).toBeGreaterThan(original.g);
    expect(faded.g - original.g).toBeLessThan(0.12);
  }
});

it("stores and restores a step camera including zoom and pan", () => {
  const saved = { theta: 1.2, phi: 0.8, distance: 10, referenceDistance: 20,
    target: [2, 3, 4] as [number, number, number], referenceTarget: [0, 0, 0] as [number, number, number] };
  const step = instructionStepSchema.parse({ id: "a", title: "", notes: "", partIds: [], rotation: [15, 25, -35], camera: saved });
  const plan = { version: 1 as const, source: "manual" as const, edited: true, warnings: [], steps: [step] };
  const restored = readStudioInstructions(writeStudioInstructions(plan), { ...plan, steps: [{ ...step, camera: undefined }] });
  expect(restored.steps[0].camera).toEqual(saved);
  expect(restored.steps[0].rotation?.[0]).toBeCloseTo(15);
  expect(restored.steps[0].rotation?.[1]).toBeCloseTo(25);
  expect(restored.steps[0].rotation?.[2]).toBeCloseTo(-35);
  const camera = new OrthographicCamera(-5, 5, 4, -4, 0.01, 1000);
  applyPdfStepCamera(camera, 5, step.camera);
  expect(camera.zoom).toBe(2);
  const target = new Vector3(2, 3, 4);
  expect(camera.position.distanceTo(target)).toBeCloseTo(20);
  applyPdfStepCamera(camera, 5);
  expect(camera.zoom).toBe(1);
  expect(camera.position.length()).toBeCloseTo(20);
  expect(camera.position.y / camera.position.length()).toBeCloseTo(Math.cos(DEFAULT_INSTRUCTION_PHI));
});

it("converts combined orbit and XYZ rotations to one equivalent instruction rotation", () => {
  const makeCamera = (theta: number, phi: number, rotation?: [number, number, number]) => {
    const camera = new PerspectiveCamera();
    const target = new Vector3();
    camera.position.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    camera.lookAt(target);
    applyInstructionCameraRotation(camera, target, rotation);
    return camera;
  };
  const original = makeCamera(1.31, 0.64, [23, -47, 18]);
  const combined = instructionRotationFromCameraPose(1.31, 0.64, [23, -47, 18]);
  const canonical = makeCamera(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI, combined);
  expect(canonical.position.distanceTo(original.position)).toBeLessThan(0.00001);
  expect(canonical.quaternion.angleTo(original.quaternion)).toBeLessThan(0.00001);

  const unrotated = instructionRotationFromCameraPose(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI);
  expect(unrotated).toEqual([0, 0, 0]);
});

it("keeps equivalent multi-turn views stable and bounded at both supported pitch limits", () => {
  const makeCamera = (theta: number, phi: number, rotation?: [number, number, number]) => {
    const camera = new PerspectiveCamera();
    const target = new Vector3();
    camera.position.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    camera.lookAt(target);
    applyInstructionCameraRotation(camera, target, rotation);
    return camera;
  };

  for (const phi of [0.25, 1.42]) {
    const baseTheta = DEFAULT_INSTRUCTION_THETA + 0.37;
    const expected = instructionRotationFromCameraPose(baseTheta, phi, [35, -82, 24]);
    const expectedCamera = makeCamera(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI, expected);

    for (const completeTurns of [-8, -3, 1, 4, 9]) {
      const theta = baseTheta + completeTurns * Math.PI * 2;
      const actual = instructionRotationFromCameraPose(theta, phi, [35, -82, 24]);
      const actualCamera = makeCamera(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI, actual);

      expect(actual.every(angle => angle >= -180 && angle < 180)).toBe(true);
      actual.forEach((angle, index) => expect(angle).toBeCloseTo(expected[index], 5));
      expect(actualCamera.position.distanceTo(expectedCamera.position)).toBeLessThan(0.00001);
      expect(actualCamera.quaternion.angleTo(expectedCamera.quaternion)).toBeLessThan(0.00001);
    }
  }
});

it("preserves the camera view through repeated touch-turn conversions", () => {
  const makeCamera = (theta: number, phi: number, rotation?: [number, number, number]) => {
    const camera = new PerspectiveCamera();
    const target = new Vector3();
    camera.position.set(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
    camera.lookAt(target);
    applyInstructionCameraRotation(camera, target, rotation);
    return camera;
  };

  let rotation: [number, number, number] | undefined;
  for (let gesture = 0; gesture < 160; gesture++) {
    const theta = DEFAULT_INSTRUCTION_THETA + 0.08;
    const phi = gesture % 2 === 0 ? 0.25 : 1.42;
    const direct = makeCamera(theta, phi, rotation);
    const next = instructionRotationFromCameraPose(theta, phi, rotation);
    const canonical = makeCamera(DEFAULT_INSTRUCTION_THETA, DEFAULT_INSTRUCTION_PHI, next);

    expect(next.every(angle => angle >= -180 && angle < 180)).toBe(true);
    expect(canonical.position.distanceTo(direct.position)).toBeLessThan(0.00001);
    expect(canonical.quaternion.angleTo(direct.quaternion)).toBeLessThan(0.00001);
    rotation = next;
  }

});

it("draws twelve strong red box edges rather than recoloring surfaces", () => {
  const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    strokeStyle: "", lineWidth: 0, globalAlpha: 0 };
  const camera = new OrthographicCamera(-5, 5, 5, -5, 0.01, 100);
  camera.position.set(5, 5, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  drawInstructionOutlines(context as unknown as CanvasRenderingContext2D, camera,
    [new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1))], 400, 400);
  expect(context.strokeStyle).toBe("#e32620");
  expect(context.lineWidth).toBeGreaterThan(2);
  expect(context.lineTo).toHaveBeenCalledTimes(12);
});
