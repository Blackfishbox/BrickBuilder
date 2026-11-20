import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileUp, LoaderCircle, RotateCw, Search, X } from 'lucide-react';
import type { BuilderDocument } from '@/features/editor/model';
import { previewInventory, resolveStoredInventory } from '@/features/catalog/client';
import { allocatedCounts, inventorySpreadCandidates, MAX_INVENTORY_SPREAD_UNITS, type InventorySpreadRequest, type InventorySpreadResult } from './accounting';
import InventoryThumbnail from './InventoryThumbnail';
import { MAX_LIST_BYTES, MAX_ROWS, type Inventory, type InventoryChoice, type InventoryPreview, type InventoryRow } from './types';
import './inventory.css';
import { importFileAccept } from '@/platform/import-file';
import { useI18n } from '@/i18n/I18nProvider';

const PAGE = 30;
export const CSV_TEMPLATE = `part_id,color_id,quantity
3001,5,2
`;

interface Props {
  document: BuilderDocument;
  selected: InventoryChoice | null;
  onSelect(choice: InventoryChoice): Promise<boolean>;
  onSpread(requests: InventorySpreadRequest[], onProgress: (progress: { stage: 'mapping' | 'geometry' | 'placing'; completed: number; total: number }) => void, signal: AbortSignal): Promise<InventorySpreadResult>;
  onReplace(inventory: Inventory, expectedProjectId: string): void;
  onSelected(): void;
}

type Pick = { ldrawId?: string; colorCode?: string };

function rowIssue(row: InventoryRow, res: InventoryPreview['resolutions'][string] | undefined, t: ReturnType<typeof useI18n>['t']): string | null {
  if (row.itemType !== 'P') return t('inventory.invalidType', { type: row.itemType });
  if (!res) return t('inventory.mappingPending', { id: row.partId });
  if (!res.parts.length && !res.colors.length) return t('inventory.unknownPartColor', { part: row.partId, color: row.colorId });
  if (!res.parts.length) return t('inventory.unknownPart', { id: row.partId });
  if (!res.colors.length) return t('inventory.unknownColor', { id: row.colorId });
  return null;
}

