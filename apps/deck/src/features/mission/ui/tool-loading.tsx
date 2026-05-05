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
  return (
    <div className="mission-tool-loading" role="status" aria-live="polite">
      <span className="mission-tool-loading-dots" aria-hidden="true">
        <i /> <i /> <i />
      </span>
      <div>
        <strong>
          {pendingToolPresent ? "正在执行工具" : "Agent 正在处理"}
        </strong>
        <p className="compact muted">等待 {activity.title} 返回结果…</p>
      </div>
    </div>
  );
}
