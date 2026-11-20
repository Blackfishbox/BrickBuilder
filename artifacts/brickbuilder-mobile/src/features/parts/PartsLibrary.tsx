import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CloudOff, Download, ExternalLink, LoaderCircle, Plus, RotateCw, Search, X } from 'lucide-react';
import { PART_PACKAGES, ensureBundledPackages, installPackage, listInstalledPackages, searchLocalParts } from './library';
import type { InstalledPackage, LibraryPart } from './types';
import './parts-library.css';
import CatalogPanel from "../catalog/CatalogPanel";
import PartThumbnail from "./PartThumbnail";
import CatalogPartSearch from "./CatalogPartSearch";
import { useI18n } from "@/i18n/I18nProvider";

type PkgState = { status: 'idle' | 'pending' | 'error'; error?: string };
const CATEGORIES = [
  { value: '', label: 'parts.all' as const },
  { value: 'Steine', label: 'parts.cat.bricks' as const },
  { value: 'Platten', label: 'parts.cat.plates' as const },
  { value: 'Fliesen', label: 'parts.cat.tiles' as const },
  { value: 'Schrägsteine', label: 'parts.cat.slopes' as const },
  { value: 'Technik', label: 'parts.cat.technic' as const },
  { value: 'Fahrzeug & Details', label: 'parts.cat.vehicle' as const },
];
const categoryLabel = (value: string, t: ReturnType<typeof useI18n>['t']) =>
  t(CATEGORIES.find(category => category.value === value)?.label ?? 'parts.category');

