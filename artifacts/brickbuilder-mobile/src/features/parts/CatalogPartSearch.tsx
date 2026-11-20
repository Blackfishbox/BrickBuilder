import { useEffect, useState } from "react";
import { AlertTriangle, Download, Search } from "lucide-react";
import { searchBuildingCatalog, type CatalogSearchResult } from "../catalog/client";
import InventoryThumbnail from "../inventory/InventoryThumbnail";
import type { LibraryPart } from "./types";
import { incomingLDrawIds } from "../catalog/ldraw-identity";
import { useI18n } from "@/i18n/I18nProvider";
export { incomingLDrawIds } from "../catalog/ldraw-identity";

type Props = {
  query: string; category: string; installedIds: ReadonlySet<string>;
  color: string; colorCode: string; loading: boolean; selectionError?: string | null;
  onSelect(part: LibraryPart): void | boolean | Promise<void | boolean>;
};

export default function CatalogPartSearch({ query, category, installedIds, color, colorCode, loading, selectionError, onSelect }: Props) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; rows?: CatalogSearchResult[]; total?: number; error?: string }>();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<{ id: string; pending?: boolean; error?: string }>();
  async function select(part: LibraryPart, rowId: string) {
    setSelection({ id: rowId, pending: true });
    try {
      const success = await onSelect(part);
      setSelection({ id: rowId, ...(success === false ? {
        error: t("catalog.prepareGeometryFailed"),
      } : {}) });
    } catch (error) {
      setSelection({ id: rowId, error: error instanceof Error ? error.message : t("catalog.geometryLoadFailed") });
    }
  }
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
        if (active) setState({ key, error: error instanceof Error ? error.message : t("catalog.searchFailed") });
      });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [key, term, category, page]);
  if (term.length < 2) return <p className="plib-catalog-note">{t("catalog.searchMinChars")}</p>;
  const current = state?.key === key ? state : undefined;
  return <section className="plib-catalog-search" aria-label={t("catalog.results")} aria-busy={!current}>
    <h4><Search size={16} /> {t("catalog.matches", { count: current?.total ?? 0 })}</h4>
    <p className="plib-catalog-note">{t("catalog.searchHint")}</p>
    {!current ? <p role="status">{t("catalog.searching")}</p> : current.error ? <div className="plib-alert" role="alert">
      <AlertTriangle size={16} /><span>{current.error} {t("catalog.localResultsRemain")}</span>
      <button type="button" onClick={() => setRetry(value => value + 1)}>{t("catalog.searchRetry")}</button>
    </div> : <>
      {!current.rows?.length && <p>{t("catalog.noMoreResults")}</p>}
      <ul className="plib-catalog-rows">
        {current.rows?.filter(row => incomingLDrawIds(row).length > 0).map(row => {
          const ids = incomingLDrawIds(row);
          const chosen = ids.length === 1 ? ids[0] : ids.includes(choices[row.id]) ? choices[row.id] : "";
          const brickLinkIds = [...new Set(row.mappings.filter(mapping => mapping[1] === "BL" && mapping[3] === "True").map(mapping => mapping[2]))];
          const local = Boolean(chosen && installedIds.has(chosen));
          return <li key={row.id} className="plib-catalog-row">
            <div className="plib-catalog-row-head">
              {chosen && <InventoryThumbnail ldrawId={chosen} color={color} colorCode={colorCode}
                acquireMissing={!loading && !selection?.pending} />}
              <div className="drawer-piece-copy">
                <strong>{row.name}</strong>
                <small>Rebrickable {row.id}{brickLinkIds.length ? ` · BrickLink ${brickLinkIds.join(", ")}` : ` · ${t("catalog.unconfirmedBrickLink")}`}</small>
                <small>{chosen ? `LDraw ${chosen} · ${local ? t("catalog.offlineInstalled") : t("catalog.notInstalled")}` : t("catalog.noUniqueLdraw")}</small>
              </div>
            </div>
            {ids.length > 1 && <label>{t("catalog.chooseVariant")}
              <select aria-label={t("catalog.chooseVariantFor", { id: row.id })} value={chosen}
                onChange={event => setChoices(values => ({ ...values, [row.id]: event.target.value }))}>
                <option value="">{t("catalog.choose")}</option>
                {ids.map(id => <option key={id} value={id}>{id}{installedIds.has(id) ? ` · ${t("catalog.offlineInstalled")}` : ""}</option>)}
              </select>
            </label>}
            <button type="button" disabled={loading || !chosen || Boolean(selection?.id === row.id && selection.pending)} data-testid={`button-catalog-build-${row.id}`}
              onClick={() => void select({
                id: `catalog:${row.id}:${chosen}`, packageId: "catalog", ldrawId: chosen,
                file: `parts/${chosen}.dat`, name: row.name, category: category || t("catalog.full"), keywords: [],
                ...(brickLinkIds.length === 1 ? { brickLinkId: brickLinkIds[0] } : {}),
              }, row.id)}>
              {!local && <Download size={15} />}{local ? t("catalog.build") : t("catalog.verifyBuild")}
            </button>
            {selection?.id === row.id && selection.pending && <p role="status">{t("catalog.loadingGeometry", { id: chosen })}</p>}
            {selection?.id === row.id && selection.error && <p role="alert" className="plib-error">
              LDraw {chosen}: {selectionError || selection.error}
            </p>}
          </li>;
        })}
      </ul>
      {!!current.total && current.total > 40 && <div className="plib-catalog-pager">
         <button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{t("catalog.previous")}</button>
         <span>{t("catalog.page", { current: page + 1, total: Math.ceil(current.total / 40) })}</span>
         <button type="button" disabled={(page + 1) * 40 >= current.total} onClick={() => setPage(value => value + 1)}>{t("catalog.next")}</button>
      </div>}
    </>}
  </section>;
}
