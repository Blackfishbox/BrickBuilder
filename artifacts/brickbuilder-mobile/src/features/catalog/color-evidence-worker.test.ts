import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import manifest from "./color-evidence-manifest.json";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("verifies the actual offline worker payload and rejects tampering without loading the mapping catalog", async () => {
  const postMessage = vi.fn();
  const scope = { postMessage, onmessage: undefined as any };
  vi.stubGlobal("self", scope);
  await import("./catalog.worker");
  const bytes = new Uint8Array(readFileSync(`public/${manifest.url}`));
  await scope.onmessage({ data: { id: 1, type: "load-evidence", bytes, sha256: manifest.sha256 } });
  expect(postMessage.mock.calls[0][0]).toMatchObject({ id: 1, index: { version: manifest.version } });
  expect(postMessage.mock.calls[0][0].index.parts["3001"]).toHaveLength(1);
  expect(postMessage.mock.calls[0][0].index.pairsBySource.setInventories["3023a"]).toContain("4");
  expect(postMessage.mock.calls[0][0].index.pairsBySource.elements["3023a"]).toBeUndefined();
  bytes[20] ^= 1;
  await scope.onmessage({ data: { id: 2, type: "load-evidence", bytes, sha256: manifest.sha256 } });
  expect(postMessage.mock.calls[1][0]).toMatchObject({ id: 2, error: "Farbnachweis-Prüfsumme stimmt nicht." });
  await scope.onmessage({ data: { id: 3, type: "search", kind: "parts", query: "3001" } });
  expect(postMessage.mock.calls[2][0]).toMatchObject({ id: 3, error: "Katalog noch nicht geladen." });
});
