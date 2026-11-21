import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Grip } from "lucide-react";
import { useDraggablePanel } from "./useDraggablePanel";

export default function DraggablePanel({
  className,
  title,
  panelId,
  headingClassName,
  handleTestId,
  hidden = false,
  portalOnMobile = false,
  children,
}: {
  className: string;
  title: string;
  panelId?: string;
  headingClassName: string;
  handleTestId: string;
  hidden?: boolean;
  portalOnMobile?: boolean;
  children: ReactNode;
}) {
  const [mobileViewport, setMobileViewport] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 760,
  );
  useEffect(() => {
    const updateViewport = () => setMobileViewport(window.innerWidth <= 760);
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);
  const { panelRef, position, onPointerDown } = useDraggablePanel<HTMLDivElement>();
  const panel = <div ref={panelRef} id={panelId}
    className={`${className}${position ? " is-positioned" : ""}${portalOnMobile && mobileViewport ? " draggable-panel-portal" : ""}`}
    style={position ? { left: position.left, top: position.top } : undefined}
    hidden={hidden} role="group" aria-label={title}>
    <div className={`draggable-panel-heading ${headingClassName}`}>
      <strong>{title}</strong>
      <div className="panel-drag-handle" aria-hidden="true" onPointerDown={onPointerDown}
        data-testid={handleTestId}>
        <Grip size={17} />
      </div>
    </div>
    {children}
  </div>;
  return portalOnMobile && mobileViewport ? createPortal(panel, document.body) : panel;
}
