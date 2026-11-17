import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { gunzipSync } from "fflate";
import { builderDatabase } from "@/storage/database";
import { indexColorEvidence } from "./color-evidence";
import manifest from "./color-evidence-manifest.json";
import { ensureColorEvidence } from "./client";
import { getColorEvidenceState, updateColorEvidenceState } from "./color-evidence-state";

afterEach(async () => {
  updateColorEvidenceState({ status: "idle" });
  await builderDatabase.delete();
  vi.unstubAllGlobals();
});
it("restores the evidence from IndexedDB offline, independently of old catalog snapshots", async () => {
  const bytes = new Uint8Array(readFileSync(`public/${manifest.url}`));
  await builderDatabase.open();
  await builderDatabase.catalogSnapshots.put({ id: manifest.sha256, bytes });
  const fetch = vi.fn(() => { throw new Error("Offline: network forbidden"); });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("Worker", class {
    onmessage?: (event: { data: unknown }) => void;
    postMessage(message: any) {
      expect(message.type).toBe("load-evidence");
      expect(message.sha256).toBe(manifest.sha256);
      const index = indexColorEvidence(JSON.parse(new TextDecoder().decode(gunzipSync(message.bytes))));
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, index } }));
    }
  });
  await ensureColorEvidence();
  expect(getColorEvidenceState()).toMatchObject({ status: "ready", index: { snapshotDate: manifest.snapshotDate } });
  expect(getColorEvidenceState().index?.pairsBySource.setInventories["3023a"]).toContain("4");
  expect(getColorEvidenceState().index?.pairsBySource.elements["3023a"]).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();
  expect(await builderDatabase.catalogSnapshots.count()).toBe(1);
});
