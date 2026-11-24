import { GState, type jsPDF } from "jspdf";

export function drawStudioArrow(
  pdf: jsPDF, points: number[], start: string, end: string,
  thickness: number, rawColor: string, scale: number,
): void {
  const [x1, y1, x2, y2] = points;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 0.001) return;
  const color = rawColor.trim().split(/[:\s]+/).map(Number);
  const valid = [3, 4].includes(color.length) && color.every(value => Number.isFinite(value) && value >= 0 && value <= 1);
  const rgb = (valid ? color.slice(0, 3).map(value => Math.round(value * 255)) : [0, 0, 0]) as [number, number, number];
  const width = Number.isFinite(thickness) && thickness >= 0 ? thickness * scale : 0.4;
  pdf.saveGraphicsState();
  pdf.setDrawColor(...rgb); pdf.setFillColor(...rgb);
  pdf.setLineWidth(width);
  if (valid && color.length === 4) pdf.setGState(new GState({ opacity: color[3], "stroke-opacity": color[3] }));
  const size = Math.min(length * 0.3, Math.max(2, width * 4));
  const ux = (x2 - x1) / length, uy = (y2 - y1) / length;
  const startInset = start === "NoHeads" ? 0 : size;
  const endInset = end === "NoHeads" ? 0 : size;
  pdf.line(x1 + ux * startInset, y1 + uy * startInset, x2 - ux * endInset, y2 - uy * endInset);
  const head = (x: number, y: number, dx: number, dy: number, style: string) => {
    if (style === "NoHeads") return;
    const ux = dx / length, uy = dy / length;
    pdf.triangle(x, y, x - ux * size - uy * size * 0.45, y - uy * size + ux * size * 0.45,
      x - ux * size + uy * size * 0.45, y - uy * size - ux * size * 0.45,
      style === "TriangleFilled" ? "FD" : "D");
  };
  head(x1, y1, x1 - x2, y1 - y2, start);
  head(x2, y2, x2 - x1, y2 - y1, end);
  pdf.restoreGraphicsState();
}
