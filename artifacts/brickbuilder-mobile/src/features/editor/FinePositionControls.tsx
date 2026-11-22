import { useId, useState } from "react";
import type { Position3 } from "./model";
import {
  ArrowDown,
  ArrowDownFromLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpFromLine,
  Move3d,
  type LucideIcon,
} from "lucide-react";
import "./fine-position.css";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageId } from "@/i18n/messages";
import DraggablePanel from "./DraggablePanel";

const directions: { label: MessageId; axis: keyof Position3; sign: number; Icon: LucideIcon }[] = [
  { label: "fine.left", axis: "x", sign: -1, Icon: ArrowLeft },
  { label: "fine.right", axis: "x", sign: 1, Icon: ArrowRight },
  { label: "fine.forward", axis: "z", sign: -1, Icon: ArrowUp },
  { label: "fine.back", axis: "z", sign: 1, Icon: ArrowDown },
  { label: "fine.up", axis: "y", sign: 1, Icon: ArrowUpFromLine },
  { label: "fine.down", axis: "y", sign: -1, Icon: ArrowDownFromLine },
];
export default function FinePositionControls({ onNudge, onOpenChange, portalOnMobile = false, open }: {
  onNudge(delta: Position3): void;
  onOpenChange?(open: boolean): void;
  portalOnMobile?: boolean;
  open?: boolean;
}) {
  const { t } = useI18n();
  const panelId = `fine-position-panel-${useId().replace(/:/g, "")}`;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return <div className="fine-position" data-open={isOpen} data-testid="fine-position-menu">
    <button type="button" className={`fine-position-toggle${isOpen ? " is-open" : ""}`} aria-expanded={isOpen}
      aria-controls={panelId} aria-label={t("fine.open")} title={t("fine.title")}
      data-testid="button-fine-adjustment" onClick={toggle}>
      <Move3d size={18} aria-hidden="true" />
    </button>
    <DraggablePanel className="fine-position-panel" panelId={panelId} title={t("fine.axes")}
      headingClassName="fine-position-heading" handleTestId="button-move-fine-panel"
      portalOnMobile={portalOnMobile} hidden={!isOpen}>
      <small>{t("fine.step")}</small>
      <div className="fine-position-grid">
        {directions.map(({ label, axis, sign, Icon }) => <button key={label} type="button"
          aria-label={`${t("fine.title")}: ${t(label)}`} title={t(label)}
          data-testid={`button-nudge-${axis}-${sign < 0 ? "negative" : "positive"}`}
          onClick={() => onNudge({ x: 0, y: 0, z: 0, [axis]: sign * 0.05 })}>
          <Icon size={18} aria-hidden="true" />
        </button>)}
      </div>
    </DraggablePanel>
  </div>;
}
