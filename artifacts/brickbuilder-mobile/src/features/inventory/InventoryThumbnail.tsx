import { useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { ImageOff, LoaderCircle, RefreshCw } from "lucide-react";
import { builderDatabase } from "@/storage/database";
import PartThumbnail from "../parts/PartThumbnail";
import type { LibraryPart } from "../parts/types";
import { cachedThumbnailSource } from "../parts/thumbnails/snapshot-source";
import { observeThumbnail } from "../parts/thumbnails/visibility";

type LocalPart = { ldrawId: string; part?: LibraryPart; revision?: string; error?: string };

/** Inventory stays local-only; catalog search explicitly opts into visible-row acquisition. */
export default function InventoryThumbnail({ ldrawId, color, colorCode, acquireMissing = false }: {
  ldrawId: string; color: string; colorCode: string; acquireMissing?: boolean;
}) {
  const [local, setLocal] = useState<LocalPart>();
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [retry, setRetry] = useState(0);
  const [download, setDownload] = useState<{ id: string; error?: string }>();
  useEffect(() => acquireMissing && host.current ? observeThumbnail(host.current, setVisible) : undefined, [acquireMissing]);
  useEffect(() => {
    if (acquireMissing && !visible && typeof IntersectionObserver !== "undefined") return;
    const subscription = liveQuery(async (): Promise<LocalPart> => {
      const parts = await builderDatabase.libraryParts.where("ldrawId").equals(ldrawId).toArray();
      for (const part of parts) {
        const pkg = await builderDatabase.partPackages.get(part.packageId);
        if (pkg) return { ldrawId, part, revision: `${pkg.version}:${pkg.sha256}` };
      }
      const cached = await cachedThumbnailSource(ldrawId);
      if (cached) return { ldrawId, ...cached };
      return { ldrawId, error: "Keine lokal installierte Vorschaugeometrie verfügbar." };
    }).subscribe({
      next: setLocal,
      error: () => setLocal({ ldrawId, error: "Lokale Vorschaugeometrie konnte nicht gelesen werden." }),
    });
    return () => subscription.unsubscribe();
  }, [ldrawId, acquireMissing, visible]);
  const current = local?.ldrawId === ldrawId ? local : undefined;
  useEffect(() => {
    if (!acquireMissing || !visible || !current?.error) return;
    const controller = new AbortController();
    setDownload({ id: ldrawId });
    void import("../parts/thumbnails/acquire").then(module => {
      controller.signal.throwIfAborted();
      return module.acquireThumbnailGeometry(ldrawId, controller.signal);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setDownload({
        id: ldrawId, error: error instanceof Error ? error.message : "Vorschaugeometrie konnte nicht geladen werden.",
      });
    });
    return () => controller.abort();
  }, [acquireMissing, visible, ldrawId, current?.error, retry]);
  const downloadError = download?.id === ldrawId ? download.error : undefined;
  const acquiring = acquireMissing && visible && Boolean(current?.error) && !downloadError;
  if (current?.part && current.revision) {
    return <span ref={host} className="plib-thumbnail-host">
      <PartThumbnail part={current.part} revision={current.revision} color={color} colorCode={colorCode} />
    </span>;
  }
  const label = acquiring ? "Vorschaugeometrie wird geladen" : current?.error ? "Vorschau nicht verfügbar" : "Vorschau wird geladen";
  return <span ref={host} className="plib-thumbnail-host">
    <span className="plib-thumbnail" role="img" aria-label={downloadError ?? label} title={downloadError ?? current?.error ?? label}>
    {current?.error && !acquiring ? <ImageOff size={18} aria-hidden="true" />
      : <LoaderCircle size={18} className="spin" aria-hidden="true" />}
    </span>
    {acquireMissing && downloadError && <button type="button" className="plib-preview-retry"
      aria-label={`Vorschau für LDraw ${ldrawId} erneut laden`} title={downloadError}
      onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} /></button>}
  </span>;
}
