import { expect, it } from "vitest";
import { Vector3 } from "three";
import { BRICK_HEIGHT, type Brick } from "./model";
import { brickBounds, brickLDrawMatrix, brickTransformMatrix, clampBrickToGround, normalizeTiltAngle } from "./brick-transform";
import { worldMatrix } from "../engine/ldraw-geometry";

const brick: Brick = {
  id: "tilted", type: "brick-2x4", color: "#B40000", x: 3.25, y: 0.4, z: -2,
  rotation: 90, tiltX: 31.5, tiltZ: -22,
};

it("normalizes free tilt angles without losing decimal precision", () => {
  expect(normalizeTiltAngle(390)).toBe(30);
  expect(normalizeTiltAngle(-181)).toBe(179);
  expect(normalizeTiltAngle(31.5)).toBe(31.5);
});

it("uses all three axes for local geometry and includes the tilted shape in bounds", () => {
  const transform = brickTransformMatrix(brick);
  const local = new Vector3(0, BRICK_HEIGHT, 1.5);
  const world = local.clone().applyMatrix4(transform);
  expect(world.x).not.toBeCloseTo(brick.x);
  expect(world.y).not.toBeCloseTo(brick.y + BRICK_HEIGHT);
  const bounds = brickBounds(brick);
  expect(bounds.min.x).toBeLessThan(brick.x);
  expect(bounds.min.y).toBeLessThan(brick.y);
  expect(bounds.max.y).toBeGreaterThan(brick.y + BRICK_HEIGHT);
});

it("keeps tilted geometry above the floor after clamping", () => {
  const grounded = clampBrickToGround({ ...brick, y: 0 });
  expect(brickBounds(grounded).min.y).toBeCloseTo(0);
});

it("exports the same 3D pose as an LDraw type-1 transform", () => {
  const exported = worldMatrix(brickLDrawMatrix(brick));
  const display = brickTransformMatrix(brick);
  for (const point of [
    new Vector3(0, 0, 0),
    new Vector3(0.5, BRICK_HEIGHT, -1.5),
    new Vector3(-0.5, BRICK_HEIGHT + 0.08, 1.5),
  ]) {
    const sourceLDraw = new Vector3(point.x * 20, (BRICK_HEIGHT - point.y) * 20, point.z * 20);
    expect(sourceLDraw.applyMatrix4(exported).distanceTo(point.applyMatrix4(display))).toBeLessThan(1e-8);
  }
});
