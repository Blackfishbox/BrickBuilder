import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/I18nProvider";
import { GESTURE_GUIDE_SECTIONS } from "./gesture-guide";

export default function GestureHelpDialog({ onClose }: { onClose(): void }) {
  const { t } = useI18n();

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="gesture-guide-dialog" data-testid="dialog-gesture-help">
        <DialogHeader className="gesture-guide-header">
          <DialogTitle className="gesture-guide-title">{t("gesture.title")}</DialogTitle>
          <DialogDescription className="gesture-guide-intro">{t("gesture.intro")}</DialogDescription>
        </DialogHeader>
        <div className="gesture-guide-sections">
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
      </DialogContent>
    </Dialog>
  );
}
