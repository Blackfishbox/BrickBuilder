import type { StudioRect } from "./studio-objects";

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
