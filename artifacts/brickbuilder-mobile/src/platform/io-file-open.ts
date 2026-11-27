import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

interface IOFilePayload {
  name: string;
  base64: string;
}

interface IOFileOpenPlugin {
  readPendingFile(): Promise<IOFilePayload | null>;
  addListener(event: "fileOpened", listener: () => void): Promise<PluginListenerHandle>;
}

const native = registerPlugin<IOFileOpenPlugin>("IOFileOpen");

export function fileFromNativeIO(payload: IOFilePayload): File {
  if (!payload.name.toLowerCase().endsWith(".io")) throw new Error("Unsupported file type.");
  const chunks: ArrayBuffer[] = [];
  const chunkLength = 64 * 1024;
  for (let offset = 0; offset < payload.base64.length; offset += chunkLength) {
    const binary = atob(payload.base64.slice(offset, offset + chunkLength));
    const chunk = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(chunk);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    chunks.push(chunk);
  }
  return new File(chunks, payload.name, { type: "application/zip" });
}

/** Listen before checking the cold-start intent so neither launch path can be missed. */
export async function watchForOpenedIOFiles(
  onFile: (file: File) => void,
  onError: (error: unknown) => void,
): Promise<PluginListenerHandle | null> {
  if (Capacitor.getPlatform() !== "android") return null;

  let reading = false;
  let requestedAgain = false;
  const readPending = async () => {
    if (reading) {
      requestedAgain = true;
      return;
    }
    reading = true;
    try {
      do {
        requestedAgain = false;
        try {
          const payload = await native.readPendingFile();
          if (payload) onFile(fileFromNativeIO(payload));
        } catch (error) {
          onError(error);
        }
      } while (requestedAgain);
    } finally { reading = false; }
  };

  const listener = await native.addListener("fileOpened", () => void readPending());
  void readPending();
  return listener;
}
