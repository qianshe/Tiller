export type OverviewMetricItem = {
  label: string;
  value: string;
};

export type OverviewCounts = {
  activeHelmLabel: string;
  connectionLabel: string;
  projectCount: number;
  worktreeCount: number;
  agentCount: number;
  sessionCount: number;
};

export function buildOverviewMetrics(counts: OverviewCounts): OverviewMetricItem[] {
  return [
    { label: "Helm", value: counts.activeHelmLabel },
    { label: "连接", value: counts.connectionLabel },
    { label: "项目", value: String(counts.projectCount) },
    { label: "工作区", value: String(counts.worktreeCount) },
    { label: "ACP 舰员", value: String(counts.agentCount) },
    { label: "任务", value: String(counts.sessionCount) },
  ];
}
