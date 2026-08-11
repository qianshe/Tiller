import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "../../../shared/utils/cn";

export const DASHBOARD_MISSION_DRAWER_MIN_WIDTH = 480;
export const DASHBOARD_MISSION_DRAWER_MAX_WIDTH = 960;
export const DASHBOARD_MISSION_DRAWER_DEFAULT_WIDTH = 640;

export function clampDashboardMissionDrawerWidth(width: number) {
  if (!Number.isFinite(width)) {
    return DASHBOARD_MISSION_DRAWER_DEFAULT_WIDTH;
  }
  return Math.min(
    Math.max(width, DASHBOARD_MISSION_DRAWER_MIN_WIDTH),
    DASHBOARD_MISSION_DRAWER_MAX_WIDTH,
  );
}

type DashboardMissionDrawerResizeHandleProps = {
  width: number;
  onWidthChange: (width: number) => void;
};

export function DashboardMissionDrawerResizeHandle({
  width,
  onWidthChange,
}: DashboardMissionDrawerResizeHandleProps) {
  const [isResizing, setIsResizing] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const drag = dragState.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }

      onWidthChange(clampDashboardMissionDrawerWidth(drag.startWidth - event.clientX + drag.startX));
    };
    const stopResizing = (event: globalThis.PointerEvent) => {
      if (dragState.current?.pointerId !== event.pointerId) {
        return;
      }
      dragState.current = null;
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, onWidthChange]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      startX: event.clientX,
      startWidth: width,
      pointerId: event.pointerId,
    };
    setIsResizing(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    let nextWidth: number | undefined;
    if (event.key === "ArrowLeft") {
      nextWidth = width + step;
    } else if (event.key === "ArrowRight") {
      nextWidth = width - step;
    } else if (event.key === "Home") {
      nextWidth = DASHBOARD_MISSION_DRAWER_MIN_WIDTH;
    } else if (event.key === "End") {
      nextWidth = DASHBOARD_MISSION_DRAWER_MAX_WIDTH;
    }

    if (nextWidth === undefined) {
      return;
    }
    event.preventDefault();
    onWidthChange(clampDashboardMissionDrawerWidth(nextWidth));
  };

  return (
    <div
      data-slot="dashboard-mission-drawer-resize-handle"
      role="separator"
      aria-label="调整会话抽屉宽度"
      aria-orientation="vertical"
      aria-valuemin={DASHBOARD_MISSION_DRAWER_MIN_WIDTH}
      aria-valuemax={DASHBOARD_MISSION_DRAWER_MAX_WIDTH}
      aria-valuenow={Math.round(clampDashboardMissionDrawerWidth(width))}
      tabIndex={0}
      className={cn(
        "absolute inset-y-0 left-0 z-20 hidden w-3 touch-none cursor-col-resize select-none items-center justify-center border-r border-transparent hover:border-border-ghost focus-visible:border-border-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex",
        isResizing && "border-primary bg-primary/10",
      )}
      onPointerDownCapture={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}
