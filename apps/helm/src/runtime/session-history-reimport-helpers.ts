import type {
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  SessionHistoryReimportResult,
  SessionSummary,
  AgentToolCall,
} from "@tiller/shared";
import { mergeAuthoritativeMessagesWithLocalUserPrompts } from "../sessions/provider-history-sync.js";

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
  getPage(sessionId: string, options: { limit?: number }): ArtifactPage;
};

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
  sessionMessageStore: ReimportMessageStore;
  sessionArtifactStore: ReimportArtifactStore;
}): SessionHistoryReimportResult {
  const messagePage = input.sessionMessageStore.listPage(input.sessionId, { limit: input.limit });
  const artifactPage = input.sessionArtifactStore.getPage(input.sessionId, { limit: input.limit });
  return {
    sessionId: input.sessionId,
    messages: messagePage.messages,
    outputs: artifactPage.outputs,
    diffs: artifactPage.diffs,
    toolCalls: artifactPage.toolCalls,
    nextCursor: messagePage.nextCursor,
    hasMore: messagePage.hasMore,
    activityNextCursor: artifactPage.nextCursor,
    activityHasMore: artifactPage.hasMore,
    message: input.message,
  };
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