export default function InventoryPanel({ document, selected, onSelect, onSpread, onReplace, onSelected }: Props) {
  const { t } = useI18n();
  const inventory = document.inventory;
  const projectId = document.id;
  const counts = useMemo(() => allocatedCounts(document), [document]);
  const hasAllocations = useMemo(() => [...counts.values()].some(n => n > 0), [counts]);
  const [resolutions, setResolutions] = useState<InventoryPreview['resolutions'] | null>(null);
  const [resolveError, setResolveError] = useState('');
  const [resolveTick, setResolveTick] = useState(0);
  const [preview, setPreview] = useState<InventoryPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busyRow, setBusyRow] = useState('');
  const [rowError, setRowError] = useState('');
  const [spreading, setSpreading] = useState(false);
  const [spreadProgress, setSpreadProgress] = useState<{ stage: 'mapping' | 'geometry' | 'placing'; completed: number; total: number } | null>(null);
  const [spreadMessage, setSpreadMessage] = useState('');
  const spreadController = useRef<AbortController | null>(null);
  const token = useRef(0);
  const mounted = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const retryFile = useRef<File | undefined>(undefined);
  const projectRef = useRef(projectId);
  const previewProjectRef = useRef(projectId);
  projectRef.current = projectId;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; token.current++; };
  }, []);
  useEffect(() => { token.current++; retryFile.current = undefined; setPreview(null); setImporting(false); setImportError(''); setImportStatus(''); setPicks({}); }, [projectId]);
  useEffect(() => { setPicks({}); setRowError(''); setBusyRow(''); setPage(0); }, [inventory?.id]);

  useEffect(() => {
    if (!inventory) { setResolutions(null); return; }
    let live = true;
    setResolutions(null); setResolveError('');
    resolveStoredInventory(inventory).then(p => { if (live) setResolutions(p.resolutions); })
      .catch(e => { if (live) setResolveError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [inventory?.id, resolveTick]);
  useEffect(() => () => spreadController.current?.abort(), []);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    retryFile.current = file;
    const my = ++token.current; const pid = projectId;
    setImportError(''); setImportStatus(t('inventory.reading')); setPreview(null);
    if (!/\.(xml|csv)$/i.test(file.name)) { setImportError(t('inventory.onlyFormats')); return; }
    if (file.size > MAX_LIST_BYTES) { setImportError(t('inventory.tooLarge')); return; }
    setImporting(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const p = await Promise.race([
        previewInventory(file, message => {
          if (mounted.current && my === token.current) setImportStatus(message);
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(t('inventory.timeout'))), 90_000);
        }),
      ]);
      if (!mounted.current || my !== token.current || pid !== projectRef.current) return;
      previewProjectRef.current = pid;
      setPreview(p);
    } catch (e) {
      if (!mounted.current || my !== token.current || pid !== projectRef.current) return;
      const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e || 'Unbekannter Fehler');
      setImportError(t('inventory.failedFile', { file: file.name, reason: message }));
    } finally {
      if (timer) clearTimeout(timer);
      if (mounted.current && my === token.current) setImporting(false);
    }
  };

  const cancelImport = () => { token.current++; setImporting(false); setPreview(null); setImportError(''); setImportStatus(t('inventory.importCancelled')); if (fileRef.current) fileRef.current.value = ''; };

  const confirmImport = () => {
    if (!preview) return;
    try {
      onReplace(preview.inventory, previewProjectRef.current);
      setImportStatus(t('inventory.importSuccess', { rows: preview.inventory.rows.length, parts: preview.inventory.rows.reduce((sum, row) => sum + row.quantity, 0) }));
      setPreview(null); setPicks({}); setPage(0); setQuery('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setImportError(e instanceof Error ? e.message : String(e)); }
  };

  const downloadTemplate = async () => {
    try {
      const { exportFile } = await import('@/platform/export-file');
      await exportFile(new TextEncoder().encode(CSV_TEMPLATE), 'teileliste-vorlage.csv', 'text/csv');
    } catch (e) { setImportError(e instanceof Error ? e.message : t('inventory.templateFailed')); }
  };

  const rows = inventory?.rows ?? [];
  const availableRows = useMemo(() => rows.filter(row => (counts.get(row.id) ?? 0) < row.quantity), [rows, counts]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableRows;
    return availableRows.filter(r => {
      const res = resolutions?.[r.id];
      const hay = [r.partId, r.colorId, ...(res?.parts.map(p => `${p.ldrawId} ${p.name}`) ?? []), ...(res?.colors.map(c => c.name) ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [availableRows, query, resolutions]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  useEffect(() => { setPage(previous => Math.min(previous, pages - 1)); }, [pages]);
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE, current * PAGE + PAGE);
  const spreadCandidates = useMemo(
    () => resolutions ? inventorySpreadCandidates(document, resolutions, picks) : [],
    [document, resolutions, picks],
  );
  const spreadRequests = spreadCandidates.flatMap(candidate =>
    candidate.choice ? [{ choice: candidate.choice, quantity: candidate.quantity }] : [],
  );
  const spreadUnits = spreadRequests.reduce((sum, request) => sum + request.quantity, 0);
  const blockedCandidates = spreadCandidates.filter(candidate => candidate.issue);

  const spreadRemaining = async () => {
    if (spreading || !spreadRequests.length) return;
    const controller = new AbortController();
    spreadController.current = controller;
    setSpreading(true); setSpreadProgress(null); setSpreadMessage('');
    try {
      const result = await onSpread(spreadRequests, setSpreadProgress, controller.signal);
      const message = [
        t('inventory.spreadPlaced', { count: result.placed }),
        result.skipped ? t('inventory.spreadSkipped', { count: result.skipped }) : '',
        result.deferred ? t('inventory.spreadDeferred', { count: result.deferred }) : '',
      ].filter(Boolean);
      const detailLimit = 3;
      const details = result.failures.slice(0, detailLimit).map(failure => {
        const reason = failure.reason.replace(/\s+/g, ' ').trim();
        const shortReason = reason.length > 160 ? `${reason.slice(0, 157)}…` : reason;
        return `${failure.ldrawId} (${failure.quantity}): ${shortReason}`;
      });
      if (result.failures.length > detailLimit) details.push(t('inventory.spreadOtherGeometry', { count: result.failures.length - detailLimit }));
      if (details.length) message.push(t('inventory.spreadFailureDetails', { details: details.join('; ') }));
      setSpreadMessage(message.join(' '));
    } catch (error) {
      setSpreadMessage(controller.signal.aborted
        ? t('inventory.spreadCancelled')
        : error instanceof Error ? t('inventory.spreadNothing', { reason: error.message }) : t('inventory.spreadRetry'));
    } finally {
      if (spreadController.current === controller) spreadController.current = null;
      setSpreading(false); setSpreadProgress(null);
    }
  };

  const choose = async (row: InventoryRow, ldrawId: string, colorCode: string) => {
    if (!inventory) return;
    const pid = projectId; setBusyRow(row.id); setRowError('');
    try {
      const ok = await onSelect({ listId: inventory.id, rowId: row.id, ldrawId, colorCode });
      if (!mounted.current || pid !== projectRef.current) return;
      if (ok) onSelected(); else setRowError(t('inventory.partLoadFailed'));
    } catch (e) {
      if (mounted.current) setRowError(e instanceof Error ? e.message : String(e));
    } finally { if (mounted.current) setBusyRow(''); }
  };

  return (
    <div className="inv-panel" data-testid="panel-inventory">
      <section className="inv-import">
        <div className="inv-import-head">
          <div>
            <strong>{inventory ? inventory.name || t('inventory.list') : t('inventory.none')}</strong>
            <small>{inventory ? t('inventory.rows', { rows: rows.length, count: rows.reduce((s, r) => s + r.quantity, 0) }) : t('inventory.limits')}</small>
          </div>
          <label className={`inv-file ${hasAllocations ? 'disabled' : ''}`}>
            <FileUp size={15} /> {inventory ? t('inventory.replace') : t('inventory.import')}
            <input ref={fileRef} type="file" accept={importFileAccept('inventory')} disabled={hasAllocations || importing}
              onClick={e => { e.currentTarget.value = ''; }}
              onChange={e => void pickFile(e.target.files?.[0])} data-testid="input-inventory-file" />
          </label>
        </div>
        {hasAllocations && <p className="inv-note" data-testid="text-inventory-locked">{t('inventory.locked')}</p>}
        <div className="inv-template">
          <code>part_id,color_id,quantity<br />3001,5,2</code>
          <button type="button" onClick={downloadTemplate} data-testid="button-inventory-template"><Download size={14} /> {t('inventory.csvTemplate')}</button>
        </div>
        {importing && <div className="inv-status" role="status"><LoaderCircle className="spin" size={15} /> {importStatus} <button type="button" onClick={cancelImport} data-testid="button-inventory-cancel-loading">{t('inventory.cancel')}</button></div>}
        {!importing && !preview && !importError && importStatus && <p role="status">{importStatus}</p>}
        {importError && <div className="inv-error" role="alert" data-testid="status-inventory-import-error">{importError}<button type="button" onClick={() => void pickFile(retryFile.current)} data-testid="button-inventory-import-retry"><RotateCw size={13} /> {t('inventory.retry')}</button><button type="button" onClick={() => { if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); } }}>{t('inventory.otherFile')}</button></div>}
        {preview && <ImportPreview preview={preview} onCancel={cancelImport} onConfirm={confirmImport} replacing={!!inventory} />}
      </section>

      {inventory && <>
        <p className="inv-note">{t('inventory.listColor')}</p>
        <p className="inv-note">{t('inventory.hiddenUsed')}</p>
        <section className="inv-spread" aria-label={t('inventory.spreadAria')}>
          <div>
            <strong>{t('inventory.spreadTitle')}</strong>
            <small>{t('inventory.spreadInfo', { max: MAX_INVENTORY_SPREAD_UNITS })}</small>
          </div>
          <button type="button" className="inv-spread-button" disabled={!resolutions || spreading || spreadUnits === 0}
            onClick={() => void spreadRemaining()} data-testid="button-inventory-spread">
            {spreading ? <LoaderCircle className="spin" size={15} /> : null}
            {spreading ? t('inventory.spreading') : `${t('inventory.spread')}${spreadUnits ? ` (${spreadUnits})` : ''}`}
          </button>
          {blockedCandidates.length > 0 && resolutions && <div className="inv-spread-issues" role="status" data-testid="status-inventory-spread-issues">
            {t(blockedCandidates.length === 1 ? 'inventory.unplaceable' : 'inventory.unplaceableMany', { count: blockedCandidates.length })}
            <ul>{blockedCandidates.slice(0, 8).map(candidate => <li key={candidate.rowId}>{candidate.issue}</li>)}</ul>
            {blockedCandidates.length > 8 && <small>{t('inventory.moreNeedReview', { count: blockedCandidates.length - 8 })}</small>}
          </div>}
          {spreading && spreadProgress && <p className="inv-status" role="status" data-testid="status-inventory-spread-progress">
            <LoaderCircle className="spin" size={15} />
            {spreadProgress.stage === 'mapping'
              ? t('inventory.mapping', { done: spreadProgress.completed, total: spreadProgress.total })
              : spreadProgress.stage === 'geometry'
                ? t('inventory.geometry', { done: spreadProgress.completed, total: spreadProgress.total })
                : t('inventory.placing', { done: spreadProgress.completed, total: spreadProgress.total })}
            <button type="button" onClick={() => spreadController.current?.abort()} data-testid="button-inventory-spread-cancel">{t('inventory.cancel')}</button>
          </p>}
          {spreadMessage && (() => {
            const failed = spreadMessage.startsWith(t('inventory.spreadNothing', { reason: '' }));
            return <p className={failed ? 'inv-error' : 'inv-note'} role={failed ? 'alert' : 'status'} data-testid="status-inventory-spread-result">{spreadMessage}</p>;
          })()}
        </section>
        <div className="inv-search">
          <Search size={15} />
          <input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder={t('inventory.searchPlaceholder')} aria-label={t('inventory.searchLabel')} data-testid="input-inventory-search" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label={t('inventory.clearSearch')}><X size={14} /></button>}
        </div>
        {resolveError && <div className="inv-error" role="alert">{resolveError}<button type="button" onClick={() => setResolveTick(tick => tick + 1)} data-testid="button-inventory-retry"><RotateCw size={13} /> {t('inventory.retryAgain')}</button></div>}
        {!resolutions && !resolveError && <div className="inv-skeleton" aria-label={t('inventory.loadingMappings')}>{[0, 1, 2].map(i => <span key={i} />)}</div>}
        {rowError && <p className="inv-error" role="alert">{rowError}</p>}
        {resolutions && (filtered.length === 0
          ? <p className="inv-empty" role="status">{availableRows.length === 0
            ? t('inventory.allUsed')
            : t('inventory.noMatch', { query })}</p>
          : <ul className="inv-rows" aria-label={t('inventory.myList')}>
            {visible.map(row => {
              const res = resolutions[row.id];
              const issue = rowIssue(row, res, t);
              const used = counts.get(row.id) ?? 0;
              const left = Math.max(0, row.quantity - used);
              const pick = picks[row.id] ?? {};
              const ldrawId = res?.parts.length === 1 ? res.parts[0].ldrawId : pick.ldrawId;
              const colorCode = res?.colors.length === 1 ? res.colors[0].ldrawCode : pick.colorCode;
              const color = res?.colors.find(c => c.ldrawCode === colorCode) ?? (res?.colors.length === 1 ? res.colors[0] : undefined);
              const active = selected?.rowId === row.id && selected.listId === inventory.id;
              const ready = !issue && left > 0 && !!ldrawId && !!colorCode;
              const name = res?.parts.find(p => p.ldrawId === ldrawId)?.name ?? res?.parts[0]?.name ?? `BrickLink ${row.partId}`;
              return (
                <li key={row.id} className={`inv-row ${issue ? 'blocked' : ''} ${left === 0 ? 'empty' : ''} ${active ? 'active' : ''}`} data-testid={`row-inventory-${row.id}`}>
                  <div className="inv-row-main">
                    {!issue && ldrawId && color && colorCode && (
                      <InventoryThumbnail ldrawId={ldrawId} color={color.hex} colorCode={colorCode} />
                    )}
                    <span className="inv-chip" style={{ background: color?.hex ?? 'transparent' }} aria-hidden="true" />
                    <div className="inv-row-copy">
                      <strong>{name}</strong>
                    <small>BL {row.partId} · {t('inventory.colorLabel')} {row.colorId}{color ? ` (${color.name})` : ''}</small>
                    </div>
                    <div className="inv-qty" aria-label={t('inventory.remaining', { left, total: row.quantity })}>
                      <b>{left}</b><small>/ {row.quantity}</small>
                    </div>
                  </div>
                  <div className="inv-meter"><span style={{ transform: `scaleX(${row.quantity ? used / row.quantity : 0})` }} /></div>
                  <small className="inv-counts">{t('inventory.totalUsedLeft', { total: row.quantity, used, left })}{row.sourceRows.length > 1 ? ` · ${t('inventory.sourceRows', { count: row.sourceRows.length })}` : ''}</small>
                  {issue && <p className="inv-issue"><AlertTriangle size={13} /> {issue}</p>}
                  {!issue && res && res.parts.length > 1 && (
                    <label className="inv-pick">{t('inventory.chooseLdrawPart')}
                      <select value={pick.ldrawId ?? ''} onChange={e => setPicks(p => ({ ...p, [row.id]: { ...p[row.id], ldrawId: e.target.value || undefined } }))} data-testid={`select-inventory-part-${row.id}`}>
                        <option value="">{t('inventory.chooseOption')}</option>
                        {res.parts.map(p => <option key={p.ldrawId} value={p.ldrawId}>{p.ldrawId} – {p.name}</option>)}
                      </select>
                    </label>)}
                  {!issue && res && res.colors.length > 1 && (
                    <label className="inv-pick">{t('inventory.chooseLdrawColor')}
                      <select value={pick.colorCode ?? ''} onChange={e => setPicks(p => ({ ...p, [row.id]: { ...p[row.id], colorCode: e.target.value || undefined } }))} data-testid={`select-inventory-color-${row.id}`}>
                        <option value="">{t('inventory.chooseOption')}</option>
                        {res.colors.map(c => <option key={c.ldrawCode} value={c.ldrawCode}>{c.ldrawCode} – {c.name}</option>)}
                      </select>
                    </label>)}
                  {!issue && (
                    <button type="button" className="inv-use" disabled={!ready || !!busyRow} onClick={() => ldrawId && colorCode && void choose(row, ldrawId, colorCode)} data-testid={`button-inventory-use-${row.id}`}>
                      {busyRow === row.id ? <LoaderCircle className="spin" size={14} /> : active ? <Check size={14} /> : null}
                      {left === 0 ? t('inventory.depleted') : !ldrawId || !colorCode ? t('inventory.chooseFirst') : active ? t('inventory.active') : t('inventory.buildWith')}
                    </button>)}
                </li>
              );
            })}
          </ul>)}
        {resolutions && pages > 1 && (
          <div className="inv-pager">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} data-testid="button-inventory-prev">{t('inventory.previous')}</button>
            <span>{t('inventory.page', { current: current + 1, total: pages, rows: filtered.length })}</span>
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} data-testid="button-inventory-next">{t('inventory.next')}</button>
          </div>)}
      </>}
      {!inventory && !preview && !importing && <div className="inv-empty-state"><strong>{t('inventory.headline')}</strong><span>{t('inventory.explainer')}</span></div>}
    </div>
  );
}

