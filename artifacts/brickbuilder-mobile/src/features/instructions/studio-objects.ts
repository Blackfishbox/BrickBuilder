import type { StudioNode } from "./studio-layout";
import { Euler, OrthographicCamera, Quaternion, Vector3 } from "three";

export type StudioRect = [number, number, number, number];
export interface StudioModelArrow {
  points: [[number, number, number], [number, number, number]];
  startStyle: string;
  endStyle: string;
  thickness: number;
  color: string;
}
export function studioModelArrowPoints(
  arrows: readonly StudioModelArrow[], center: Vector3, rotation: readonly [number, number, number],
): Vector3[] {
  const euler = new Euler(...rotation.map(angle => angle * Math.PI / 180) as [number, number, number]);
  return arrows.flatMap(arrow => arrow.points.map(point =>
    new Vector3(...point).sub(center).applyEuler(euler)));
}

export function drawStudioModelArrows(
  context: CanvasRenderingContext2D, camera: OrthographicCamera, arrows: readonly StudioModelArrow[],
  center: Vector3, rotation: readonly [number, number, number], width: number, height: number,
): void {
  const projected = studioModelArrowPoints(arrows, center, rotation).map(point => point.project(camera));
  const scale = Math.max(width, height) / 2000;
  for (let index = 0; index < arrows.length; index++) {
    const arrow = arrows[index], first = projected[index * 2], last = projected[index * 2 + 1];
    const x1 = (first.x + 1) * width / 2, y1 = (1 - first.y) * height / 2;
    const x2 = (last.x + 1) * width / 2, y2 = (1 - last.y) * height / 2;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < 0.001 || ![x1, y1, x2, y2].every(Number.isFinite)) continue;
    const color = arrow.color.trim().split(/[:\s]+/).map(Number);
    const validColor = [3, 4].includes(color.length) &&
      color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 1);
    const rgba = validColor
      ? `rgb(${color.slice(0, 3).map(channel => Math.round(channel * 255)).join(",")})`
      : "#000000";
    const thickness = Number.isFinite(arrow.thickness) && arrow.thickness >= 0 ? arrow.thickness : 2;
    const lineWidth = Math.max(0.75, thickness * scale);
    const headSize = Math.min(length * 0.3, Math.max(2 * scale, lineWidth * 4));
    const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
    const startInset = arrow.startStyle === "NoHeads" ? 0 : headSize;
    const endInset = arrow.endStyle === "NoHeads" ? 0 : headSize;
    context.save();
    context.globalAlpha = validColor ? color[3] ?? 1 : 1;
    context.strokeStyle = rgba; context.fillStyle = rgba; context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(x1 + ux * startInset, y1 + uy * startInset);
    context.lineTo(x2 - ux * endInset, y2 - uy * endInset);
    context.stroke();
    const head = (x: number, y: number, dx: number, dy: number, style: string) => {
      if (style === "NoHeads") return;
      const directionX = dx / length, directionY = dy / length;
      const baseX = x - directionX * headSize, baseY = y - directionY * headSize;
      const side = headSize * 0.45;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(baseX - directionY * side, baseY + directionX * side);
      context.lineTo(baseX + directionY * side, baseY - directionX * side);
      context.closePath();
      if (style === "TriangleFilled") context.fill();
      else context.stroke();
    };
    head(x1, y1, x1 - x2, y1 - y2, arrow.startStyle);
    head(x2, y2, x2 - x1, y2 - y1, arrow.endStyle);
    context.restore();
  }
}
export const studioVector = (raw: string | undefined, length: number): number[] | undefined => {
  if (!raw?.trim()) return undefined;
  const values = raw.trim().split(/\s+/).map(Number);
  return values.length === length && values.every(Number.isFinite) ? values : undefined;
};
export const studioChildren = (node: StudioNode, nodes: StudioNode[], name: string) =>
  nodes.filter(candidate => candidate.parent === node.id && candidate.name === name);

/** Page/slot arrows use centered source units with Y upwards, not top-left coordinates. */
export function studioPageArrowPoints(points: number[], slot: StudioRect, scale: number): number[] {
  return points.map((value, index) => index % 2
    ? slot[1] + slot[3] / 2 - value * scale
    : slot[0] + slot[2] / 2 + value * scale);
}

/** Text anchors are normalized; their stored box dimensions remain millimeters. */
export function studioTextRect(rect: number[], slot: StudioRect): StudioRect {
  return [slot[0] + (0.5 + rect[0]) * slot[2], slot[1] + (0.5 - rect[1]) * slot[3] - rect[3],
    rect[2], rect[3]];
}

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
  const item = parent?.name === "BufferExchangeItemData" ? parent : undefined;
  const buffer = item && nodes[item.parent ?? -1];
  const points = studioVector(node.attributes.PointList, 4);
  // Buffer-exchange arrows use model screen space, not page/slot coordinates.
  const hasValidParent = ["Page", "Slot"].includes(parent?.name ?? "") ||
    (!!item && buffer?.name === "BufferExchange" &&
      nodes[buffer.parent ?? -1]?.name === "Step");
  return hasValidParent && !!points &&
    (points[0] !== points[2] || points[1] !== points[3]) &&
    Number(node.attributes.Rotation ?? 0) === 0 &&
    STUDIO_ARROW_HEADS.has(node.attributes.StartStyle ?? "NoHeads") &&
    STUDIO_ARROW_HEADS.has(node.attributes.EndStyle ?? "TriangleFilled");
}

