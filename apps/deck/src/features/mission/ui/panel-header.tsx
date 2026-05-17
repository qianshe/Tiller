import type { ReactNode } from "react";
import { cn } from "../../../shared/utils/cn";

type MissionPanelHeaderProps = {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  bordered?: boolean;
};

const PANEL_HEADER_FRAME_CLASS = "flex items-center justify-between gap-2 px-2 py-1.5";
const PANEL_HEADER_TITLE_CLASS = "text-sm font-semibold leading-tight text-foreground";

export function MissionPanelHeader({
  title,
  action,
  className = "mission-panel-head",
  bordered = false,
}: MissionPanelHeaderProps) {
  return (
    <div
      className={cn(
        className,
        PANEL_HEADER_FRAME_CLASS,
        bordered && "border-b border-border-ghost",
      )}
    >
      <div className="min-w-0">
        <h3 className={PANEL_HEADER_TITLE_CLASS}>{title}</h3>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function MissionPanelLoadingBadge() {
  return (
    <span className="mission-inline-loading rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
      加载中
    </span>
  );
}
