import type { ReactNode } from "react";
import { Grip } from "lucide-react";
import { useDraggablePanel } from "./useDraggablePanel";

export default function DraggablePanel({
  className,
  title,
  panelId,
  headingClassName,
  handleTestId,
  hidden = false,
  children,
}: {
  className: string;
  title: string;
  panelId?: string;
  headingClassName: string;
  handleTestId: string;
  hidden?: boolean;
  children: ReactNode;
}) {
  const { panelRef, position, onPointerDown } = useDraggablePanel<HTMLDivElement>();
  return <div ref={panelRef} id={panelId} className={`${className}${position ? " is-positioned" : ""}`}
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
}
