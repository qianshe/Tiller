import { isAdapterPlanToolCall, readAdapterTranscriptToolCalls } from "@tiller/acp-runtime";
import {
  buildSessionTimelineFromLegacy,
  type AcpAgentProvider,
  type AgentMessage,
  type AgentToolCall,
  type CommandChunk,
  type FileDiffSummary,
  type SessionSummary,
  type SessionTimelineEntry,
  type SessionUpdateRecord,
} from "@tiller/shared";
import { normalizePersistedAgentToolCall } from "@tiller/persistence";
import type { TillerLogger } from "../../logging/logger";
import { hasToolCallChanged } from "../tool-call-repair/change-detection";
import { isStaleOpenCodeRunningWriteToolCall } from "../tool-call-repair/stale-open-code-write";
import { dedupeCodexWebFetchToolCalls } from "../tool-call-repair/codex-web-fetch-dedupe";

type SessionMessageStore = {
  list(sessionId: string): AgentMessage[];
};

type SessionArtifactStore = {
  get(sessionId: string): {
    outputs: CommandChunk[];
    diffs: FileDiffSummary[];
    toolCalls: AgentToolCall[];
  };
  replaceToolCalls(sessionId: string, toolCalls: AgentToolCall[]): void;
};

type SessionTimelineStore = {
  list?(sessionId: string): SessionTimelineEntry[];
  replace(sessionId: string, entries: SessionTimelineEntry[]): SessionTimelineEntry[];
};

type SessionUpdateStore = {
  listPage(sessionId: string, options: { limit?: number }): { updates: SessionUpdateRecord[] };
  append(record: SessionUpdateRecord): void;
};

