import { loadAdapterAuthoritativeHistory } from "@tiller/acp-runtime";
import { resolveProviderById } from "@tiller/agent-registry";
import {
  buildSessionTimelineFromLegacy,
  type AcpAgentProvider,
  type AgentMessage,
  type AgentToolCall,
  type CommandChunk,
  type FileDiffSummary,
  type SessionSummary,
  type SessionTimelineEntry,
  type WorktreeSummary,
} from "@tiller/shared";
import type { SessionRecord } from "./session-services";
import type { SessionAttachmentStore, StoredSessionRuntimeDescriptor } from "../sessions/facade";
import {
  filterNewProviderHistoryMessages,
  mergeAuthoritativeMessagesWithLocalUserPrompts,
  planProviderHistorySync,
  shouldImportAuthoritativeProviderHistory,
  shouldRepairProviderHistorySnapshot,
  toParagraphMessages,
} from "../sessions/provider-history-sync.js";
import {
  resolveProviderHistorySnapshot,
  type ProviderHistorySnapshot,
  type ProviderHistorySnapshotContent,
} from "./provider-history-source";
import { resolveSessionRestoreCapabilities } from "./resume-info";
import { normalizeWorktreePath } from "./session-worktree-resolution";
import { persistMessageImageAttachments } from "./session-attachment-projection";
import type { TillerLogger } from "../logging/logger";

type SessionMessageStore = {
  list(sessionId: string): AgentMessage[];
  replace(sessionId: string, messages: AgentMessage[]): void;
  append(sessionId: string, message: AgentMessage): void;
};

type SessionArtifactStore = {
  get(sessionId: string): {
    toolCalls: AgentToolCall[];
    outputs: CommandChunk[];
    diffs: FileDiffSummary[];
  };
  replaceToolCalls(sessionId: string, toolCalls: AgentToolCall[]): void;
};

type SessionRuntimeStore = {
  get(sessionId: string): StoredSessionRuntimeDescriptor | null | undefined;
  upsert(descriptor: StoredSessionRuntimeDescriptor): void;
};

type SessionTimelineStore = {
  replace(sessionId: string, entries: SessionTimelineEntry[]): SessionTimelineEntry[];
};

type ProviderHistoryServiceOptions = {
  sessions: Map<string, SessionRecord>;
  sessionStore: { list(): SessionSummary[] };
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionAttachmentStore?: SessionAttachmentStore;
  sessionRuntimeStore: SessionRuntimeStore;
  sessionTimelineStore?: SessionTimelineStore;
  getAgents(): AcpAgentProvider[];
  getWorktrees(): WorktreeSummary[];
  loadAdapterHistoryContent?: (
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    cwd: string,
  ) => Promise<ProviderHistorySnapshotContent | null>;
  logger?: Pick<TillerLogger, "debug" | "error">;
  logInfo(message: string): void;
  logError(message: string): void;
};

