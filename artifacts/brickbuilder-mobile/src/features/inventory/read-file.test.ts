// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readInventoryFile } from "./read-file";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("reads document-provider files through FileReader when arrayBuffer is unavailable", async () => {
  const file = new File(["<INVENTORY/>"], "parts.xml");
  Object.defineProperty(file, "arrayBuffer", { value: undefined });
  expect(await readInventoryFile(file)).toBe("<INVENTORY/>");
});

it("rejects empty files, invalid UTF-8 and oversized input with useful messages", async () => {
  const file = (bytes: number[]) => ({ size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as File;
  await expect(readInventoryFile(file([]))).rejects.toThrow("leer");
  await expect(readInventoryFile(file([0xff]))).rejects.toThrow("UTF-8");
  await expect(readInventoryFile({ size: 3 * 1024 * 1024 } as File)).rejects.toThrow("2 MiB");
});

it("reports inaccessible documents and bounds a stalled Android file read", async () => {
  const failed = new File(["x"], "parts.xml");
  Object.defineProperty(failed, "arrayBuffer", { value: async () => { throw new Error("NotReadableError"); } });
  vi.stubGlobal("FileReader", class {
    error = new DOMException("Permission denied", "NotReadableError");
    onerror = () => {};
    readAsArrayBuffer() { this.onerror(); }
  });
  await expect(readInventoryFile(failed)).rejects.toThrow("Permission denied");
  vi.useFakeTimers();
  const stalled = readInventoryFile({ size: 12, arrayBuffer: () => new Promise(() => {}) } as unknown as File);
  const result = expect(stalled).rejects.toThrow("Downloads");
  await vi.advanceTimersByTimeAsync(15_000);
  await result;
});
