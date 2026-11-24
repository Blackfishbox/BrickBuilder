import type { StudioNode } from "./studio-layout";

export type StudioRect = [number, number, number, number];
export const studioVector = (raw: string | undefined, length: number): number[] | undefined => {
  if (!raw?.trim()) return undefined;
  const values = raw.trim().split(/\s+/).map(Number);
  return values.length === length && values.every(Number.isFinite) ? values : undefined;
};
export const studioChildren = (node: StudioNode, nodes: StudioNode[], name: string) =>
  nodes.filter(candidate => candidate.parent === node.id && candidate.name === name);

export function supportedStudioCallout(node: StudioNode, nodes: StudioNode[]): boolean {
  const parent = nodes[node.parent ?? -1];
  if (parent?.name !== "Step" || nodes[parent.parent ?? -1]?.name !== "Slot") return false;
  const items = studioChildren(node, nodes, "CallOutItemData");
  const global = nodes.find(candidate => candidate.name === "CallOut" && nodes[candidate.parent ?? -1]?.name === "GlobalStyle");
  return items.length > 0 && items.every(item => {
    const rect = studioVector(item.attributes.Rect, 4);
    const steps = studioChildren(item, nodes, "CallOutStepItemData");
    const style = item.attributes.IsUseGlobalStyle?.toLowerCase() === "false" ? item : global;
    const arrowStyle = style && studioChildren(style, nodes, "ArrowStyle")[0]?.attributes.Style;
    return !!rect && rect[2] > 0 && rect[3] > 0 && steps.length > 0 &&
      (!arrowStyle || STUDIO_ARROW_HEADS.has(arrowStyle)) &&
      steps.every(entry => {
        const step = studioChildren(entry, nodes, "Step");
        return step.length === 1 && /^\d+$/.test(step[0].attributes.SerializedIndex ?? "") &&
          !studioChildren(step[0], nodes, "CallOut").length;
      }) &&
      studioChildren(item, nodes, "CallOutArrowItemData").every(arrow => !!studioVector(arrow.attributes.ArrowPosition, 4));
  });
}

export const STUDIO_ARROW_HEADS = new Set(["NoHeads", "TriangleFilled", "TriangleEmpty"]);
export function supportedStudioArrow(node: StudioNode, nodes: StudioNode[]): boolean {
  const parent = nodes[node.parent ?? -1];
  const points = studioVector(node.attributes.PointList, 4);
  // Buffer-exchange arrows use model screen space, not page/slot coordinates.
  return ["Page", "Slot"].includes(parent?.name) && !!points &&
    (points[0] !== points[2] || points[1] !== points[3]) &&
    Number(node.attributes.Rotation ?? 0) === 0 &&
    STUDIO_ARROW_HEADS.has(node.attributes.StartStyle ?? "NoHeads") &&
    STUDIO_ARROW_HEADS.has(node.attributes.EndStyle ?? "TriangleFilled");
}

/** Studio's callout rect is normalized around the slot center, with Y upwards. */
export function studioCalloutRect(rect: number[], slot: StudioRect): StudioRect {
  return [slot[0] + (rect[0] + 0.5) * slot[2], slot[1] + (0.5 - rect[1]) * slot[3],
    rect[2] * slot[2], rect[3] * slot[3]];
}

/** Largest free rectangle keeps the model clear of opaque annotations. */
export function studioModelRect(slot: StudioRect, occupied: StudioRect[]): StudioRect {
  let candidates = [slot];
  for (const obstacle of occupied) {
    const next: StudioRect[] = [];
    for (const [x, y, width, height] of candidates) {
      const left = Math.max(x, obstacle[0]), top = Math.max(y, obstacle[1]);
      const right = Math.min(x + width, obstacle[0] + obstacle[2]);
      const bottom = Math.min(y + height, obstacle[1] + obstacle[3]);
      if (left >= right || top >= bottom) { next.push([x, y, width, height]); continue; }
      if (left > x) next.push([x, y, left - x, height]);
      if (right < x + width) next.push([right, y, x + width - right, height]);
      if (top > y) next.push([x, y, width, top - y]);
      if (bottom < y + height) next.push([x, bottom, width, y + height - bottom]);
    }
    candidates = next.sort((a, b) => b[2] * b[3] - a[2] * a[3]).slice(0, 64);
  }
  return candidates[0] ?? slot;
}
