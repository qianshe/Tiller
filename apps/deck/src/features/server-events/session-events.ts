import type { MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentPlan,
  AgentPromptContent,
  AgentPromptImageContent,
  AgentToolCall,
  SessionConfigOption,
  SessionSummary,
  SessionTimelineEntry,
} from "@tiller/shared";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
  looksLikeContinuationSummary,
  sortSessionTimelineEntries,
} from "@tiller/shared";
import { shouldProjectArtifactsIntoTimeline } from "../mission/history/model";
import { toast } from "../toast";
import { commandChunkToToolCall, dropActiveThinkingToolCalls, mergeMessageHistory } from "../logbook";
import type { DeckRpcClient, DispatchToHelm } from "../helm-connection/facade";
import { useDeckStore } from "../../store";
import {
  pruneSessionScopedMap,
  resolveActiveSessionId,
} from "../mission/utils/session-derivations";
import {
  availableCommandListsEqual,
  mergeCommandHistory,
  removeSessionRecord,
  stripRedundantAttachmentData,
  upsertSessionSummary,
} from "./helpers";
import type { SessionUpdateParams } from "./session-update-contracts";
import {
  applySessionConfigSelection,
  resolveSessionConfigSelection,
  type SessionConfigSelection,
} from "./session-config-selection";
import { deriveSessionListResult } from "./session-list-result";
import { resolveSessionCleanupToast } from "./session-result-effects";
import {
  pendingInitialPromptMessageId,
  pendingPromptImages,
  replaceInitialMessageHistory,
} from "./session-message-history";



function clearConsumedDraftMetadata(runtimeSessionId: string) {
  const store = useDeckStore.getState();
  store.setAgentModelOptions((current) => {
    let changed = false;
    const next = Object.fromEntries(
      Object.entries(current).map(([key, entry]) => {
        if (entry.runtimeSessionId !== runtimeSessionId || !entry.draftId) {
          return [key, entry];
        }
        changed = true;
        const {
          draftId: _draftId,
          deckClientId: _deckClientId,
          scopeKey: _scopeKey,
          logicalScopeKey: _logicalScopeKey,
          ...rest
        } = entry;
        return [key, rest];
      }),
    );
    return changed ? next : current;
  });
}

function requestAgentConnectionsRefresh(context: SessionServerEventContext) {
  if (context.rpcClientRef.current?.socket?.readyState === 1) {
    void context.dispatch(context.rpcClientRef.current, "agent/connections", {});
  }
}

export type SessionServerEventContext = {
  setSelectedProjectId: (projectId: string | null) => void;
  pendingPromptRef: MutableRefObject<string | null>;
  pendingPromptContentRef: MutableRefObject<AgentPromptContent[] | undefined>;
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  assignSessionTitleFromPrompt: (sessionId: string, prompt: string) => void;
  createClientUserMessageId: (sessionId: string) => string;
  appendUserMessage: (
    sessionId: string,
    text: string,
    id: string,
    attachments: AgentPromptImageContent[],
  ) => void;
  dispatch: DispatchToHelm;
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>;
  mergeSessionToolCalls: (sessionId: string, incoming: AgentToolCall[]) => void;
  shouldAutoStartSessionResume: (
    session: Pick<SessionSummary, "resume"> | undefined,
  ) => boolean;
  requestSessionResumeStart: (sessionId: string, reason: string) => void;
  setResumeFeedback: (value: string) => void;
  resumeStartRequestsRef: MutableRefObject<Set<string>>;
};

