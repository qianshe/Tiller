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

const MESSAGE_TIMESTAMP_SKEW_MS = 60_000;

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
  const hasTimestampSkew = hasVisibleMessageTimestampSkew(
    input.repairMessages,
    replayMessages,
  );
  if (!missingAssistantMessages.length && !hasTimestampSkew) {
    return false;
  }

  const {
    repairedMessages,
    changedMessages,
  } = buildRepairedVisibleMessages(input.repairMessages, replayMessages);
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
    messages: changedMessages,
  });
  return true;
}

function buildRepairedVisibleMessages(
  transcriptMessages: AgentMessage[],
  replayMessages: AgentMessage[],
) {
  const repaired: AgentMessage[] = [];
  const changed: AgentMessage[] = [];
  const usedReplayIndexes = new Set<number>();
  for (const transcriptMessage of transcriptMessages) {
    const replayIndex = findReplayMessageIndex(
      replayMessages,
      transcriptMessage,
      usedReplayIndexes,
    );
    if (replayIndex !== -1) {
      usedReplayIndexes.add(replayIndex);
    }
    const repairedMessage = buildRepairedVisibleMessage(
      transcriptMessage,
      replayIndex === -1 ? undefined : replayMessages[replayIndex],
    );
    if (!repairedMessage) {
      continue;
    }
    repaired.push(repairedMessage);
    if (
      replayIndex === -1 ||
      hasVisibleMessageChanged(replayMessages[replayIndex], repairedMessage)
    ) {
      changed.push(repairedMessage);
    }
  }

  const transcriptText = normalizedCombinedText(transcriptMessages);
  for (const [index, replayMessage] of replayMessages.entries()) {
    if (
      usedReplayIndexes.has(index) ||
      (replayMessage.role !== "system" && isTextCovered(replayMessage.text, transcriptText))
    ) {
      continue;
    }
    repaired.push({ ...replayMessage });
  }
  return {
    repairedMessages: repaired,
    changedMessages: changed,
  };
}

function buildRepairedVisibleMessage(
  transcriptMessage: AgentMessage,
  replayMessage: AgentMessage | undefined,
) {
  if (!replayMessage) {
    return transcriptMessage.role === "assistant" ? { ...transcriptMessage } : undefined;
  }
  return {
    ...replayMessage,
    text: transcriptMessage.role === "assistant"
      ? transcriptMessage.text
      : replayMessage.text,
    timestamp: shouldUseTranscriptMessageTimestamp(replayMessage, transcriptMessage)
      ? transcriptMessage.timestamp
      : replayMessage.timestamp,
    sequence: replayMessage.sequence ?? transcriptMessage.sequence,
  } satisfies AgentMessage;
}

function findReplayMessageIndex(
  replayMessages: AgentMessage[],
  transcriptMessage: AgentMessage,
  usedIndexes: Set<number>,
) {
  const normalizedTranscriptText = normalizeComparableText(transcriptMessage.text);
  return replayMessages.findIndex((message, index) =>
    !usedIndexes.has(index) &&
    message.role === transcriptMessage.role &&
    normalizeComparableText(message.text) === normalizedTranscriptText
  );
}

function hasVisibleMessageChanged(
  replayMessage: AgentMessage | undefined,
  repairedMessage: AgentMessage,
) {
  if (!replayMessage) {
    return true;
  }
  return replayMessage.timestamp !== repairedMessage.timestamp ||
    replayMessage.text !== repairedMessage.text ||
    replayMessage.role !== repairedMessage.role;
}

function hasVisibleMessageTimestampSkew(
  transcriptMessages: AgentMessage[],
  replayMessages: AgentMessage[],
) {
  const usedReplayIndexes = new Set<number>();
  for (const transcriptMessage of transcriptMessages) {
    const replayIndex = findReplayMessageIndex(
      replayMessages,
      transcriptMessage,
      usedReplayIndexes,
    );
    if (replayIndex === -1) {
      continue;
    }
    usedReplayIndexes.add(replayIndex);
    const replayMessage = replayMessages[replayIndex];
    if (
      replayMessage &&
      exceedsTimestampSkew(replayMessage.timestamp, transcriptMessage.timestamp)
    ) {
      return true;
    }
  }
  return false;
}

function exceedsTimestampSkew(left: string, right: string) {
  const delta = Math.abs(Date.parse(left) - Date.parse(right));
  return Number.isFinite(delta) && delta > MESSAGE_TIMESTAMP_SKEW_MS;
}

function shouldUseTranscriptMessageTimestamp(
  replayMessage: AgentMessage,
  transcriptMessage: AgentMessage,
) {
  return exceedsTimestampSkew(replayMessage.timestamp, transcriptMessage.timestamp);
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
