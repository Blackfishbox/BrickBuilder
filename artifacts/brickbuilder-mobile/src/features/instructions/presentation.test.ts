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
