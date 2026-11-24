import { OrthographicCamera, Vector3 } from "three";
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
