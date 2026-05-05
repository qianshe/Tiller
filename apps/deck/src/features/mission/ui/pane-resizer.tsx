import type { MouseEvent as ReactMouseEvent } from "react";
import type { MissionResizeHandle } from "../hooks/use-layout";

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
  return (
    <button
      type="button"
      className={`mission-pane-resizer mission-pane-resizer-${handle}`}
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
