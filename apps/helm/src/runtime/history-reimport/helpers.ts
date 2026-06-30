import type {
  AgentMessage,
  AgentPlan,
  CommandChunk,
  FileDiffSummary,
  SessionHistoryReimportResult,
  SessionTimelineEntry,
  SessionSummary,
  AgentToolCall,
} from "@tiller/shared";
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import { mergeAuthoritativeMessagesWithLocalUserPrompts } from "../../sessions/provider-history-sync.js";
import { projectLegacySessionHistoryFromTimeline } from "../session-timeline/legacy-projection.js";

type MessagePage = {
  messages: AgentMessage[];
  nextCursor?: string;
  hasMore: boolean;
};

type ArtifactPage = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
  nextCursor?: string;
  hasMore: boolean;
};

type ReimportMessageStore = {
  list(sessionId: string): AgentMessage[];
  replace(sessionId: string, messages: AgentMessage[]): void;
  listPage(sessionId: string, options: { limit?: number }): MessagePage;
};

type ReimportArtifactStore = {
  get(sessionId: string): {
    outputs: CommandChunk[];
    diffs: FileDiffSummary[];
    toolCalls: AgentToolCall[];
  };
  getPage(sessionId: string, options: { limit?: number }): ArtifactPage;
};

type ReimportTimelineStore = {
  list?(sessionId: string): SessionTimelineEntry[];
  replace(sessionId: string, entries: SessionTimelineEntry[]): SessionTimelineEntry[];
};

export function resolveLegacyHistoryBaseline(input: {
  messages: AgentMessage[];
  artifacts: {
    outputs: CommandChunk[];
    diffs: FileDiffSummary[];
    toolCalls: AgentToolCall[];
  };
  timeline: SessionTimelineEntry[];
}) {
  const projected = projectLegacySessionHistoryFromTimeline(input.timeline);
  return {
    messages: input.messages.length ? input.messages : projected.messages,
    artifacts: {
      outputs: input.artifacts.outputs.length ? input.artifacts.outputs : projected.outputs,
      diffs: input.artifacts.diffs,
      toolCalls: input.artifacts.toolCalls.length ? input.artifacts.toolCalls : projected.toolCalls,
    },
  };
}

export function chooseRecoverySummary(
  summary: SessionSummary,
  storedSummary: SessionSummary | undefined,
): SessionSummary {
  if (!storedSummary) {
    return summary;
  }
  const summaryText = summary.lastMessagePreview?.trim() || summary.title?.trim();
  const storedText = storedSummary.lastMessagePreview?.trim() || storedSummary.title?.trim();
  if (summaryText || !storedText) {
    return summary;
  }
  return storedSummary;
}

export function readReimportedHistoryPage(input: {
  sessionId: string;
  limit?: number;
  message: string;
  plan?: AgentPlan;
  sessionMessageStore: ReimportMessageStore;
  sessionArtifactStore: ReimportArtifactStore;
  sessionTimelineStore?: ReimportTimelineStore;
}): SessionHistoryReimportResult {
  const messagePage = input.sessionMessageStore.listPage(input.sessionId, { limit: input.limit });
  const artifactPage = input.sessionArtifactStore.getPage(input.sessionId, { limit: input.limit });
  const timeline = replaceReimportedHistoryTimeline(input);
  return {
    sessionId: input.sessionId,
    messages: messagePage.messages,
    timeline,
    outputs: artifactPage.outputs,
    diffs: artifactPage.diffs,
    toolCalls: artifactPage.toolCalls,
    ...(input.plan ? { plan: input.plan } : {}),
    nextCursor: messagePage.nextCursor,
    hasMore: messagePage.hasMore,
    activityNextCursor: artifactPage.nextCursor,
    activityHasMore: artifactPage.hasMore,
    message: input.message,
  };
}

export function replaceReimportedHistoryTimeline(input: {
  sessionId: string;
  sessionMessageStore: Pick<ReimportMessageStore, "list">;
  sessionArtifactStore: Pick<ReimportArtifactStore, "get">;
  sessionTimelineStore?: ReimportTimelineStore;
}): SessionTimelineEntry[] {
  const existingTimeline = input.sessionTimelineStore?.list?.(input.sessionId) ?? [];
  if (existingTimeline.length) {
    return existingTimeline;
  }
  const messages = input.sessionMessageStore.list(input.sessionId);
  const artifacts = input.sessionArtifactStore.get(input.sessionId);
  const timeline = buildSessionTimelineFromLegacy({
    messages,
    outputs: artifacts.outputs,
    toolCalls: artifacts.toolCalls,
  });
  return input.sessionTimelineStore?.replace(input.sessionId, timeline) ?? timeline;
}

