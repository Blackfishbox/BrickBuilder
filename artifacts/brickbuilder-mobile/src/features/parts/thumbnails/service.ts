import { resolveColor } from "../../formats/colors";
import { getCatalogState } from "../../catalog/state";
import type { LibraryPart } from "../types";
import { ThumbnailQueue } from "./queue";
import { thumbnailModel } from "./model";
import { renderThumbnail } from "./render";

type Input = { part: LibraryPart; revision: string; color: string };
const queue = new ThumbnailQueue<Input>(async ({ part, revision, color }, signal) => {
  const model = await thumbnailModel(part, revision, signal);
  signal.throwIfAborted();
  return renderThumbnail(model, color);
});
const paletteIds = new WeakMap<object, number>();
let nextPaletteId = 0;

export function requestThumbnail(
  part: LibraryPart, revision: string, hex: string, code: string | undefined, signal: AbortSignal,
): Promise<string> {
  const known = code ? resolveColor(code) : undefined;
  const color = known && known.hex.toLowerCase() === hex.toLowerCase() ? code!
    : /^#[a-f0-9]{6}$/i.test(hex) ? `0x2${hex.slice(1)}` : undefined;
  if (!color) return Promise.reject(new Error("Vorschaufarbe nicht verfügbar."));
  // Mapping arrival may resolve previously unknown fixed geometry colors, too.
  const palette = getCatalogState().index;
  if (palette && !paletteIds.has(palette)) paletteIds.set(palette, ++nextPaletteId);
  const key = JSON.stringify([part.id, part.file, revision, color, known?.alpha, palette ? paletteIds.get(palette) : 0, "view-1"]);
  return queue.request(key, { part, revision, color }, signal);
}
