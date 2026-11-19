import { useEffect, useState } from "react";
import { Rotate3d } from "lucide-react";
import "./tilt-controls.css";

export default function TiltControls({
  tiltX,
  tiltZ,
  onTilt,
  onOpenChange,
}: {
  tiltX: number;
  tiltZ: number;
  onTilt(axis: "x" | "z", angle: number): void;
  onOpenChange?(open: boolean): void;
}) {
  const [xValue, setXValue] = useState(String(tiltX));
  const [zValue, setZValue] = useState(String(tiltZ));
  useEffect(() => setXValue(String(tiltX)), [tiltX]);
  useEffect(() => setZValue(String(tiltZ)), [tiltZ]);

  const commit = (axis: "x" | "z", raw: string) => {
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) {
      (axis === "x" ? setXValue : setZValue)(String(axis === "x" ? tiltX : tiltZ));
      return;
    }
    onTilt(axis, value);
  };

  return (
    <details className="tilt-controls" onToggle={event => onOpenChange?.(event.currentTarget.open)}>
      <summary aria-label="Neigung einstellen"><Rotate3d size={15} /><span>Neigen</span></summary>
      <div className="tilt-panel" role="group" aria-label="Stein um X- und Z-Achse neigen">
        <strong>Neigung</strong>
        <small>Winkel in Grad · frei einstellbar</small>
        <label>
          <span>X</span>
          <input type="text" inputMode="decimal" aria-label="Neigung X in Grad" data-testid="input-tilt-x"
            value={xValue} onChange={event => setXValue(event.target.value)}
            onBlur={event => commit("x", event.currentTarget.value)}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <b>°</b>
        </label>
        <label>
          <span>Z</span>
          <input type="text" inputMode="decimal" aria-label="Neigung Z in Grad" data-testid="input-tilt-z"
            value={zValue} onChange={event => setZValue(event.target.value)}
            onBlur={event => commit("z", event.currentTarget.value)}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <b>°</b>
        </label>
      </div>
    </details>
  );
}