export function readAdapterTranscriptToolCallRepair(input: {
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  logger?: Pick<TillerLogger, "debug">;
}): AgentToolCall[] {
  const { summary, agent, logger } = input;
  if (!summary.runtimeSessionId || !agent) {
    return [];
  }
  try {
    const toolCalls = readAdapterTranscriptToolCalls({
      provider: agent,
      runtimeSessionId: summary.runtimeSessionId,
      cwd: summary.cwd,
    });
    if (toolCalls.length) {
      logger?.debug("runtime.history_cache.adapter_transcript_tool_calls_read", {
        sessionId: summary.id,
        providerId: agent.id,
        runtimeSessionId: summary.runtimeSessionId,
        toolCalls: toolCalls.length,
      });
    }
    return toolCalls;
  } catch (error) {
    logger?.debug("runtime.history_cache.adapter_transcript_tool_calls_failed", {
      sessionId: summary.id,
      providerId: agent.id,
      runtimeSessionId: summary.runtimeSessionId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function applyTranscriptToolCallRepair(input: {
  sessionId: string;
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  transcriptToolCalls: AgentToolCall[];
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionTimelineStore?: SessionTimelineStore;
  sessionUpdateStore: SessionUpdateStore;
}) {
  const artifacts = input.sessionArtifactStore.get(input.sessionId);
  const currentTimeline = input.sessionTimelineStore?.list?.(input.sessionId) ?? [];
  const providerId = input.agent?.id ?? input.summary.agentId;
  const replayToolCalls = artifacts.toolCalls.length
    ? artifacts.toolCalls
    : currentTimeline
        .filter((entry): entry is Extract<SessionTimelineEntry, { kind: "tool_call" }> => entry.kind === "tool_call")
        .map((entry) => entry.toolCall);
  const filteredReplayToolCalls = dedupeCodexWebFetchToolCalls(
    providerId,
    replayToolCalls.filter((toolCall) =>
      shouldRetainTranscriptRepairedToolCall(input.summary, providerId, toolCall)
    ),
  );
  const { repairedToolCalls, changedToolCalls } = mergeTranscriptToolCalls(
    filteredReplayToolCalls,
    input.transcriptToolCalls,
  );
  const removedToolCallCount = replayToolCalls.length - filteredReplayToolCalls.length;
  if (!changedToolCalls.length && removedToolCallCount === 0) {
    return false;
  }

  input.sessionArtifactStore.replaceToolCalls(input.sessionId, repairedToolCalls);
  if (currentTimeline.length) {
    const repairedTimeline = repairTimelineToolCalls(currentTimeline, repairedToolCalls);
    input.sessionTimelineStore?.replace(input.sessionId, repairedTimeline);
  } else {
    input.sessionTimelineStore?.replace(
      input.sessionId,
      buildSessionTimelineFromLegacy({
        messages: input.sessionMessageStore.list(input.sessionId),
        outputs: artifacts.outputs,
        toolCalls: repairedToolCalls,
      }),
    );
  }
  appendTranscriptRepairToolCallUpdates({
    ...input,
    toolCalls: changedToolCalls,
  });
  return true;
}

function mergeTranscriptToolCalls(
  replayToolCalls: AgentToolCall[],
  transcriptToolCalls: AgentToolCall[],
) {
  const transcriptById = new Map(
    transcriptToolCalls
      .map((toolCall) => normalizePersistedAgentToolCall(toolCall) ?? toolCall)
      .map((toolCall) => [toolCall.id, toolCall] as const),
  );
  const changedToolCalls: AgentToolCall[] = [];
  const repairedToolCalls = replayToolCalls.map((toolCall) => {
    const transcriptToolCall = transcriptById.get(toolCall.id);
    if (!transcriptToolCall) {
      return toolCall;
    }
    const repaired = {
      ...toolCall,
      ...transcriptToolCall,
      id: toolCall.id,
      timestamp: toolCall.timestamp,
      sequence: toolCall.sequence ?? transcriptToolCall.sequence,
      output: transcriptToolCall.output ?? toolCall.output,
      input: transcriptToolCall.input ?? toolCall.input,
    } satisfies AgentToolCall;
    if (!hasToolCallChanged(toolCall, repaired)) {
      return toolCall;
    }
    changedToolCalls.push(repaired);
    return repaired;
  });
  return { repairedToolCalls, changedToolCalls };
}

function appendTranscriptRepairToolCallUpdates(input: {
  sessionId: string;
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  toolCalls: AgentToolCall[];
  sessionUpdateStore: SessionUpdateStore;
}) {
  const latest = input.sessionUpdateStore.listPage(input.sessionId, { limit: 1 }).updates[0];
  let sequence = latest?.sequence ?? 0;
  for (const toolCall of input.toolCalls) {
    sequence += 1;
    input.sessionUpdateStore.append({
      sessionId: input.sessionId,
      runtimeSessionId: input.summary.runtimeSessionId ?? input.sessionId,
      providerId: input.agent?.id ?? input.summary.agentId,
      sequence,
      source: "agent_transcript_repair",
      updateType: "tool-call",
      receivedAt: new Date().toISOString(),
      payloadJson: JSON.stringify({ type: "tool-call", toolCall }),
    });
  }
}

function repairTimelineToolCalls(
  timeline: SessionTimelineEntry[],
  repairedToolCalls: AgentToolCall[],
) {
  const repairedById = new Map(
    repairedToolCalls.map((toolCall) => [toolCall.id, toolCall] as const),
  );
  const repairedTimeline: SessionTimelineEntry[] = [];
  for (const entry of timeline) {
    if (entry.kind !== "tool_call") {
      repairedTimeline.push(entry);
      continue;
    }
    const repairedToolCall = repairedById.get(entry.toolCall.id);
    if (!repairedToolCall) {
      continue;
    }
    repairedTimeline.push({
      ...entry,
      toolCall: repairedToolCall,
      updatedAt: repairedToolCall.updatedAt,
    } satisfies SessionTimelineEntry);
  }
  return repairedTimeline;
}

function shouldRetainTranscriptRepairedToolCall(
  summary: Pick<SessionSummary, "cwd" | "status">,
  providerId: string | undefined,
  toolCall: AgentToolCall,
) {
  if (isStaleOpenCodeRunningWriteToolCall({
    providerId,
    summary,
    toolCall,
  })) {
    return false;
  }
  return !isAdapterPlanToolCall(providerId, toolCall);
}
