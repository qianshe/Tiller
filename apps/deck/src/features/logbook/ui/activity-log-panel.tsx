import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { CommandOutput } from "./command-output";
import { resolveToolCallTone } from "../tool-call-tone";
import { commandChunkToToolCall, groupToolCalls } from "../timeline";

type ActivityHistoryState = {
  hasMore?: boolean;
  loading?: boolean;
};

type ActivityLogPanelProps = {
  sessionId?: string;
  sessionToolCalls: AgentToolCall[];
  commandChunks: CommandChunk[];
  sessionMessages: AgentMessage[];
  historyState?: ActivityHistoryState;
  visibleCount: number;
  visibleLimit: number;
  copy: {
    commandOutput: string;
    noCommandOutput: string;
  };
  onShowMore: (sessionId: string, nextVisibleCount: number) => void;
  onLoadOlder: (sessionId: string) => void;
};

/**
 * Shows tool activity only; user prompts and assistant text remain in the conversation pane.
 */
export function ActivityLogPanel({
  sessionId,
  sessionToolCalls,
  commandChunks,
  historyState,
  visibleCount,
  visibleLimit,
  copy,
  onShowMore,
  onLoadOlder,
}: ActivityLogPanelProps) {
  const timelineItems = buildActivityTimeline(sessionToolCalls, commandChunks);
  const visibleTimelineItems = timelineItems.slice(0, visibleCount);
  const hiddenCount = Math.max(
    0,
    timelineItems.length - visibleTimelineItems.length,
  );

  if (!timelineItems.length) {
    return (
      <CommandOutput items={commandChunks} emptyLabel={copy.noCommandOutput} />
    );
  }

  return (
    <Card className="grid w-full gap-3 p-3 shadow-none">
      <CardHeader className="p-0">
        <CardTitle>{copy.commandOutput}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 p-0">
        {visibleTimelineItems.map((timelineItem) => (
          <ToolActivityCard
            key={timelineItem.item.id}
            item={timelineItem.item}
          />
        ))}
        {hiddenCount > 0 ? (
          <Button
            variant="outline"
            type="button"
            onClick={() =>
              sessionId
                ? onShowMore(sessionId, visibleCount + visibleLimit)
                : undefined
            }
          >
            展开更多（剩余 {hiddenCount} 条）
          </Button>
        ) : historyState?.hasMore ? (
          <Button
            variant="outline"
            type="button"
            onClick={() => (sessionId ? onLoadOlder(sessionId) : undefined)}
            disabled={historyState.loading}
          >
            {historyState.loading ? "加载中..." : "加载更早活动"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

type ActivityTimelineItem = {
  kind: "tool";
  timestamp: string;
  item: ReturnType<typeof groupToolCalls>[number];
};

function buildActivityTimeline(
  sessionToolCalls: AgentToolCall[],
  commandChunks: CommandChunk[],
): ActivityTimelineItem[] {
  const toolItems = groupToolCalls(
    sessionToolCalls.length
      ? sessionToolCalls
      : commandChunks.map(commandChunkToToolCall),
  );

  return toolItems.map((item) => ({
    kind: "tool" as const,
    timestamp: item.timestamp,
    item,
  })).sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
  );
}

function ToolActivityCard({
  item,
}: {
  item: ReturnType<typeof groupToolCalls>[number];
}) {
  const toolTone = resolveToolCallTone(item.toolKind, item.title);
  const streamTone = item.streams.includes("stderr") ? "stderr" : "stdout";
  const icon = toolTone.icon ?? "•";
  const label = toolTone.label ?? "Tool";
  const accent = streamTone === "stderr" ? "stderr" : (toolTone.className ?? "tool-call-default");

  return (
    <ActivityDetails
      accent={accent}
      icon={icon}
      kind={label}
      title={item.title}
      stream={streamTone}
    >
      {item.text.trim() ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words pl-7 font-mono text-sm leading-relaxed text-foreground">
          {item.text}
        </pre>
      ) : null}
    </ActivityDetails>
  );
}

type ActivityDetailsProps = {
  accent: string;
  icon: string;
  kind: string;
  title: string;
  stream: string;
  children: React.ReactNode;
};

function ActivityDetails({
  accent,
  icon,
  kind,
  title,
  stream,
  children,
}: ActivityDetailsProps) {
  const tone = activityToneClass(accent);
  return (
    <details
      className={cn(
        "group w-full rounded-md border border-border-ghost bg-surface-sunken p-0 shadow-none transition-colors hover:bg-surface-emphasis",
        tone.border,
      )}
    >
      <summary className="grid min-h-9 cursor-pointer list-none grid-cols-[20px_minmax(56px,auto)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "grid size-5 place-items-center rounded-sm font-mono text-xs font-bold",
            tone.icon,
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {kind}
        </span>
        <strong className="min-w-0 truncate text-sm font-semibold text-foreground">
          {title}
        </strong>
        <span
          className={cn(
            "text-xs font-semibold uppercase tracking-wider text-muted-foreground",
            stream === "stderr" && "text-destructive",
          )}
        >
          {stream}
        </span>
      </summary>
      <div className="mx-3 mb-3 border-t border-border-ghost pt-2">{children}</div>
    </details>
  );
}

function activityToneClass(accent: string) {
  switch (accent) {
    case "tool-call-mcp":
      return { border: "border-l-2 border-l-violet-400", icon: "bg-violet-400/15 text-violet-500" };
    case "tool-call-shell":
      return { border: "border-l-2 border-l-emerald-400", icon: "bg-emerald-400/15 text-emerald-500" };
    case "tool-call-file":
      return { border: "border-l-2 border-l-cyan-300", icon: "bg-cyan-300/15 text-cyan-500" };
    case "tool-call-skill":
      return { border: "border-l-2 border-l-amber-400", icon: "bg-amber-400/15 text-amber-500" };
    case "tool-call-subagent":
      return { border: "border-l-2 border-l-fuchsia-300", icon: "bg-fuchsia-300/15 text-fuchsia-500" };
    case "tool-call-builtin":
      return { border: "border-l-2 border-l-cyan-300", icon: "bg-cyan-300/15 text-cyan-500" };
    case "stderr":
      return { border: "border-l-2 border-l-destructive", icon: "bg-destructive/15 text-destructive" };
    default:
      return { border: "border-l-2 border-l-primary", icon: "bg-primary-soft text-primary" };
  }
}
