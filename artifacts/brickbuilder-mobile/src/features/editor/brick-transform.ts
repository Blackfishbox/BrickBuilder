import { Box3, Euler, Matrix3, Matrix4, Vector3 } from "three";
import { BRICK_DEFINITIONS, BRICK_HEIGHT, type Brick } from "./model";

const TO_LDRAW = new Matrix4().makeScale(1, -1, 1);

export function normalizeTiltAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

/** Local brick geometry uses its bottom center as the origin. */
export function brickRotationMatrix(brick: Pick<Brick, "rotation" | "tiltX" | "tiltZ">): Matrix4 {
  return new Matrix4().makeRotationFromEuler(new Euler(
    (brick.tiltX ?? 0) * Math.PI / 180,
    brick.rotation * Math.PI / 180,
    (brick.tiltZ ?? 0) * Math.PI / 180,
    "XYZ",
  ));
}

export function brickTransformMatrix(brick: Brick): Matrix4 {
  return new Matrix4().makeTranslation(brick.x, brick.y, brick.z)
    .multiply(brickRotationMatrix(brick));
}

export function brickBounds(brick: Brick): Box3 {
  const { studsX, studsZ } = BRICK_DEFINITIONS[brick.type];
  const bounds = new Box3(
    new Vector3(-studsX / 2, 0, -studsZ / 2),
    new Vector3(studsX / 2, BRICK_HEIGHT, studsZ / 2),
  );
  return bounds.applyMatrix4(brickTransformMatrix(brick));
}

export function clampBrickToGround(brick: Brick, floor = 0): Brick {
  const bottom = brickBounds(brick).min.y;
  if (!Number.isFinite(bottom) || bottom >= floor - 1e-9) return brick;
  return { ...brick, y: brick.y + floor - bottom };
}

/** Convert the bottom-origin Three.js brick transform to an LDraw type-1 matrix. */
export function brickLDrawMatrix(brick: Brick): [number, number, number, number, number, number, number, number, number, number, number, number] {
  const ldrawRotation = TO_LDRAW.clone().multiply(brickRotationMatrix(brick)).multiply(TO_LDRAW);
  const elements = ldrawRotation.elements;
  const basis = new Matrix3().setFromMatrix4(ldrawRotation);
  const topOffset = new Vector3(0, BRICK_HEIGHT * 20, 0).applyMatrix3(basis);
  const x = brick.x * 20 - topOffset.x;
  const y = -brick.y * 20 - topOffset.y;
  const z = brick.z * 20 - topOffset.z;
  return [
    elements[0], elements[4], elements[8], x,
    elements[1], elements[5], elements[9], y,
    elements[2], elements[6], elements[10], z,
  ];
}
