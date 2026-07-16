import type {
  AgentMessage,
  AgentToolCall,
  SessionSummary,
  SessionTimelineEntry,
} from "@tiller/shared";
import { deriveToolCallsFromTimeline } from "../utils/timeline-activity";

/**
 * Measures the total streamed character volume of a session so callers can
 * detect in-place content growth (streaming text / growing tool output) that
 * leaves entry counts unchanged.
 */
export function resolveSessionStreamContentLength(sources: {
  messages?: AgentMessage[];
  timeline?: SessionTimelineEntry[];
  toolCalls?: AgentToolCall[];
}): number {
  let length = 0;
  for (const message of sources.messages ?? []) {
    length += message.text?.length ?? 0;
  }
  for (const entry of sources.timeline ?? []) {
    if (entry.kind === "assistant_message") {
      for (const chunk of entry.chunks) {
        length += chunk.text?.length ?? 0;
      }
    } else if (entry.kind === "tool_call") {
      length += (entry.toolCall.output?.length ?? 0) + (entry.toolCall.input?.length ?? 0);
    } else if (entry.kind === "command_output") {
      length += entry.output.text?.length ?? 0;
    } else if (entry.kind === "context_compaction" || entry.kind === "history_gap") {
      // Transcript events don't contribute to character count
      continue;
    } else {
      length += entry.message.text?.length ?? 0;
    }
  }
  for (const toolCall of sources.toolCalls ?? []) {
    length += (toolCall.output?.length ?? 0) + (toolCall.input?.length ?? 0);
  }
  return length;
}

export function splitMissionToolCalls(
  toolCalls: AgentToolCall[],
  timelineItems?: SessionTimelineEntry[],
) {
  const effectiveToolCalls = toolCalls.length > 0
    ? toolCalls
    : deriveToolCallsFromTimeline(timelineItems);
  return {
    thinkingToolCalls: effectiveToolCalls.filter((toolCall) => toolCall.kind === "think"),
    timelineToolCalls: effectiveToolCalls.filter((toolCall) => toolCall.kind !== "think"),
    boundaryTimestamps: effectiveToolCalls.map((toolCall) => toolCall.timestamp),
  };
}

export function shouldAutoScrollSessionBody({
  stickToBottom,
  historyLoading = false,
  historyRevealLocked = false,
  previousHistoryLoading = false,
  allowAfterInitialHistoryLoad = false,
}: {
  stickToBottom?: boolean;
  historyLoading?: boolean;
  historyRevealLocked?: boolean;
  previousHistoryLoading?: boolean;
  allowAfterInitialHistoryLoad?: boolean;
}) {
  return stickToBottom !== false &&
    !historyLoading &&
    !historyRevealLocked &&
    (!previousHistoryLoading || allowAfterInitialHistoryLoad);
}

export function resolveSessionBodyStickToBottom({
  current,
  previous,
  previousStickToBottom,
  threshold,
}: {
  current: { scrollTop: number; scrollHeight: number; clientHeight: number };
  previous?: { scrollTop: number; scrollHeight: number };
  previousStickToBottom?: boolean;
  threshold: number;
}) {
  // A growing stream can fire a scroll event before the follow-to-bottom write.
  // Preserve the existing sticky intent so layout growth is not mistaken for a
  // user-initiated upward scroll. A later real scroll event (without growth)
  // still disables auto-follow when the user moves away from the bottom.
  if (
    previousStickToBottom !== false &&
    previous &&
    current.scrollHeight > previous.scrollHeight
  ) {
    return true;
  }
  return current.scrollHeight - current.scrollTop - current.clientHeight <= threshold;
}

export function pruneSessionCardScrollState<T>(
  state: Record<string, T>,
  openSessionIds: ReadonlyArray<string>,
) {
  const openIds = new Set(openSessionIds);
  return Object.fromEntries(
    Object.entries(state).filter(([sessionId]) => openIds.has(sessionId)),
  ) as Record<string, T>;
}

export function resolveSessionStatusTone(status: SessionSummary["status"]): "active" | "idle" | "warning" | "danger" | "primary" {
  switch (status) {
    case "running":
      return "primary";
    case "waiting_for_permission":
      return "warning";
    case "error":
      return "danger";
    default:
      return "idle";
  }
}

/**
 * Short, always-present status word for a session, shown in the chat window
 * title bar so a running window is never left without a visible status.
 */
export function resolveSessionStatusLabel(status: SessionSummary["status"]): string {
  switch (status) {
    case "starting":
      return "启动中";
    case "running":
      return "运行中";
    case "waiting_for_permission":
      return "等待审批";
    case "error":
      return "错误";
    case "cancelled":
      return "已取消";
    case "idle":
    default:
      return "空闲";
  }
}

export function resolveSessionConversationDisplayMode({
  sessionId,
  sessionMessages,
  sessionStatus,
  timelineItemsLength,
}: {
  sessionId: string;
  sessionMessages?: AgentMessage[];
  sessionStatus: SessionSummary["status"];
  timelineItemsLength: number;
}): "conversation" | "history-loading" | "preview" {
  const messages = sessionMessages ?? [];
  const canUseOptimisticFallback =
    sessionStatus === "starting" ||
    sessionStatus === "running" ||
    sessionStatus === "waiting_for_permission";
  if (timelineItemsLength > 0) {
    return "conversation";
  }
  if (canUseOptimisticFallback && hasOptimisticConversationMessages(sessionId, messages)) {
    return "conversation";
  }
  if (messages.length > 0) {
    return "history-loading";
  }
  return "preview";
}

function hasOptimisticConversationMessages(
  sessionId: string,
  sessionMessages: AgentMessage[],
) {
  return sessionMessages.some((message) => {
    if (message.role === "user") {
      return (
        message.id === `${sessionId}-user-pending` ||
        message.id.startsWith(`${sessionId}-user-`)
      );
    }
    return message.role === "assistant" && message.streaming === true;
  });
}

export function formatSessionPreviewTime(value: string | undefined) {
  if (!value) {
    return "--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
