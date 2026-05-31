export type MissionToolLoadingActivity = {
  title: string;
};

export type MissionToolLoadingState = {
  activity: MissionToolLoadingActivity;
  pendingToolPresent: boolean;
};

function formatMissionToolLoadingDetail({
  activity,
  pendingToolPresent,
}: MissionToolLoadingState) {
  return pendingToolPresent
    ? `等待 ${activity.title.replace(/^Tool:\s*/u, "")} 返回结果…`
    : "等待下一次状态更新…";
}

function resolveMissionToolLoadingLabel({
  activity,
  pendingToolPresent,
}: MissionToolLoadingState) {
  return pendingToolPresent ? "正在执行工具" : activity.title;
}

function resolveMissionToolLoadingTitleLabel({
  pendingToolPresent,
}: MissionToolLoadingState) {
  return pendingToolPresent ? "工具执行中" : "同步中";
}

/**
 * Inline status shown while the active mission is still producing tool output.
 */
export function MissionToolLoading({
  activity,
  pendingToolPresent,
}: MissionToolLoadingState) {
  const detail = formatMissionToolLoadingDetail({ activity, pendingToolPresent });

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
          {resolveMissionToolLoadingLabel({ activity, pendingToolPresent })}
        </strong>
        <p className="truncate text-xs text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  );
}

export function MissionToolLoadingTitle({
  activity,
  pendingToolPresent,
}: MissionToolLoadingState) {
  const detail = formatMissionToolLoadingDetail({ activity, pendingToolPresent });
  const label = resolveMissionToolLoadingTitleLabel({ activity, pendingToolPresent });

  return (
    <div
      className="mission-tool-loading-title flex min-w-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-primary"
      role="status"
      aria-live="polite"
      title={detail}
    >
      <span
        className="size-1.5 shrink-0 rounded-full bg-primary wb-pulse"
        aria-hidden="true"
      />
      <strong className="shrink-0 text-2xs font-semibold">
        {label}
      </strong>
    </div>
  );
}