export function preservePreviousUserPromptsAfterReimport(input: {
  sessionId: string;
  previousMessages: AgentMessage[];
  sessionMessageStore: Pick<ReimportMessageStore, "list" | "replace">;
}) {
  const previousUserPrompts = input.previousMessages.filter(
    (message) => message.role === "user",
  );
  if (!previousUserPrompts.length) {
    return;
  }
  const currentMessages = input.sessionMessageStore.list(input.sessionId);
  const mergedMessages = mergeAuthoritativeMessagesWithLocalUserPrompts(
    previousUserPrompts,
    currentMessages,
  );
  if (mergedMessages.length !== currentMessages.length) {
    input.sessionMessageStore.replace(input.sessionId, mergedMessages);
  }
}

const RECOVERED_SEQUENCE_RESET_TIMESTAMP_GAP_MS = 60_000;

export function sanitizeRecoveredHistorySequenceResets(
  entries: SessionTimelineEntry[],
) {
  const observations = entries
    .map((entry, index) => {
      const sequence = resolveEntryTimelineSequence(entry);
      const timestamp = Date.parse(entry.timestamp);
      return Number.isFinite(timestamp) && typeof sequence === "number"
        ? { entryId: entry.id, sequence, timestamp, index }
        : null;
    })
    .filter((entry): entry is {
      entryId: string;
      sequence: number;
      timestamp: number;
      index: number;
    } => Boolean(entry))
    .sort((left, right) =>
      left.timestamp === right.timestamp ? left.index - right.index : left.timestamp - right.timestamp
    );

  const staleEntryIds = new Set<string>();
  let maxSequence = Number.NEGATIVE_INFINITY;
  let maxSequenceTimestamp = Number.NEGATIVE_INFINITY;

  for (const observation of observations) {
    if (
      observation.sequence < maxSequence &&
      observation.timestamp - maxSequenceTimestamp > RECOVERED_SEQUENCE_RESET_TIMESTAMP_GAP_MS
    ) {
      staleEntryIds.add(observation.entryId);
      continue;
    }
    if (observation.sequence > maxSequence) {
      maxSequence = observation.sequence;
      maxSequenceTimestamp = observation.timestamp;
      continue;
    }
    if (observation.timestamp > maxSequenceTimestamp) {
      maxSequenceTimestamp = observation.timestamp;
    }
  }

  if (!staleEntryIds.size) {
    return {
      entries,
      clearedMessageIds: new Set<string>(),
      clearedToolCallIds: new Set<string>(),
    };
  }

  const clearedMessageIds = new Set<string>();
  const clearedToolCallIds = new Set<string>();
  const sanitizedEntries = entries.map((entry) => {
    if (!staleEntryIds.has(entry.id)) {
      return entry;
    }
    // Transcript events don't have sequence to clear
    if (entry.kind === "context_compaction" || entry.kind === "session_resumed" || entry.kind === "history_gap") {
      return entry;
    }
    if (entry.kind === "tool_call") {
      clearedToolCallIds.add(entry.toolCall.id);
      return {
        ...entry,
        sequence: undefined,
        toolCall: {
          ...entry.toolCall,
          sequence: undefined,
        },
      };
    }
    if (entry.kind === "assistant_message") {
      clearedMessageIds.add(entry.id);
      return {
        ...entry,
        sequence: undefined,
        chunks: entry.chunks.map((chunk) => ({
          ...chunk,
          sequence: undefined,
        })),
      };
    }
    clearedMessageIds.add(entry.message.id);
    return {
      ...entry,
      sequence: undefined,
      message: {
        ...entry.message,
        sequence: undefined,
      },
    };
  });

  return { entries: sanitizedEntries, clearedMessageIds, clearedToolCallIds };
}

export function clearRecoveredArtifactTimelineSequences(input: {
  outputs: CommandChunk[];
  toolCalls: AgentToolCall[];
  clearedToolCallIds: ReadonlySet<string>;
}) {
  if (!input.clearedToolCallIds.size) {
    return { outputs: input.outputs, toolCalls: input.toolCalls };
  }
  const outputs = input.outputs.map((output) =>
    input.clearedToolCallIds.has(output.commandId) || input.clearedToolCallIds.has(output.id)
      ? { ...output, sequence: undefined }
      : output
  );
  const toolCalls = input.toolCalls.map((toolCall) =>
    input.clearedToolCallIds.has(toolCall.id) && typeof toolCall.sequence === "number"
      ? { ...toolCall, sequence: undefined }
      : toolCall
  );
  return { outputs, toolCalls };
}

