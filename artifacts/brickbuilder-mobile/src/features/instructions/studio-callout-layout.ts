import type { StudioRect } from "./studio-objects";
import type { ProjectedPartBounds } from "./part-projection";

/** Re-anchor a callout to its actual assembly after fitting/mirroring the image. */
export function studioCalloutTarget(
  ids: readonly string[], bounds: ProjectedPartBounds, image: StudioRect, mirrored: boolean,
): [number, number] | undefined {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const id of ids) {
    const box = bounds.get(id);
    if (!box) continue;
    left = Math.min(left, box[0]); top = Math.min(top, box[1]);
    right = Math.max(right, box[0] + box[2]); bottom = Math.max(bottom, box[1] + box[3]);
  }
  if (!Number.isFinite(left)) return undefined;
  const x = (left + right) / 2, y = (top + bottom) / 2;
  return [image[0] + (mirrored ? 1 - x : x) * image[2], image[1] + y * image[3]];
}

/** Studio callout leaders have a right-angle bend, chosen by their box edge. */
export function studioCalloutArrowRoute(points: number[], position: number[]): number[][] {
  const [x1, y1, x2, y2] = points;
  const horizontal = position[0] === 0 || position[0] === 1;
  const elbow = horizontal ? [x2, y1] : [x1, y2];
  return [[x1, y1, ...elbow], [...elbow, x2, y2]]
    .filter(([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay) > 0.001);
}

/** The first pair anchors the arrow to the callout; the second is a slot-sized
 * displacement from that anchor, not another position relative to slot center. */
export function studioCalloutArrowPoints(rect: StudioRect, slot: StudioRect, position: number[]): number[] {
  const [u, v, dx, dy] = position;
  const x = rect[0] + u * rect[2], y = rect[1] + (1 - v) * rect[3];
  return [x, y, x + dx * slot[2], y - dy * slot[3]];
}

/** Studio stores style padding in mm even when the page's length unit is Pixels.
 * Reserve a real font-height heading instead of a fixed six-millimetre strip. */
export function studioCalloutCell(
  rect: StudioRect, padding: [number, number, number, number], index: number,
  columns: number, rows: number, asRows: boolean, numberSize: number,
) {
  const [x, y, width, height] = rect, [left, right, bottom, top] = padding;
  const col = asRows ? index % columns : Math.floor(index / rows);
  const row = asRows ? Math.floor(index / columns) : index % rows;
  const cellWidth = Math.max(1, width - left - right) / columns;
  const cellHeight = Math.max(1, height - top - bottom) / rows;
  const cellX = x + left + col * cellWidth, cellY = y + top + row * cellHeight;
  const headingHeight = numberSize * 25.4 / 72;
  return {
    col, row, cellX, cellY, cellWidth, cellHeight,
    numberX: cellX, numberY: cellY + headingHeight * 0.8,
    imageRect: [cellX, cellY + headingHeight, cellWidth, Math.max(1, cellHeight - headingHeight)] as StudioRect,
  };
}
