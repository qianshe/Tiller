import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { normalizeLocalCommandMessageText } from "../../../shared/utils/local-command-message";
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
 * Shows user prompts and tool activity; assistant text remains in the conversation pane.
 */
export function ActivityLogPanel({
  sessionId,
  sessionToolCalls,
  commandChunks,
  sessionMessages,
  historyState,
  visibleCount,
  visibleLimit,
  copy,
  onShowMore,
  onLoadOlder,
}: ActivityLogPanelProps) {
  const timelineItems = buildActivityTimeline(sessionToolCalls, commandChunks, sessionMessages);
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
    <Card className="grid w-full gap-2 p-2 shadow-none">
      <CardHeader className="p-0">
        <CardTitle>{copy.commandOutput}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 p-0">
        {visibleTimelineItems.map((timelineItem) =>
          timelineItem.kind === "prompt" ? (
            <PromptActivityCard
              key={timelineItem.id}
              text={timelineItem.text}
            />
          ) : (
            <ToolActivityCard
              key={timelineItem.item.id}
              item={timelineItem.item}
            />
          ),
        )}
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

type ActivityTimelineItem =
  | {
      kind: "prompt";
      id: string;
      timestamp: string;
      text: string;
    }
  | {
      kind: "tool";
      timestamp: string;
      item: ReturnType<typeof groupToolCalls>[number];
    };

function buildActivityTimeline(
  sessionToolCalls: AgentToolCall[],
  commandChunks: CommandChunk[],
  sessionMessages: AgentMessage[],
): ActivityTimelineItem[] {
  const visibleToolCalls = sessionToolCalls.filter(
    (toolCall) => toolCall.kind !== "think",
  );
  const toolItems = groupToolCalls(
    visibleToolCalls.length
      ? visibleToolCalls
      : commandChunks.map(commandChunkToToolCall),
  );
  const promptItems = sessionMessages
    .filter((message) => message.role === "user" && !isAcpPromptWrapperEcho(message))
    .flatMap((message) => {
      const text = normalizeLocalCommandMessageText(message.text);
      return text
        ? [{ kind: "prompt" as const, id: message.id, timestamp: message.timestamp, text }]
        : [];
    });

  return [
    ...promptItems,
    ...toolItems.map((item) => ({
      kind: "tool" as const,
      timestamp: item.timestamp,
      item,
    })),
  ].sort(
    (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
  );
}

function PromptActivityCard({ text }: { text: string }) {
  return (
    <ActivityDetails
      accent="prompt"
      icon="↗"
      kind="Prompt"
      title={summarizeActivityText(text)}
      stream="user"
    >
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words pl-6 font-mono text-xs leading-snug text-foreground">
        {text}
      </pre>
    </ActivityDetails>
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
  const status = resolveToolStatusLabel(item.status, streamTone);
  const accent = status.tone === "danger" ? "stderr" : (toolTone.className ?? "tool-call-default");
  const outputText = item.text.trim();
  const inputText = outputText ? "" : formatToolInputPreview(item.input);

  return (
    <ActivityDetails
      accent={accent}
      icon={icon}
      kind={label}
      title={item.title}
      stream={status.label}
      streamTone={status.tone}
    >
      {outputText ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words pl-6 font-mono text-xs leading-snug text-foreground">
          {item.text}
        </pre>
      ) : inputText ? (
        <div className="grid gap-0.5 pl-6">
          <span className="text-meta font-semibold text-muted-foreground">无输出，仅有调用参数</span>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-snug text-foreground">
            {inputText}
          </pre>
        </div>
      ) : null}
    </ActivityDetails>
  );
}

function formatToolInputPreview(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

type ActivityDetailsProps = {
  accent: string;
  icon: string;
  kind: string;
  title: string;
  stream: string;
  streamTone?: "danger" | "neutral";
  children: React.ReactNode;
};

function ActivityDetails({
  accent,
  icon,
  kind,
  title,
  stream,
  streamTone = "neutral",
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
      <summary className="grid min-h-8 cursor-pointer list-none grid-cols-[16px_minmax(44px,auto)_minmax(0,1fr)_auto] items-center gap-1.5 px-2 py-1 [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "grid size-4 place-items-center rounded-sm font-mono text-2xs font-bold",
            tone.icon,
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="whitespace-nowrap text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {kind}
        </span>
        <strong className="min-w-0 truncate text-xs font-medium text-foreground">
          {title}
        </strong>
        <span
          className={cn(
            "text-2xs font-semibold uppercase tracking-wide text-muted-foreground",
            streamTone === "danger" && "text-destructive",
          )}
        >
          {stream}
        </span>
      </summary>
      <div className="mx-2 mb-2 border-t border-border-ghost pt-1.5">{children}</div>
    </details>
  );
}

function resolveToolStatusLabel(
  status: ReturnType<typeof groupToolCalls>[number]["status"],
  streamTone: "stderr" | "stdout",
) {
  if (status === "failed" || streamTone === "stderr") {
    return { label: "失败", tone: "danger" as const };
  }
  if (status === "completed") {
    return { label: "完成", tone: "neutral" as const };
  }
  if (status === "waiting_for_permission") {
    return { label: "待授权", tone: "neutral" as const };
  }
  if (status === "cancelled") {
    return { label: "取消", tone: "neutral" as const };
  }
  return { label: "运行中", tone: "neutral" as const };
}

function activityToneClass(accent: string) {
  switch (accent) {
    case "prompt":
      return { border: "border-l-2 border-l-sky-400", icon: "bg-sky-400/15 text-sky-500" };
    case "tool-call-mcp":
      return { border: "border-l-2 border-l-violet-400", icon: "bg-violet-400/15 text-violet-500" };
    case "tool-call-shell":
      return { border: "border-l-2 border-l-emerald-400", icon: "bg-emerald-400/15 text-emerald-500" };
    case "tool-call-read":
      return { border: "border-l-2 border-l-blue-300", icon: "bg-blue-300/15 text-blue-500" };
    case "tool-call-write":
      return { border: "border-l-2 border-l-orange-300", icon: "bg-orange-300/15 text-orange-500" };
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

function summarizeActivityText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 72
    ? `${compact.slice(0, 72)}…`
    : compact || "发送给 ACP";
}

function isAcpPromptWrapperEcho(message: AgentMessage) {
  const text = message.text.trim();
  return (
    /^\[[a-z-]+mode\]/iu.test(text) ||
    text === "---" ||
    text.includes("SYNTHESIZE findings before proceeding.") ||
    text.includes("MANDATORY delegate_task params")
  );
}
