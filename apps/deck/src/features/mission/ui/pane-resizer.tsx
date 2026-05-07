import type { MouseEvent as ReactMouseEvent } from "react";
import type { MissionResizeHandle } from "../hooks/layout";

type MissionPaneResizerProps = {
  handle: MissionResizeHandle;
  label: string;
  onResizeStart: (
    handle: MissionResizeHandle,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  onNudge: (handle: MissionResizeHandle, direction: -1 | 1) => void;
};

/**
 * Keyboard and pointer resize handle between mission panes.
 */
export function MissionPaneResizer({
  handle,
  label,
  onResizeStart,
  onNudge,
}: MissionPaneResizerProps) {
  const gridColumnClass =
    handle === "sidebar"
      ? "col-start-2 col-end-3"
      : handle === "display"
        ? "col-start-4 col-end-5"
        : "col-start-6 col-end-7";

  return (
    <button
      type="button"
      className={`mission-pane-resizer mission-pane-resizer-${handle} ${gridColumnClass} group relative z-20 w-1.5 cursor-col-resize rounded-full bg-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 max-[860px]:hidden after:absolute after:inset-y-3 after:left-1/2 after:w-px after:-translate-x-1/2 after:rounded-full after:bg-border-ghost after:transition hover:after:bg-primary focus-visible:after:bg-primary`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onMouseDown={(event) => onResizeStart(handle, event)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onNudge(handle, -1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onNudge(handle, 1);
        }
      }}
    />
  );
}
