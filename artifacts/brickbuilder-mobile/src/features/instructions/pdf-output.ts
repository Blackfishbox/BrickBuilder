import type { jsPDF } from "jspdf";
import { yieldPdfExecution } from "../../platform/pdf-background";

// jsPDF's public output() joins the complete PDF into a single binary string.
// Besides duplicating memory, this exceeds the engine's string-length limit for
// large manuals. Its SAFE wrapper then swallows the exception and returns void.
// Capture the writer's binary fragments instead; jsPDF still calculates all
// object/xref offsets itself. Keep this private-API adapter covered by real PDFs.
interface PdfWriter {
  setCustomOutputDestination(destination: { push(fragment: string): void }): void;
  resetCustomOutputDestination(): void;
  buildDocument(): string;
}

export function instructionPdfChunks(pdf: jsPDF, signal?: AbortSignal): AsyncIterable<Uint8Array> {
  const writer = (pdf as unknown as { __private__: PdfWriter }).__private__;
  const chunks: (Uint8Array | undefined)[] = [];
  const chunkSize = 1024 * 1024;
  let buffer = new Uint8Array(chunkSize), used = 0, first = true;
  const append = (value: number) => {
    if (used === buffer.length) {
      chunks.push(buffer);
      buffer = new Uint8Array(chunkSize);
      used = 0;
    }
    buffer[used++] = value;
  };
  signal?.throwIfAborted();
  try {
    writer.setCustomOutputDestination({
      push(fragment) {
        signal?.throwIfAborted();
        // Match content.join("\n") exactly, including binary image bytes.
        if (!first) append(10);
        first = false;
        for (let i = 0; i < fragment.length; i++) append(fragment.charCodeAt(i) & 255);
      },
    });
    // With a custom destination, the internal content array stays empty, so its
    // final join is harmless. Call directly so errors cannot become empty PDFs.
    writer.buildDocument();
    if (used) chunks.push(buffer.subarray(0, used));
    if (first) throw new Error("PDF serialization produced no data");
  } finally {
    writer.resetCustomOutputDestination();
  }
  return (async function* () {
    try {
      for (let i = 0; i < chunks.length; i++) {
        signal?.throwIfAborted();
        const chunk = chunks[i]!;
        chunks[i] = undefined;
        yield chunk;
        await yieldPdfExecution();
      }
    } finally {
      chunks.length = 0;
    }
  })();
}
