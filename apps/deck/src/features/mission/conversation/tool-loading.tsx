type MissionToolLoadingActivity = {
  title: string;
};

type MissionToolLoadingProps = {
  activity: MissionToolLoadingActivity;
  pendingToolPresent: boolean;
};

/**
 * Inline status shown while the active mission is still producing tool output.
 */
export function MissionToolLoading({
  activity,
  pendingToolPresent,
}: MissionToolLoadingProps) {
  const detail = pendingToolPresent
    ? `等待 ${activity.title.replace(/^Tool:\s*/u, "")} 返回结果…`
    : "等待下一次状态更新…";

  return (
    <div
      className="mission-tool-loading my-3 mr-auto grid max-w-[min(640px,100%)] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border-ghost bg-surface-elevated px-3 py-2.5 text-foreground shadow-ambient"
      role="status"
      aria-live="polite"
    >
      <span
        className="mission-tool-loading-dot size-2.5 rounded-full bg-primary shadow-[0_0_0_4px_var(--color-primary-soft)]"
        aria-hidden="true"
      />
      <div className="grid min-w-0 gap-0.5">
        <strong className="text-sm font-semibold">
          {pendingToolPresent ? "正在执行工具" : activity.title}
        </strong>
        <p className="truncate text-xs text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  );
}
