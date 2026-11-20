import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { ViewExportError, type ViewExporter, type ViewFormat, type ViewExportProgress } from '../engine/view-export';
import { AlertTriangle, ChevronDown, Download, FileUp, LoaderCircle, X } from 'lucide-react';
import type { BuilderDocument } from '@/features/editor/model';
import type { ImportedModel } from './types';
import { exportModel, importModelFile, validateImportFile } from './adapters';
import ImportPartNotification from './ImportPartNotification';
import { importDiagnostics } from './import-diagnostics';
import CatalogPanel from '../catalog/CatalogPanel';
import type { GeometryProgress } from './online-geometry';
import { BrickLinkExportError, type PartsListIssue } from './bricklink/export';
import './format-dialog.css';
import { exportFile } from '@/platform/export-file';
import { importFileAccept } from '@/platform/import-file';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageId } from '@/i18n/messages';
import { localizedImportIssue } from './issue-message';

type ExportFormat = 'json' | 'ldr' | 'mpd' | 'io' | 'bricklink';
type WithImported = BuilderDocument & { imported?: ImportedModel };

const EXPORTS: { format: ExportFormat; label: MessageId; note: MessageId }[] = [
  { format: 'bricklink', label: 'format.bricklinkLabel', note: 'format.bricklinkNote' },
  { format: 'json', label: 'format.jsonLabel', note: 'format.jsonNote' },
  { format: 'ldr', label: 'format.ldrLabel', note: 'format.ldrNote' },
  { format: 'mpd', label: 'format.mpdLabel', note: 'format.mpdNote' },
  { format: 'io', label: 'format.ioLabel', note: 'format.ioNote' },
];

interface Props {
  viewExporterRef?: MutableRefObject<ViewExporter | null>;
  document: BuilderDocument;
  initialMode?: 'import' | 'export';
  onClose(): void;
  onImport(document: BuilderDocument): Promise<void>;
}