function resolveEntryTimelineSequence(entry: SessionTimelineEntry) {
  if (entry.kind === "context_compaction" || entry.kind === "session_resumed" || entry.kind === "history_gap") {
    return undefined;
  }
  if (entry.kind === "tool_call") {
    return entry.sequence ?? entry.toolCall.sequence;
  }
  if (entry.kind === "assistant_message") {
    return entry.sequence ?? entry.chunks[0]?.sequence;
  }
  return entry.sequence ?? entry.message.sequence;
}

export function findAcpReplayCoverageGap(input: {
  previousMessages: AgentMessage[];
  replayMessages: AgentMessage[];
  previousTimeline?: SessionTimelineEntry[];
  replayTimeline?: SessionTimelineEntry[];
  previousPlan?: AgentPlan;
  replayPlan?: AgentPlan;
}): string | null {
  if (isVisiblePlan(input.previousPlan) && !isVisiblePlan(input.replayPlan)) {
    return "ACP replay 未返回本地已有的可见计划。";
  }

  const replayAssistantText = normalizeComparableText(
    [
      ...input.replayMessages
        .filter((message) => message.role === "assistant")
        .map((message) => message.text),
      collectReplayTimelineComparableText(input.replayTimeline),
    ].join("\n"),
  );
  const compactReplayAssistantText = compactComparableText(replayAssistantText);
  const previousThinkingText = normalizeComparableText(
    collectTimelineThinkingComparableText(input.previousTimeline),
  );
  const compactPreviousThinkingText = compactComparableText(previousThinkingText);
  const missingAssistantMessages = input.previousMessages
    .filter((message) => message.role === "assistant")
    .map((message) => normalizeComparableText(message.text))
    .filter((text) =>
      text.length > 0 &&
      !isTextCoveredByReplay(text, previousThinkingText, compactPreviousThinkingText) &&
      !isTextCoveredByReplay(text, replayAssistantText, compactReplayAssistantText)
    );
  if (missingAssistantMessages.length) {
    return `ACP replay 遗漏了 ${missingAssistantMessages.length} 条本地已有的助手消息。`;
  }

  return null;
}

function isVisiblePlan(plan: AgentPlan | undefined): plan is AgentPlan {
  return Boolean(plan?.entries.length);
}

function normalizeComparableText(text: string) {
  return text.replace(/[*_~`]/gu, "").replace(/\s+/gu, " ").trim();
}

function compactComparableText(text: string) {
  return text.replace(/\s+/gu, "");
}

function collectReplayTimelineComparableText(entries: SessionTimelineEntry[] | undefined) {
  return (entries ?? [])
    .flatMap((entry) => {
      if (entry.kind === "assistant_message") {
        return entry.chunks.map((chunk) => chunk.text);
      }
      if (entry.kind === "tool_call" && entry.toolCall.kind === "think") {
        return [entry.toolCall.input, entry.toolCall.output].filter(isString);
      }
      return [];
    })
    .join("\n");
}

function collectTimelineThinkingComparableText(entries: SessionTimelineEntry[] | undefined) {
  return (entries ?? [])
    .flatMap((entry) => {
      if (entry.kind === "assistant_message") {
        return entry.chunks
          .filter((chunk) => chunk.kind === "thinking")
          .map((chunk) => chunk.text);
      }
      if (entry.kind === "tool_call" && entry.toolCall.kind === "think") {
        return [entry.toolCall.input, entry.toolCall.output].filter(isString);
      }
      return [];
    })
    .join("\n");
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isTextCoveredByReplay(
  text: string,
  replayText: string,
  compactReplayText: string,
) {
  return replayText.includes(text) || compactReplayText.includes(compactComparableText(text));
}

export function recoverUserPromptFromSessionSummary(input: {
  sessionId: string;
  summary: SessionSummary;
  sessionMessageStore: Pick<ReimportMessageStore, "list" | "replace">;
}) {
  const currentMessages = input.sessionMessageStore.list(input.sessionId);
  if (currentMessages.some((message) => message.role === "user")) {
    return;
  }
  const recoveredText = input.summary.lastMessagePreview?.trim() || input.summary.title?.trim();
  if (!recoveredText) {
    return;
  }
  const firstMessageTimestamp = currentMessages
    .map((message) => Date.parse(message.timestamp))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  const timestamp = Number.isFinite(firstMessageTimestamp)
    ? new Date(firstMessageTimestamp - 1).toISOString()
    : input.summary.createdAt;
  input.sessionMessageStore.replace(input.sessionId, [
    {
      id: `${input.sessionId}-recovered-user-prompt`,
      role: "user",
      text: recoveredText,
      timestamp,
    },
    ...currentMessages,
  ]);
}
