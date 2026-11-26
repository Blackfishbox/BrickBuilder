import type { BuilderDocument } from "../editor/model";
import { compilePart } from "../engine/ldraw-geometry";
import { ThumbnailQueue } from "../parts/thumbnails/queue";
import { renderThumbnail } from "../parts/thumbnails/render";
import { createSoftwareInstructionRenderer } from "./software-render";
import { instructionPartDocument, type InstructionPart } from "./parts";
import { configureStudioEdges } from "./studio-edges";
import { PART_PREVIEW_DIRECTION } from "../parts/thumbnails/camera";

type Input = { document: BuilderDocument; entry: InstructionPart; studio?: boolean };
const sources = new WeakMap<object, number>();
let nextSource = 0;
const legacyKey = {};

// One global image budget, including projects still retained in undo history.
const queue = new ThumbnailQueue<Input>(async ({ document: doc, entry: item, studio }, currentSignal) => {
      currentSignal.throwIfAborted();
      if (item.kind === "imported" && item.part.part.status !== "resolved") {
        throw new Error(`${item.number}: Geometrie fehlt im Projekt.`);
      }
      const isolated = instructionPartDocument(doc, item);
      if (isolated.imported && !compilePart(isolated.imported, item.kind === "imported" ? item.part.reference : "", "16")
        .some(surface => surface.positions.length)) throw new Error(`${item.number}: Keine Flächengeometrie verfügbar.`);
      if (isolated.imported && item.kind === "imported") {
        try { return renderThumbnail(isolated.imported, item.part.colorCode, studio ? configureStudioEdges : undefined); }
        catch { currentSignal.throwIfAborted(); }
      }
      const renderer = await createSoftwareInstructionRenderer(isolated, currentSignal, { width: 240, height: 182, minRadius: 0.01 });
      try {
        currentSignal.throwIfAborted();
        const [x, y, z] = PART_PREVIEW_DIRECTION;
        return renderer.image(new Set([item.part.id]), { id: "part", title: "", notes: "", partIds: [item.part.id],
          ...(studio ? { camera: { theta: Math.atan2(x, z), phi: Math.acos(y / Math.hypot(x, y, z)),
            distance: 1, referenceDistance: 1, target: [0, 0, 0], referenceTarget: [0, 0, 0] } } : {}) },
          undefined, undefined, undefined, undefined, studio ? { studioEdges: true, transparentBackground: true } : undefined);
      } finally { renderer.dispose(); }
}, 4 * 1024 * 1024, 128);

/** One shared thumbnail renderer with a software fallback, never per-card contexts or downloads. */
export function instructionPartImage(document: BuilderDocument, entry: InstructionPart, signal: AbortSignal, studio = false): Promise<string> {
  const source = entry.kind === "imported" ? document.imported?.resources : legacyKey;
  if (!source) return Promise.reject(new Error("Projektgeometrie fehlt."));
  let id = sources.get(source);
  if (id === undefined) { id = nextSource++; sources.set(source, id); }
  return queue.request(`${id}:${entry.key}:${studio}`, { document, entry, studio }, signal);
}
