import { isAdapterPlanToolCall, mapSessionUpdateNotification } from "@tiller/acp-runtime";
import { isFallbackToolCallTitle } from "@tiller/persistence";
import { compactBinaryToolCallOutput, type AgentToolCall, type SessionSummary, type SessionTimelineEntry, type SessionUpdateRecord } from "@tiller/shared";
import { hasToolCallChanged } from "../tool-call-repair/change-detection";
import { isStaleOpenCodeRunningWriteToolCall } from "../tool-call-repair/stale-open-code-write";
import { dedupeCodexWebFetchToolCalls } from "../tool-call-repair/codex-web-fetch-dedupe";

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

type SessionUpdateToolCallRepairResult = {
  changedCount: number;
  updates: SessionUpdateRecord[];
};

export function repairSessionToolCalls(
  context: ToolCallRepairContext,
  toolCalls: AgentToolCall[],
): ToolCallRepairResult {
  const dedupedToolCalls = dedupeCodexWebFetchToolCalls(context.providerId, toolCalls);
  const filteredToolCalls = dedupedToolCalls.filter((toolCall) =>
    shouldRetainPersistedToolCall(context, toolCall)
  );
  let changedCount = toolCalls.length - dedupedToolCalls.length;
  changedCount += dedupedToolCalls.length - filteredToolCalls.length;
  const repairedToolCalls = filteredToolCalls.map((toolCall) => {
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
  const toolCalls = timeline
    .filter((entry): entry is Extract<SessionTimelineEntry, { kind: "tool_call" }> => entry.kind === "tool_call")
    .map((entry) => entry.toolCall);
  const retainedToolCallIds = new Set(
    dedupeCodexWebFetchToolCalls(context.providerId, toolCalls).map((toolCall) => toolCall.id),
  );
  let changedCount = 0;
  const repairedTimeline: SessionTimelineEntry[] = [];
  for (const entry of timeline) {
    if (entry.kind !== "tool_call") {
      repairedTimeline.push(entry);
      continue;
    }
    if (!retainedToolCallIds.has(entry.toolCall.id)) {
      changedCount += 1;
      continue;
    }
    if (!shouldRetainPersistedToolCall(context, entry.toolCall)) {
      changedCount += 1;
      continue;
    }
    const repairedToolCall = repairToolCall(context, entry.toolCall);
    if (!hasToolCallChanged(entry.toolCall, repairedToolCall)) {
      repairedTimeline.push(entry);
      continue;
    }
    changedCount += 1;
    repairedTimeline.push({
      ...entry,
      toolCall: repairedToolCall,
      updatedAt: repairedToolCall.updatedAt,
    } satisfies SessionTimelineEntry);
  }
  return {
    changedCount,
    timeline: changedCount > 0 ? repairedTimeline : timeline,
  };
}

export function repairSessionUpdateToolCalls(
  context: ToolCallRepairContext,
  updates: SessionUpdateRecord[],
): SessionUpdateToolCallRepairResult {
  const updateToolCalls = updates
    .map((update) => ({ update, toolCall: readToolCallUpdate(update) }))
    .filter((entry): entry is { update: SessionUpdateRecord; toolCall: AgentToolCall } => Boolean(entry.toolCall));
  const retainedToolCallIds = new Set(
    dedupeCodexWebFetchToolCalls(
      context.providerId,
      updateToolCalls.map((entry) => entry.toolCall),
    ).map((toolCall) => toolCall.id),
  );
  let changedCount = 0;
  const repairedUpdates: SessionUpdateRecord[] = [];
  for (const update of updates) {
    if (update.updateType !== "tool-call") {
      repairedUpdates.push(update);
      continue;
    }
    const parsedToolCall = readToolCallUpdate(update);
    if (!parsedToolCall) {
      repairedUpdates.push(update);
      continue;
    }
    if (!retainedToolCallIds.has(parsedToolCall.id)) {
      changedCount += 1;
      continue;
    }
    if (!shouldRetainPersistedToolCall(context, parsedToolCall)) {
      changedCount += 1;
      continue;
    }
    const repairedToolCall = repairToolCall(context, parsedToolCall);
    if (!hasToolCallChanged(parsedToolCall, repairedToolCall)) {
      repairedUpdates.push(update);
      continue;
    }
    changedCount += 1;
    repairedUpdates.push({
      ...update,
      payloadJson: JSON.stringify({ type: "tool-call", toolCall: repairedToolCall }),
    });
  }
  return {
    changedCount,
    updates: changedCount > 0 ? repairedUpdates : updates,
  };
}

function repairToolCall(
  context: ToolCallRepairContext,
  toolCall: AgentToolCall,
) {
  return compactBinaryToolCallOutput(repairCompletedThinkingToolCall(
    context.summary,
    repairLegacySubagentToolCall(
      repairProviderToolCall(context.sessionId, context.providerId, toolCall),
    ),
  ));
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

function shouldRetainPersistedToolCall(
  context: ToolCallRepairContext,
  toolCall: AgentToolCall,
) {
  if (isStaleOpenCodeRunningWriteToolCall({
    providerId: context.providerId,
    summary: context.summary,
    toolCall,
  })) {
    return false;
  }
  return !isAdapterPlanToolCall(context.providerId, toolCall);
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

function readToolCallUpdate(update: SessionUpdateRecord) {
  try {
    const parsed = JSON.parse(update.payloadJson) as {
      type?: unknown;
      toolCall?: AgentToolCall;
    };
    return parsed.type === "tool-call" && parsed.toolCall ? parsed.toolCall : null;
  } catch {
    return null;
  }
}
