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

const directions: { label: string; axis: keyof Position3; sign: number; Icon: LucideIcon }[] = [
  { label: "Links · X−", axis: "x", sign: -1, Icon: ArrowLeft },
  { label: "Rechts · X+", axis: "x", sign: 1, Icon: ArrowRight },
  { label: "Vor · Z−", axis: "z", sign: -1, Icon: ArrowUp },
  { label: "Zurück · Z+", axis: "z", sign: 1, Icon: ArrowDown },
  { label: "Höher · Y+", axis: "y", sign: 1, Icon: ArrowUpFromLine },
  { label: "Tiefer · Y−", axis: "y", sign: -1, Icon: ArrowDownFromLine },
];
export default function FinePositionControls({ onNudge, onOpenChange }: {
  onNudge(delta: Position3): void;
  onOpenChange?(open: boolean): void;
}) {
  return <details className="fine-position" data-testid="fine-position-menu" onToggle={event => onOpenChange?.(event.currentTarget.open)}>
    <summary aria-label="Feinjustierung öffnen" title="Feinjustierung" data-testid="button-fine-adjustment">
      <Move3d size={18} aria-hidden="true" />
    </summary>
    <div className="fine-position-panel" role="group" aria-label="Feinjustierung in Weltachsen">
      <strong>Feinjustierung</strong>
      <small>1 LDU (0,4 mm) pro Schritt · Weltachsen</small>
      <div className="fine-position-grid">
        {directions.map(({ label, axis, sign, Icon }) => <button key={label} type="button"
          aria-label={`Feinjustierung: ${label}`} title={label}
          data-testid={`button-nudge-${axis}-${sign < 0 ? "negative" : "positive"}`}
          onClick={() => onNudge({ x: 0, y: 0, z: 0, [axis]: sign * 0.05 })}>
          <Icon size={18} aria-hidden="true" />
        </button>)}
      </div>
    </div>
  </details>;
}
