import type { SessionSummary } from "@tiller/shared";

type SessionOverviewCardProps = {
  activeSession: SessionSummary | null;
  statusLabel: string;
  diffCount: number;
  logCount: number;
};

/**
 * Compact mission overview metrics shown above the logbook and diff panes.
 */
export function SessionOverviewCard({
  activeSession,
  statusLabel,
  diffCount,
  logCount,
}: SessionOverviewCardProps) {
  const cards = activeSession
    ? [
        { label: "状态", value: statusLabel, meta: "Session state" },
        {
          label: "消息",
          value: `${activeSession.messageCount} 条`,
          meta: "Conversation",
        },
        { label: "变更", value: `${diffCount} 个文件`, meta: "Git diff" },
        { label: "航行日志", value: `${logCount} 条`, meta: "Activity" },
      ]
    : [
        { label: "状态", value: "待创建", meta: "Session state" },
        { label: "会话", value: "未创建", meta: "发送首条指令后创建" },
      ];

  return (
    <section className="session-overview-card">
      <div className="section-head section-head-soft">
        <div>
          <h3>{activeSession ? "会话信息" : "新任务"}</h3>
        </div>
      </div>
      <div className="session-overview-grid">
        {cards.map((card) => (
          <article key={card.label} className="session-overview-metric">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.meta}</small>
          </article>
        ))}
      </div>
      <div className="session-overview-preview">
        <span>最近活动</span>
        <strong>{activeSession?.lastMessagePreview || "暂无预览"}</strong>
      </div>
    </section>
  );
}
