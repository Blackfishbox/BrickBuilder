import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Grip, Rotate3d } from "lucide-react";
import "./tilt-controls.css";
import { useI18n } from "@/i18n/I18nProvider";
import type { RotationAnchor } from "@/features/connections/rotation-anchors";

type SliderAxis = "y" | "x" | "z";
type PanelPosition = { left: number; top: number };
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
  const panelRef = useRef<HTMLDivElement>(null);
  const safeAreaRef = useRef<HTMLDivElement>(null);
  const panelDrag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const panelDragListeners = useRef<{ move: (event: PointerEvent) => void; end: (event: PointerEvent) => void } | null>(null);
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null);

  const clampPanelPosition = (left: number, top: number): PanelPosition => {
    const panel = panelRef.current;
    const viewport = window.visualViewport;
    const rect = panel?.getBoundingClientRect();
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const offsetTop = viewport?.offsetTop ?? 0;
    const safeArea = safeAreaRef.current ? getComputedStyle(safeAreaRef.current) : null;
    const safeLeft = Number.parseFloat(safeArea?.paddingLeft ?? "0") || 0;
    const safeRight = Number.parseFloat(safeArea?.paddingRight ?? "0") || 0;
    const safeTop = Number.parseFloat(safeArea?.paddingTop ?? "0") || 0;
    const safeBottom = Number.parseFloat(safeArea?.paddingBottom ?? "0") || 0;
    const panelWidth = rect?.width ?? 300;
    const panelHeight = rect?.height ?? 240;
    const margin = 8;
    const minLeft = offsetLeft + safeLeft + margin;
    const minTop = offsetTop + safeTop + margin;
    return {
      left: Math.min(Math.max(minLeft, left), Math.max(minLeft, offsetLeft + width - safeRight - panelWidth - margin)),
      top: Math.min(Math.max(minTop, top), Math.max(minTop, offsetTop + height - safeBottom - panelHeight - margin)),
    };
  };

  useEffect(() => {
    if (!panelPosition) return;
    const clampAfterResize = () => setPanelPosition(position => position
      ? clampPanelPosition(position.left, position.top) : position);
    window.addEventListener("resize", clampAfterResize);
    window.visualViewport?.addEventListener("resize", clampAfterResize);
    return () => {
      window.removeEventListener("resize", clampAfterResize);
      window.visualViewport?.removeEventListener("resize", clampAfterResize);
    };
  }, [panelPosition]);

  const startPanelDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!panelRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (panelDragListeners.current) {
      window.removeEventListener("pointermove", panelDragListeners.current.move, true);
      window.removeEventListener("pointerup", panelDragListeners.current.end, true);
      window.removeEventListener("pointercancel", panelDragListeners.current.end, true);
    }
    const rect = panelRef.current.getBoundingClientRect();
    const initial = clampPanelPosition(rect.left, rect.top);
    setPanelPosition(initial);
    panelDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...initial };
    const move = (pointerEvent: PointerEvent) => {
      const drag = panelDrag.current;
      if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      setPanelPosition(clampPanelPosition(
        drag.left + pointerEvent.clientX - drag.x,
        drag.top + pointerEvent.clientY - drag.y,
      ));
    };
    const end = (pointerEvent: PointerEvent) => {
      if (panelDrag.current?.pointerId !== pointerEvent.pointerId) return;
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      panelDrag.current = null;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      panelDragListeners.current = null;
    };
    panelDragListeners.current = { move, end };
    // Capture-phase window listeners work even when Android WebView does not
    // preserve pointer capture on a button through a fixed-panel rerender.
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", end, { capture: true, passive: false });
    window.addEventListener("pointercancel", end, { capture: true, passive: false });
  };

  useEffect(() => () => {
    const listeners = panelDragListeners.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move, true);
    window.removeEventListener("pointerup", listeners.end, true);
    window.removeEventListener("pointercancel", listeners.end, true);
  }, []);

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

  const doubleClick = (axis: SliderAxis, event: React.MouseEvent<HTMLInputElement>) => {
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
    onDoubleClick: (event: React.MouseEvent<HTMLInputElement>) => doubleClick(axis, event),
    title: t("tilt.reset"),
  });

  return (
    <details className="tilt-controls" data-testid="tilt-controls-menu" open={open}
      onToggle={event => onOpenChange?.(event.currentTarget.open)}>
      <summary aria-label={t("tilt.open")} title={t("tilt.title")} data-testid="button-tilt-controls">
        <Rotate3d size={17} aria-hidden="true" />
      </summary>
      <div ref={panelRef} className={`tilt-panel${panelPosition ? " is-positioned" : ""}`}
        style={panelPosition ? { left: panelPosition.left, top: panelPosition.top } : undefined}
        role="group" aria-label={t("tilt.axes")}>
        <div ref={safeAreaRef} className="tilt-safe-area-probe" aria-hidden="true" />
        <div className="tilt-panel-heading">
          <strong>{t("tilt.title")}</strong>
          <button type="button" className="tilt-panel-drag" aria-label={t("tilt.movePanel")} title={t("tilt.movePanel")}
            onPointerDown={startPanelDrag} data-testid="button-move-tilt-panel">
            <Grip size={17} aria-hidden="true" />
          </button>
        </div>
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
      </div>
    </details>
  );
}
