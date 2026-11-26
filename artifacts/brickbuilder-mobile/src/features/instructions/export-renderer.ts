import type { BuilderDocument } from "../editor/model";
import { yieldPdfExecution } from "../../platform/pdf-background";
import { createInstructionRenderer, type InstructionImageRenderer } from "./render";

type RendererFactory = typeof createInstructionRenderer;
const MAX_CONTEXT_RECOVERIES = 2;

/**
 * Retry only the interrupted image, keeping the PDF and its completed pages.
 * A context is replaced only after a real loss, never for every page.
 */
export async function createExportInstructionRenderer(
  document: BuilderDocument, signal?: AbortSignal, createRenderer: RendererFactory = createInstructionRenderer,
): Promise<InstructionImageRenderer> {
  let current = await createRenderer(document, signal);
  let recoveries = 0;
  let disposed = false;
  return {
    image(...args) { return current.image(...args); },
    async imageAsync(...args) {
      for (;;) {
        signal?.throwIfAborted();
        if (disposed) throw new Error("PDF renderer disposed");
        try {
          return current.image(...args);
        } catch (error) {
          signal?.throwIfAborted();
          if (!error || typeof error !== "object" || !("code" in error) ||
            error.code !== "PDF_WEBGL_CONTEXT_LOST" || recoveries >= MAX_CONTEXT_RECOVERIES) throw error;
          recoveries++;
          current.dispose();
          // Let the browser release the lost context before requesting another.
          await yieldPdfExecution();
          signal?.throwIfAborted();
          // A large model must not fall through to a lossy or budget-limited
          // software renderer after it has already rendered successfully.
          current = await createRenderer(document, signal, { requireWebGL: true });
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      current.dispose();
    },
  };
}
