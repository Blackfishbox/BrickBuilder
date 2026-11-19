import { useEffect, useId, useRef, useState } from "react";
import { Rotate3d } from "lucide-react";
import "./tilt-controls.css";

export default function TiltControls({
  rotationY = 0,
  onRotate,
  tiltX,
  tiltZ,
  onTilt,
  onOpenChange,
}: {
  rotationY?: number;
  onRotate?(angle: number): void;
  tiltX: number;
  tiltZ: number;
  onTilt(axis: "x" | "z", angle: number): void;
  onOpenChange?(open: boolean): void;
}) {
  const [rotationValue, setRotationValue] = useState(String(Math.round(rotationY)));
  const [xValue, setXValue] = useState(String(Math.round(tiltX)));
  const [zValue, setZValue] = useState(String(Math.round(tiltZ)));
  const [editing, setEditing] = useState<{ y: boolean; x: boolean; z: boolean }>({ y: false, x: false, z: false });
  const controlId = useId().replace(/:/g, "");
  const rotationInput = useRef<HTMLInputElement>(null);
  const xInput = useRef<HTMLInputElement>(null);
  const zInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing.y) setRotationValue(String(Math.round(rotationY))); }, [rotationY, editing.y]);
  useEffect(() => { if (!editing.x) setXValue(String(Math.round(tiltX))); }, [tiltX, editing.x]);
  useEffect(() => { if (!editing.z) setZValue(String(Math.round(tiltZ))); }, [tiltZ, editing.z]);

  const commit = (axis: "x" | "z", raw: string) => {
    if (!/^-?\d+$/.test(raw)) {
      (axis === "x" ? setXValue : setZValue)(String(Math.round(axis === "x" ? tiltX : tiltZ)));
      return;
    }
    const [min, max] = [-180, 179];
    onTilt(axis, Math.max(min, Math.min(max, Number(raw))));
  };

  const commitRotation = (raw: string) => {
    if (!/^-?\d+$/.test(raw)) {
      setRotationValue(String(Math.round(rotationY)));
      return;
    }
    onRotate?.(Math.max(0, Math.min(360, Number(raw))));
  };

  const adjustRotationFromSlider = (raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const wholeDegrees = Math.round(value);
    setRotationValue(String(wholeDegrees));
    onRotate?.(wholeDegrees);
  };

  const adjustFromSlider = (axis: "x" | "z", raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    (axis === "x" ? setXValue : setZValue)(String(Math.round(value)));
    onTilt(axis, Math.round(value));
  };

  return (
    <details className="tilt-controls" onToggle={event => onOpenChange?.(event.currentTarget.open)}>
      <summary aria-label="Drehung und Neigung einstellen"><Rotate3d size={15} /><span>Drehen / Neigen</span></summary>
      <div className="tilt-panel" role="group" aria-label="Stein drehen und neigen">
        <strong>Drehung und Neigung</strong>
        <small>Y-Drehung: 0° bis 360° · X/Z-Neigung: −180° bis 179°</small>
        <div className="tilt-axis-control">
          <label htmlFor={`${controlId}-slider-y`}>Drehung</label>
          <input
            id={`${controlId}-slider-y`}
            type="range"
            min="0"
            max="360"
            step="1"
            aria-label="Drehung"
            aria-valuetext={`${Math.round(rotationY)} Grad`}
            data-testid="slider-rotation-y"
            value={Math.max(0, Math.min(360, Math.round(rotationY)))}
            onPointerDown={() => rotationInput.current?.blur()}
            onChange={event => adjustRotationFromSlider(event.currentTarget.value)}
          />
          <output htmlFor={`${controlId}-slider-y`} data-testid="value-rotation-y">{Math.round(rotationY)}°</output>
        </div>
        <label>
          <span>Y</span>
          <input ref={rotationInput} type="number" inputMode="numeric" min="0" max="360" step="1" aria-label="Drehung Y in Grad"
            data-testid="input-rotation-y" value={rotationValue}
            onChange={event => {
              if (/^\d*$/.test(event.target.value)) setRotationValue(event.target.value);
              else event.currentTarget.value = rotationValue;
            }}
            onFocus={() => setEditing(current => ({ ...current, y: true }))}
            onBlur={event => { commitRotation(event.currentTarget.value); setEditing(current => ({ ...current, y: false })); }}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <b>°</b>
        </label>
        {(["x", "z"] as const).map((axis) => {
          const angle = axis === "x" ? tiltX : tiltZ;
          return (
            <div className="tilt-axis-control" key={axis}>
              <label htmlFor={`${controlId}-slider-${axis}`}>{axis.toUpperCase()}-Achse</label>
              <input
                id={`${controlId}-slider-${axis}`}
                type="range"
                min="-180"
                max="179"
                step="1"
                aria-label={`Neigung ${axis.toUpperCase()}-Achse`}
                aria-valuetext={`${Math.round(angle)} Grad`}
                data-testid={`slider-tilt-${axis}`}
                value={Math.max(-180, Math.min(179, Math.round(angle)))}
                onPointerDown={() => (axis === "x" ? xInput : zInput).current?.blur()}
                onChange={event => adjustFromSlider(axis, event.currentTarget.value)}
              />
              <output htmlFor={`${controlId}-slider-${axis}`} data-testid={`value-tilt-${axis}`}>{Math.round(angle)}°</output>
            </div>
          );
        })}
        <label>
          <span>X</span>
          <input ref={xInput} type="number" inputMode="numeric" min="-180" max="179" step="1" aria-label="Neigung X in Grad" data-testid="input-tilt-x"
            value={xValue} onChange={event => {
              if (/^-?\d*$/.test(event.target.value)) setXValue(event.target.value);
              else event.currentTarget.value = xValue;
            }}
            onFocus={() => setEditing(current => ({ ...current, x: true }))}
            onBlur={event => { commit("x", event.currentTarget.value); setEditing(current => ({ ...current, x: false })); }}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <b>°</b>
        </label>
        <label>
          <span>Z</span>
          <input ref={zInput} type="number" inputMode="numeric" min="-180" max="179" step="1" aria-label="Neigung Z in Grad" data-testid="input-tilt-z"
            value={zValue} onChange={event => {
              if (/^-?\d*$/.test(event.target.value)) setZValue(event.target.value);
              else event.currentTarget.value = zValue;
            }}
            onFocus={() => setEditing(current => ({ ...current, z: true }))}
            onBlur={event => { commit("z", event.currentTarget.value); setEditing(current => ({ ...current, z: false })); }}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          <b>°</b>
        </label>
      </div>
    </details>
  );
}
