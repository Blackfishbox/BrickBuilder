import { MAX_LIST_BYTES } from "./types";

/** Read Android document-provider files immediately, before loading the catalog. */
export async function readInventoryFile(file: File): Promise<string> {
  if (file.size > MAX_LIST_BYTES) throw new Error("Teileliste ist größer als 2 MiB.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: FileReader | undefined;
  try {
    const bytes = await Promise.race([
      (async () => {
        try {
          return await file.arrayBuffer();
        } catch (error) {
          if (typeof FileReader === "undefined") throw error;
          return await new Promise<ArrayBuffer>((resolve, reject) => {
            reader = new FileReader();
            reader.onload = () => reader!.result instanceof ArrayBuffer
              ? resolve(reader!.result) : reject(new Error("Datei konnte nicht gelesen werden."));
            reader.onerror = () => reject(reader!.error ?? new Error("Dateizugriff verweigert."));
            reader.onabort = () => reject(new Error("Dateizugriff wurde abgebrochen."));
            reader.readAsArrayBuffer(file);
          });
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Die Datei antwortet seit 15 Sekunden nicht. Speichere sie unter Downloads auf dem Gerät und wähle sie erneut aus."));
          reader?.abort();
        }, 15_000);
      }),
    ]);
    if (bytes.byteLength > MAX_LIST_BYTES) throw new Error("Teileliste ist größer als 2 MiB.");
    if (!bytes.byteLength) throw new Error("Die ausgewählte Datei ist leer.");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Die Teileliste ist nicht als UTF-8 lesbar. Exportiere sie erneut als BrickLink-XML oder UTF-8-CSV.");
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
