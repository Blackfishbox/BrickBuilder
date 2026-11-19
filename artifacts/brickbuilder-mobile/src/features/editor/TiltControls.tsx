import { useEffect, useRef, useState } from "react";
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
  const [editing, setEditing] = useState<{ x: boolean; z: boolean }>({ x: false, z: false });
  const xInput = useRef<HTMLInputElement>(null);
  const zInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing.x) setXValue(String(tiltX)); }, [tiltX, editing.x]);
  useEffect(() => { if (!editing.z) setZValue(String(tiltZ)); }, [tiltZ, editing.z]);

  const commit = (axis: "x" | "z", raw: string) => {
    const value = Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) {
      (axis === "x" ? setXValue : setZValue)(String(axis === "x" ? tiltX : tiltZ));
      return;
    }
    onTilt(axis, value);
  };

  const adjustFromSlider = (axis: "x" | "z", raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    (axis === "x" ? setXValue : setZValue)(String(value));
    onTilt(axis, value);
  };

  return (
    <details className="tilt-controls" onToggle={event => onOpenChange?.(event.currentTarget.open)}>
      <summary aria-label="Neigung einstellen"><Rotate3d size={15} /><span>Neigen</span></summary>
      <div className="tilt-panel" role="group" aria-label="Stein um X- und Z-Achse neigen">
        <strong>Neigung</strong>
        <small>Schieber ziehen oder Winkel eingeben · −180° bis 179°</small>
        {(["x", "z"] as const).map((axis) => {
          const angle = axis === "x" ? tiltX : tiltZ;
          return (
            <div className="tilt-axis-control" key={axis}>
              <label htmlFor={`tilt-slider-${axis}`}>{axis.toUpperCase()}-Achse</label>
              <input
                id={`tilt-slider-${axis}`}
                type="range"
                min="-180"
                max="179"
                step="1"
                aria-label={`Neigung ${axis.toUpperCase()}-Achse`}
                aria-valuetext={`${angle} Grad`}
                data-testid={`slider-tilt-${axis}`}
                value={Math.max(-180, Math.min(179, angle))}
                onPointerDown={() => (axis === "x" ? xInput : zInput).current?.blur()}
                onChange={event => adjustFromSlider(axis, event.currentTarget.value)}
              />
              <output htmlFor={`tilt-slider-${axis}`} data-testid={`value-tilt-${axis}`}>{angle}°</output>
            </div>
          );
        })}
        <label>
          <span>X</span>
          <input ref={xInput} type="text" inputMode="decimal" aria-label="Neigung X in Grad" data-testid="input-tilt-x"
            value={xValue} onChange={event => setXValue(event.target.value)}
            onFocus={() => setEditing(current => ({ ...current, x: true }))}
            onBlur={event => { commit("x", event.currentTarget.value); setEditing(current => ({ ...current, x: false })); }}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <b>°</b>
        </label>
        <label>
          <span>Z</span>
          <input ref={zInput} type="text" inputMode="decimal" aria-label="Neigung Z in Grad" data-testid="input-tilt-z"
            value={zValue} onChange={event => setZValue(event.target.value)}
            onFocus={() => setEditing(current => ({ ...current, z: true }))}
            onBlur={event => { commit("z", event.currentTarget.value); setEditing(current => ({ ...current, z: false })); }}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <b>°</b>
        </label>
      </div>
    </details>
  );
}