/**
 * Native buffer-exchange points are stored in the source model camera's screen
 * plane. Convert them back to model coordinates so the renderer can project
 * them using the same (possibly auto-fitted) camera as the parts.
 */
export function studioBufferExchangeArrows(step: StudioNode, nodes: StudioNode[]): StudioModelArrow[] {
  const preview = studioChildren(step, nodes, "StepPreview")[0];
  const modelAngle = studioVector(preview?.attributes.modelAngle ??
    preview?.attributes.DefaultCameraControlInfo_modelAngle, 3) ?? [0, 0, 0];
  const cameraAngle = studioVector(preview?.attributes.cameraAngle ??
    preview?.attributes.DefaultCameraControlInfo_cameraAngle, 2) ?? [-Math.PI / 6, Math.PI / 4];
  const target = studioVector(preview?.attributes.TargetPos ??
    preview?.attributes.DefaultCameraControlInfo_TargetPos, 3) ?? [0, 0, 0];
  // Studio orbits can cross either pole; clamping flips underside views and arrows.
  const phi = Math.PI / 2 + cameraAngle[0];
  const camera = new OrthographicCamera();
  camera.position.set(Math.sin(phi) * Math.sin(Math.PI - cameraAngle[1]), Math.cos(phi),
    Math.sin(phi) * Math.cos(Math.PI - cameraAngle[1]));
  camera.up.set(-Math.cos(phi) * Math.sin(Math.PI - cameraAngle[1]), Math.sin(phi),
    -Math.cos(phi) * Math.cos(Math.PI - cameraAngle[1]));
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const inverseModelRotation = new Quaternion().setFromEuler(new Euler(...modelAngle as [number, number, number])).invert();
  const cameraToModel = camera.quaternion.clone().premultiply(inverseModelRotation);
  const toModel = (x: number, y: number, displacement: number[]): [number, number, number] =>
    new Vector3(x, -y, 0).applyQuaternion(cameraToModel).add(new Vector3(...target))
      // Studio's scene has reversed Z relative to LDraw; our renderer also
      // reverses LDraw Y and uses studs instead of LDU (20 LDU per stud).
      .add(new Vector3(...displacement)).multiply(new Vector3(1 / 20, -1 / 20, -1 / 20))
      .toArray() as [number, number, number];
  const displacementOf = (item: StudioNode): number[] => {
    const value = Object.entries(item.attributes).find(([name]) =>
      /^(?:displacement|offset|translation|positionoffset)$/i.test(name))?.[1];
    const vector = studioVector(value, 3);
    if (vector) return vector;
    const axes = ["x", "y", "z"].map(axis => {
      const raw = item.attributes[`Displacement${axis.toUpperCase()}`] ??
        item.attributes[`Offset${axis.toUpperCase()}`] ??
        item.attributes[axis] ?? item.attributes[axis.toUpperCase()];
      return raw === undefined ? NaN : Number(raw);
    });
    if (axes.every(Number.isFinite)) return axes;
    const child = nodes.find(candidate => candidate.parent === item.id &&
      /^(?:Displacement|Offset|Translation)$/i.test(candidate.name));
    if (child) {
      const childVector = Object.values(child.attributes).map(Number);
      if (childVector.length === 3 && childVector.every(Number.isFinite)) return childVector;
      const childAxes = ["x", "y", "z"].map(axis =>
        Number(child.attributes[axis] ?? child.attributes[axis.toUpperCase()]));
      if (childAxes.every(Number.isFinite)) return childAxes;
    }
    return [0, 0, 0];
  };
  const result: StudioModelArrow[] = [];
  for (const buffer of studioChildren(step, nodes, "BufferExchange")) {
    for (const item of studioChildren(buffer, nodes, "BufferExchangeItemData")) {
      if (item.attributes.showArrow?.toLowerCase() === "false") continue;
      const displacement = displacementOf(item);
      for (const arrow of studioChildren(item, nodes, "Arrow")) {
        if (!supportedStudioArrow(arrow, nodes) || arrow.attributes.IsVisible?.toLowerCase() === "false") continue;
        const points = studioVector(arrow.attributes.PointList, 4);
        if (!points) continue;
        result.push({
          points: [toModel(points[0], points[1], displacement), toModel(points[2], points[3], displacement)],
          startStyle: arrow.attributes.StartStyle ?? "NoHeads",
          endStyle: arrow.attributes.EndStyle ?? "TriangleFilled",
          thickness: Number(arrow.attributes.Thickness ?? 2),
          color: arrow.attributes.Color ?? "0 0 0",
        });
      }
    }
  }
  return result;
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
