import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { Affine, ImportedInstance } from "../formats/types";
import { worldMatrix } from "../engine/ldraw-geometry";
import { normalizeTiltAngle } from "./brick-transform";

export interface ImportedControlAngles {
  rotationY: number;
  tiltX: number;
  tiltZ: number;
  baseRotationY: number;
  baseTiltX: number;
  baseTiltZ: number;
}

function affineAngles(matrix: Affine): [number, number, number] {
  const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
  const basisFlip = new Matrix4().makeScale(1, -1, 1);
  worldMatrix(matrix).multiply(basisFlip).decompose(position, quaternion, scale);
  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  return [
    normalizeTiltAngle(euler.x * 180 / Math.PI),
    normalizeTiltAngle(euler.y * 180 / Math.PI),
    normalizeTiltAngle(euler.z * 180 / Math.PI),
  ];
}

/** Report effective slider angles, including orientation already present in the source matrix. */
export function importedControlAngles(instance: ImportedInstance): ImportedControlAngles {
  const sourceBasis = instance.rotationBaseMatrix ?? instance.tiltBaseMatrix ?? instance.matrix;
  const [baseTiltX, baseYaw, baseTiltZ] = affineAngles(sourceBasis);
  const baseRotationY = (baseYaw + 360) % 360;
  return {
    rotationY: (baseRotationY + (instance.rotationY ?? 0)) % 360,
    tiltX: normalizeTiltAngle(baseTiltX + (instance.tiltX ?? 0)),
    tiltZ: normalizeTiltAngle(baseTiltZ + (instance.tiltZ ?? 0)),
    baseRotationY,
    baseTiltX,
    baseTiltZ,
  };
}

export function importedRotationOffset(displayedAngle: number, baseline: number): number {
  return ((Math.round(displayedAngle - baseline) % 360) + 360) % 360;
}

export function importedTiltOffset(displayedAngle: number, baseline: number): number {
  return normalizeTiltAngle(displayedAngle - baseline);
}