const formatBytes = (bytes: number, locale: 'en' | 'de') =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toLocaleString(locale === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 1 })} KB`;

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

interface Props {
  online: boolean;
  selectedPartId?: string;
  selectedColor?: string;
  selectedColorCode?: string;
  paletteRevision?: string;
  loading?: boolean;
  selectionError?: string | null;
  onSelect: (part: LibraryPart) => void | boolean | Promise<void | boolean>;
}

export default function PartsLibrary({ online, selectedPartId, selectedColor = "#B40000", selectedColorCode = "4", paletteRevision, loading = false, selectionError, onSelect }: Props) {
  const { locale, t } = useI18n();
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [installed, setInstalled] = useState<InstalledPackage[] | null>(null);
  const [installedError, setInstalledError] = useState('');
  const [pkgState, setPkgState] = useState<Record<string, PkgState>>({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [visibleCount, setVisibleCount] = useState(40);
  const [results, setResults] = useState<LibraryPart[] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searchNonce, setSearchNonce] = useState(0);
  const [installedIds, setInstalledIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    mountedRef.current = true;
    controllerRef.current = new AbortController();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const loadInstalled = useCallback(async () => {
    setInstalledError('');
    try {
      await ensureBundledPackages();
      const list = await listInstalledPackages();
      const parts = await searchLocalParts();
      if (mountedRef.current) {
        setInstalled(list);
        setInstalledIds(new Set(parts.map(part => part.ldrawId)));
      }
    } catch (error) {
      if (mountedRef.current) {
        setInstalled([]);
        setInstalledError(errorText(error, t('parts.installedReadError')));
      }
    }
  }, [t]);

  useEffect(() => { void loadInstalled(); }, [loadInstalled]);

  useEffect(() => {
    if (installed === null) return;
    let active = true;
    setVisibleCount(40);
    setResults(null);
    setSearchError('');
    const timer = window.setTimeout(() => {
      searchLocalParts(query, category)
        .then((parts) => { if (active && mountedRef.current) setResults(parts); })
        .catch((error: unknown) => {
          if (active && mountedRef.current) {
            setResults([]);
            setSearchError(errorText(error, t('parts.localSearchError')));
          }
        });
    }, 160);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, category, searchNonce, installed, t]);

  const install = async (id: string) => {
    const signal = controllerRef.current?.signal;
    if (!signal || signal.aborted) return;
    setPkgState((s) => ({ ...s, [id]: { status: 'pending' } }));
    try {
      await installPackage(id, signal);
      if (!mountedRef.current) return;
      setPkgState((s) => ({ ...s, [id]: { status: 'idle' } }));
      await loadInstalled();
    } catch (error) {
      if (!mountedRef.current || signal.aborted) return;
          setPkgState((s) => ({ ...s, [id]: { status: 'error', error: errorText(error, t('parts.installError')) } }));
    }
  };

  const installedMap = new Map((installed ?? []).map((p) => [p.id, p]));
  const hasInstalled = installedMap.size > 0;

  const libraryDetails = (
    <>
      <div className="plib-head">
        <div>
          <p className="popover-eyebrow">{t('parts.library')}</p>
          <h3 id="plib-title">{t('parts.localPackages')}</h3>
        </div>
        {!online && (
          <span className="plib-offline" role="status" data-testid="status-library-offline">
            <CloudOff size={13} /> {t('parts.offlineSummary')}
          </span>
        )}
      </div>

      <CatalogPanel />
      <details className="rounded-lg border p-3 text-xs">
        <summary className="cursor-pointer py-2 font-semibold">{t('parts.connectionLicenses')}</summary>
        <p className="py-2">{t('parts.connectionInfo')}</p>
        <div className="flex flex-wrap gap-3 underline">
          <a href={`${import.meta.env.BASE_URL}licenses/connections/ATTRIBUTION.txt`} target="_blank" rel="noreferrer">{t('parts.sourcesEdits')}</a>
          <a href={`${import.meta.env.BASE_URL}licenses/connections/LICENSE.md`} target="_blank" rel="noreferrer">{t('parts.license')}</a>
          <a href={`${import.meta.env.BASE_URL}licenses/connections/manifest.json`} target="_blank" rel="noreferrer">{t('parts.snapshot')}</a>
          <a href={`${import.meta.env.BASE_URL}licenses/connections/coverage.json`} target="_blank" rel="noreferrer">{t('parts.coverage')}</a>
        </div>
      </details>
      {installedError && (
        <div className="plib-alert" role="alert">
          <AlertTriangle size={14} /><span>{installedError}</span>
          <button type="button" onClick={() => void loadInstalled()} data-testid="button-retry-installed">{t('parts.retry')}</button>
        </div>
      )}

      <details>
      <summary>{t('parts.packageInventory', { count: PART_PACKAGES.reduce((sum, pkg) => sum + pkg.partCount, 0) })}</summary>
      <ul className="plib-packages">
        {PART_PACKAGES.map((pkg) => {
          const state = pkgState[pkg.id]?.status ?? 'idle';
          const inst = installedMap.get(pkg.id);
          const current = inst?.version === pkg.version;
          return (
            <li key={pkg.id} className={`plib-pkg ${inst ? 'is-installed' : ''}`} data-testid={`package-${pkg.id}`}>
              <div className="plib-pkg-row">
                <div className="plib-pkg-copy">
                  <strong>{pkg.title}</strong>
                  <small>{pkg.description}</small>
                  <span className="plib-meta">
                    v{pkg.version} · {formatBytes(pkg.bytes, locale)} · {pkg.partCount} {t('format.parts')} · {pkg.fileCount} {t('parts.files')}
                  </span>
                </div>
                {installed === null ? (
                  <span className="plib-skel" aria-label={t('parts.loadingStatus')} />
                ) : state === 'pending' ? (
                  <span className="plib-btn is-pending" role="status" data-testid={`status-pending-${pkg.id}`}>
                    <LoaderCircle size={14} className="spin" /> {t('parts.loading')}
                  </span>
                ) : inst && current ? (
                  <span className="plib-installed" data-testid={`status-installed-${pkg.id}`}><Check size={14} /> {t('parts.installed')}</span>
                ) : (
                  <button
                    type="button"
                    className="plib-btn"
                    onClick={() => void install(pkg.id)}
                    disabled={!online && !pkg.bundled}
                    aria-label={state === 'error' ? t('parts.downloadAgain', { name: pkg.title }) : t('parts.download', { name: pkg.title })}
                    data-testid={`button-install-${pkg.id}`}
                  >
                    {state === 'error' ? <RotateCw size={14} /> : <Download size={14} />}
                    {state === 'error' ? t('parts.retryInstall') : inst ? t('parts.update') : t('parts.get')}
                  </button>
                )}
              </div>
              {state === 'error' && (
                <p className="plib-error" role="alert" data-testid={`error-${pkg.id}`}>
                  <AlertTriangle size={13} /> {pkgState[pkg.id]?.error}
                </p>
              )}
              {inst && (
                <p className="plib-installed-at">
                  {t('parts.installedAt', { date: new Date(inst.installedAt).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US') })}
                  {!current && ` · ${t('parts.newVersion', { old: inst.version, version: pkg.version })}`}
                </p>
              )}
              <details className="plib-details">
                <summary>{t('parts.provenance')}</summary>
                <dl>
                  <dt>{t('parts.author')}</dt><dd>{pkg.attribution}</dd>
                  <dt>{t('parts.licenseText')}</dt><dd>{pkg.licenses.join(', ')}</dd>
                  <dt>{t('parts.changes')}</dt><dd>{pkg.changes}</dd>
                </dl>
                <div className="plib-links">
                  <a href={pkg.sourceUrl} target="_blank" rel="noreferrer noopener">{t('parts.librarySource')} <ExternalLink size={11} /></a>
                  <a href={pkg.licenseUrl} target="_blank" rel="noreferrer noopener">{t('parts.licenseText')} <ExternalLink size={11} /></a>
                </div>
                {inst?.legalDocuments?.length ? (
                  <div className="plib-legal" aria-label={t('parts.localLicenses')}>
                    {inst.legalDocuments.map((doc) => (
                      <details key={`${doc.name}:${doc.sourceUrl}`} className="plib-doc" data-testid={`legal-${pkg.id}-${doc.name}`}>
                        <summary>{doc.name} <span>{t('parts.readOffline')}</span></summary>
                        <pre tabIndex={0} aria-label={doc.name}>{doc.content}</pre>
                        <a href={doc.sourceUrl} target="_blank" rel="noreferrer noopener">{t('parts.originalSource')} <ExternalLink size={11} /></a>
                      </details>
                    ))}
                  </div>
                ) : inst ? null : (
                  <p className="plib-installed-at">{t('parts.licenseSaved')}</p>
                )}
              </details>
            </li>
          );
        })}
      </ul>
      </details>

    </>
  );
  return (
    <section className="plib" aria-labelledby="plib-title" data-testid="parts-library">
      <div className="plib-search-row">
        <label className="search-field plib-search">
          <Search size={16} />
          <input
            type="search"
            placeholder={t('parts.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t('parts.searchLabel')}
            data-testid="input-search-library"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('parts.clearSearch')}><X size={14} /></button>}
        </label>
        <div className="plib-filter" role="group" aria-label={t('parts.category')}>
          {CATEGORIES.map((c) => (
            <button
              key={c.value || 'all'}
              type="button"
              className={category === c.value ? 'active' : ''}
              aria-pressed={category === c.value}
              onClick={() => setCategory(c.value)}
              data-testid={`button-category-${c.value || 'all'}`}
            >{t(c.label)}</button>
          ))}
        </div>
      </div>

      <p className="plib-catalog-note">{t('parts.localInstalled')}</p>
      <div className="plib-results" aria-live="polite" aria-busy={results === null}>
        {searchError ? (
          <div className="plib-alert" role="alert">
            <AlertTriangle size={14} /><span>{searchError}</span>
            <button type="button" onClick={() => setSearchNonce((n) => n + 1)} data-testid="button-retry-search">{t('parts.retry')}</button>
          </div>
        ) : results === null ? (
          [0, 1, 2].map((i) => <div key={i} className="plib-row-skel" />)
        ) : results.length === 0 ? (
          <div className="drawer-empty" data-testid="status-library-empty">
            <Search size={19} />
            <strong>{hasInstalled ? t('parts.emptyMatches') : t('parts.noPackages')}</strong>
            <span>{hasInstalled ? t('parts.searchHint') : t('parts.packageHint')}</span>
          </div>
        ) : results.slice(0, visibleCount).map((part) => {
          const body = (
            <>
              <PartThumbnail part={part}
                revision={`${installedMap.get(part.packageId)?.version}:${installedMap.get(part.packageId)?.sha256}`}
                color={selectedColor} colorCode={selectedColorCode} paletteRevision={paletteRevision} />
              <span className="drawer-piece-copy">
                <strong>{part.name}</strong>
                <span className="plib-part-number">LDraw {part.ldrawId}</span>
                <small>{t('parts.geometryCheck', { category: categoryLabel(part.category, t) })}</small>
              </span>
            </>
          );
          return (
            <button
              key={part.id}
              type="button"
              className={`drawer-piece plib-part ${selectedPartId === part.ldrawId ? 'chosen' : ''}`}
              disabled={loading}
              onClick={() => onSelect(part)}
              aria-label={t('parts.selectPart', { name: part.name, id: part.ldrawId })}
              data-testid={`button-library-part-${part.ldrawId}`}
            >
              {body}
              {selectedPartId === part.ldrawId ? <Check size={17} className="chosen-check" /> : <Plus size={17} className="add-glyph" />}
            </button>
          );
        })}
      </div>
      {results && results.length > visibleCount && (
        <button type="button" className="plib-btn" onClick={() => setVisibleCount(count => count + 40)}>
          {t('parts.more', { shown: visibleCount, total: results.length })}
        </button>
      )}
      <CatalogPartSearch query={query} category={category} installedIds={installedIds}
        color={selectedColor} colorCode={selectedColorCode} loading={loading} selectionError={selectionError} onSelect={onSelect} />
      {libraryDetails}
    </section>
  );
}
