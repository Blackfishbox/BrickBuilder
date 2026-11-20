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

const directions: { label: MessageId; axis: keyof Position3; sign: number; Icon: LucideIcon }[] = [
  { label: "fine.left", axis: "x", sign: -1, Icon: ArrowLeft },
  { label: "fine.right", axis: "x", sign: 1, Icon: ArrowRight },
  { label: "fine.forward", axis: "z", sign: -1, Icon: ArrowUp },
  { label: "fine.back", axis: "z", sign: 1, Icon: ArrowDown },
  { label: "fine.up", axis: "y", sign: 1, Icon: ArrowUpFromLine },
  { label: "fine.down", axis: "y", sign: -1, Icon: ArrowDownFromLine },
];
export default function FinePositionControls({ onNudge, onOpenChange }: {
  onNudge(delta: Position3): void;
  onOpenChange?(open: boolean): void;
}) {
  const { t } = useI18n();
  return <details className="fine-position" data-testid="fine-position-menu" onToggle={event => onOpenChange?.(event.currentTarget.open)}>
    <summary aria-label={t("fine.open")} title={t("fine.title")} data-testid="button-fine-adjustment">
      <Move3d size={18} aria-hidden="true" />
    </summary>
    <div className="fine-position-panel" role="group" aria-label={t("fine.axes")}>
      <strong>{t("fine.title")}</strong>
      <small>{t("fine.step")}</small>
      <div className="fine-position-grid">
        {directions.map(({ label, axis, sign, Icon }) => <button key={label} type="button"
          aria-label={`${t("fine.title")}: ${t(label)}`} title={t(label)}
          data-testid={`button-nudge-${axis}-${sign < 0 ? "negative" : "positive"}`}
          onClick={() => onNudge({ x: 0, y: 0, z: 0, [axis]: sign * 0.05 })}>
          <Icon size={18} aria-hidden="true" />
        </button>)}
      </div>
    </div>
  </details>;
}
