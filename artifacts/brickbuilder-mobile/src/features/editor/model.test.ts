import { describe, expect, it } from "vitest";

import { rotateQuarterTurn, snapPosition } from "./model";

describe("snapPosition", () => {
  it("snaps the part anchor onto floor-grid intersections, regardless of part size", () => {
    expect(snapPosition({ x: 0.26, y: 0, z: -1.24 })).toEqual({
      x: 0,
      y: 0,
      z: -1,
    });
    expect(snapPosition({ x: 0.26, y: 0, z: 0.26 })).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it("keeps half-stud adjustments available above the floor", () => {
    expect(snapPosition({ x: 0.26, y: 1.2, z: -1.24 })).toEqual({
      x: 0.5,
      y: 1.2,
      z: -1,
    });
  });

  it("snaps vertical placement to brick layers and prevents negative height", () => {
    expect(snapPosition({ x: 0, y: 1.21, z: 0 })).toEqual({
      x: 0,
      y: 1.2,
      z: 0,
    });
    expect(snapPosition({ x: 0, y: -2, z: 0 }).y).toBe(0);
  });
});

describe("rotateQuarterTurn", () => {
  it("advances rotations in quarter turns and wraps to zero", () => {
    expect(rotateQuarterTurn(0)).toBe(90);
    expect(rotateQuarterTurn(270)).toBe(0);
  });
});
