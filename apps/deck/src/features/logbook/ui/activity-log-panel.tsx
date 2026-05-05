import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";
import { CommandOutput } from "../../../shared/ui/primitives";
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
 * Merges prompt and tool activity into the mission activity timeline.
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
  const timelineItems = buildActivityTimeline(
    sessionToolCalls,
    commandChunks,
    sessionMessages,
  );
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
    <section className="info-list mission-activity-log">
      <div className="section-head section-head-soft">
        <div>
          <h3>{copy.commandOutput}</h3>
        </div>
      </div>
      <div className="plain-message-list conversation-timeline activity-timeline">
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
          <button
            className="secondary load-more-history"
            type="button"
            onClick={() =>
              sessionId
                ? onShowMore(sessionId, visibleCount + visibleLimit)
                : undefined
            }
          >
            展开更多（剩余 {hiddenCount} 条）
          </button>
        ) : historyState?.hasMore ? (
          <button
            className="secondary load-more-history"
            type="button"
            onClick={() => (sessionId ? onLoadOlder(sessionId) : undefined)}
            disabled={historyState.loading}
          >
            {historyState.loading ? "加载中..." : "加载更早活动"}
          </button>
        ) : null}
      </div>
    </section>
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
  const toolItems = groupToolCalls(
    sessionToolCalls.length
      ? sessionToolCalls
      : commandChunks.map(commandChunkToToolCall),
  );
  const promptItems = sessionMessages
    .filter((message) => message.role === "user")
    .map((message) => ({
      kind: "prompt" as const,
      id: message.id,
      timestamp: message.timestamp,
      text: message.text,
    }));

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
    <details className="tool-call-card acp-prompt-card">
      <summary className="tool-call-head">
        <span className="tool-call-icon" aria-hidden="true">
          ↗
        </span>
        <span className="tool-call-kind">Prompt</span>
        <strong>{summarizeActivityText(text)}</strong>
        <span className="tool-call-stream">user</span>
      </summary>
      <pre className="tool-call-output">{text}</pre>
    </details>
  );
}

function ToolActivityCard({
  item,
}: {
  item: ReturnType<typeof groupToolCalls>[number];
}) {
  const toolTone = resolveToolCallTone(item.toolKind, item.title);
  const streamTone = item.streams.includes("stderr") ? "stderr" : "stdout";

  return (
    <details
      className={`tool-call-card tool-call-${streamTone} ${toolTone.className}`}
    >
      <summary className="tool-call-head">
        <span className="tool-call-icon" aria-hidden="true">
          {toolTone.icon}
        </span>
        <span className="tool-call-kind">{toolTone.label}</span>
        <strong>{item.title}</strong>
        <span className={`tool-call-stream tool-call-stream-${streamTone}`}>
          {streamTone}
        </span>
      </summary>
      {item.text.trim() ? (
        <pre className="tool-call-output">{item.text}</pre>
      ) : null}
    </details>
  );
}

function summarizeActivityText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 72
    ? `${compact.slice(0, 72)}…`
    : compact || "发送给 ACP";
}