export function createProviderHistoryService(options: ProviderHistoryServiceOptions) {
  const providerHistoryRefreshes = new Map<string, number>();
  const providerHistoryRefreshInFlight = new Map<string, Promise<void>>();

  async function importAuthoritativeProviderHistory(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    cwd: string,
  ) {
    try {
      const historySnapshot = await resolveProviderHistorySnapshot([
        {
          source: "adapter-authoritative-history",
          load: () => loadAdapterHistoryContent(agent, runtimeSessionId, cwd),
        },
      ]);
      if (!historySnapshot) {
        return false;
      }
      applyAuthoritativeProviderHistory(sessionId, agent, runtimeSessionId, historySnapshot);
      return true;
    } catch (error) {
      logProviderHistoryError("runtime.provider_history.export_failed", {
        sessionId,
        message: error instanceof Error ? error.message : "Provider history export failed.",
      });
      return false;
    }
  }

  async function loadAdapterHistoryContent(
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    cwd: string,
  ): Promise<ProviderHistorySnapshotContent | null> {
    if (options.loadAdapterHistoryContent) {
      return options.loadAdapterHistoryContent(agent, runtimeSessionId, cwd);
    }
    const history = await loadAdapterAuthoritativeHistory(agent, runtimeSessionId, cwd);
    if (!history) {
      return null;
    }
    return {
      messages: history.messages,
      toolCalls: history.toolCalls,
      outputs: [],
      diffs: [],
    };
  }

  function mergeAuthoritativeToolCalls(
    localToolCalls: AgentToolCall[],
    authoritativeToolCalls: AgentToolCall[],
    options: { preserveLocalThinking: boolean },
  ) {
    if (!authoritativeToolCalls.length) {
      return options.preserveLocalThinking
        ? localToolCalls
        : localToolCalls.filter((toolCall) => toolCall.kind !== "think");
    }

    const authoritativeIds = new Set(authoritativeToolCalls.map((toolCall) => toolCall.id));
    return [
      ...authoritativeToolCalls,
      ...(options.preserveLocalThinking
        ? localToolCalls.filter(
            (toolCall) => toolCall.kind === "think" && !authoritativeIds.has(toolCall.id),
          )
        : []),
    ].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  }

  function hasThinkingToolCalls(toolCalls: AgentToolCall[]) {
    return toolCalls.some((toolCall) => toolCall.kind === "think");
  }

  function areToolCallListsEqual(left: AgentToolCall[], right: AgentToolCall[]) {
    if (left.length !== right.length) {
      return false;
    }
    return left.every((toolCall, index) => toolCallSignature(toolCall) === toolCallSignature(right[index]));
  }

  function toolCallSignature(toolCall: AgentToolCall | undefined) {
    if (!toolCall) {
      return "";
    }
    return [
      toolCall.id,
      toolCall.commandId ?? "",
      toolCall.kind,
      toolCall.title,
      toolCall.status,
      toolCall.input ?? "",
      toolCall.output ?? "",
      toolCall.timestamp,
      toolCall.updatedAt,
      toolCall.timelineSequence ?? "",
    ].join("\u001f");
  }

  function applyAuthoritativeProviderHistory(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    history: ProviderHistorySnapshot,
  ) {
    const descriptor = options.sessionRuntimeStore.get(sessionId);
    const localMessages = options.sessionMessageStore.list(sessionId);
    if (
      !shouldImportAuthoritativeProviderHistory({
        currentState: descriptor?.providerHistory,
        localMessages,
      })
    ) {
      logProviderHistoryDecision({
        sessionId,
        runtimeSessionId,
        action: "skip_local_source",
        providerMessages: history.messages.length,
        localMessages: localMessages.length,
        toolCalls: history.toolCalls.length,
      });
      return;
    }

    if (!history.messages.length) {
      if (history.toolCalls.length) {
        const localToolCalls = options.sessionArtifactStore.get(sessionId).toolCalls;
        const mergedToolCalls = mergeAuthoritativeToolCalls(
          localToolCalls,
          history.toolCalls,
          { preserveLocalThinking: true },
        );
        if (!areToolCallListsEqual(localToolCalls, mergedToolCalls)) {
          options.sessionArtifactStore.replaceToolCalls(sessionId, mergedToolCalls);
          persistLocalProviderHistoryTimeline(sessionId);
        }
      }
      logProviderHistoryDecision({
        sessionId,
        runtimeSessionId,
        action: "skip_empty",
        providerMessages: 0,
        localMessages: 0,
        toolCalls: history.toolCalls.length,
      });
      return;
    }

    if (shouldSkipIncompleteProviderSnapshot(localMessages, history.messages)) {
      logProviderHistoryDecision({
        sessionId,
        runtimeSessionId,
        action: "skip_incomplete_snapshot",
        providerMessages: history.messages.length,
        localMessages: localMessages.length,
        toolCalls: history.toolCalls.length,
      });
      return;
    }

    const syncDecision = planProviderHistorySync({
      currentState: descriptor?.providerHistory,
      providerMessages: history.messages,
      syncedAt: history.syncedAt,
    });

    let localMessageCount = syncDecision.action === "skip" ? 0 : syncDecision.messages.length;
    let logAction: "append" | "repair" | "replace" | "skip" = syncDecision.action;
    if (syncDecision.action === "replace") {
      if (syncDecision.messages.length) {
        options.sessionMessageStore.replace(
          sessionId,
          mergeAuthoritativeMessagesWithLocalUserPrompts(
            localMessages,
            persistProviderHistoryMessageAttachments(sessionId, syncDecision.messages),
          ),
        );
      }
    } else if (syncDecision.action === "append") {
      const appendMessages = filterNewProviderHistoryMessages(
        localMessages,
        syncDecision.messages,
      );
      const storedAppendMessages = persistProviderHistoryMessageAttachments(
        sessionId,
        appendMessages,
      );
      for (const message of storedAppendMessages) {
        options.sessionMessageStore.append(sessionId, message);
      }
      localMessageCount = storedAppendMessages.length;
      const messagesAfterAppend = storedAppendMessages.length
        ? [...localMessages, ...storedAppendMessages]
        : localMessages;
      if (shouldRepairProviderHistorySnapshot(messagesAfterAppend, history.messages)) {
        const repairedMessages = mergeAuthoritativeMessagesWithLocalUserPrompts(
          messagesAfterAppend,
          persistProviderHistoryMessageAttachments(sessionId, toParagraphMessages(history.messages)),
        );
        options.sessionMessageStore.replace(sessionId, repairedMessages);
        localMessageCount = repairedMessages.length;
        logAction = "repair";
      }
    } else if (shouldRepairProviderHistorySnapshot(localMessages, history.messages)) {
      const repairedMessages = mergeAuthoritativeMessagesWithLocalUserPrompts(
        localMessages,
        persistProviderHistoryMessageAttachments(sessionId, toParagraphMessages(history.messages)),
      );
      options.sessionMessageStore.replace(sessionId, repairedMessages);
      localMessageCount = repairedMessages.length;
      logAction = "repair";
    }

    persistProviderHistoryState(sessionId, agent, runtimeSessionId, syncDecision.nextState);
    const localToolCalls = options.sessionArtifactStore.get(sessionId).toolCalls;
    let toolCallsChanged = false;
    if (history.toolCalls.length || hasThinkingToolCalls(localToolCalls)) {
      const mergedToolCalls = mergeAuthoritativeToolCalls(
        localToolCalls,
        history.toolCalls,
        { preserveLocalThinking: false },
      );
      toolCallsChanged = !areToolCallListsEqual(localToolCalls, mergedToolCalls);
      if (toolCallsChanged) {
        options.sessionArtifactStore.replaceToolCalls(sessionId, mergedToolCalls);
      }
    }
    if (logAction !== "skip" || toolCallsChanged) {
      persistLocalProviderHistoryTimeline(sessionId);
    }
    logProviderHistoryDecision({
      sessionId,
      runtimeSessionId,
      action: logAction,
      providerMessages: history.messages.length,
      localMessages: localMessageCount,
      toolCalls: history.toolCalls.length,
    });
  }

  function persistLocalProviderHistoryTimeline(sessionId: string) {
    if (!options.sessionTimelineStore) {
      return;
    }

    const artifacts = options.sessionArtifactStore.get(sessionId);
    const entries = buildSessionTimelineFromLegacy({
      messages: options.sessionMessageStore.list(sessionId),
      outputs: artifacts.outputs,
      toolCalls: artifacts.toolCalls,
    });
    if (entries.length) {
      options.sessionTimelineStore.replace(sessionId, entries);
    }
  }

  function persistProviderHistoryMessageAttachments(
    sessionId: string,
    messages: AgentMessage[],
  ) {
    if (!options.sessionAttachmentStore) {
      return messages;
    }
    return messages.map((message) =>
      persistMessageImageAttachments({
        sessionId,
        message,
        attachments: options.sessionAttachmentStore!,
      }),
    );
  }

  function hasHistoryContent(history: ProviderHistorySnapshotContent) {
    return Boolean(
      history.messages.length || history.toolCalls.length || history.outputs.length || history.diffs.length,
    );
  }

  function shouldSkipIncompleteProviderSnapshot(
    localMessages: AgentMessage[],
    providerMessages: AgentMessage[],
  ) {
    return Boolean(
      localMessages.some((message) => message.role === "user") &&
      !providerMessages.some((message) => message.role === "user") &&
      providerMessages.length < localMessages.length,
    ) || isProviderSnapshotBehindCompletedLocalTurn(localMessages, providerMessages);
  }

  function isProviderSnapshotBehindCompletedLocalTurn(
    localMessages: AgentMessage[],
    providerMessages: AgentMessage[],
  ) {
    const latestLocalUserIndex = findLastIndex(
      localMessages,
      (message) => message.role === "user" && Boolean(message.text.trim()),
    );
    if (latestLocalUserIndex < 0) {
      return false;
    }

    const latestLocalUser = localMessages[latestLocalUserIndex];
    if (!latestLocalUser || !localMessages.slice(latestLocalUserIndex + 1).some(isAssistantTextMessage)) {
      return false;
    }

    const matchingProviderUserIndex = providerMessages.findIndex(
      (message) => message.role === "user" && representsUserPrompt(message, latestLocalUser),
    );
    if (matchingProviderUserIndex >= 0) {
      return !providerMessages.slice(matchingProviderUserIndex + 1).some(isAssistantTextMessage);
    }

    const latestLocalUserTime = Date.parse(latestLocalUser.timestamp);
    if (!Number.isFinite(latestLocalUserTime)) {
      return false;
    }
    return !providerMessages.some((message) => {
      if (!isAssistantTextMessage(message)) {
        return false;
      }
      const providerAssistantTime = Date.parse(message.timestamp);
      return Number.isFinite(providerAssistantTime) && providerAssistantTime > latestLocalUserTime;
    });
  }

  function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (predicate(items[index]!)) {
        return index;
      }
    }
    return -1;
  }

  function isAssistantTextMessage(message: AgentMessage) {
    return message.role === "assistant" && Boolean(message.text.trim());
  }

  function representsUserPrompt(providerMessage: AgentMessage, localMessage: AgentMessage) {
    const providerText = providerMessage.text.trim();
    const localText = localMessage.text.trim();
    return providerMessage.id === localMessage.id ||
      providerText === localText ||
      providerText.includes(localText) ||
      localText.includes(providerText);
  }

  function readLocalProviderHistory(sessionId: string): ProviderHistorySnapshotContent {
    const artifacts = options.sessionArtifactStore.get(sessionId);
    return {
      messages: options.sessionMessageStore.list(sessionId),
      toolCalls: artifacts.toolCalls,
      outputs: artifacts.outputs,
      diffs: artifacts.diffs,
    };
  }

  function persistProviderHistoryState(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    providerHistory: StoredSessionRuntimeDescriptor["providerHistory"],
  ) {
    if (!providerHistory) {
      return;
    }

    const descriptor = options.sessionRuntimeStore.get(sessionId);
    if (descriptor) {
      options.sessionRuntimeStore.upsert({
        ...descriptor,
        providerHistory,
        lastSeenAt: providerHistory.syncedAt,
      });
      return;
    }

    const summary =
      options.sessions.get(sessionId)?.summary ??
      options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      return;
    }

    options.sessionRuntimeStore.upsert({
      sessionId,
      projectId: summary.projectId,
      helmId: summary.helmId,
      providerId: summary.agentId,
      runtimeSessionId,
      capabilities: resolveSessionRestoreCapabilities(agent, null),
      providerHistory,
      lastSeenAt: providerHistory.syncedAt,
      state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
    });
  }

  async function refreshAuthoritativeSessionHistory(sessionId: string) {
    const lastRefresh = providerHistoryRefreshes.get(sessionId);
    if (lastRefresh && Date.now() - lastRefresh < 30_000) {
      return;
    }

    const inFlightRefresh = providerHistoryRefreshInFlight.get(sessionId);
    if (inFlightRefresh) {
      return inFlightRefresh;
    }

    const refresh = refreshAuthoritativeSessionHistoryOnce(sessionId);
    providerHistoryRefreshInFlight.set(sessionId, refresh);
    try {
      await refresh;
    } finally {
      if (providerHistoryRefreshInFlight.get(sessionId) === refresh) {
        providerHistoryRefreshInFlight.delete(sessionId);
      }
    }
  }

  async function refreshAuthoritativeSessionHistoryOnce(sessionId: string) {
    const activeRecord = options.sessions.get(sessionId);
    const summary =
      activeRecord?.summary ?? options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      return;
    }
    const agent = activeRecord?.agent ?? resolveProviderById(summary.agentId, options.getAgents());
    const worktree =
      activeRecord?.worktree ?? options.getWorktrees().find((item) => normalizeWorktreePath(item.path) === normalizeWorktreePath(summary.cwd));
    const runtimeSessionId =
      activeRecord?.runtime.runtimeSessionId ??
      summary.runtimeSessionId ??
      options.sessionRuntimeStore.get(sessionId)?.runtimeSessionId;
    if (!agent || !worktree || !runtimeSessionId) {
      return;
    }

    const refreshed = await importAuthoritativeProviderHistory(
      sessionId,
      agent,
      runtimeSessionId,
      worktree.path,
    );
    if (refreshed) {
      providerHistoryRefreshes.set(sessionId, Date.now());
    }
  }

  function resetRefresh(sessionId: string) {
    providerHistoryRefreshes.delete(sessionId);
    providerHistoryRefreshInFlight.delete(sessionId);
  }

  function logProviderHistoryDecision(fields: {
    sessionId: string;
    runtimeSessionId: string;
    action: string;
    providerMessages: number;
    localMessages: number;
    toolCalls: number;
  }) {
    if (fields.action.startsWith("skip")) {
      return;
    }
    if (options.logger) {
      options.logger.debug("runtime.provider_history.sync_decision", fields);
      return;
    }
    options.logInfo(`[tiller] runtime.provider_history.sync_decision ${formatLogFields(fields)}`);
  }

  function logProviderHistoryError(event: string, fields: Record<string, unknown>) {
    if (options.logger) {
      options.logger.error(event, fields);
      return;
    }
    options.logError(`[tiller] ${event} ${formatLogFields(fields)}`);
  }

  return {
    applyAuthoritativeProviderHistory,
    hasHistoryContent,
    importAuthoritativeProviderHistory,
    loadAdapterHistoryContent,
    readLocalProviderHistory,
    refreshAuthoritativeSessionHistory,
    resetRefresh,
  };
}

function formatLogFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
