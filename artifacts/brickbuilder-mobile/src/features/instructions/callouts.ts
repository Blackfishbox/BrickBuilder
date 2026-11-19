import type { BuilderDocument } from "../editor/model";
import { reuseGeometryCache } from "../engine/ldraw-geometry";
import { ThumbnailQueue } from "../parts/thumbnails/queue";
import { createSoftwareInstructionRenderer } from "./software-render";
import type { InstructionCallout, InstructionStep } from "./types";

type CalloutImageInput = { document: BuilderDocument; callout: InstructionCallout };
const documentIds = new WeakMap<BuilderDocument, number>();
let nextDocumentId = 0;

function prefixMatches(path: number[] | undefined, prefix: number[]) {
  return !!path && path.length >= prefix.length && prefix.every((part, index) => path[index] === part);
}

export function instructionCalloutPartIds(document: BuilderDocument, callout: InstructionCallout): string[] {
  return (document.imported?.instances ?? [])
    .filter(part => prefixMatches(part.sourceOccurrence, callout.occurrence))
    .map(part => part.id);
}

export function instructionHighlightIds(document: BuilderDocument, step: InstructionStep): Set<string> {
  const ids = new Set(step.partIds);
  for (const callout of step.callouts ?? []) {
    instructionCalloutPartIds(document, callout).forEach(id => ids.add(id));
  }
  return ids;
}

function calloutDocument(document: BuilderDocument, ids: string[]): BuilderDocument {
  const selected = new Set(ids);
  const imported = document.imported
    ? { ...document.imported, instances: document.imported.instances.filter(part => selected.has(part.id)) }
    : undefined;
  if (document.imported && imported) reuseGeometryCache(document.imported, imported);
  return {
    ...document,
    instructions: undefined,
    bricks: document.bricks.filter(part => selected.has(part.id)),
    ...(imported ? { imported } : { imported: undefined }),
  };
}

const imageQueue = new ThumbnailQueue<CalloutImageInput>(async ({ document, callout }, signal) => {
  signal.throwIfAborted();
  const ids = instructionCalloutPartIds(document, callout);
  if (!ids.length) throw new Error("Die Baugruppe enthält keine Teile mehr.");
  const isolated = calloutDocument(document, ids);
  const renderer = await createSoftwareInstructionRenderer(isolated, signal, {
    width: 480, height: 360, minRadius: 0.01,
  });
  try {
    signal.throwIfAborted();
    return renderer.image(new Set(ids), {
      id: callout.id, title: callout.title, notes: "", partIds: ids,
    });
  } finally { renderer.dispose(); }
}, 4 * 1024 * 1024, 80);

/** Render an occurrence-specific subassembly preview through the bounded software thumbnail queue. */
export function instructionCalloutImage(
  document: BuilderDocument, callout: InstructionCallout, signal: AbortSignal,
): Promise<string> {
  let sourceId = documentIds.get(document);
  if (sourceId === undefined) { sourceId = nextDocumentId++; documentIds.set(document, sourceId); }
  return imageQueue.request(`${sourceId}:${callout.id}`, { document, callout }, signal);
}
