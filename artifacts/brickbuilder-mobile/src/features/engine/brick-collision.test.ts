import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import type { Brick } from "../editor/model";
import { brickBounds } from "../editor/brick-transform";
import { brickVolume, brickVolumesOverlap, countBrickOverlaps, type BrickVolume } from "./brick-collision";

const brick: Brick = {
  id: "fixture", type: "brick-1x2", color: "#B40000",
  x: 0, y: 0, z: 0, rotation: 0,
};

function centered(patch: Partial<Brick> = {}, center = new Vector3()): BrickVolume {
  const volume = brickVolume({ ...brick, ...patch });
  volume.bounds.translate(center.clone().sub(volume.center));
  volume.center.copy(center);
  return volume;
}

describe("oriented brick collision volumes", () => {
  it("keeps the construction bounds and rotated volume in agreement", () => {
    for (const tiltX of [-90, -43, 0, 27, 90, 179]) {
      const value = { ...brick, tiltX, tiltZ: 37, rotation: 90, x: -4, y: 3, z: 10 };
      const actual = brickVolume(value).bounds, expected = brickBounds(value);
      expect(actual.min.distanceTo(expected.min)).toBeLessThan(1e-12);
      expect(actual.max.distanceTo(expected.max)).toBeLessThan(1e-12);
    }
  });

  it("rejects empty corners inside overlapping tilted AABBs", () => {
    const a = centered({ tiltX: 45 });
    const b = centered({}, a.axes[1].clone().multiplyScalar(1.74));
    expect(a.bounds.intersectsBox(b.bounds)).toBe(true);
    expect(brickVolumesOverlap(a, b)).toBe(false);
    expect(brickVolumesOverlap(b, a)).toBe(false);
    const penetrating = centered({}, a.axes[1].clone().multiplyScalar(1.72));
    expect(brickVolumesOverlap(a, penetrating)).toBe(true);
  });

  it.each([
    {}, { tiltX: 45 }, { tiltX: -35, tiltZ: 23, rotation: 90 },
    { tiltX: 90, tiltZ: 90 }, { rotation: 270 }, { tiltX: 179.999999 },
  ])("distinguishes rotated face, edge and corner contact from penetration: %j", patch => {
    const a = centered(patch);
    for (const axisIndices of [[0], [1], [2], [0, 1], [0, 1, 2]]) {
      const offset = new Vector3();
      for (const index of axisIndices) offset.addScaledVector(a.axes[index], a.halfSize[index] * 2);
      expect(brickVolumesOverlap(a, centered(patch, offset))).toBe(false);
      expect(brickVolumesOverlap(a, centered(patch, offset.clone().multiplyScalar(1.001)))).toBe(false);
      expect(brickVolumesOverlap(a, centered(patch, offset.clone().multiplyScalar(0.999)))).toBe(true);
    }
  });

  it("requires the edge-cross-product separating axes for skew bricks", () => {
    const a = centered({ tiltX: 60, rotation: 60, tiltZ: -15 });
    const b = centered({ tiltX: 15, rotation: 30, tiltZ: 15 }, new Vector3(-1.52, -1.1, -0.65));
    // Every face-normal projection overlaps; only a crossed edge axis separates.
    const delta = b.center.clone().sub(a.center);
    for (const axis of [...a.axes, ...b.axes]) {
      const radius = a.axes.reduce((sum, v, i) => sum + a.halfSize[i] * Math.abs(v.dot(axis)), 0) +
        b.axes.reduce((sum, v, i) => sum + b.halfSize[i] * Math.abs(v.dot(axis)), 0);
      expect(Math.abs(delta.dot(axis))).toBeLessThan(radius);
    }
    expect(a.bounds.intersectsBox(b.bounds)).toBe(true);
    expect(brickVolumesOverlap(a, b)).toBe(false);
  });

  it("counts all pairs, even with three occupants and multiple shared cells", () => {
    const volumes = Array.from({ length: 3 }, () => centered({ tiltX: 45, type: "brick-2x4" }));
    expect(countBrickOverlaps(volumes)).toBe(3);
    expect(countBrickOverlaps([])).toBe(0);
    expect(countBrickOverlaps([volumes[0]])).toBe(0);
  });

  it("finds fractional and negative-coordinate overlaps across cell boundaries", () => {
    const a = centered({}, new Vector3(-4.49, -4, -4));
    const b = centered({}, new Vector3(-3.5, -4, -4));
    expect(countBrickOverlaps([a, b])).toBe(1);
    expect(countBrickOverlaps([b, a])).toBe(1);
  });

  it("matches all-pairs testing for mixed rotations, tilts and grid boundaries", () => {
    let seed = 146;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const volumes = Array.from({ length: 150 }, () => brickVolume({
      ...brick, type: random() < 0.5 ? "brick-2x4" : "brick-1x2",
      x: random() * 16 - 8, y: random() * 8 - 4, z: random() * 16 - 8,
      tiltX: random() * 360, tiltZ: random() * 360, rotation: random() * 360,
    }));
    let expected = 0;
    volumes.forEach((a, i) => {
      for (let j = 0; j < i; j++) if (brickVolumesOverlap(a, volumes[j])) expected++;
    });
    expect(expected).toBeGreaterThan(0);
    expect(countBrickOverlaps(volumes)).toBe(expected);
    expect(countBrickOverlaps([...volumes].reverse())).toBe(expected);
  });

  it("analyzes 10,000 tilted bricks without an all-pairs scan", () => {
    const started = performance.now();
    const volumes = Array.from({ length: 10_000 }, (_, i) => brickVolume({
      ...brick, x: (i % 100) * 5, z: Math.floor(i / 100) * 5, tiltX: 32, tiltZ: 17,
    }));
    expect(countBrickOverlaps(volumes)).toBe(0);
    const milliseconds = performance.now() - started;
    console.info(JSON.stringify({ tiltedBrickAnalysis: { count: volumes.length, milliseconds } }));
    // Generous CI ceiling; quadratic scanning of this fixture is far slower.
    expect(milliseconds).toBeLessThan(2000);
  });
});
