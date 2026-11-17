import { useSyncExternalStore } from "react";
import { builderDatabase } from "@/storage/database";
import manifest from "./manifest.json";
import evidenceManifest from "./color-evidence-manifest.json";
import { getColorEvidenceState, subscribeColorEvidence, updateColorEvidenceState } from "./color-evidence-state";
import type { Inventory, InventoryPreview } from "../inventory/types";
import { MAX_LIST_BYTES } from "../inventory/types";
import { getCatalogState, subscribeCatalog, updateCatalogState as update } from "./state";
import { loadSnapshot } from "./load-snapshot";
export { getCatalogState, installCatalogIndex } from "./state";
export { default as catalogManifest } from "./manifest.json";
export type CatalogSearchResult = { id: string; name: string; mappings: string[][] };
export function useCatalog() {
  return useSyncExternalStore(subscribeCatalog, getCatalogState, getCatalogState);
}
export function useColorEvidence() {
  return useSyncExternalStore(subscribeColorEvidence, getColorEvidenceState, getColorEvidenceState);
}
let evidencePending: Promise<void> | undefined;
export function ensureColorEvidence(): Promise<void> {
  if (getColorEvidenceState().status === "ready") return Promise.resolve();
  if (evidencePending) return evidencePending;
  updateColorEvidenceState({ status: "loading" });
  evidencePending = (async () => {
    const stored = await builderDatabase.catalogSnapshots.get(evidenceManifest.sha256);
    let bytes = stored?.bytes;
    if (!bytes) {
      const response = await fetch(`${import.meta.env.BASE_URL}${evidenceManifest.url}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Farbnachweis: HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    let loaded;
    try {
      if (bytes.length !== evidenceManifest.bytes) throw new Error("Farbnachweisgröße stimmt nicht.");
      loaded = await request({ type: "load-evidence", bytes, sha256: evidenceManifest.sha256 });
      if (loaded.index.version !== evidenceManifest.version || loaded.index.snapshotDate !== evidenceManifest.snapshotDate) {
        throw new Error("Farbnachweisversion stimmt nicht.");
      }
    } catch (error) {
      if (stored) await builderDatabase.catalogSnapshots.delete(evidenceManifest.sha256);
      throw error;
    }
    if (!stored) await builderDatabase.catalogSnapshots.put({ id: evidenceManifest.sha256, bytes });
    updateColorEvidenceState({ status: "ready", index: loaded.index });
  })().catch(error => {
    updateColorEvidenceState({ status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }).finally(() => { evidencePending = undefined; });
  return evidencePending;
}
let worker: Worker | undefined;
let sequence = 0;
const waiting = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
function request(message: Record<string, unknown>): Promise<any> {
  if (!worker) {
    worker = new Worker(new URL("./catalog.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      const task = waiting.get(event.data.id);
      if (!task) return;
      clearTimeout(task.timer); waiting.delete(event.data.id);
      event.data.error ? task.reject(new Error(event.data.error)) : task.resolve(event.data);
    };
    worker.onerror = () => {
      for (const task of waiting.values()) { clearTimeout(task.timer); task.reject(new Error("Katalog-Hintergrundverarbeitung fehlgeschlagen.")); }
      waiting.clear(); worker?.terminate(); worker = undefined;
    };
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("Zeitlimit beim Katalogzugriff.")); }, 45000);
    waiting.set(id, { resolve, reject, timer });
    worker!.postMessage({ id, ...message });
  });
}
let pending: Promise<void> | undefined;
export function ensureCatalog(): Promise<void> {
  if (getCatalogState().status === "ready") return Promise.resolve();
  if (pending) return pending;
  update({ status: "loading" });
  pending = (async () => {
    const loaded = await loadSnapshot({
      url: `${import.meta.env.BASE_URL}${manifest.url}`,
      expectedBytes: manifest.bytes,
      read: async () => (await builderDatabase.catalogSnapshots.get(manifest.sha256))?.bytes,
      remove: () => builderDatabase.catalogSnapshots.delete(manifest.sha256),
      save: async bytes => { await builderDatabase.catalogSnapshots.put({ id: manifest.sha256, bytes }); },
      validate: async bytes => {
        const result = await request({ type: "load", bytes, sha256: manifest.sha256 });
        if (result.version !== manifest.version) throw new Error("Katalogversion stimmt nicht. App und Katalogdatei gemeinsam aktualisieren.");
        return result;
      },
    });
    update({ status: "ready", index: loaded.index });
  })().catch(error => {
    update({ status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }).finally(() => { pending = undefined; });
  return pending;
}
export async function searchFullCatalog(query: string, kind: "parts" | "colors"): Promise<CatalogSearchResult[]> {
  await ensureCatalog();
  return (await request({ type: "search", query, kind })).results;
}
export async function searchBuildingCatalog(query: string, offset = 0, category = ""): Promise<{ results: CatalogSearchResult[]; total: number }> {
  await ensureCatalog();
  const response = await request({ type: "search-page", query, offset, category });
  return { results: response.results, total: response.total };
}
export async function previewInventory(file: File): Promise<InventoryPreview> {
  if (file.size > MAX_LIST_BYTES) throw new Error("Teileliste ist größer als 2 MiB.");
  await ensureCatalog();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  return (await request({ type: "inventory", text, name: file.name })).preview;
}
export async function resolveStoredInventory(inventory: Inventory): Promise<InventoryPreview> {
  await ensureCatalog();
  return (await request({ type: "inventory", inventory })).preview;
}
