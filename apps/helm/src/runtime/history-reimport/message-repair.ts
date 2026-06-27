import { readAdapterTranscriptMessages } from "@tiller/acp-runtime";
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
  type SessionUpdateSource,
} from "@tiller/shared";
import type { TillerLogger } from "../../logging/logger";

type SessionMessageStore = {
  list(sessionId: string): AgentMessage[];
  replace(sessionId: string, messages: AgentMessage[]): void;
};

type SessionArtifactStore = {
  get(sessionId: string): {
    outputs: CommandChunk[];
    diffs: FileDiffSummary[];
    toolCalls: AgentToolCall[];
  };
};

type SessionTimelineStore = {
  replace(sessionId: string, entries: SessionTimelineEntry[]): SessionTimelineEntry[];
};

type SessionUpdateStore = {
  listPage(sessionId: string, options: { limit?: number }): { updates: SessionUpdateRecord[] };
  append(record: SessionUpdateRecord): void;
};

export function readAdapterTranscriptMessageRepair(input: {
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  logger?: Pick<TillerLogger, "debug">;
}): AgentMessage[] {
  const { summary, agent, logger } = input;
  if (!summary.runtimeSessionId || !agent) {
    return [];
  }
  try {
    const messages = readAdapterTranscriptMessages({
      provider: agent,
      runtimeSessionId: summary.runtimeSessionId,
      cwd: summary.cwd,
    });
    if (messages.length) {
      logger?.debug("runtime.history_cache.adapter_transcript_messages_read", {
        sessionId: summary.id,
        providerId: agent.id,
        runtimeSessionId: summary.runtimeSessionId,
        messages: messages.length,
      });
    }
    return messages;
  } catch (error) {
    logger?.debug("runtime.history_cache.adapter_transcript_messages_failed", {
      sessionId: summary.id,
      providerId: agent.id,
      runtimeSessionId: summary.runtimeSessionId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function applyTranscriptMessageRepair(input: {
  sessionId: string;
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  transcriptMessages: AgentMessage[];
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionTimelineStore?: SessionTimelineStore;
  sessionUpdateStore: SessionUpdateStore;
}) {
  return applyVisibleMessageRepair({
    ...input,
    repairMessages: input.transcriptMessages,
    source: "agent_transcript_repair",
  });
}

export function applyLocalMessageRepair(input: {
  sessionId: string;
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  previousMessages: AgentMessage[];
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionTimelineStore?: SessionTimelineStore;
  sessionUpdateStore: SessionUpdateStore;
}) {
  return applyVisibleMessageRepair({
    ...input,
    repairMessages: input.previousMessages,
    source: "local_history_repair",
  });
}

function applyVisibleMessageRepair(input: {
  sessionId: string;
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  repairMessages: AgentMessage[];
  source: SessionUpdateSource;
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionTimelineStore?: SessionTimelineStore;
  sessionUpdateStore: SessionUpdateStore;
}) {
  const replayMessages = input.sessionMessageStore.list(input.sessionId);
  const missingAssistantMessages = findMissingTranscriptAssistantMessages(
    input.repairMessages,
    replayMessages,
  );
  if (!missingAssistantMessages.length) {
    return false;
  }

  const repairedMessages = buildRepairedVisibleMessages(input.repairMessages, replayMessages);
  if (!repairedMessages.length) {
    return false;
  }

  input.sessionMessageStore.replace(input.sessionId, repairedMessages);
  const artifacts = input.sessionArtifactStore.get(input.sessionId);
  input.sessionTimelineStore?.replace(
    input.sessionId,
    buildSessionTimelineFromLegacy({
      messages: repairedMessages,
      outputs: artifacts.outputs,
      toolCalls: artifacts.toolCalls,
    }),
  );
  appendTranscriptRepairMessageUpdates({
    ...input,
    messages: missingAssistantMessages.map((message) =>
      repairedMessages.find((candidate) => candidate.id === message.id) ?? message
    ),
  });
  return true;
}

function buildRepairedVisibleMessages(
  transcriptMessages: AgentMessage[],
  replayMessages: AgentMessage[],
) {
  const repaired: AgentMessage[] = [];
  const usedReplayUserIndexes = new Set<number>();
  for (const transcriptMessage of transcriptMessages) {
    if (transcriptMessage.role === "user") {
      const replayUserIndex = findReplayUserIndex(replayMessages, transcriptMessage, usedReplayUserIndexes);
      if (replayUserIndex === -1) {
        continue;
      }
      usedReplayUserIndexes.add(replayUserIndex);
      const replayUser = replayMessages[replayUserIndex];
      if (replayUser) {
        repaired.push({ ...replayUser });
      }
      continue;
    }
    if (transcriptMessage.role === "assistant") {
      repaired.push({ ...transcriptMessage });
    }
  }

  const transcriptText = normalizedCombinedText(transcriptMessages);
  for (const replayMessage of replayMessages) {
    if (replayMessage.role !== "system" && isTextCovered(replayMessage.text, transcriptText)) {
      continue;
    }
    repaired.push({ ...replayMessage });
  }
  return repaired;
}

function findReplayUserIndex(
  replayMessages: AgentMessage[],
  transcriptMessage: AgentMessage,
  usedIndexes: Set<number>,
) {
  const normalizedTranscriptText = normalizeComparableText(transcriptMessage.text);
  return replayMessages.findIndex((message, index) =>
    !usedIndexes.has(index) &&
    message.role === "user" &&
    normalizeComparableText(message.text) === normalizedTranscriptText
  );
}

function findMissingTranscriptAssistantMessages(
  transcriptMessages: AgentMessage[],
  replayMessages: AgentMessage[],
) {
  const replayAssistantText = normalizedCombinedText(
    replayMessages.filter((message) => message.role === "assistant"),
  );
  return transcriptMessages.filter((message) =>
    message.role === "assistant" && !isTextCovered(message.text, replayAssistantText)
  );
}

function appendTranscriptRepairMessageUpdates(input: {
  sessionId: string;
  summary: SessionSummary;
  agent: AcpAgentProvider | undefined;
  messages: AgentMessage[];
  source: SessionUpdateSource;
  sessionUpdateStore: SessionUpdateStore;
}) {
  const latest = input.sessionUpdateStore.listPage(input.sessionId, { limit: 1 }).updates[0];
  let sequence = latest?.sequence ?? 0;
  for (const message of input.messages) {
    sequence += 1;
    input.sessionUpdateStore.append({
      sessionId: input.sessionId,
      runtimeSessionId: input.summary.runtimeSessionId ?? input.sessionId,
      providerId: input.agent?.id ?? input.summary.agentId,
      sequence,
      source: input.source,
      updateType: "message",
      receivedAt: new Date().toISOString(),
      payloadJson: JSON.stringify({ type: "message", message }),
    });
  }
}

function normalizedCombinedText(messages: AgentMessage[]) {
  return normalizeComparableText(messages.map((message) => message.text).join("\n"));
}

function isTextCovered(text: string, normalizedCombined: string) {
  const normalizedText = normalizeComparableText(text);
  return Boolean(normalizedText) && (
    normalizedCombined.includes(normalizedText) ||
    compactComparableText(normalizedCombined).includes(compactComparableText(normalizedText))
  );
}

function normalizeComparableText(text: string) {
  return text.replace(/[*_~`]/gu, "").replace(/\s+/gu, " ").trim();
}

function compactComparableText(text: string) {
  return text.replace(/\s+/gu, "");
}