function applySessionCreated(payload: { session: SessionSummary }, context: SessionServerEventContext) {
  const {
    setSelectedProjectId,
    pendingPromptRef,
    pendingPromptContentRef,
    rpcClientRef,
    assignSessionTitleFromPrompt,
    appendUserMessage,
    dispatch,
  } = context;
  const store = useDeckStore.getState();

  store.setSessions((current) => upsertSessionSummary(current, payload.session));
  if ((payload.session.configOptions?.length ?? 0) > 0) {
    store.setSessionConfigOptions((current) => ({
      ...current,
      [payload.session.id]: applySessionConfigSelection(
        payload.session.configOptions ?? [],
        payload.session,
      ),
    }));
  }
  if ((payload.session.availableCommands?.length ?? 0) > 0) {
    store.setSessionAvailableCommands((current) => ({
      ...current,
      [payload.session.id]: payload.session.availableCommands ?? [],
    }));
    store.setAgentAvailableCommands((current) => ({
      ...current,
      [payload.session.agentId]: payload.session.availableCommands ?? [],
    }));
  }
  store.setStatuses((current) => ({
    ...current,
    [payload.session.id]: payload.session.status,
  }));
  setSelectedProjectId(payload.session.projectId);
  if (!payload.session.runtimeSessionId) {
    return true;
  }
  store.setActiveSessionId(payload.session.id);
  clearConsumedDraftMetadata(payload.session.runtimeSessionId);
  if (pendingPromptRef.current && rpcClientRef.current) {
    const pendingPrompt = pendingPromptRef.current;
    const pendingContent = pendingPromptContentRef.current;
    const pendingImages = pendingPromptImages(pendingContent);
    pendingPromptRef.current = null;
    pendingPromptContentRef.current = undefined;
    assignSessionTitleFromPrompt(payload.session.id, pendingPrompt);
    const clientMessageId = pendingInitialPromptMessageId(payload.session.id);
    appendUserMessage(
      payload.session.id,
      pendingPrompt,
      clientMessageId,
      pendingImages,
    );
    void dispatch(rpcClientRef.current, "session/prompt", {
      sessionId: payload.session.id,
      text: pendingPrompt,
      content: pendingContent,
      clientMessageId,
    });
  }
  requestAgentConnectionsRefresh(context);
  return true;
}