export function Report({ model, bricks }: { model?: ImportedModel; bricks: number }) {
  const { t } = useI18n();
  if (!model) return <p className="fmt-muted">{t('format.projectNoImport')}</p>;
  const parts = new Set(model.instances.map((i) => i.part.ldrawId)).size;
  const colors = new Set(model.instances.map((i) => i.colorCode)).size;
  const unsupported = model.instances.filter((i) => i.part.status !== 'resolved').length;
  const { warnings, information } = importDiagnostics(model);
  const groups = new Map<string, { instance: ImportedModel['instances'][number]; count: number }>();
  for (const instance of model.instances) {
    const key = JSON.stringify([instance.reference, instance.colorCode]);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { instance, count: 1 });
  }
  return (
    <div className="fmt-report" data-testid="format-report">
      <CatalogPanel />
      <div className="fmt-source"><strong>{model.sourceName}</strong><span>{String(model.format).toUpperCase()}</span></div>
      <div className="fmt-stats">
        <div><b>{bricks + model.instances.length}</b><small>{t('format.total')}</small></div>
        <div><b>{model.instances.length}</b><small>{t('format.instances')}</small></div>
        <div><b>{parts}</b><small>{t('format.parts')}</small></div>
        <div><b>{colors}</b><small>{t('format.colors')}</small></div>
      </div>
      <ImportPartNotification model={model} dismissible={false} />
      {(warnings.length > 0 || unsupported > 0) && (
        <div className="fmt-warn" role="status">
          <AlertTriangle size={15} />
          <span>{warnings.length === 1 ? t('format.warningCount.one') : t('format.warningCount', { count: warnings.length })}{unsupported ? ` · ${t('format.unsupported', { count: unsupported })}` : ''}. {t('format.detailsPreserved')}</span>
        </div>
      )}
      {warnings.length > 0 && (
        <details className="fmt-details" open>
          <summary>{t('format.warningsTitle', { count: warnings.length })} <ChevronDown size={14} /></summary>
          <ul>{warnings.map((issue, n) => (
            <li key={n}><code>{issue.code}</code><span>{localizedImportIssue(issue, t, issue.message)}</span>
              {(issue.reference || issue.count) && <small>{issue.reference ?? ''}{issue.count ? ` · ${issue.count}×` : ''}</small>}
            </li>
          ))}</ul>
        </details>
      )}
      {information.length > 0 && (
        <details className="fmt-details" data-testid="import-catalog-information">
          <summary>{t('format.catalogInfo', { count: information.length })} <ChevronDown size={14} /></summary>
          <p className="fmt-muted">{t('format.catalogInfoDisclaimer')}</p>
          <ul>{information.map((issue, index) => (
            <li key={index}><span>{localizedImportIssue(issue, t, issue.message)}</span>
              {issue.code === 'missing-bl-part' && <small>{t('format.ldrawUnmapped', { ids: [...new Set(model.instances.filter(instance => !instance.part.brickLinkId).map(instance => instance.part.ldrawId))].join(', ') })}</small>}
              {issue.reference && <small>{issue.code.startsWith('io-geometry-') ? issue.reference : `LDraw ${issue.reference}`}</small>}
            </li>
          ))}</ul>
        </details>
      )}
      <details className="fmt-details">
        <summary>{t('format.mappingDetails', { count: groups.size })} <ChevronDown size={14} /></summary>
        <p className="fmt-muted">{t('format.mappingEvidence')}</p>
        <ul>{[...groups.values()].map(({ instance: i, count }) => (
          <li key={i.id} className="fmt-map">
            <i style={{ background: i.color?.hex ?? '#ccc' }} />
            <span><b>{i.part.name ?? i.reference} · {count}×</b>
              <small>LDraw {i.part.ldrawId} · BrickLink {i.part.brickLinkId ?? '—'} · Studio {i.part.studioId ?? '—'}</small>
              <small>{t('format.rebrickable')} {i.part.mapping?.rebrickableIds?.join(', ') || t('format.idMissing')} · {t('format.catalogVersion')} {i.part.mapping?.catalogVersion ?? t('format.storedEvidence')}</small>
              <small>{i.part.mapping?.status === 'confirmed' ? t('format.mappingStatus') : i.part.mapping?.status === 'ambiguous' ? t('format.mappingAmbiguous') : t('format.mappingUnknown')}</small>
              {i.part.mapping?.candidates.map((e, n) => (
                <small key={n}>
                  BrickLink {e.brickLinkId} · {e.name} · Variante: {e.variant}<br />
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer">{t('format.downloadSource', { id: e.ldrawId })}</a>
                  {' · '}{e.author} · {e.license} · {e.mappingSet} / {e.version}<br />
                  {t('format.evidence', { line: e.sourceLine })}<br />
                  <span style={{ overflowWrap: 'anywhere' }}>{t('format.sourceHash', { hash: e.sourceSha256 })}</span>
                </small>
              ))}
              <small>{t('format.color')} {i.color?.name ?? `Code ${i.colorCode}`} · LDraw {i.color?.ldrawCode ?? i.colorCode} · BrickLink {i.color?.brickLinkName ?? '—'} {i.color?.brickLinkId ?? '—'} · Studio {i.color?.studioId ?? '—'}</small>
              {i.color && <small>{t('format.colorMapping', { source: i.color.source })}</small>}
              {i.color?.catalog && <small>{t('format.rebrickable')} {t('format.colors')} {i.color.catalog.rebrickableIds.join(', ')} · {i.color.catalog.status === 'ambiguous' ? t('format.colorAmbiguous', { ids: i.color.catalog.brickLinkIds.join(', ') }) : i.color.catalog.status === 'confirmed' ? t('format.colorConfirmed') : t('format.colorNoTarget')}</small>}
            </span>
            <em className={`fmt-status s-${i.part.status}`}>{i.part.status === 'resolved' ? t('format.geometryLoaded') : t('format.missing')}</em>
          </li>
        ))}</ul>
      </details>
      <p className="fmt-muted">{t('format.sourcePreserved', { count: Object.keys(model.resources ?? {}).length })}</p>
      <p className="fmt-muted">{t('format.exportDetails')}</p>
      <details className="fmt-details">
        <summary>{t('format.geometryLicenses')} <ChevronDown size={14} /></summary>
        <p className="fmt-muted">{t('format.ldrawLicense')}</p>
        <ul>{Object.values(model.resources).map(file => (
          <li key={file.path}>{file.license === "Project-source" ? <code>{file.sourceArchivePath}</code> : <a href={file.sourceUrl} target="_blank" rel="noreferrer">{file.path}</a>}
            <span>{file.author} · {file.license === "Project-source" ? t('format.projectFile') : file.license}</span>
            {file.sha256 && <small style={{ overflowWrap: 'anywhere' }}>{t('format.sourceHash', { hash: file.sha256 })}<br />{file.retrievalSource}</small>}
          </li>
        ))}</ul>
        {model.legalDocuments.map((doc, index) => (
          <details key={`${doc.name}-${index}`}><summary>{doc.name}</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 10 }}>{doc.content}</pre></details>
        ))}
      </details>
    </div>
  );
}

