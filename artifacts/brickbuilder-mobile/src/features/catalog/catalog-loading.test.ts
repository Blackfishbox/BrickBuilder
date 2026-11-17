import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { builderDatabase, saveProject, loadCurrentProject } from "@/storage/database";
import { createEmptyDocument } from "@/features/editor/model";
import { ensureCatalog, previewInventory, resolveStoredInventory, installCatalogIndex } from "./client";
import manifest from "./manifest.json";
import evidence from "./color-evidence-manifest.json";

// CI downloads this approved input before running regressions. Never fetch live data.
const path = new URL("../../../../../generated-artifacts/android-inputs/catalog.bin", import.meta.url);
describe.skipIf(!existsSync(path))("approved catalog through client, worker and IndexedDB", () => {
  let workerScope: { onmessage: (event: { data: unknown }) => Promise<void>; postMessage: (data: unknown) => void };
  beforeAll(async () => {
    workerScope = { onmessage: async () => {}, postMessage: () => {} };
    vi.stubGlobal("self", workerScope);
    await import("./catalog.worker");
    // Only replace the browser thread boundary; execute the actual worker handler.
    vi.stubGlobal("Worker", class {
      onmessage = (_event: { data: unknown }) => {};
      onerror = () => {};
      constructor() { workerScope.postMessage = data => this.onmessage({ data }); }
      postMessage(data: unknown) { void workerScope.onmessage({ data }); }
      terminate() {}
    });
  });
  afterAll(() => { vi.unstubAllGlobals(); installCatalogIndex(); });
  it("imports exact XML quantities/colors, reopens offline and preserves data on failed repair", async () => {
    const bytes = new Uint8Array(readFileSync(path));
    const fetcher = vi.fn(async () => new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    await builderDatabase.catalogSnapshots.put({ id: manifest.sha256, bytes: new Uint8Array([0]) });
    await builderDatabase.catalogSnapshots.put({ id: evidence.sha256, bytes: new Uint8Array([9]) });
    const xml = `<INVENTORY>
      <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR><QTY>2</QTY></ITEM>
      <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR><QTY>3</QTY></ITEM>
      <ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>3002</ITEMID><COLOR>3</COLOR><QTY>4</QTY></ITEM>
    </INVENTORY>`;
    const preview = await previewInventory(new File([xml], "synthetic.xml"));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/${manifest.url}`, expect.objectContaining({ cache: "no-store" }));
    expect(preview.inventory.rows.map(r => [r.partId, r.colorId, r.quantity])).toEqual([
      ["3001", "5", 5], ["3002", "3", 4],
    ]);
    for (const row of preview.inventory.rows) {
      expect(preview.resolutions[row.id].parts).toContainEqual(expect.objectContaining({ ldrawId: row.partId }));
      expect(preview.resolutions[row.id].colors).toContainEqual(expect.objectContaining({
        ldrawCode: row.colorId === "5" ? "4" : "14",
      }));
    }
    const document = { ...createEmptyDocument(), inventory: preview.inventory };
    await saveProject(document);
    installCatalogIndex();
    builderDatabase.close();
    await builderDatabase.open();
    fetcher.mockRejectedValue(new TypeError("offline"));
    const reopened = await loadCurrentProject();
    const offline = await resolveStoredInventory(reopened!.inventory!);
    expect(offline).toEqual(preview);
    expect(fetcher).toHaveBeenCalledOnce();
    // A later corrupt catalog and failed connection cannot remove the inventory or evidence.
    installCatalogIndex();
    await builderDatabase.catalogSnapshots.put({ id: manifest.sha256, bytes: new Uint8Array([1]) });
    await expect(ensureCatalog()).rejects.toThrow("offline");
    expect((await loadCurrentProject())!.inventory).toEqual(preview.inventory);
    expect(await builderDatabase.catalogSnapshots.get(evidence.sha256)).toMatchObject({ bytes: new Uint8Array([9]) });
    fetcher.mockResolvedValue(new Response(bytes));
    await ensureCatalog();
    expect((await resolveStoredInventory(preview.inventory)).resolutions).toEqual(preview.resolutions);
  });
});