export function applySessionResult(
  method: string,
  result: unknown,
  sourceHelmKey: string,
  sourceIsCurrentHelm: boolean,
  context: SessionServerEventContext,
) {
  const payload = result as Record<string, any>;
  const {
    toolCallsRef,
    mergeSessionToolCalls,
    shouldAutoStartSessionResume,
    requestSessionResumeStart,
    setResumeFeedback,
    resumeStartRequestsRef,
    rpcClientRef,
    dispatch,
  } = context;
  const store = useDeckStore.getState();
  const currentSessions = store.sessions;

  switch (method) {
    case "session/new":
      return applySessionCreated(payload as { session: SessionSummary }, context);
    case "session/prompt":
      if (payload.session) {
        return applySessionCreated(payload as { session: SessionSummary }, context);
      }
      return true;
    case "session/list": {
      const listResult = deriveSessionListResult({
        currentSessions,
        payload: {
          sessions: payload.sessions,
          before: payload.before,
          nextCursor: payload.nextCursor,
          hasMore: payload.hasMore,
        },
      });
      const { nextSessions, nextStatuses } = listResult;
      store.applyHelmInventory(sourceHelmKey, {
        sessions: nextSessions,
        statuses: nextStatuses,
      });
      if (sourceIsCurrentHelm) {
        store.setSessions(nextSessions);
        store.setSessionHistoryState(listResult.historyState);
        store.setStatuses(nextStatuses);
        store.setMessages((current) => pruneSessionScopedMap(current, nextSessions));
        store.setSessionTimeline((current) => pruneSessionScopedMap(current, nextSessions));
        store.setTranscriptStatusBySession((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setMessageHistoryState((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setPromptQueues((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setOutputs((current) => pruneSessionScopedMap(current, nextSessions));
        store.setToolCalls((current) => {
          const next = pruneSessionScopedMap(current, nextSessions);
          toolCallsRef.current = next;
          return next;
        });
        store.setSessionPlans((current) => pruneSessionScopedMap(current, nextSessions));
        store.setActivityHistoryState((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setDiffs((current) => pruneSessionScopedMap(current, nextSessions));
        store.setSessionConfigOptions((current) => ({
          ...pruneSessionScopedMap(current, nextSessions),
          ...listResult.configOptionsBySession,
        }));
        store.setSessionAvailableCommands((current) => ({
          ...pruneSessionScopedMap(current, nextSessions),
          ...listResult.availableCommands.bySession,
        }));
        store.setAgentAvailableCommands((current) => ({
          ...current,
          ...listResult.availableCommands.byAgent,
        }));
        store.setActiveSessionId((current: string | null) =>
          resolveActiveSessionId(current, nextSessions),
        );
      }
      return true;
    }
    case "session/configure": {
      if (!payload.sessionId) {
        return false;
      }
      const payloadOptions = Array.isArray(payload.options)
        ? payload.options as SessionConfigOption[]
        : undefined;
      const payloadState = payload.state && typeof payload.state === "object"
        ? payload.state as Partial<SessionConfigSelection>
        : undefined;
      if (payloadOptions) {
        const session = store.sessions.find((item) => item.id === payload.sessionId);
        const selection = resolveSessionConfigSelection(session, payloadState, payloadOptions);
        store.setSessionConfigOptions((current) => ({
          ...current,
          [payload.sessionId]: applySessionConfigSelection(payloadOptions, selection),
        }));
      }
      if (payloadState) {
        store.setSessions((current) =>
          current.map((session) => {
            if (session.id !== payload.sessionId) {
              return session;
            }
            const selection = resolveSessionConfigSelection(session, payloadState, payloadOptions);
            return {
              ...session,
              model: selection.model,
              agentMode: selection.agentMode,
              reasoningEffort: selection.reasoningEffort,
              configOptions: payloadOptions ?? session.configOptions,
              updatedAt: new Date().toISOString(),
            };
          }),
        );
      }
      return true;
    }
    case "session/list_messages": {
      const isTimelineOnlyPage = Boolean(payload.timelineBefore && !payload.before);
      if (!isTimelineOnlyPage) {
        const incomingMessages = payload.messages.map(stripRedundantAttachmentData);
        store.setMessages((current) => ({
          ...current,
          [payload.sessionId]: payload.before
            ? mergeMessageHistory(current[payload.sessionId] ?? [], incomingMessages, {
                mode: "prepend",
              })
            : replaceInitialMessageHistory(current[payload.sessionId] ?? [], incomingMessages),
        }));
      }
      if (Array.isArray(payload.timeline)) {
        const shouldReplaceTimeline = !payload.before && !payload.timelineBefore;
        const shouldForceIncomingTimeline = shouldReplaceTimeline &&
          payload.messages.some((message: AgentMessage) => looksLikeContinuationSummary(message.text));
        store.setSessionTimeline((current) => {
          const currentEntries = current[payload.sessionId] ?? [];
          const incomingEntries = payload.timeline as SessionTimelineEntry[];
          const nextEntries = shouldReplaceTimeline
            ? replaceInitialTimelineHistory(
                currentEntries,
                incomingEntries,
                { forceIncoming: shouldForceIncomingTimeline },
              )
            : mergeTimelineEntries(
                incomingEntries,
                currentEntries,
              );
          debugTimelineTransition(
            payload.sessionId,
            shouldReplaceTimeline ? "session/list_messages:replace" : "session/list_messages:merge",
            currentEntries,
            incomingEntries,
            nextEntries,
            {
              before: payload.before,
              timelineBefore: payload.timelineBefore,
              keptCurrent: nextEntries === currentEntries,
            },
          );
          if (nextEntries === currentEntries) {
            return current;
          }
          return {
            ...current,
            [payload.sessionId]: nextEntries,
          };
        });
      }
      if (!isTimelineOnlyPage) {
        store.setTranscriptStatusBySession((current) => ({
          ...current,
          [payload.sessionId]: payload.transcriptStatus,
        }));
      }
      store.setMessageHistoryState((current) => ({
        ...current,
        [payload.sessionId]: {
          nextCursor: isTimelineOnlyPage
            ? current[payload.sessionId]?.nextCursor
            : payload.nextCursor,
          hasMore: isTimelineOnlyPage
            ? Boolean(current[payload.sessionId]?.hasMore)
            : Boolean(payload.hasMore),
          timelineNextCursor: payload.timelineNextCursor,
          timelineHasMore: Boolean(payload.timelineHasMore),
          loading: false,
        },
      }));
      return true;
    }
    case "session/get_artifacts": {
      const outputToolCalls = payload.outputs.map(commandChunkToToolCall);
      const artifactToolCalls = [
        ...(payload.toolCalls ?? []),
        ...outputToolCalls,
      ];
      store.setOutputs((current) => ({
        ...current,
        [payload.sessionId]: mergeCommandHistory(
          current[payload.sessionId] ?? [],
          payload.outputs,
        ),
      }));
      pruneActiveThinkingToolCalls(payload.sessionId, toolCallsRef, store);
      mergeSessionToolCalls(payload.sessionId, [
        ...outputToolCalls,
        ...(payload.toolCalls ?? []),
      ]);
      {
        const messageState = store.messageHistoryState[payload.sessionId];
        const canProject = shouldProjectArtifactsIntoTimeline({
          messageHistoryLoading: Boolean(messageState?.loading),
          messageHasMore: Boolean(messageState?.hasMore),
          timelineHasMore: Boolean(messageState?.timelineHasMore),
          isLiveUpdate: false,
        });
        if (canProject && artifactToolCalls.length > 0) {
          appendToolCallsToSessionTimeline(store, payload.sessionId, artifactToolCalls);
        }
      }
      applySessionPlanPayload(store, payload.sessionId, payload.plan);
      store.setDiffs((current) => ({
        ...current,
        [payload.sessionId]: payload.diffs,
      }));
      store.setActivityHistoryState((current) => ({
        ...current,
        [payload.sessionId]: {
          nextCursor: payload.nextCursor,
          hasMore: Boolean(payload.hasMore),
          loading: false,
        },
      }));
      return true;
    }
    case "session/check_resume":
      store.setSessions((current) =>
        current.map((session) =>
          session.id === payload.sessionId
            ? {
                ...session,
                resume: payload.resume,
                runtimeSessionId:
                  payload.resume.runtimeSessionId ?? session.runtimeSessionId,
              }
            : session,
        ),
      );
      if (shouldAutoStartSessionResume({ resume: payload.resume })) {
        requestSessionResumeStart(
          payload.sessionId,
          "检测到历史任务可恢复，正在自动重连 ACP 会话...",
        );
      }
      return true;
    case "approval/list_pending":
      if (sourceIsCurrentHelm) {
        store.replacePendingApprovals(
          (payload.approvals ?? []).map((approval: any) => ({
            sessionId: approval.sessionId,
            request: approval.request,
          })),
        );
      }
      return true;
    case "session/resume": {
      setResumeFeedback(payload.message);
      resumeStartRequestsRef.current.delete(payload.sessionId);
      const resume = payload.ok
        ? payload.resume
        : {
            ...payload.resume,
            state: "resume-unavailable",
            reason: payload.message,
          };
      store.setSessions((current) =>
        current.map((session) =>
          session.id === payload.sessionId
            ? {
                ...session,
                resume,
                runtimeSessionId:
                  resume.runtimeSessionId ?? session.runtimeSessionId,
              }
            : session,
        ),
      );
      if (sourceIsCurrentHelm && payload.ok && rpcClientRef.current?.socket?.readyState === 1) {
        void dispatch(rpcClientRef.current, "agent/connections", {});
      }
      return true;
    }
    case "session/cleanup": {
      const cleanupToast = resolveSessionCleanupToast(payload.result);
      if (cleanupToast.tone === "success") {
        toast.success(cleanupToast.message);
      } else if (cleanupToast.tone === "warning") {
        toast.warning(cleanupToast.message);
      } else {
        toast.info(cleanupToast.message);
      }
      setResumeFeedback("");
      store.setSessions((current) =>
        current.filter((session) => session.id !== payload.result.sessionId),
      );
      store.setStatuses((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setMessages((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setSessionTimeline((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setTranscriptStatusBySession((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.dropSessionApprovals(payload.result.sessionId);
      store.setOutputs((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setToolCalls((current) => {
        const next = removeSessionRecord(current, payload.result.sessionId);
        toolCallsRef.current = next;
        return next;
      });
      store.setDiffs((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setSessionConfigOptions((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setActiveSessionId((current: string | null) =>
        current === payload.result.sessionId ? null : current,
      );
      return true;
    }
    case "permission/respond":
    case "approval/respond":
    case "approval/list_pending":
    case "session/prompt":
    case "session/set_config_option":
      return true;
    default:
      return false;
  }
}

type DeckStore = ReturnType<typeof useDeckStore.getState>;

function appendToolCallsToSessionTimeline(
  store: DeckStore,
  sessionId: string,
  toolCalls: AgentToolCall[],
) {
  if (!toolCalls.length) {
    return;
  }
  store.setSessionTimeline((current) => {
    const currentEntries = current[sessionId] ?? [];
    const entries = [...currentEntries];
    for (const toolCall of toolCalls) {
      appendToolCallToSessionTimeline(entries, toolCall);
    }
    const nextEntries = sortSessionTimelineEntries(entries);
    debugTimelineTransition(
      sessionId,
      "session/get_artifacts:tool-projection",
      currentEntries,
      toolCalls.map((toolCall) => ({
        id: `tool:${toolCall.id}`,
        kind: "tool_call" as const,
        toolCall,
        timestamp: toolCall.timestamp,
        updatedAt: toolCall.updatedAt,
        timelineSequence: toolCall.timelineSequence,
      })),
      nextEntries,
      { toolCallCount: toolCalls.length },
    );
    if (sessionTimelineEntriesEqual(currentEntries, nextEntries)) {
      return current;
    }
    return {
      ...current,
      [sessionId]: nextEntries,
    };
  });
}

function sessionTimelineEntriesEqual(
  left: SessionTimelineEntry[],
  right: SessionTimelineEntry[],
) {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) =>
    stableJsonValue(entry) === stableJsonValue(right[index])
  );
}

function stableJsonValue(value: unknown): string {
  return JSON.stringify(normalizeJsonValue(value));
}

function normalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, normalizeJsonValue(entryValue)]),
  );
}

function applySessionPlanPayload(
  store: DeckStore,
  sessionId: string,
  plan: unknown,
) {
  if (!isAgentPlanPayload(plan)) {
    return;
  }
  store.setSessionPlans((current) => ({
    ...current,
    [sessionId]: plan,
  }));
}

function isAgentPlanPayload(value: unknown): value is AgentPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<AgentPlan>;
  return typeof record.updatedAt === "string" &&
    Array.isArray(record.entries) &&
    record.entries.every((entry) =>
      Boolean(entry) &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        typeof (entry as { content?: unknown }).content === "string" &&
        ((entry as { priority?: unknown }).priority === "high" ||
          (entry as { priority?: unknown }).priority === "medium" ||
          (entry as { priority?: unknown }).priority === "low") &&
        ((entry as { status?: unknown }).status === "pending" ||
          (entry as { status?: unknown }).status === "in_progress" ||
          (entry as { status?: unknown }).status === "completed"),
    );
}

function mergeTimelineEntries(
  incoming: SessionTimelineEntry[],
  current: SessionTimelineEntry[],
) {
  const seenIds = new Set(incoming.map((entry) => entry.id));
  return [
    ...incoming,
    ...current.filter((entry) => !seenIds.has(entry.id)),
  ];
}

function replaceInitialTimelineHistory(
  current: SessionTimelineEntry[],
  incoming: SessionTimelineEntry[],
  options: {
    forceIncoming?: boolean;
  } = {},
) {
  if (!options.forceIncoming && shouldKeepRicherCurrentTimeline(current, incoming)) {
    return current;
  }
  const currentToolEntriesById = new Map(
    current
      .filter((entry): entry is Extract<SessionTimelineEntry, { kind: "tool_call" }> =>
        entry.kind === "tool_call"
      )
      .map((entry) => [entry.id, entry] as const),
  );
  const enrichedIncoming = incoming.map((entry) =>
    entry.kind === "tool_call"
      ? mergeIncomingToolTimelineEntry(entry, currentToolEntriesById.get(entry.id))
      : entry
  );
  const incomingIds = new Set(enrichedIncoming.map((entry) => entry.id));
  const retainedToolEntries = current.filter((entry) =>
    !incomingIds.has(entry.id) && entry.kind === "tool_call"
  );
  const activeLocalEntries = current.filter((entry) =>
    !incomingIds.has(entry.id) &&
    entry.kind !== "tool_call" &&
    isActiveTimelineEntry(entry)
  );
  const mergedHistory = retainedToolEntries.length
    ? sortSessionTimelineEntries([...enrichedIncoming, ...retainedToolEntries])
    : [...enrichedIncoming];
  return activeLocalEntries.length ? [...mergedHistory, ...activeLocalEntries] : mergedHistory;
}

function shouldKeepRicherCurrentTimeline(
  current: SessionTimelineEntry[],
  incoming: SessionTimelineEntry[],
) {
  if (!incoming.length || current.length <= incoming.length) {
    return false;
  }
  return sameStringMultiset(
    collectTimelineMessageKeys(current),
    collectTimelineMessageKeys(incoming),
  ) &&
    sameStringMultiset(
      collectTimelineToolIdentityKeys(current),
      collectTimelineToolIdentityKeys(incoming),
    ) &&
    (
      sameStringMultiset(
        collectTimelineAssistantChunkKeys(current),
        collectTimelineAssistantChunkKeys(incoming),
      ) ||
      hasSameAssistantContentTranscript(current, incoming)
    );
}

function collectTimelineMessageKeys(entries: SessionTimelineEntry[]) {
  return entries.flatMap((entry) =>
    entry.kind === "user_message" || entry.kind === "system_message"
      ? [`${entry.kind}:${entry.message.id}:${entry.message.timelineSequence ?? ""}:${entry.message.text}`]
      : []
  );
}

function collectTimelineToolIdentityKeys(entries: SessionTimelineEntry[]) {
  return entries.flatMap((entry) =>
    entry.kind === "tool_call"
      ? [entry.toolCall.id]
      : []
  );
}

function collectTimelineAssistantChunkKeys(entries: SessionTimelineEntry[]) {
  return entries.flatMap((entry) => {
    if (entry.kind !== "assistant_message") {
      return [];
    }
    return entry.chunks.map((chunk) => {
      if (chunk.kind === "content") {
        return `content:${chunk.id}:${chunk.timelineSequence ?? ""}:${chunk.text}`;
      }
      return `thinking:${chunk.id}:${chunk.timelineSequence ?? ""}:${chunk.status}:${chunk.text}`;
    });
  });
}

function sameStringMultiset(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const item of left) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  for (const item of right) {
    const count = counts.get(item);
    if (!count) {
      return false;
    }
    if (count === 1) {
      counts.delete(item);
    } else {
      counts.set(item, count - 1);
    }
  }
  return counts.size === 0;
}

function hasSameAssistantContentTranscript(
  current: SessionTimelineEntry[],
  incoming: SessionTimelineEntry[],
) {
  const currentText = collectAssistantContentTranscript(current);
  if (!currentText) {
    return false;
  }
  return currentText === collectAssistantContentTranscript(incoming);
}

function collectAssistantContentTranscript(entries: SessionTimelineEntry[]) {
  return entries
    .flatMap((entry) =>
      entry.kind === "assistant_message"
        ? entry.chunks.flatMap((chunk) => chunk.kind === "content" ? [chunk.text] : [])
        : []
    )
    .join("");
}

const TIMELINE_DEBUG_STORAGE_KEY = "tillerTimelineDebug";

function debugTimelineTransition(
  sessionId: string,
  source: string,
  current: SessionTimelineEntry[],
  incoming: SessionTimelineEntry[],
  next: SessionTimelineEntry[],
  extra: Record<string, unknown> = {},
) {
  if (!shouldDebugTimeline(sessionId)) {
    return;
  }
  globalThis.console.debug("[tiller:timeline]", {
    sessionId,
    source,
    ...extra,
    current: summarizeTimelineForDebug(current),
    incoming: summarizeTimelineForDebug(incoming),
    next: summarizeTimelineForDebug(next),
  });
}

function shouldDebugTimeline(sessionId: string) {
  if (typeof globalThis.localStorage === "undefined") {
    return false;
  }
  const value = globalThis.localStorage.getItem(TIMELINE_DEBUG_STORAGE_KEY);
  if (!value) {
    return false;
  }
  return value === "*" || value.split(/[,\s]+/u).includes(sessionId);
}

function summarizeTimelineForDebug(entries: SessionTimelineEntry[]) {
  return {
    length: entries.length,
    kinds: entries.map((entry) => entry.kind),
    assistantContentChunks: entries.reduce((count, entry) =>
      entry.kind === "assistant_message"
        ? count + entry.chunks.filter((chunk) => chunk.kind === "content").length
        : count,
    0),
    toolIds: entries.flatMap((entry) => entry.kind === "tool_call" ? [entry.toolCall.id] : []),
    contentLength: collectAssistantContentTranscript(entries).length,
    tail: entries.slice(-8).map((entry) => summarizeTimelineEntryForDebug(entry)),
  };
}

function summarizeTimelineEntryForDebug(entry: SessionTimelineEntry) {
  if (entry.kind === "tool_call") {
    return {
      id: entry.id,
      kind: entry.kind,
      seq: entry.timelineSequence ?? entry.toolCall.timelineSequence,
      title: entry.toolCall.title,
      toolKind: entry.toolCall.kind,
    };
  }
  if (entry.kind === "assistant_message") {
    return {
      id: entry.id,
      kind: entry.kind,
      seq: entry.timelineSequence,
      chunks: entry.chunks.map((chunk) => ({
        id: chunk.id,
        kind: chunk.kind,
        seq: chunk.timelineSequence,
        textLength: chunk.text.length,
        textStart: chunk.text.slice(0, 32),
      })),
    };
  }
  if (entry.kind === "context_compaction" || entry.kind === "session_resumed" || entry.kind === "history_gap") {
    return {
      id: entry.id,
      kind: entry.kind,
      seq: undefined,
      textStart: "",
    };
  }
  return {
    id: entry.id,
    kind: entry.kind,
    seq: entry.timelineSequence ?? entry.message.timelineSequence,
    textStart: entry.message.text.slice(0, 32),
  };
}

function mergeIncomingToolTimelineEntry(
  incoming: Extract<SessionTimelineEntry, { kind: "tool_call" }>,
  current: Extract<SessionTimelineEntry, { kind: "tool_call" }> | undefined,
) {
  if (!current) {
    return incoming;
  }
  const incomingTool = incoming.toolCall;
  const currentTool = current.toolCall;
  return {
    ...incoming,
    toolCall: {
      ...currentTool,
      ...incomingTool,
      commandId: incomingTool.commandId ?? currentTool.commandId,
      input: incomingTool.input ?? currentTool.input,
      kind: strongerToolKind(incomingTool.kind, currentTool.kind),
      output: incomingTool.output ?? currentTool.output,
      status: mergedToolStatus(incomingTool, currentTool),
      title: strongerToolTitle(incomingTool, currentTool),
    },
  };
}

function strongerToolKind(
  incoming: AgentToolCall["kind"],
  current: AgentToolCall["kind"],
) {
  return toolKindRank(current) > toolKindRank(incoming) ? current : incoming;
}

function toolKindRank(kind: AgentToolCall["kind"]) {
  const ranks: Record<AgentToolCall["kind"], number> = {
    unknown: 0,
    tool: 1,
    think: 2,
    todo: 2,
    fetch: 2,
    search: 3,
    read: 3,
    write: 3,
    shell: 3,
    skill: 3,
    subagent: 3,
    mcp: 4,
  };
  return ranks[kind];
}

function mergedToolStatus(
  incoming: AgentToolCall,
  current: AgentToolCall,
) {
  if (shouldKeepTerminalToolStatus(current, incoming)) {
    return current.status;
  }
  return incoming.status;
}

function shouldKeepTerminalToolStatus(current: AgentToolCall, incoming: AgentToolCall) {
  if ((current.status !== "completed" && current.status !== "failed") || incoming.status !== "running") {
    return false;
  }
  if (toolKindRank(incoming.kind) > toolKindRank(current.kind)) {
    return false;
  }
  if (!isWeakToolTitle(incoming.title, incoming) && incoming.title !== current.title) {
    return false;
  }
  if (incoming.input && incoming.input !== current.input) {
    return false;
  }
  if (incoming.commandId && incoming.commandId !== current.commandId) {
    return false;
  }
  return true;
}

function strongerToolTitle(
  incoming: AgentToolCall,
  current: AgentToolCall,
) {
  if (isWeakToolTitle(incoming.title, incoming) && !isWeakToolTitle(current.title, current)) {
    return current.title;
  }
  return incoming.title || current.title;
}

function isWeakToolTitle(title: string, toolCall: AgentToolCall) {
  const normalizedTitle = title.trim().toLowerCase();
  return !normalizedTitle ||
    normalizedTitle === "tool" ||
    normalizedTitle === toolCall.id.toLowerCase() ||
    normalizedTitle === toolCall.commandId?.toLowerCase() ||
    normalizedTitle.startsWith("tool call ");
}

function isActiveTimelineEntry(entry: SessionTimelineEntry) {
  if (entry.kind === "assistant_message") {
    return entry.streaming ||
      entry.chunks.some((chunk) =>
        (chunk.kind === "content" && chunk.streaming) ||
        (chunk.kind === "thinking" && chunk.status === "running")
      );
  }
  if (entry.kind === "tool_call") {
    return entry.toolCall.status === "running";
  }
  if (entry.kind === "context_compaction" || entry.kind === "session_resumed" || entry.kind === "history_gap") {
    return false;
  }
  return Boolean(entry.message.streaming);
}

function appendTimelineMessage(
  store: DeckStore,
  sessionId: string,
  message: AgentMessage,
) {
  store.setSessionTimeline((current) => {
    const entries = [...(current[sessionId] ?? [])];
    appendMessageToSessionTimeline(entries, message);
    return {
      ...current,
      [sessionId]: sortSessionTimelineEntries(entries),
    };
  });
}

function pruneActiveThinkingToolCalls(
  sessionId: string,
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>,
  store: DeckStore,
) {
  const currentSessionToolCalls = toolCallsRef.current[sessionId] ?? [];
  const nextSessionToolCalls = dropActiveThinkingToolCalls(currentSessionToolCalls);
  if (nextSessionToolCalls.length === currentSessionToolCalls.length) {
    return;
  }

  store.setToolCalls((current) => {
    const next = {
      ...current,
      [sessionId]: nextSessionToolCalls,
    };
    toolCallsRef.current = next;
    return next;
  });
}

export function applySessionUpdate(
  params: SessionUpdateParams,
  context: SessionServerEventContext,
) {
  const { sessionId, update } = params;
  const store = useDeckStore.getState();

  switch (update.kind) {
    case "session_updated":
      store.setSessions((current) =>
        upsertSessionSummary(current, update.session),
      );
      if ((update.session.configOptions?.length ?? 0) > 0) {
        store.setSessionConfigOptions((current) => ({
          ...current,
          [update.session.id]: applySessionConfigSelection(
            update.session.configOptions ?? [],
            update.session,
          ),
        }));
      }
      if ((update.session.availableCommands?.length ?? 0) > 0) {
        store.setSessionAvailableCommands((current) => ({
          ...current,
          [update.session.id]: update.session.availableCommands ?? [],
        }));
        store.setAgentAvailableCommands((current) => ({
          ...current,
          [update.session.agentId]: update.session.availableCommands ?? [],
        }));
      }
      if (!update.session.runtimeSessionId && context.pendingPromptRef.current) {
        store.setActiveSessionId(update.session.id);
        context.assignSessionTitleFromPrompt(update.session.id, context.pendingPromptRef.current);
        context.appendUserMessage(
          update.session.id,
          context.pendingPromptRef.current,
          pendingInitialPromptMessageId(update.session.id),
          pendingPromptImages(context.pendingPromptContentRef.current),
        );
      }
      if (update.session.runtimeSessionId) {
        requestAgentConnectionsRefresh(context);
      }
      return true;
    case "config_options": {
      const session = store.sessions.find((item) => item.id === sessionId);
      const selection = resolveSessionConfigSelection(session, update.state, update.options);
      store.setSessionConfigOptions((current) => ({
        ...current,
        [sessionId]: applySessionConfigSelection(update.options, selection),
      }));
      store.setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                model: selection.model,
                agentMode: selection.agentMode,
                reasoningEffort: selection.reasoningEffort,
                configOptions: update.options,
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      );
      return true;
    }
    case "commands_available":
      store.setSessionAvailableCommands((current) => {
        if (availableCommandListsEqual(current[sessionId], update.commands)) {
          return current;
        }
        return { ...current, [sessionId]: update.commands };
      });
      {
        const agentId = store.sessions.find((session) => session.id === sessionId)?.agentId;
        if (agentId) {
          store.setAgentAvailableCommands((current) => {
            if (availableCommandListsEqual(current[agentId], update.commands)) {
              return current;
            }
            return { ...current, [agentId]: update.commands };
          });
        }
      }
      return true;
    case "model_options":
      store.setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                model: update.currentModelId ?? session.model,
                modelOptions: update.options,
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      );
      return true;
    case "restore_replay_cached":
      return true;
    case "prompt_queue":
      store.setPromptQueue(sessionId, update.queue);
      return true;
    case "user_message":
      store.setMessages((current) => ({
        ...current,
        [sessionId]: mergeMessageHistory(
          current[sessionId] ?? [],
          [update.message],
          { mode: "append" },
        ),
      }));
      appendTimelineMessage(store, sessionId, update.message);
      return true;
    case "status_change":
      requestAgentConnectionsRefresh(context);
      store.setStatuses((current) => ({
        ...current,
        [sessionId]: update.status,
      }));
      store.setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                status: update.status,
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      );
      return true;
    default:
      return false;
  }
}