function ImportPreview({ preview, onCancel, onConfirm, replacing }: { preview: InventoryPreview; onCancel(): void; onConfirm(): void; replacing: boolean }) {
  const { t } = useI18n();
  const rows = preview.inventory.rows;
  const unsupported = rows.filter(r => r.itemType !== 'P');
  const unknown = rows.filter(r => r.itemType === 'P' && (!preview.resolutions[r.id]?.parts.length || !preview.resolutions[r.id]?.colors.length));
  const ambiguous = rows.filter(r => (preview.resolutions[r.id]?.parts.length ?? 0) > 1 || (preview.resolutions[r.id]?.colors.length ?? 0) > 1);
  const merged = rows.filter(r => r.sourceRows.length > 1);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(rows.length / PAGE);
  const current = Math.min(page, pages - 1);
  return (
    <div className="inv-preview" role="region" aria-label={t('inventory.preview')} data-testid="inventory-preview">
      <p className="popover-eyebrow">{t('inventory.previewPending')}</p>
      <div className="inv-stats">
        <span><b>{rows.length}</b> {t('inventory.rowsOnly')}</span>
        <span><b>{rows.reduce((s, r) => s + r.quantity, 0)}</b> {t('format.parts')}</span>
        <span><b>{merged.length}</b> {t('inventory.merged')}</span>
        <span><b>{unsupported.length + unknown.length}</b> {t('inventory.unplaceableShort')}</span>
        <span><b>{ambiguous.length}</b> {t('inventory.ambiguous')}</span>
      </div>
      {rows.length >= MAX_ROWS && <p className="inv-note">{t('inventory.maxRows', { count: MAX_ROWS })}</p>}
      <p className="inv-note">{t('inventory.previewConfirm', { action: replacing ? t('inventory.replaceList') : t('inventory.acceptList') })}</p>
      <div className="inv-actions">
        <button type="button" className="cancel-button" onClick={onCancel} data-testid="button-inventory-preview-cancel">{t('inventory.cancel')}</button>
        <button type="button" className="confirm-button" onClick={onConfirm} data-testid="button-inventory-preview-confirm">{replacing ? t('inventory.replaceList') : t('inventory.acceptList')}</button>
      </div>
      <ul className="inv-preview-rows" aria-label={t('inventory.checkedRows')}>
        {rows.slice(current * PAGE, current * PAGE + PAGE).map(row => {
          const res = preview.resolutions[row.id];
          const issue = rowIssue(row, res, t);
          return <li key={row.id}>
            <strong>BL {row.partId} · {t('inventory.colorLabel')} {row.colorId} · {t('inventory.quantity')} {row.quantity}</strong>
            <span>{res?.parts.map(p => `${p.name} (LDraw ${p.ldrawId})`).join(' / ') || t('inventory.noPartGeometryMapping')}</span>
            <span>{res?.colors.map(c => `${c.name} (LDraw ${c.ldrawCode})`).join(' / ') || t('inventory.noColorMapping')}</span>
            <small>{t('inventory.sourceRowsLabel')}: {row.sourceRows.join(', ')}{row.sourceRows.length > 1 ? ` · ${t('inventory.duplicatesMerged')}` : ''}</small>
            {issue && <span className="inv-issue">{issue} {t('inventory.reviewSourceNumbers')}</span>}
          </li>;
        })}
      </ul>
      {pages > 1 && <div className="inv-pager">
        <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>{t('inventory.previous')}</button>
        <span>{t('inventory.previewPage', { current: current + 1, total: pages })}</span>
        <button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>{t('inventory.next')}</button>
      </div>}
      {ambiguous.length > 0 && <p className="inv-note">{t('inventory.resolveAmbiguous')}</p>}
    </div>
  );
}
