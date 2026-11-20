import { Capacitor } from "@capacitor/core";
import { byteChunks, isByteArray, type ByteSource } from "../types/byte-source";

/** Browser download or Android's document-sharing sheet; no remote upload. */
export async function exportFile(bytes: ByteSource, filename: string, mime: string): Promise<void> {
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
    } catch (error) {
      if (created) {
        try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* Keep the original export error. */ }
      }
      throw error;
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: name, files: [uri], dialogTitle: "Projekt speichern oder teilen" });
    return;
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
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
