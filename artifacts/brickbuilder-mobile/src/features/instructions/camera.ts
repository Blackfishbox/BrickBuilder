import { Box3, OrthographicCamera, Vector3 } from "three";
import {
  DEFAULT_INSTRUCTION_PHI,
  DEFAULT_INSTRUCTION_THETA,
} from "../engine/instruction-camera";
import type { InstructionCamera } from "./types";

export function setPdfDefaultCamera(camera: OrthographicCamera, radius: number): void {
  const theta = DEFAULT_INSTRUCTION_THETA;
  const phi = DEFAULT_INSTRUCTION_PHI;
  camera.up.set(0, 1, 0);
  camera.position.set(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta),
  ).multiplyScalar(radius * 4);
  camera.zoom = 1;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
}

/** Shared PDF camera, with the touch view's angle, relative zoom and pan. */
export function applyPdfStepCamera(camera: OrthographicCamera, radius: number, saved?: InstructionCamera): void {
  const target = new Vector3();
  camera.up.set(0, 1, 0);
  if (saved) {
    const distance = radius * 4;
    const panScale = distance / saved.referenceDistance;
    target.fromArray(saved.target).sub(new Vector3(...saved.referenceTarget)).multiplyScalar(panScale);
    camera.position.set(Math.sin(saved.phi) * Math.sin(saved.theta), Math.cos(saved.phi),
      Math.sin(saved.phi) * Math.cos(saved.theta)).multiplyScalar(distance).add(target);
    camera.zoom = saved.referenceDistance / saved.distance;
  } else {
    setPdfDefaultCamera(camera, radius);
  }
  camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
}

/** Bounds are in camera space, so tilted models fill even narrow Studio slots. */
export function fitStudioCamera(camera: OrthographicCamera, bounds: Box3, aspect: number, minimumHeight = 0): void {
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new Vector3()), size = bounds.getSize(new Vector3());
  const height = Math.max(Math.max(size.y, size.x / aspect, 0.01) * 1.06, minimumHeight);
  camera.zoom = 1;
  camera.left = center.x - height * aspect / 2;
  camera.right = center.x + height * aspect / 2;
  camera.top = center.y + height / 2;
  camera.bottom = center.y - height / 2;
  camera.updateProjectionMatrix();
}

export function studioRenderSize(aspect: number): { width: number; height: number } {
  const safeAspect = Math.max(0.1, Math.min(10, aspect));
  return safeAspect >= 1
    ? { width: 2000, height: Math.round(2000 / safeAspect) }
    : { width: Math.round(2000 * safeAspect), height: 2000 };
}
