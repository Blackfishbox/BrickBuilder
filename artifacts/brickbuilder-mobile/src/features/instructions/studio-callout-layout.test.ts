import { expect, it } from "vitest";
import { studioCalloutArrowPoints, studioCalloutArrowRoute, studioCalloutTarget, studioCalloutCell } from "./studio-callout-layout";
import { studioCalloutRect, type StudioRect } from "./studio-objects";

it.each([
  [[0.26945, 0.10598, 0.19995, 0.44565], [0, 0.41697, -0.29202, 0]],
  [[0.23192, 0.13115, 0.14282, 0.54126], [0, 0.67263, -0.18478, 0]],
  [[0.22754, 0.18566, 0.25078, 0.61256], [0, 0.59784, -0.12563, 0]],
])("keeps horizontal native arrows horizontal on offset slots", (rect, position) => {
  const slot: StudioRect = [150, 10, 120, 200];
  const box = studioCalloutRect(rect, slot);
  const [x1, y1, x2, y2] = studioCalloutArrowPoints(box, slot, position);
  expect(y2).toBe(y1);
  expect(x1).toBe(box[0]);
  expect(x2).toBeCloseTo(x1 + position[2] * slot[2]);
});

it("preserves vertical displacement and non-left-edge anchors", () => {
  expect(studioCalloutArrowPoints([20, 30, 40, 60], [100, 200, 300, 400],
    [1, 0.25, -0.1, 0.2])).toEqual([60, 75, 30, -5]);
});

it("uses orthogonal leaders with the head on the final nonempty segment", () => {
  expect(studioCalloutArrowRoute([10, 20, 40, 60], [1, 0.5, 0.1, 0.1]))
    .toEqual([[10, 20, 40, 20], [40, 20, 40, 60]]);
  expect(studioCalloutArrowRoute([10, 20, 40, 60], [0.5, 0, 0.1, 0.1]))
    .toEqual([[10, 20, 10, 60], [10, 60, 40, 60]]);
  expect(studioCalloutArrowRoute([10, 20, 40, 20], [1, 0.5, 0.1, 0]))
    .toEqual([[10, 20, 40, 20]]);
});

it("targets the actual assembly after fitting, offsetting and horizontal mirroring", () => {
  const bounds = new Map<string, [number, number, number, number]>([
    ["one", [0.1, 0.2, 0.2, 0.1]], ["two", [0.2, 0.3, 0.2, 0.3]],
  ]);
  expect(studioCalloutTarget(["one", "two"], bounds, [100, 200, 400, 100], false)).toEqual([200, 240]);
  expect(studioCalloutTarget(["one", "two"], bounds, [100, 200, 400, 100], true)).toEqual([400, 240]);
  expect(studioCalloutTarget(["missing"], bounds, [100, 200, 400, 100], true)).toBeUndefined();
});

it("uses millimetre padding and font-sized headings for vertical callouts", () => {
  const rect: StudioRect = [100, 50, 40, 120];
  const first = studioCalloutCell(rect, [3.175, 3.175, 3.175, 3.175], 0, 1, 3, false, 28);
  const last = studioCalloutCell(rect, [3.175, 3.175, 3.175, 3.175], 2, 1, 3, false, 28);
  expect(first.numberX).toBe(103.175);
  expect(first.numberY).toBeCloseTo(53.175 + 28 * 25.4 / 72 * 0.8);
  expect(first.imageRect[1]).toBeGreaterThan(first.numberY);
  expect(last.imageRect[1] + last.imageRect[3]).toBeCloseTo(166.825);
});
