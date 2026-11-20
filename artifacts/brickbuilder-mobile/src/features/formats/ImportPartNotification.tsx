import { useId, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { ImportedModel } from './types';
import { getImportPartFailures } from './import-failures';
import './import-part-notification.css';
import { useI18n } from '@/i18n/I18nProvider';
import { localizedImportIssue } from './issue-message';

interface Props {
  model?: ImportedModel;
  dismissible?: boolean;
  floating?: boolean;
}

export default function ImportPartNotification({ model, dismissible = true, floating = false }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const failures = useMemo(() => getImportPartFailures(model), [model]);
  const signature = JSON.stringify(failures);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!failures.length || (dismissible && dismissed === signature)) return null;
  const count = failures.reduce((sum, part) => sum + part.count, 0);

  return (
    <aside
      className={`import-part-notification${floating ? ' import-part-notification-floating' : ''}`}
      role="alert"
      aria-labelledby={titleId}
      data-testid="notification-import-parts"
    >
      <div className="import-part-notification-heading">
        <AlertTriangle size={20} aria-hidden="true" />
        <strong id={titleId}>{t('import.incomplete')}</strong>
        {dismissible && (
          <button type="button" onClick={() => setDismissed(signature)} aria-label={t('common.close')}>
            <X size={19} aria-hidden="true" />
          </button>
        )}
      </div>
      <p>{t('import.notRendered')}: {count} {t(count === 1 ? 'import.instance' : 'import.instances')} · {failures.length} {t(failures.length === 1 ? 'import.partNumber' : 'import.partNumbers')}</p>
      <ul aria-label={t('import.nonImportable')} tabIndex={0}>
        {failures.map(part => (
          <li key={part.reference.toLowerCase()}>
            <strong>LDraw {part.ldrawId} · {part.count}×</strong>
            {part.brickLinkIds.length > 0 && <span>BrickLink {part.brickLinkIds.join(', ')}</span>}
            {part.reasonCodes.map(code => <span key={code}>{localizedImportIssue({ code, reference: part.reference }, t)}</span>)}
          </li>
        ))}
      </ul>
      <small>{t('import.sourcePreserved')}</small>
    </aside>
  );
}
