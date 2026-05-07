import type { SessionSummary } from "@tiller/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";

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
    <Card className="sticky top-0 z-10 grid gap-3 p-3 shadow-none">
      <CardHeader className="p-0">
        <CardTitle>{activeSession ? "会话信息" : "新任务"}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 p-0">
        <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
          {cards.map((card) => (
            <article key={card.label} className="grid gap-1 rounded-md bg-surface-sunken p-3">
              <span className="text-xs font-semibold text-muted-foreground">{card.label}</span>
              <strong className="text-base font-semibold text-foreground">{card.value}</strong>
              <small className="text-xs text-muted-foreground">{card.meta}</small>
            </article>
          ))}
        </div>
        <div className="grid gap-1 rounded-md bg-surface-sunken p-3">
          <span className="text-xs font-semibold text-muted-foreground">最近活动</span>
          <strong className="line-clamp-3 text-sm leading-relaxed text-foreground">
            {activeSession?.lastMessagePreview || "暂无预览"}
          </strong>
        </div>
      </CardContent>
    </Card>
  );
}
