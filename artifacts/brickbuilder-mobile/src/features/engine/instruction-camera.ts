import { Euler, PerspectiveCamera, Quaternion, Vector3 } from "three";

export const DEFAULT_INSTRUCTION_THETA = 0.72;
export const DEFAULT_INSTRUCTION_PHI = 0.93;

/** Inverse camera rotation gives the same model view as the PDF's XYZ pivot. */
export function applyInstructionCameraRotation(
  camera: PerspectiveCamera,
  target: Vector3,
  rotation?: readonly [number, number, number],
): void {
  camera.up.set(0, 1, 0);
  if (rotation) {
    const radians = rotation.map(angle => (angle % 360) * Math.PI / 180) as [number, number, number];
    const inverse = new Quaternion().setFromEuler(new Euler(...radians, "XYZ")).invert();
    camera.position.sub(target).applyQuaternion(inverse).add(target);
    camera.up.applyQuaternion(inverse);
  }
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

/**
 * Express an orbit camera plus its existing XYZ pivot as one equivalent
 * instruction rotation around the standard instruction camera.
 */
export function instructionRotationFromCameraPose(
  theta: number,
  phi: number,
  rotation?: readonly [number, number, number],
  referenceTheta = DEFAULT_INSTRUCTION_THETA,
  referencePhi = DEFAULT_INSTRUCTION_PHI,
): [number, number, number] {
  const orientation = (orbitTheta: number, orbitPhi: number, pivot?: readonly [number, number, number]) => {
    const camera = new PerspectiveCamera();
    const target = new Vector3();
    camera.position.set(
      Math.sin(orbitPhi) * Math.sin(orbitTheta),
      Math.cos(orbitPhi),
      Math.sin(orbitPhi) * Math.cos(orbitTheta),
    );
    camera.lookAt(target);
    applyInstructionCameraRotation(camera, target, pivot);
    return camera.quaternion.clone();
  };

  const reference = orientation(referenceTheta, referencePhi);
  const current = orientation(theta, phi, rotation);
  const combined = reference.multiply(current.invert());
  const angles = new Euler().setFromQuaternion(combined, "XYZ");
  return [angles.x, angles.y, angles.z].map(radians => {
    const degrees = radians * 180 / Math.PI;
    const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
    return Math.abs(normalized) < 0.000001 ? 0 : Number(normalized.toFixed(6));
  }) as [number, number, number];
}
