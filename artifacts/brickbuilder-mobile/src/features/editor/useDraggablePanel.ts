import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

interface Position { left: number; top: number }
interface DragState extends Position { pointerId: number; x: number; y: number; moved: boolean }

const DRAG_THRESHOLD = 18;

function clampPosition(panel: HTMLElement, left: number, top: number): Position {
  const viewport = window.visualViewport;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  const offsetLeft = viewport?.offsetLeft ?? 0;
  const offsetTop = viewport?.offsetTop ?? 0;
  const margin = 8;
  const rect = panel.getBoundingClientRect();
  const minLeft = offsetLeft + margin;
  const minTop = offsetTop + margin;
  return {
    left: Math.min(Math.max(minLeft, left), Math.max(minLeft, offsetLeft + width - rect.width - margin)),
    top: Math.min(Math.max(minTop, top), Math.max(minTop, offsetTop + height - rect.height - margin)),
  };
}

/** Pointer-safe panel dragging: a tap never moves the panel or activates its parent. */
export function useDraggablePanel<T extends HTMLElement>() {
  const panelRef = useRef<T>(null);
  const dragRef = useRef<DragState | null>(null);
  const listenersRef = useRef<{ move: (event: PointerEvent) => void; end: (event: PointerEvent) => void } | null>(null);
  const clickSuppressionRef = useRef<{ handler: (event: MouseEvent) => void; timeout: number } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const panel = panelRef.current;
    if (!panel || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    if (listenersRef.current) {
      window.removeEventListener("pointermove", listenersRef.current.move, true);
      window.removeEventListener("pointerup", listenersRef.current.end, true);
      window.removeEventListener("pointercancel", listenersRef.current.end, true);
    }
    const rect = panel.getBoundingClientRect();
    const start = clampPosition(panel, rect.left, rect.top);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...start, moved: false };

    const move = (pointerEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== pointerEvent.pointerId) return;
      if (!drag.moved && Math.hypot(pointerEvent.clientX - drag.x, pointerEvent.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.moved = true;
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      setPosition(clampPosition(panel, drag.left + pointerEvent.clientX - drag.x, drag.top + pointerEvent.clientY - drag.y));
    };
    const end = (pointerEvent: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== pointerEvent.pointerId) return;
      dragRef.current = null;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      listenersRef.current = null;
      if (drag.moved) {
        const clickScope = panel.closest(".tilt-controls, .fine-position, .rotation-selection") ?? panel;
        const suppressClick = (clickEvent: MouseEvent) => {
          if (clickEvent.target instanceof Node && clickScope.contains(clickEvent.target)) {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
          }
          if (clickSuppressionRef.current) window.clearTimeout(clickSuppressionRef.current.timeout);
          clickSuppressionRef.current = null;
          window.removeEventListener("click", suppressClick, true);
        };
        const timeout = window.setTimeout(() => {
          window.removeEventListener("click", suppressClick, true);
          clickSuppressionRef.current = null;
        }, 180);
        clickSuppressionRef.current = { handler: suppressClick, timeout };
        window.addEventListener("click", suppressClick, true);
      }
    };
    listenersRef.current = { move, end };
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", end, { capture: true, passive: false });
    window.addEventListener("pointercancel", end, { capture: true, passive: false });
  };

  useEffect(() => () => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move, true);
    window.removeEventListener("pointerup", listeners.end, true);
    window.removeEventListener("pointercancel", listeners.end, true);
    const clickSuppression = clickSuppressionRef.current;
    if (clickSuppression) {
      window.clearTimeout(clickSuppression.timeout);
      window.removeEventListener("click", clickSuppression.handler, true);
      clickSuppressionRef.current = null;
    }
  }, []);

  return { panelRef, position, onPointerDown };
}
