import { Box3, Camera, Vector3 } from "three";

/** Selection-style 3D bounds, projected without allocating a mesh per part. */
export function drawInstructionOutlines(
  context: CanvasRenderingContext2D, camera: Camera, boxes: Iterable<Box3>, width: number, height: number,
): void {
  context.save();
  context.strokeStyle = "#e32620"; context.lineWidth = 2.6; context.globalAlpha = 1;
  for (const box of boxes) {
    const points = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      points.push(new Vector3(x, y, z).project(camera));
    }
    if (points.some(p => !Number.isFinite(p.x) || p.z < -1 || p.z > 1)) continue;
    context.beginPath();
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
      const j = i ^ bit;
      if (j < i) continue;
      context.moveTo((points[i].x + 1) * width / 2, (1 - points[i].y) * height / 2);
      context.lineTo((points[j].x + 1) * width / 2, (1 - points[j].y) * height / 2);
    }
    context.stroke();
  }
  context.restore();
}
