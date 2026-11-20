import { useEffect, useState } from "react";
import { catalogManifest, ensureCatalog, searchFullCatalog, useCatalog, type CatalogSearchResult } from "./client";
import { useI18n } from "@/i18n/I18nProvider";

export default function CatalogPanel() {
  const catalog = useCatalog();
  const { locale, t } = useI18n();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"parts" | "colors">("parts");
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || catalog.status !== "ready") return;
    let active = true;
    const timer = setTimeout(() => {
      setError("");
      void searchFullCatalog(query, kind).then(rows => { if (active) setResults(rows); })
        .catch(reason => { if (active) setError(String(reason)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, kind, open, catalog.status]);
  const c = catalog.index?.coverage;
  return (
    <details className="fmt-details" onToggle={event => setOpen(event.currentTarget.open)} data-testid="catalog-panel">
      <summary style={{ minHeight: 44 }}>{t("catalog.full")} · {catalog.status === "ready" ? t("catalog.offline") : catalog.status === "loading" ? t("catalog.checking") : t("catalog.notLoaded")}</summary>
      <p>{t("catalog.version", { version: catalogManifest.version, size: Math.round(catalogManifest.bytes / 1024) })}</p>
      <p>{t("catalog.disclaimer")}</p>
      {catalog.status === "error" && <p role="alert">{catalog.error} {t("catalog.unavailable")}</p>}
      {catalog.status !== "ready" && <button type="button" className="plib-btn" disabled={catalog.status === "loading"} onClick={() => void ensureCatalog().catch(() => undefined)}>{t("catalog.load")}</button>}
      {c && <>
        <p>{t("catalog.partsColors", { parts: c.parts.toLocaleString(locale === "de" ? "de-DE" : "en-US"), colors: c.colors })}<br />
          {t("catalog.mappingRows", { parts: c.partRows.toLocaleString(locale === "de" ? "de-DE" : "en-US"), colors: c.colorRows.toLocaleString(locale === "de" ? "de-DE" : "en-US") })}</p>
        <p>{t("catalog.partIds", { total: c.ldrawParts.toLocaleString(locale === "de" ? "de-DE" : "en-US"), confirmed: c.confirmedParts.toLocaleString(locale === "de" ? "de-DE" : "en-US"), ambiguous: c.ambiguousParts, unknown: c.unknownParts })}<br />
          {t("catalog.colorIds", { total: c.ldrawColors, confirmed: c.confirmedColors, ambiguous: c.ambiguousColors, unknown: c.unknownColors })}</p>
        <p>{t("catalog.noImportMapping")}</p>
        <label style={{ display: "block" }}>{t("catalog.searchAll")} <input style={{ minHeight: 44, width: "100%" }} value={query} onChange={event => setQuery(event.target.value)} placeholder={t("catalog.nameOrIdExample")} data-testid="catalog-search" /></label>
        <select style={{ minHeight: 44 }} value={kind} onChange={event => setKind(event.target.value as typeof kind)} aria-label={t("catalog.kind")}><option value="parts">{t("catalog.allParts")}</option><option value="colors">{t("catalog.allColors")}</option></select>
        {error && <p role="alert">{error}</p>}
        <ul>{results.map(row => <li key={row.id} style={{ overflowWrap: "anywhere" }}>
          <strong>Rebrickable {row.id} · {row.name}</strong>
          <small>{row.mappings.length ? row.mappings.map(mapping =>
            `${mapping[1]} ${mapping[2]} ${t("catalog.resultFlags", { export: mapping.at(-2) === "True" ? t("common.yes") : t("common.no"), import: mapping.at(-1) === "True" ? t("common.yes") : t("common.no") })}`).join(" · ") : t("catalog.noExternalMappings")}</small>
        </li>)}</ul>
        <p>{t("catalog.limit")}</p>
      </>}
      <p><a href="https://rebrickable.com/downloads/" target="_blank" rel="noreferrer">{t("catalog.sourceFiles")}</a> · <a href={catalogManifest.termsUrl} target="_blank" rel="noreferrer">{t("color.terms")}</a></p>
      <details><summary>{t("catalog.provenance")}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 10 }}>{JSON.stringify(catalogManifest, null, 2)}</pre></details>
      <p>{catalogManifest.attribution}</p>
    </details>
  );
}
