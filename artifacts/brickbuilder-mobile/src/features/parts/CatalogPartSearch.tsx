import { useEffect, useState } from "react";
import { AlertTriangle, Download, Search } from "lucide-react";
import { searchBuildingCatalog, type CatalogSearchResult } from "../catalog/client";
import InventoryThumbnail from "../inventory/InventoryThumbnail";
import type { LibraryPart } from "./types";

export function incomingLDrawIds(row: CatalogSearchResult): string[] {
  return [...new Set(row.mappings.filter(mapping => mapping[1] === "LD" && mapping[4] === "True")
    .map(mapping => mapping[2].toLowerCase().replace(/\.dat$/i, ""))
    .filter(id => /^[a-z0-9_-]+$/.test(id)))];
}

type Props = {
  query: string; category: string; installedIds: ReadonlySet<string>;
  color: string; colorCode: string; loading: boolean; onSelect(part: LibraryPart): void;
};

export default function CatalogPartSearch({ query, category, installedIds, color, colorCode, loading, onSelect }: Props) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; rows?: CatalogSearchResult[]; total?: number; error?: string }>();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const term = query.trim();
  const key = JSON.stringify([term, category, page, retry]);
  useEffect(() => { setPage(0); setChoices({}); }, [term, category]);
  useEffect(() => {
    if (term.length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void searchBuildingCatalog(term, page * 40, category).then(result => {
        if (active) setState({ key, rows: result.results, total: result.total });
      }).catch((error: unknown) => {
        if (active) setState({ key, error: error instanceof Error ? error.message : "Katalogsuche fehlgeschlagen." });
      });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [key, term, category, page]);
  if (term.length < 2) return <p className="plib-catalog-note">Ab zwei Zeichen werden auch nicht mitgelieferte Teile im Gesamtkatalog gesucht.</p>;
  const current = state?.key === key ? state : undefined;
  return <section className="plib-catalog-search" aria-label="Gesamtkatalog-Treffer" aria-busy={!current}>
    <h4><Search size={16} /> Gesamtkatalog {current?.total !== undefined && `· ${current.total} Treffer`}</h4>
    <p className="plib-catalog-note">Gespeicherter Katalog, keine Live-Abfrage bei BrickLink. Geometrie wird erst beim Auswählen lokal geprüft und bei Bedarf nachgeladen; die Download-Freigabe bleibt erforderlich.</p>
    {!current ? <p role="status">Gesamtkatalog wird durchsucht …</p> : current.error ? <div className="plib-alert" role="alert">
      <AlertTriangle size={16} /><span>{current.error} Lokale Treffer bleiben nutzbar.</span>
      <button type="button" onClick={() => setRetry(value => value + 1)}>Erneut</button>
    </div> : <>
      {!current.rows?.length && <p>Keine weiteren Katalogtreffer.</p>}
      <ul className="plib-catalog-rows">
        {current.rows?.map(row => {
          const ids = incomingLDrawIds(row);
          const chosen = ids.length === 1 ? ids[0] : ids.includes(choices[row.id]) ? choices[row.id] : "";
          const brickLinkIds = [...new Set(row.mappings.filter(mapping => mapping[1] === "BL" && mapping[3] === "True").map(mapping => mapping[2]))];
          const local = Boolean(chosen && installedIds.has(chosen));
          return <li key={row.id} className="plib-catalog-row">
            <div className="plib-catalog-row-head">
              {chosen && <InventoryThumbnail ldrawId={chosen} color={color} colorCode={colorCode} />}
              <div className="drawer-piece-copy">
                <strong>{row.name}</strong>
                <small>Rebrickable {row.id}{brickLinkIds.length ? ` · BrickLink ${brickLinkIds.join(", ")}` : " · BrickLink-Zuordnung nicht bestätigt"}</small>
                <small>{chosen ? `LDraw ${chosen} · ${local ? "Offline installiert" : "Nicht als Teilepaket installiert"}` : "Keine eindeutige LDraw-Auswahl"}</small>
              </div>
            </div>
            {ids.length > 1 && <label>LDraw-Variante wählen
              <select aria-label={`LDraw-Variante für ${row.id}`} value={chosen}
                onChange={event => setChoices(values => ({ ...values, [row.id]: event.target.value }))}>
                <option value="">Bitte auswählen …</option>
                {ids.map(id => <option key={id} value={id}>{id}{installedIds.has(id) ? " · offline installiert" : ""}</option>)}
              </select>
            </label>}
            {!ids.length && <small>Keine verwendbare LDraw-Zuordnung im Datenstand; nicht platzierbar.</small>}
            <button type="button" disabled={loading || !chosen} data-testid={`button-catalog-build-${row.id}`}
              onClick={() => onSelect({
                id: `catalog:${row.id}:${chosen}`, packageId: "catalog", ldrawId: chosen,
                file: `parts/${chosen}.dat`, name: row.name, category: category || "Gesamtkatalog", keywords: [],
                ...(brickLinkIds.length === 1 ? { brickLinkId: brickLinkIds[0] } : {}),
              })}>
              {!local && <Download size={15} />}{local ? "Damit bauen" : "Geometrie prüfen / damit bauen"}
            </button>
          </li>;
        })}
      </ul>
      {!!current.total && current.total > 40 && <div className="plib-catalog-pager">
        <button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Zurück</button>
        <span>Seite {page + 1} / {Math.ceil(current.total / 40)}</span>
        <button type="button" disabled={(page + 1) * 40 >= current.total} onClick={() => setPage(value => value + 1)}>Weiter</button>
      </div>}
    </>}
  </section>;
}
