import { decodeCatalog, indexCatalog, searchCatalog, searchCatalogPage, type CatalogData } from "./data";
import { parseInventory } from "../inventory/import";
import { resolveInventory } from "./inventory-resolution";
import { gunzipSync } from "fflate";
import { indexColorEvidence } from "./color-evidence";
let data: CatalogData | undefined;
self.onmessage = async (event: MessageEvent) => {
  const { id, type, bytes, sha256, query, kind } = event.data;
  try {
    if (type === "load-evidence") {
      const raw = new Uint8Array(bytes);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)), b => b.toString(16).padStart(2, "0")).join("");
      if (digest !== sha256) throw new Error("Farbnachweis-Prüfsumme stimmt nicht.");
      const length = raw.length >= 18 ? new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(raw.length - 4, true) : 0;
      if (!length || length > 16 * 1024 * 1024) throw new Error("Ungültige Farbnachweisgröße.");
      const unpacked = gunzipSync(raw);
      if (unpacked.length !== length) throw new Error("Unvollständiger Farbnachweis.");
      const index = indexColorEvidence(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(unpacked)));
      self.postMessage({ id, index });
    } else if (type === "load") {
      const raw = new Uint8Array(bytes);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)), b => b.toString(16).padStart(2, "0")).join("");
      if (digest !== sha256) throw new Error("Katalog-Prüfsumme stimmt nicht.");
      const next = decodeCatalog(raw);
      const index = indexCatalog(next);
      data = next;
      self.postMessage({ id, index, version: data.version, attribution: data.attribution });
    } else {
      if (!data) throw new Error("Katalog noch nicht geladen.");
      if (type === "inventory") {
        const inventory = event.data.inventory ?? parseInventory(event.data.text, event.data.name);
        self.postMessage({ id, preview: resolveInventory(data, inventory) });
      } else if (type === "search-page") {
        self.postMessage({ id, ...searchCatalogPage(data, query, "parts", event.data.offset, 40, event.data.category, true) });
      } else self.postMessage({ id, results: searchCatalog(data, query, kind) });
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
