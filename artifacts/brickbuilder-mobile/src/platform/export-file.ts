import { Capacitor } from "@capacitor/core";
import { byteChunks, isByteArray, type ByteSource } from "../types/byte-source";

export interface PreparedExport {
  /** Re-open the share sheet for the already-written file or browser Blob. */
  share(): Promise<void>;
}

/** Recognize the Android share sheet's dismissal result, not file-write failures. */
export function isShareCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bshare(?:\s+activity)?\s+cancell?ed\b/i.test(message) ||
    /\bsharing\s+cancell?ed\b/i.test(message);
}

/** Android reports a dismissed chooser as a rejection even when its target saved the file. */
export async function sharePreparedExport(prepared: PreparedExport): Promise<void> {
  try { await prepared.share(); }
  catch (error) { if (!isShareCancelled(error)) throw error; }
}

/** Write an export once and retain a reusable local share target for retries. */
export async function prepareExportFile(bytes: ByteSource, filename: string, mime: string, signal?: AbortSignal): Promise<PreparedExport> {
  signal?.throwIfAborted();
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const name = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "project.json";
    const path = `exports/${crypto.randomUUID()}/${name}`;
    const chunkSize = 192 * 1024; // multiple of 3: concatenate valid base64 chunks
    let pending = new Uint8Array(chunkSize), used = 0, created = false;
    const append = async (chunk: Uint8Array) => {
      let offset = 0;
      while (offset < chunk.length) {
        signal?.throwIfAborted();
        const count = Math.min(chunkSize - used, chunk.length - offset);
        pending.set(chunk.subarray(offset, offset + count), used);
        used += count; offset += count;
        if (used === chunkSize) {
          let binary = "";
          for (let i = 0; i < used; i += 8192) binary += String.fromCharCode(...pending.subarray(i, i + 8192));
          const data = btoa(binary);
          if (!created) {
            created = true;
            await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
          } else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
          used = 0;
        }
      }
    };
    try {
      for await (const chunk of byteChunks(bytes)) await append(chunk);
      signal?.throwIfAborted();
      if (!created || used) {
        let binary = "";
        for (let i = 0; i < used; i += 8192) binary += String.fromCharCode(...pending.subarray(i, Math.min(used, i + 8192)));
        const data = btoa(binary);
        if (!created) {
          created = true;
          await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
        }
        else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
        created = true;
      }
      signal?.throwIfAborted();
    } catch (error) {
      if (created) {
        try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* Keep the original export error. */ }
      }
      throw error;
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    return {
      share: async () => {
        await Share.share({ title: name, files: [uri], dialogTitle: "Projekt speichern oder teilen" });
      },
    };
  }
  let blob: Blob;
  if (isByteArray(bytes)) blob = new Blob([bytes as BlobPart], { type: mime });
  else {
    const iterator = byteChunks(bytes)[Symbol.asyncIterator]();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) { controller.error(error); }
      },
      async cancel() { await iterator.return?.(undefined); },
    });
    blob = await new Response(stream, { headers: { "Content-Type": mime } }).blob();
  }
  return {
    share: async () => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = filename; anchor.click();
      // Large mobile downloads may take longer to start reading the Blob URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}

/** Browser download or Android's document-sharing sheet; no remote upload. */
export async function exportFile(bytes: ByteSource, filename: string, mime: string): Promise<void> {
  const prepared = await prepareExportFile(bytes, filename, mime);
  await prepared.share();
}
