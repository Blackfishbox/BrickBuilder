import { useEffect, useId, useRef, useState } from "react";
import { Rotate3d } from "lucide-react";
import "./rotation-controls.css";

export default function RotationControls({
  rotation,
  onChange,
}: {
  rotation: number;
  onChange(angle: number): void;
}) {
  const [draft, setDraft] = useState(String(Math.round(rotation)));
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    if (!editing) setDraft(String(Math.round(rotation)));
  }, [editing, rotation]);

  const commit = (raw: string) => {
    if (!/^\d+$/.test(raw)) {
      setDraft(String(Math.round(rotation)));
      return;
    }
    const angle = Math.max(0, Math.min(360, Number(raw)));
    setDraft(String(angle));
    onChange(angle);
  };

  const adjust = (raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const angle = Math.max(0, Math.min(360, Math.round(value)));
    setDraft(String(angle));
    onChange(angle);
  };

  return (
    <details className="rotation-controls">
      <summary aria-label="Drehung einstellen"><Rotate3d size={15} /><span>Drehung</span></summary>
      <div className="rotation-panel" role="group" aria-label="Stein drehen">
        <strong>Drehung</strong>
        <small>0° bis 360° · nur ganze Grad</small>
        <div className="rotation-slider">
          <label htmlFor={`${id}-slider`}>Winkel</label>
          <input
            id={`${id}-slider`}
            type="range"
            min="0"
            max="360"
            step="1"
            value={Math.max(0, Math.min(360, Math.round(rotation)))}
            aria-label="Drehung"
            aria-valuetext={`${Math.round(rotation)} Grad`}
            data-testid="slider-rotation"
            onPointerDown={() => input.current?.blur()}
            onChange={event => adjust(event.currentTarget.value)}
          />
          <output htmlFor={`${id}-slider`} data-testid="value-rotation">{Math.round(rotation)}°</output>
        </div>
        <label className="rotation-number">
          <span>Y</span>
          <input
            ref={input}
            type="number"
            inputMode="numeric"
            min="0"
            max="360"
            step="1"
            aria-label="Drehung Y in Grad"
            data-testid="input-rotation"
            value={draft}
            onChange={event => {
              if (/^\d*$/.test(event.target.value)) setDraft(event.target.value);
              else event.currentTarget.value = draft;
            }}
            onFocus={() => setEditing(true)}
            onBlur={event => { commit(event.currentTarget.value); setEditing(false); }}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
          />
          <b>°</b>
        </label>
      </div>
    </details>
  );
}
