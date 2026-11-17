import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { ImageOff, LoaderCircle } from "lucide-react";
import { builderDatabase } from "@/storage/database";
import PartThumbnail from "../parts/PartThumbnail";
import type { LibraryPart } from "../parts/types";
import { cachedThumbnailSource } from "../parts/thumbnails/snapshot-source";

type LocalPart = { ldrawId: string; part?: LibraryPart; revision?: string; error?: string };

/** Preview only installed geometry; never acquire a package or resolve online. */
export default function InventoryThumbnail({ ldrawId, color, colorCode }: {
  ldrawId: string; color: string; colorCode: string;
}) {
  const [local, setLocal] = useState<LocalPart>();
  useEffect(() => {
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
  }, [ldrawId]);
  const current = local?.ldrawId === ldrawId ? local : undefined;
  if (current?.part && current.revision) {
    return <PartThumbnail part={current.part} revision={current.revision} color={color} colorCode={colorCode} />;
  }
  const label = current?.error ? "Vorschau nicht verfügbar" : "Vorschau wird geladen";
  return <span className="plib-thumbnail" role="img" aria-label={label} title={current?.error ?? label}>
    {current?.error ? <ImageOff size={18} aria-hidden="true" />
      : <LoaderCircle size={18} className="spin" aria-hidden="true" />}
  </span>;
}
