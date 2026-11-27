import type { BuilderDocument } from "../editor/model";
import type { InstructionPart } from "./parts";
import { instructionPartImage, type InstructionPartImageSize } from "./part-images";

/** Catalog thumbnails include framing margins; Studio's parts boxes do not. */
export async function studioPartImage(
  document: BuilderDocument, entry: InstructionPart, signal: AbortSignal, size?: InstructionPartImageSize,
): Promise<string> {
  const source = await instructionPartImage(document, entry, signal, true, size);
  signal.throwIfAborted();
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("PDF part image unavailable"));
    image.src = source;
  });
  signal.throwIfAborted();
  const canvas = globalThis.document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PDF part image canvas unavailable");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] < 16) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left || bottom < top ||
      (left === 0 && top === 0 && right === canvas.width - 1 && bottom === canvas.height - 1)) return source;
    // Retain a pixel of antialiasing at each edge.
    left = Math.max(0, left - 1); top = Math.max(0, top - 1);
    const width = Math.min(canvas.width, right + 2) - left;
    const height = Math.min(canvas.height, bottom + 2) - top;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, left, top, width, height, 0, 0, width, height);
    const cropped = context.getImageData(0, 0, width, height);
    canvas.width = width; canvas.height = height;
    context.putImageData(cropped, 0, 0);
    return canvas.toDataURL("image/png");
  } finally { canvas.width = 1; canvas.height = 1; }
}
