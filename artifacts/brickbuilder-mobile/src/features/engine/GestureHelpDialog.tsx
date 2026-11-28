import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/I18nProvider";
import { GESTURE_GUIDE_SECTIONS, HELP_BUTTON_SECTIONS, HELP_MODE_OVERVIEW } from "./gesture-guide";

export default function GestureHelpDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="gesture-guide-dialog" scrollable={false} data-testid="dialog-gesture-help">
        <div className="gesture-guide-scroll-area">
          <DialogHeader className="gesture-guide-header">
            <DialogTitle className="gesture-guide-title">{t("gesture.title")}</DialogTitle>
            <DialogDescription className="gesture-guide-intro">{t("gesture.intro")}</DialogDescription>
          </DialogHeader>
          <div className="gesture-guide-sections">
            <section aria-labelledby="help-mode-overview">
              <h3 id="help-mode-overview">{t("help.section.modes")}</h3>
              <div className="gesture-guide-modes">
                {HELP_MODE_OVERVIEW.map(({ icon: Icon, title, description }) => (
                  <article className="gesture-guide-mode" key={title}>
                    <span className="gesture-guide-button-visual" aria-hidden="true">{Icon && <Icon size={18} />}</span>
                    <div><strong>{t(title)}</strong><p>{t(description)}</p></div>
                  </article>
                ))}
              </div>
            </section>
            {HELP_BUTTON_SECTIONS.map(section => (
              <section key={section.title} aria-labelledby={`help-section-${section.title}`}>
                <h3 id={`help-section-${section.title}`}>{t(section.title)}</h3>
                <ul className="gesture-guide-buttons">
                  {section.buttons.map(({ icon: Icon, title, description, additionalDescription }, index) => (
                    <li key={`${title}-${index}`} className={Icon ? undefined : "gesture-guide-text-only"}>
                      {Icon && <span className="gesture-guide-button-visual" aria-hidden="true"><Icon size={17} /></span>}
                      <div>
                        <strong>{t(title)}</strong>
                        <p>{t(description)}</p>
                        {additionalDescription && <p>{t(additionalDescription)}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {GESTURE_GUIDE_SECTIONS.map(section => (
              <section key={section.title} aria-labelledby={`gesture-section-${section.title}`}>
                <h3 id={`gesture-section-${section.title}`}>{t(section.title)}</h3>
                <ul>
                  {section.gestures.map(gesture => (
                    <li key={gesture.title}>
                      <strong>{t(gesture.title)}</strong>
                      <p>{t(gesture.description)}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
