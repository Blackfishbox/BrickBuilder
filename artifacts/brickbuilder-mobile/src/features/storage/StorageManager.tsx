import { useCallback, useEffect, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Database, Download, HardDrive, LoaderCircle, Lock, Package, RefreshCw, Shapes, Trash2, X } from 'lucide-react';
import {
  getStorageOverview,
  removeGeometrySnapshot,
  removeInstalledPackage,
  removeStoredProject,
  type StorageEntry,
  type StorageOverview,
} from '@/storage/management';
import { loadProject } from '@/storage/database';
import { exportModel } from '@/features/formats/adapters';
import './storage-manager.css';
import { exportFile } from '@/platform/export-file';
import { useI18n } from '@/i18n/I18nProvider';
import { isGeneratedProjectName } from '@/i18n/project-name';

interface Props {
  currentProjectId: string;
  onClose: () => void;
  onProjectsChanged: () => Promise<unknown>;
}

type Pending = { kind: 'project' | 'package'; entry: StorageEntry } | null;

export function formatBytes(bytes: number, locale: 'en' | 'de' = 'en'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return locale === 'de' ? 'unbekannt' : 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString(locale === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

const sum = (list: StorageEntry[]) => list.reduce((total, item) => total + item.bytes, 0);
const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export default function StorageManager({ currentProjectId, onClose, onProjectsChanged }: Props) {
  const { locale, t } = useI18n();
  const displayEntryName = (name: string) => isGeneratedProjectName(name) ? t('project.new') : name;
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [confirmError, setConfirmError] = useState('');
  const alive = useRef(true);
  const lock = useRef(false);
  const loadToken = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true); setLoadError('');
    try {
      const next = await getStorageOverview();
      if (alive.current && token === loadToken.current) setOverview(next);
    } catch (error) {
      if (alive.current && token === loadToken.current) setLoadError(message(error, t('storage.loadError')));
    } finally {
      if (alive.current && token === loadToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const exportProject = async (entry: StorageEntry) => {
    if (exportingId) return;
    setExportingId(entry.id); setActionError(''); setConfirmError('');
    try {
      const document = await loadProject(entry.id);
      if (!document) throw new Error(t('storage.notFound'));
      const { bytes, filename, mime } = await exportModel(document, 'json');
      await exportFile(bytes, filename, mime);
      if (alive.current) setNotice(t('storage.backupReady', { file: filename }));
    } catch (error) {
      const text = message(error, t('storage.exportError'));
      if (alive.current) { if (pending) setConfirmError(text); else setActionError(text); }
    } finally {
      if (alive.current) setExportingId(null);
    }
  };

  const run = async (id: string, task: () => Promise<void>, done: string, inDialog: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusyId(id); setActionError(''); setConfirmError(''); setNotice('');
    try {
      await task();
      if (!alive.current) return;
      setPending(null);
      setNotice(done);
      await refresh();
    } catch (error) {
      const text = message(error, t('storage.actionError'));
      if (alive.current) { if (inDialog) setConfirmError(text); else setActionError(text); }
    } finally {
      lock.current = false;
      if (alive.current) setBusyId(null);
    }
  };

  const confirmPending = () => {
    if (!pending) return;
    const { kind, entry } = pending;
    if (kind === 'project') {
      void run(entry.id, async () => {
        await removeStoredProject(entry.id, currentProjectId);
        await onProjectsChanged().catch(() => undefined);
      }, t('storage.projectDeleted', { name: displayEntryName(entry.name) }), true);
    } else {
      void run(entry.id, () => removeInstalledPackage(entry.id), t('storage.packageRemoved', { name: entry.name }), true);
    }
  };

  const removeSnapshot = (entry: StorageEntry) =>
    void run(entry.id, () => removeGeometrySnapshot(entry.id), t('storage.snapshotRemoved', { name: entry.name }), false);

  const busy = busyId !== null || exportingId !== null;
  const browser = overview?.browser;
  const hasUsage = typeof browser?.usage === 'number' && Number.isFinite(browser.usage);
  const hasQuota = typeof browser?.quota === 'number' && Number.isFinite(browser.quota) && browser.quota > 0;
  const ratio = hasUsage && hasQuota ? Math.min(1, browser!.usage! / browser!.quota!) : null;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <div className="drawer-scrim sm-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <Dialog.Content asChild aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}>
      <section className="parts-drawer sm-drawer rise-in" role="dialog" aria-modal="true" aria-labelledby="sm-title" data-testid="dialog-storage">
        <div className="drawer-handle" />
        <div className="drawer-heading">
          <div><p className="popover-eyebrow">{t('storage.eyebrow')}</p><Dialog.Title asChild><h2 id="sm-title">{t('storage.title')}</h2></Dialog.Title></div>
          <div className="sm-head-actions">
            <button type="button" className="icon-button" onClick={() => void refresh()} disabled={loading || busy} aria-label={t('storage.refresh')} data-testid="button-refresh-storage">
              <RefreshCw size={17} className={loading ? 'spin' : undefined} />
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label={t('storage.close')} data-testid="button-close-storage"><X size={18} /></button>
          </div>
        </div>

        <div className="sm-gauge" data-testid="status-browser-storage">
          <div className="sm-gauge-top">
            <HardDrive size={17} />
            <div>
              <strong>{t('storage.browserTitle')}</strong>
              {loading && !overview ? <span className="sm-skel sm-skel-line" /> : hasUsage ? (
                <span data-testid="text-browser-usage">{t('storage.used', { used: formatBytes(browser!.usage!, locale) })}{hasQuota ? t('storage.ofApprox', { size: formatBytes(browser!.quota!, locale) }) : ''}</span>
              ) : (
                <span data-testid="text-browser-usage-unavailable">{t('storage.unavailable')}{browser?.error ? ` (${browser.error})` : ''}</span>
              )}
            </div>
          </div>
          {ratio !== null && <div className="sm-bar" role="progressbar" aria-label={t('storage.usedAria')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}><i style={{ transform: `scaleX(${Math.max(ratio, 0.01)})` }} /></div>}
          <p>{t('storage.browserInfo')}</p>
        </div>

        <div className="sm-warning" role="note">
          <AlertTriangle size={16} />
          <p>{t('storage.backupWarning')}</p>
        </div>

        {notice && <div className="sm-notice" role="status" data-testid="status-storage-notice">{notice}</div>}
        {actionError && <div className="fmt-error sm-error" role="alert" data-testid="status-storage-error">{actionError}</div>}

        {loadError && !loading ? (
          <div className="sm-state" role="alert" data-testid="status-storage-load-error">
            <AlertTriangle size={20} /><strong>{t('storage.overviewUnavailable')}</strong><span>{loadError}</span>
            <button type="button" className="cancel-button sm-btn" onClick={() => void refresh()} data-testid="button-retry-storage">{t('storage.retry')}</button>
          </div>
        ) : loading && !overview ? (
          <div className="sm-loading" aria-busy="true" data-testid="status-storage-loading">
            {[0, 1, 2].map((n) => <div key={n} className="sm-skel sm-skel-row" />)}
            <span className="sr-only">{t('storage.loading')}</span>
          </div>
        ) : overview && (
          <>
            <Group index="01" icon={<Database size={15} />} title={t('storage.projects')} entries={overview.projects} empty={t('storage.noProjects')} locale={locale}>
              {(entry) => {
                const active = entry.id === currentProjectId;
                return (
                  <>
                    <button type="button" className="sm-btn sm-ghost" onClick={() => void exportProject(entry)} disabled={exportingId !== null} data-testid={`button-export-project-${entry.id}`}>
                      {exportingId === entry.id ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} {t('storage.backupJson')}
                    </button>
                    {active ? (
                      <span className="sm-active" data-testid={`status-active-project-${entry.id}`}><Lock size={13} /> {t('storage.openDelete')}</span>
                    ) : (
                      <button type="button" className="sm-btn sm-danger" onClick={() => { setConfirmError(''); setPending({ kind: 'project', entry }); }} disabled={busy} data-testid={`button-delete-project-${entry.id}`}>
                        <Trash2 size={14} /> {t('storage.delete')}
                      </button>
                    )}
                  </>
                );
              }}
            </Group>
            <Group index="02" icon={<Package size={15} />} title={t('storage.packages')} entries={overview.packages} empty={t('storage.noPackages')} locale={locale}>
              {(entry) => (
                <button type="button" className="sm-btn sm-danger" onClick={() => { setConfirmError(''); setPending({ kind: 'package', entry }); }} disabled={busy} data-testid={`button-remove-package-${entry.id}`}>
                  <Trash2 size={14} /> {t('storage.remove')}
                </button>
              )}
            </Group>
            <Group index="03" icon={<Shapes size={15} />} title={t('storage.snapshots')} entries={overview.snapshots} empty={t('storage.noSnapshots')} note={t('storage.snapshotInfo')} locale={locale}>
              {(entry) => (
                <button type="button" className="sm-btn sm-ghost" onClick={() => removeSnapshot(entry)} disabled={busy} data-testid={`button-remove-snapshot-${entry.id}`}>
                  {busyId === entry.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} {t('storage.remove')}
                </button>
              )}
            </Group>
          </>
        )}
      </section>
      </Dialog.Content>

      <AlertDialog.Root open={pending !== null} onOpenChange={(open) => { if (!open && !busy) setPending(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="sm-overlay" />
          <AlertDialog.Content className="confirm-card sm-confirm" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} data-testid="dialog-confirm-storage">
            <div className="confirm-icon"><Trash2 size={20} /></div>
            <AlertDialog.Title asChild>
              <h2>{pending?.kind === 'project' ? t('storage.deleteProjectTitle') : t('storage.removePackageTitle')}</h2>
            </AlertDialog.Title>
            <AlertDialog.Description asChild>
              {pending?.kind === 'project' ? (
                <div className="sm-confirm-copy">
                  <p>{t('storage.deleteProjectWarning', { name: displayEntryName(pending.entry.name), size: formatBytes(pending.entry.bytes, locale) })}</p>
                  <p>{t('storage.backupFirst')}</p>
                </div>
              ) : (
                <div className="sm-confirm-copy">
                  <p>{t('storage.packageWarning', { name: pending?.entry.name ?? '' })}</p>
                  <p>{t('storage.savedResources')}</p>
                </div>
              )}
            </AlertDialog.Description>
            {pending?.kind === 'project' && (
              <button type="button" className="sm-btn sm-ghost sm-wide" onClick={() => void exportProject(pending.entry)} disabled={exportingId !== null || busy} data-testid="button-confirm-export-project">
                {exportingId ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} {t('storage.downloadJson')}
              </button>
            )}
            {confirmError && <div className="fmt-error sm-error" role="alert" data-testid="status-confirm-error">{confirmError}</div>}
            <div className="confirm-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="cancel-button" disabled={busy} data-testid="button-cancel-storage-action">{t('storage.cancel')}</button>
              </AlertDialog.Cancel>
              <button type="button" className="confirm-button sm-confirm-go" onClick={confirmPending} disabled={busy} data-testid="button-confirm-storage-action">
                {busy ? <><LoaderCircle className="spin" size={14} /> {t('storage.running')}</> : pending?.kind === 'project' ? t('storage.deleteForever') : t('storage.remove')}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
    </Dialog.Root>
  );
}

function Group({ index, icon, title, entries, empty, note, children, locale }: {
  index: string; icon: React.ReactNode; title: string; entries: StorageEntry[]; empty: string; note?: string;
  locale: 'en' | 'de';
  children: (entry: StorageEntry) => React.ReactNode;
}) {
  const { t } = useI18n();
  const displayEntryName = (name: string) => isGeneratedProjectName(name) ? t('project.new') : name;
  return (
    <section className="sm-group" aria-labelledby={`sm-group-${index}`}>
      <h3 id={`sm-group-${index}`}><span>{index}</span>{icon}{title}<em data-testid={`text-storage-total-${index}`}>{t('storage.approx', { size: formatBytes(sum(entries), locale) })}</em></h3>
      {note && <p className="sm-note">{note}</p>}
      {entries.length ? (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} className="sm-row" data-testid={`row-storage-${entry.id}`}>
              <div className="sm-row-copy"><strong>{displayEntryName(entry.name) || t('storage.noName')}</strong><small>{entry.detail}</small></div>
              <span className="sm-size">{t('storage.approx', { size: formatBytes(entry.bytes, locale) })}</span>
              <div className="sm-row-actions">{children(entry)}</div>
            </li>
          ))}
        </ul>
      ) : <div className="sm-empty">{empty}</div>}
    </section>
  );
}
