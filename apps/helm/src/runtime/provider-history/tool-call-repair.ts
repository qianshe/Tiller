import { mapSessionUpdateNotification } from "@tiller/acp-runtime";
import { isFallbackToolCallTitle } from "@tiller/persistence";
import type { AgentToolCall, SessionSummary, SessionTimelineEntry } from "@tiller/shared";

type ToolCallRepairContext = {
  providerId: string;
  sessionId: string;
  summary: SessionSummary;
};

type ToolCallRepairResult = {
  changedCount: number;
  toolCalls: AgentToolCall[];
};

type TimelineToolCallRepairResult = {
  changedCount: number;
  timeline: SessionTimelineEntry[];
};

export function repairSessionToolCalls(
  context: ToolCallRepairContext,
  toolCalls: AgentToolCall[],
): ToolCallRepairResult {
  let changedCount = 0;
  const repairedToolCalls = toolCalls.map((toolCall) => {
    const repairedToolCall = repairToolCall(context, toolCall);
    if (hasToolCallChanged(toolCall, repairedToolCall)) {
      changedCount += 1;
      return repairedToolCall;
    }
    return toolCall;
  });
  return {
    changedCount,
    toolCalls: changedCount > 0 ? repairedToolCalls : toolCalls,
  };
}

export function repairTimelineToolCalls(
  context: ToolCallRepairContext,
  timeline: SessionTimelineEntry[],
): TimelineToolCallRepairResult {
  let changedCount = 0;
  const repairedTimeline = timeline.map((entry) => {
    if (entry.kind !== "tool_call") {
      return entry;
    }
    const repairedToolCall = repairToolCall(context, entry.toolCall);
    if (!hasToolCallChanged(entry.toolCall, repairedToolCall)) {
      return entry;
    }
    changedCount += 1;
    return {
      ...entry,
      toolCall: repairedToolCall,
      updatedAt: repairedToolCall.updatedAt,
    } satisfies SessionTimelineEntry;
  });
  return {
    changedCount,
    timeline: changedCount > 0 ? repairedTimeline : timeline,
  };
}

function repairToolCall(
  context: ToolCallRepairContext,
  toolCall: AgentToolCall,
) {
  return repairCompletedThinkingToolCall(
    context.summary,
    repairLegacySubagentToolCall(
      repairProviderToolCall(context.sessionId, context.providerId, toolCall),
    ),
  );
}

function repairProviderToolCall(
  sessionId: string,
  providerId: string,
  toolCall: AgentToolCall,
) {
  const mapped = mapSessionUpdateNotification(
    {
      method: "session/update",
      params: {
        sessionId,
        update: {
          type: "tool_call_update",
          toolCall,
        },
      },
    },
    { providerId },
  );
  if (mapped?.event.type !== "tool-call") {
    return toolCall;
  }
  const repaired = mapped.event.toolCall;
  if (isFallbackToolCallTitle(repaired.title) && !isFallbackToolCallTitle(toolCall.title)) {
    return { ...repaired, title: toolCall.title };
  }
  return repaired;
}

function repairCompletedThinkingToolCall(
  summary: SessionSummary,
  toolCall: AgentToolCall,
) {
  if (
    toolCall.kind !== "think" ||
    (toolCall.status !== "running" && toolCall.status !== "pending") ||
    summary.status === "running" ||
    summary.status === "waiting_for_permission"
  ) {
    return toolCall;
  }
  return {
    ...toolCall,
    status: "completed" as const,
    updatedAt: summary.updatedAt,
  };
}

function repairLegacySubagentToolCall(toolCall: AgentToolCall) {
  if (toolCall.kind === "subagent") {
    return toolCall;
  }
  if (!looksLikeLegacySubagentToolCall(toolCall)) {
    return toolCall;
  }
  return {
    ...toolCall,
    kind: "subagent" as const,
  };
}

function looksLikeLegacySubagentToolCall(toolCall: AgentToolCall) {
  if (!/^spawn_agents_/u.test(toolCall.title.trim())) {
    return false;
  }
  const input = parseJsonRecord(toolCall.input);
  return Boolean(input && typeof input.path === "string" && input.path.trim());
}

function parseJsonRecord(input: string | undefined) {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function hasToolCallChanged(left: AgentToolCall, right: AgentToolCall) {
  return left.kind !== right.kind ||
    left.title !== right.title ||
    left.status !== right.status ||
    left.commandId !== right.commandId ||
    left.input !== right.input ||
    left.output !== right.output ||
    left.stream !== right.stream ||
    left.timestamp !== right.timestamp ||
    left.updatedAt !== right.updatedAt ||
    left.sequence !== right.sequence;
}
