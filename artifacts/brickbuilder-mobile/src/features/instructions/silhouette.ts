/**
 * Trace the rendered part silhouette, not its enclosing construction box.
 * The source is an opaque part mask on a transparent background.
 */
export function drawHighlightSilhouette(
  target: CanvasRenderingContext2D, mask: CanvasImageSource, width: number, height: number,
): void {
  const outline = document.createElement("canvas");
  outline.width = width; outline.height = height;
  try {
    const context = outline.getContext("2d");
    if (!context) throw new Error("PDF silhouette canvas unavailable");
    const stroke = Math.max(1, width / 450);
    context.filter = `drop-shadow(${stroke}px 0 0 #f00000) drop-shadow(${-stroke}px 0 0 #f00000) drop-shadow(0 ${stroke}px 0 #f00000) drop-shadow(0 ${-stroke}px 0 #f00000)`;
    context.drawImage(mask, 0, 0);
    context.filter = "none";
    context.globalCompositeOperation = "destination-out";
    context.drawImage(mask, 0, 0);
    target.drawImage(outline, 0, 0);
  } finally { outline.width = 1; outline.height = 1; }
}
