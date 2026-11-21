import { describe, expect, it } from "vitest";
import { rotationAnchors } from "./rotation-anchors";

describe("evidence-backed rotation anchors", () => {
  it("offers the documented grip and arm centers on the curved minifig hand", () => {
    const anchors = rotationAnchors("3820.dat");
    expect(anchors.map(anchor => anchor.position)).toEqual(expect.arrayContaining([
      [0, -0.82275, -9.8951],
      [0, -0.0005, -9.6816],
    ]));
    expect(anchors.every(anchor => anchor.evidencePath && anchor.evidenceLine > 0)).toBe(true);
  });

  it("does not infer anchors for a part with no matching Shadow Library evidence", () => {
    expect(rotationAnchors("test.dat")).toEqual([]);
  });
});