export default function FormatDialog({ document, viewExporterRef, initialMode = 'import', onClose, onImport }: Props) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<BuilderDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<ExportFormat | ViewFormat | null>(null);
  const [rendered, setRendered] = useState(false);
  const [viewProgress, setViewProgress] = useState<ViewExportProgress | null>(null);
  const [viewCancelled, setViewCancelled] = useState(false);
  const viewController = useRef<AbortController | null>(null);
  const [exportError, setExportError] = useState('');
  const [partsListIssues, setPartsListIssues] = useState<PartsListIssue[]>([]);
  const [partsListExported, setPartsListExported] = useState(false);
  const token = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<GeometryProgress | null>(null);
  const [mode, setMode] = useState<'import' | 'export'>(initialMode);
  useEffect(() => () => {
    controller.current?.abort(); viewController.current?.abort(); viewController.current = null; token.current++;
  }, []);

  const close = () => { viewController.current?.abort(); onClose(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !creating) { viewController.current?.abort(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating, onClose]);

  const pick = async (file: File | undefined) => {
    const id = ++token.current;
    controller.current?.abort();
    const operation = new AbortController(); controller.current = operation;
    setProgress(null);
    setPreview(null); setError(''); setBusy(false);
    if (!file) return;
    setFileName(file.name);
    try { validateImportFile(file); }
    catch (e) { setError(e instanceof Error ? e.message : t('format.readFailure')); return; }
    setBusy(true);
    try {
      const doc = await importModelFile(file, { signal: operation.signal,
        onProgress: value => { if (id === token.current) setProgress(value); } });
      if (id === token.current) setPreview(doc);
    } catch (e) {
      if (id === token.current) setError(e instanceof Error ? e.message : t('format.readFailure'));
    } finally { if (id === token.current) setBusy(false); }
  };

  const create = async () => {
    if (!preview) return;
    setCreating(true); setError('');
    try { await onImport(preview); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : t('format.projectFailure')); }
    finally { setCreating(false); }
  };

  const doExport = async (format: ExportFormat) => {
    setRendered(false);
    setViewCancelled(false);
    setExporting(format); setExportError(''); setPartsListIssues([]); setPartsListExported(false);
    try {
      const { bytes, filename, mime } = await exportModel(document, format);
      await exportFile(bytes, filename, mime);
      setPartsListExported(format === 'bricklink');
    } catch (e) {
      setExportError(e instanceof Error ? e.message : t('format.exportError'));
      if (e instanceof BrickLinkExportError) setPartsListIssues(e.issues);
    }
    finally { setExporting(null); }
  };

  const doRender = async (format: ViewFormat) => {
    if (viewController.current) return;
    const operation = new AbortController();
    viewController.current = operation;
    setExporting(format); setExportError(''); setRendered(false);
    setViewCancelled(false);
    setViewProgress(format === 'svg' ? { phase: 'project', completed: 0 } : null);
    setPartsListIssues([]); setPartsListExported(false);
    try {
      // Let the busy state paint before geometry traversal and GPU rendering.
      await new Promise(resolve => setTimeout(resolve, 40));
      if (operation.signal.aborted) throw new ViewExportError('cancelled');
      const exporter = viewExporterRef?.current;
      if (!exporter) throw new ViewExportError('unavailable');
      const bytes = await exporter(format, {
        signal: operation.signal,
        onProgress: value => { if (!operation.signal.aborted) setViewProgress(value); },
      });
      if (operation.signal.aborted) throw new ViewExportError('cancelled');
      setViewProgress(null);
      const filename = `${document.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'model'}-4k.${format}`;
      await exportFile(bytes, filename, format === 'png' ? 'image/png' : 'image/svg+xml');
      if (!operation.signal.aborted) setRendered(true);
    } catch (error) {
      if (viewController.current !== operation) return;
      if (operation.signal.aborted || (error instanceof ViewExportError && error.reason === 'cancelled')) {
        if (viewController.current === operation) setViewCancelled(true);
        return;
      }
      setExportError(error instanceof ViewExportError
        ? t(`render.${error.reason}`)
        : t('render.failed'));
    } finally {
      if (viewController.current === operation) {
        viewController.current = null;
        setViewProgress(null); setExporting(null);
      }
    }
  };

  const shown = (preview ?? document) as WithImported;

  return (
    <div className="drawer-scrim fmt-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !creating) close(); }}>
      <section className="parts-drawer fmt-drawer rise-in" role="dialog" aria-modal="true" aria-labelledby="fmt-title" data-testid="dialog-formats">
        <div className="drawer-handle" />
        <div className="drawer-heading">
          <div><p className="popover-eyebrow">{t('format.files')}</p><h2 id="fmt-title">{mode === 'import' ? t('format.import') : t('format.export')}</h2></div>
          <button type="button" className="icon-button" onClick={close} disabled={creating} aria-label={t('format.close')} data-testid="button-close-formats"><X size={18} /></button>
        </div>

        <div className="fmt-mode-tabs" role="tablist" aria-label={t('format.fileAction')}>
          <button type="button" role="tab" aria-selected={mode === 'import'} className={mode === 'import' ? 'is-active' : ''}
            disabled={exporting !== null} onClick={() => setMode('import')} data-testid="tab-format-import"><FileUp size={16} /> {t('format.importTab')}</button>
          <button type="button" role="tab" aria-selected={mode === 'export'} className={mode === 'export' ? 'is-active' : ''}
            onClick={() => setMode('export')} data-testid="tab-format-export"><Download size={16} /> {t('format.exportTab')}</button>
        </div>

        {mode === 'import' && <div className="fmt-section">
          <h3><span>01</span> {t('format.importSection')}</h3>
          <label className="fmt-drop">
            <FileUp size={20} />
            <span><b>{fileName || t('format.chooseFile')}</b><small>{t('format.fileSupport')}</small></span>
            <input type="file" accept={importFileAccept('model')} disabled={creating} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-import-file" />
          </label>
          {busy && <div className="fmt-loading" role="status" style={{ flexWrap: 'wrap' }}>
            <LoaderCircle className="spin" size={15} />
            <span>{progress ? t('format.checkParts', { roots: progress.roots, total: progress.total, files: progress.files, size: (progress.bytes / 1024 / 1024).toFixed(1) }) : t('format.fileLoading')}
              {progress?.reference && <small style={{ display: 'block', overflowWrap: 'anywhere' }}>LDraw {progress.reference}</small>}</span>
            <button type="button" onClick={() => controller.current?.abort()} data-testid="button-cancel-geometry">{t('format.cancelDownload')}</button>
          </div>}
          {error && <div className="fmt-error" role="alert" data-testid="status-import-error">{error}</div>}
          {preview && (
            <button type="button" className="confirm-button fmt-create" onClick={() => void create()} disabled={creating || busy} data-testid="button-create-imported">
              {creating ? <><LoaderCircle className="spin" size={15} /> {t('format.creating')}</> : t('format.createProject')}
            </button>
          )}
          {(preview || !busy) && (
            <>
              <p className="fmt-label">{preview ? t('format.preview') : t('format.currentProject')}</p>
              <Report model={shown.imported} bricks={shown.bricks.length} />
              {preview && !shown.imported && <p className="fmt-muted">{t('format.checkedJson', { count: shown.bricks.length })}</p>}
            </>
          )}
        </div>}

        {mode === 'export' && <div className="fmt-section">
          <h3><span>02</span> {t('format.exportSection')}</h3>
          <div className="fmt-exports">
            {EXPORTS.map((x) => (
              <button key={x.format} type="button" className="fmt-export" onClick={() => void doExport(x.format)} disabled={exporting !== null} data-testid={`button-export-${x.format}`}>
                {exporting === x.format ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
                <span><b>{t(x.label)}</b><small>{t(x.note)}</small></span>
              </button>
            ))}
          </div>
          <h3>{t('render.title')}</h3>
          <p className="fmt-muted">{t('render.note')}</p>
          <div className="fmt-exports">
            {(['png', 'svg'] as const).map(format => <button key={format} type="button"
              className="fmt-export" disabled={exporting !== null}
              onClick={() => void doRender(format)} data-testid={`button-export-${format}`}>
              {exporting === format ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
              <span><b>{t(format === 'png' ? 'render.png' : 'render.svg')}</b>
                <small>{t(format === 'png' ? 'render.pngNote' : 'render.svgNote')}</small></span>
            </button>)}
          </div>
          {viewProgress && <div className="fmt-loading" role="status" style={{ flexWrap: 'wrap' }} data-testid="status-svg-progress">
            <LoaderCircle className="spin" size={15} />
            <span>{t(`render.progress.${viewProgress.phase}`, { count: viewProgress.completed })}
              <progress aria-label={t('render.svg')} max={viewProgress.total || 1}
                value={viewProgress.total ? viewProgress.completed : undefined} style={{ display: 'block', width: '100%' }} />
            </span>
            <button type="button" onClick={() => viewController.current?.abort()} data-testid="button-cancel-view-export">{t('render.cancel')}</button>
          </div>}
          {viewCancelled && <p className="fmt-muted" role="status">{t('render.cancelled')}</p>}
          {rendered && <p className="fmt-muted" role="status">{t('render.ready')}</p>}
          {exportError && <div className="fmt-error" role="alert" data-testid="status-export-error">{exportError}</div>}
          {partsListIssues.length > 0 && <div className="fmt-error" data-testid="bricklink-export-issues">
            <b>{t('format.unmappedCount', { count: partsListIssues.reduce((sum, issue) => sum + issue.quantity, 0) })}</b>
            <ul>{partsListIssues.slice(0, 50).map((issue, index) => <li key={index}>
              {issue.quantity}× {issue.reference} · {issue.color}: {issue.reason}
            </li>)}</ul>
            {partsListIssues.length > 50 && <p>{t('format.moreRows', { count: partsListIssues.length - 50 })}</p>}
          </div>}
          {partsListExported && <p role="status" className="fmt-muted">{t('format.bricklinkReady')}</p>}
          <p className="fmt-muted">{t('format.bricklinkCoverage')}</p>
          <p className="fmt-muted" data-testid="text-inventory-backup-notice">{t('format.inventoryBackup')}</p>
        </div>}
      </section>
    </div>
  );
}
