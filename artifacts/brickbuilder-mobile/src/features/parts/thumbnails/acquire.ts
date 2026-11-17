import { importLDraw } from "../../formats/ldraw/import";
import { requireGeometryPermission } from "../../privacy/geometry-consent";
import { ThumbnailQueue } from "./queue";
import { cachedThumbnailSource } from "./snapshot-source";
import { getImportPartFailures } from "../../formats/import-failures";

// Share one acquisition lane across visible catalog rows, independently of color.
// Results live in IndexedDB, not a second in-memory success cache.
const acquisitions = new ThumbnailQueue<string>(async (ldrawId, signal) => {
  requireGeometryPermission();
  if (!/^[a-z0-9_-]+$/i.test(ldrawId)) throw new Error("Ungültige LDraw-Teilenummer.");
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error("Zeitlimit beim Laden der Vorschaugeometrie.")), 30_000);
  try {
    const bytes = new TextEncoder().encode(`0 Catalog preview\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 ${ldrawId}.dat\n`);
    const document = await importLDraw(bytes, "preview.ldr", "ldr", bytes, {
      signal: controller.signal, online: true, retry: true,
    });
    controller.signal.throwIfAborted();
    if (document.imported?.instances[0]?.part.status !== "resolved") {
      const reasons = document.imported
        ? [...new Set(getImportPartFailures(document.imported).flatMap(failure => failure.reasons))].slice(0, 3).join(" ") : "";
      throw new Error(`Vorschaugeometrie für LDraw ${ldrawId} konnte nicht vollständig geladen werden. ${reasons}`.trim());
    }
    if (!await cachedThumbnailSource(ldrawId)) {
      throw new Error("Vorschaugeometrie konnte nicht offline gespeichert werden. Speicherplatz prüfen und erneut versuchen.");
    }
    return "ready";
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}, 0, 0);

export function acquireThumbnailGeometry(ldrawId: string, signal: AbortSignal) {
  return acquisitions.request(ldrawId, ldrawId, signal);
}
