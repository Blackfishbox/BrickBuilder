import { useId, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Rotate3d } from "lucide-react";
import "./tilt-controls.css";
import { useI18n } from "@/i18n/I18nProvider";
import type { RotationAnchor } from "@/features/connections/rotation-anchors";
import DraggablePanel from "./DraggablePanel";

type SliderAxis = "y" | "x" | "z";
type TouchGesture = {
  axis: SliderAxis;
  x: number;
  y: number;
  startedAt: number;
  moved: boolean;
};
type SliderTap = { axis: SliderAxis; x: number; y: number; at: number };

export default function TiltControls({
  rotationY = 0,
  onRotate,
  onRotateStart,
  onRotateEnd,
  tiltX,
  tiltZ,
  onTilt,
  onOpenChange,
  open,
  anchors = [],
  rotationPivot,
  onPivotChange,
}: {
  rotationY?: number;
  onRotate?(angle: number): void;
  onRotateStart?(): void;
  onRotateEnd?(): void;
  tiltX: number;
  tiltZ: number;
  onTilt(axis: "x" | "z", angle: number): void;
  onOpenChange?(open: boolean): void;
  open?: boolean;
  anchors?: RotationAnchor[];
  rotationPivot?: [number, number, number] | null;
  onPivotChange?(pivot: [number, number, number] | null): void;
}) {
  const { t } = useI18n();
  const controlId = useId().replace(/:/g, "");
  const gesture = useRef<TouchGesture | null>(null);
  const lastTap = useRef<SliderTap | null>(null);
  const lastReset = useRef<{ axis: SliderAxis; at: number } | null>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;

  const setMenuOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const reset = (axis: SliderAxis) => {
    lastReset.current = { axis, at: performance.now() };
    if (axis === "y") onRotate?.(0);
    else onTilt(axis, 0);
  };

  const beginTouch = (axis: SliderAxis, event: ReactPointerEvent<HTMLInputElement>) => {
    if (event.pointerType !== "touch") return;
    gesture.current = { axis, x: event.clientX, y: event.clientY, startedAt: performance.now(), moved: false };
  };

  const moveTouch = (axis: SliderAxis, event: ReactPointerEvent<HTMLInputElement>) => {
    const current = gesture.current;
    if (!current || current.axis !== axis) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 12) current.moved = true;
  };

  const endTouch = (axis: SliderAxis, event: ReactPointerEvent<HTMLInputElement>) => {
    const current = gesture.current;
    gesture.current = null;
    if (!current || current.axis !== axis) return;
    if (current.moved || performance.now() - current.startedAt > 400) {
      lastTap.current = null;
      return;
    }

    const now = performance.now();
    const previous = lastTap.current;
    if (previous && previous.axis === axis && now - previous.at <= 420 &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 32) {
      event.preventDefault();
      lastTap.current = null;
      reset(axis);
      return;
    }
    lastTap.current = { axis, x: event.clientX, y: event.clientY, at: now };
  };

  const endTouchSequence = () => { gesture.current = null; lastTap.current = null; };

  const doubleClick = (axis: SliderAxis, event: ReactMouseEvent<HTMLInputElement>) => {
    const previousReset = lastReset.current;
    if (previousReset?.axis === axis && performance.now() - previousReset.at < 500) return;
    event.preventDefault();
    reset(axis);
  };

  const adjustRotation = (raw: string) => {
    const angle = Number(raw);
    if (Number.isFinite(angle)) onRotate?.(Math.max(0, Math.min(360, Math.round(angle))));
  };

  const adjustTilt = (axis: "x" | "z", raw: string) => {
    const angle = Number(raw);
    if (Number.isFinite(angle)) onTilt(axis, Math.max(-180, Math.min(179, Math.round(angle))));
  };

  const sliderEvents = (axis: SliderAxis) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLInputElement>) => {
      beginTouch(axis, event);
      if (axis === "y") onRotateStart?.();
    },
    onPointerMove: (event: ReactPointerEvent<HTMLInputElement>) => moveTouch(axis, event),
    onPointerUp: (event: ReactPointerEvent<HTMLInputElement>) => {
      endTouch(axis, event);
      if (axis === "y") onRotateEnd?.();
    },
    onPointerCancel: () => {
      endTouchSequence();
      if (axis === "y") onRotateEnd?.();
    },
    onDoubleClick: (event: ReactMouseEvent<HTMLInputElement>) => doubleClick(axis, event),
    title: t("tilt.reset"),
  });

  return (
    <div className="tilt-controls" data-open={isOpen} data-testid="tilt-controls-menu"
    >
      <button type="button" className="tilt-controls-toggle" aria-label={t("tilt.open")} title={t("tilt.title")}
        aria-expanded={isOpen} aria-controls={`tilt-panel-${controlId}`} data-testid="button-tilt-controls"
        onClick={() => setMenuOpen(!isOpen)}>
        <Rotate3d size={17} aria-hidden="true" />
      </button>
      <DraggablePanel className="tilt-panel" panelId={`tilt-panel-${controlId}`}
        title={t("tilt.title")} headingClassName="tilt-panel-heading"
        handleTestId="button-move-tilt-panel" hidden={!isOpen}>
        <small>{t("tilt.range")}</small>
        {anchors.length > 0 && <label className="tilt-anchor-control">
          <span>{t("tilt.anchor")}</span>
          <select aria-label={t("tilt.anchor")} value={rotationPivot
            ? anchors.find(anchor => anchor.id === rotationPivot.map(value => Math.round(value * 1000) / 1000).join(","))?.id ?? "origin"
            : "origin"}
            onChange={event => onPivotChange?.(anchors.find(anchor => anchor.id === event.currentTarget.value)?.position ?? null)}
            data-testid="select-rotation-anchor">
            <option value="origin">{t("tilt.origin")}</option>
            {anchors.map((anchor, index) => (
              <option key={anchor.id} value={anchor.id}>
                {t(`tilt.anchor.${anchor.family}`)} {index + 1} · ({anchor.position.map(value => Number(value.toFixed(2))).join(", ")})
              </option>
            ))}
          </select>
          <small className="tilt-anchor-source">{t("tilt.anchorSource")}</small>
        </label>}
        <div className="tilt-axis-control">
          <label htmlFor={`${controlId}-slider-y`}>{t("tilt.rotation")}</label>
          <input
            id={`${controlId}-slider-y`}
            type="range"
            min="0"
            max="360"
            step="1"
            aria-label={t("tilt.rotation")}
            aria-valuetext={t("tilt.degrees", { degrees: Math.round(rotationY) })}
            data-testid="slider-rotation-y"
            value={Math.max(0, Math.min(360, Math.round(rotationY)))}
            onChange={event => adjustRotation(event.currentTarget.value)}
            {...sliderEvents("y")}
          />
          <output htmlFor={`${controlId}-slider-y`} data-testid="value-rotation-y">{Math.round(rotationY)}°</output>
        </div>
        {(["x", "z"] as const).map(axis => {
          const angle = axis === "x" ? tiltX : tiltZ;
          return (
            <div className="tilt-axis-control" key={axis}>
              <label htmlFor={`${controlId}-slider-${axis}`}>{t(axis === "x" ? "tilt.x" : "tilt.z")}</label>
              <input
                id={`${controlId}-slider-${axis}`}
                type="range"
                min="-180"
                max="179"
                step="1"
                aria-label={t(axis === "x" ? "tilt.x" : "tilt.z")}
                aria-valuetext={t("tilt.degrees", { degrees: Math.round(angle) })}
                data-testid={`slider-tilt-${axis}`}
                value={Math.max(-180, Math.min(179, Math.round(angle)))}
                onChange={event => adjustTilt(axis, event.currentTarget.value)}
                {...sliderEvents(axis)}
              />
              <output htmlFor={`${controlId}-slider-${axis}`} data-testid={`value-tilt-${axis}`}>{Math.round(angle)}°</output>
            </div>
          );
        })}
      </DraggablePanel>
    </div>
  );
}
