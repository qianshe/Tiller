import type { SessionSummary } from "@tiller/shared";
import { Card, CardContent } from "@/shared/ui";

type SessionOverviewCardProps = {
  activeSession: SessionSummary | null;
};

/**
 * Shows the latest session activity in a compact single-line summary.
 */
export function SessionOverviewCard({
  activeSession,
}: SessionOverviewCardProps) {
  return (
    <Card className="mission-session-overview sticky top-0 z-10 rounded-[8px] p-2 shadow-none">
      <CardContent className="mission-session-overview-content p-0">
        <div className="mission-session-preview flex min-w-0 items-baseline gap-1.5 rounded-md bg-surface-sunken px-2 py-1.5">
          <span className="shrink-0 text-2xs font-semibold text-muted-foreground">最近活动</span>
          <strong className="line-clamp-1 min-w-0 text-xs font-medium leading-snug text-foreground">
            {activeSession?.lastMessagePreview || "暂无最近活动"}
          </strong>
        </div>
      </CardContent>
    </Card>
  );
}
