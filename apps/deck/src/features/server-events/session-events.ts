import type { MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentPromptContent,
  AgentPromptImageContent,
  AgentToolCall,
  SessionConfigOption,
  SessionLiveStateSnapshot,
  LegacyEvidenceAvailability,
  LegacyEvidencePage,
  SessionSummary,
  SessionTimelineBatch,
  SessionTimelineEntry,
} from "@tiller/shared";
import { toast } from "../toast";
import { dropActiveThinkingToolCalls } from "../logbook";
import type { DeckRpcClient, DispatchToHelm } from "../helm-connection/facade";
import {
  useDeckStore,
  withDeckStorePersistenceSuppressed,
} from "../../store/facade";
import {
  pruneSessionScopedMap,
  resolveActiveSessionId,
} from "../mission/utils/session-derivations";
import {
  mergeCommandHistory,
  removeSessionRecord,
  upsertSessionSummary,
} from "./helpers";
import {
  isCanonicalConversationUpdateKind,
  type SessionUpdateParams,
} from "./session-update-contracts";
import {
  applySessionConfigSelection,
  resolveSessionConfigSelection,
  type SessionConfigSelection,
} from "./session-config-selection";
import { projectSessionLiveStateSnapshot } from "./session-live-state-projection";
import {
  deriveSessionListResult,
  mergeSessionLifecycleSummary,
} from "./session-list-result";
import { resolveSessionCleanupToast } from "./session-result-effects";
import {
  pendingInitialPromptMessageId,
  pendingPromptImages,
} from "./session-message-history";
import {
  applySessionTimelineBatch,
  createSessionTimelineIndexCache,
  createEmptyAppliedTimelineState,
  type SessionTimelineIndexCache,
} from "./session-timeline-batches";

const CANONICAL_TIMELINE_RELOAD_LIMIT = 20;
const timelineIndexCacheBySession = new Map<string, SessionTimelineIndexCache>();

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
  if (context.rpcClientRef?.current?.socket?.readyState === 1) {
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
  setResumeStartRequestIds?: (update: (current: Set<string>) => Set<string>) => void;
};

function clearResumeStartRequest(
  sessionId: string,
  context: Pick<
    SessionServerEventContext,
    "resumeStartRequestsRef" | "setResumeStartRequestIds"
  >,
) {
  context.resumeStartRequestsRef.current.delete(sessionId);
  context.setResumeStartRequestIds?.((current) => {
    if (!current.has(sessionId)) return current;
    const next = new Set(current);
    next.delete(sessionId);
    return next;
  });
}

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
  const previousSession = store.sessions.find((session) => session.id === payload.session.id);

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
  if (previousSession?.runtimeSessionId !== payload.session.runtimeSessionId) {
    requestAgentConnectionsRefresh(context);
  }
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
        liveStatesBySession: store.sessionLiveStates,
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
        for (const session of nextSessions) {
          if (
            session.resume?.state === "resume-available" &&
            (session.resume.mode === "same-process" ||
              session.resume.restoreMethod === "client-reconnect")
          ) {
            clearResumeStartRequest(session.id, context);
          }
        }
        pruneTimelineIndexCaches(nextSessions);
        store.setSessions(nextSessions);
        store.setSessionHistoryState(listResult.historyState);
        store.setStatuses(nextStatuses);
        store.setMessages((current) => pruneSessionScopedMap(current, nextSessions));
        store.setSessionTimeline((current) => pruneSessionScopedMap(current, nextSessions));
        store.setSessionTimelineDeliveryState((current) =>
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
        store.setHistoricalDiffIncompleteBySession((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setSessionLiveStates((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setSessionLiveStateSequences((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
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
    case "session/list_timeline": {
      applySessionTimelineHistoryResult(store, {
        sessionId: payload.sessionId,
        before: payload.before,
        entries: payload.entries,
        nextCursor: payload.nextCursor,
        hasMore: Boolean(payload.hasMore),
        liveState: payload.liveState,
        legacyEvidence: payload.legacyEvidence,
      }, toolCallsRef);
      return true;
    }
    case "session/list_legacy_evidence": {
      const page = payload as LegacyEvidencePage;
      store.setSessionLegacyEvidence((current) => {
        const existing = current[page.sessionId];
        return {
          ...current,
          [page.sessionId]: {
            availability: existing?.availability,
            pages: { ...existing?.pages, [page.source]: page },
            loading: { ...existing?.loading, [page.source]: false },
          },
        };
      });
      return true;
    }
    case "session/get_artifacts": {
      store.setOutputs((current) => ({
        ...current,
        [payload.sessionId]: mergeCommandHistory(
          current[payload.sessionId] ?? [],
          payload.outputs,
        ),
      }));
      pruneActiveThinkingToolCalls(payload.sessionId, toolCallsRef, store);
      mergeSessionToolCalls(payload.sessionId, payload.toolCalls ?? []);
      store.setDiffs((current) => ({
        ...current,
        [payload.sessionId]: payload.diffs,
      }));
      store.setHistoricalDiffIncompleteBySession((current) => ({
        ...current,
        [payload.sessionId]: Boolean(payload.historicalDiffIncomplete),
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
      clearResumeStartRequest(payload.sessionId, context);
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
        if (shouldReloadCanonicalTimelineAfterResume(store, payload.sessionId, resume)) {
          requestCanonicalTimelineReload(payload.sessionId, context);
        }
      }
      return true;
    }
    case "session/cleanup": {
      timelineIndexCacheBySession.delete(payload.result.sessionId);
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
      store.setSessionLegacyEvidence((current) =>
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
      store.setHistoricalDiffIncompleteBySession((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setSessionLiveStates((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setSessionLiveStateSequences((current) =>
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

function applySessionLiveStateSnapshot(
  store: DeckStore,
  sessionId: string,
  snapshot: SessionLiveStateSnapshot | undefined,
  toolCallsRef?: MutableRefObject<Record<string, AgentToolCall[]>>,
) {
  const projection = projectSessionLiveStateSnapshot(store, sessionId, snapshot);
  if (!projection.applied) {
    return false;
  }
  const toolCalls = removeIdleLiveToolCallOverlays(store, sessionId, snapshot);
  const patch = toolCalls
    ? { ...projection.patch, toolCalls }
    : projection.patch;
  if (patch) {
    withDeckStorePersistenceSuppressed(() => {
      useDeckStore.setState(patch);
    });
  }
  if (toolCalls && toolCallsRef) {
    toolCallsRef.current = toolCalls;
  }
  return true;
}

function applySessionTimelineHistoryResult(
  store: DeckStore,
  payload: {
    sessionId: string;
    before?: string;
    entries: SessionTimelineEntry[];
    nextCursor?: string;
    hasMore: boolean;
    liveState?: SessionLiveStateSnapshot;
    legacyEvidence?: LegacyEvidenceAvailability;
  },
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>,
) {
  timelineIndexCacheBySession.delete(payload.sessionId);
  const shouldReplace = !payload.before;
  store.setSessionTimeline((current) => {
    const currentEntries = current[payload.sessionId] ?? [];
    const nextEntries = shouldReplace
      ? payload.entries
      : mergeTimelineEntries(payload.entries, currentEntries);
    return {
      ...current,
      [payload.sessionId]: nextEntries,
    };
  });
  const overlays = removeTerminalTimelineOverlays(store, payload.sessionId, payload.entries);
  if (overlays.messages || overlays.toolCalls) {
    withDeckStorePersistenceSuppressed(() => {
      useDeckStore.setState(overlays);
    });
    if (overlays.toolCalls) {
      toolCallsRef.current = overlays.toolCalls;
    }
  }
  if (shouldReplace) {
    store.setSessionTimelineDeliveryState((current) => ({
      ...current,
      [payload.sessionId]: {
        latestDeliverySequence: 0,
        reloadRequired: false,
      },
    }));
  }
  store.setMessageHistoryState((current) => ({
    ...current,
    [payload.sessionId]: {
      nextCursor: payload.nextCursor,
      hasMore: payload.hasMore,
      loading: false,
    },
  }));
  store.setActivityHistoryState((current) => ({
    ...current,
    [payload.sessionId]: {
      nextCursor: payload.nextCursor,
      hasMore: payload.hasMore,
      loading: false,
    },
  }));
  if (shouldReplace || payload.liveState) {
    applySessionLiveStateSnapshot(store, payload.sessionId, payload.liveState, toolCallsRef);
  }
  if (payload.legacyEvidence) {
    store.setSessionLegacyEvidence((current) => {
      const existing = current[payload.sessionId];
      return {
        ...current,
        [payload.sessionId]: {
          availability: payload.legacyEvidence,
          pages: existing?.pages ?? {},
          loading: existing?.loading ?? {},
        },
      };
    });
  }
}

function requestCanonicalTimelineReload(
  sessionId: string,
  context: Pick<SessionServerEventContext, "dispatch" | "rpcClientRef">,
) {
  const client = context.rpcClientRef.current;
  if (!client || client.socket?.readyState !== 1) {
    return;
  }
  const store = useDeckStore.getState();
  store.setMessageHistoryState((current) => ({
    ...current,
    [sessionId]: {
      hasMore: current[sessionId]?.hasMore ?? false,
      ...current[sessionId],
      loading: true,
    },
  }));
  void context.dispatch(client, "session/list_timeline", {
    sessionId,
    limit: CANONICAL_TIMELINE_RELOAD_LIMIT,
  }).catch(() => {
    useDeckStore.getState().setMessageHistoryState((current) => ({
      ...current,
      [sessionId]: {
        hasMore: current[sessionId]?.hasMore ?? false,
        ...current[sessionId],
        loading: false,
      },
    }));
  });
}

function shouldReloadCanonicalTimelineAfterResume(
  store: DeckStore,
  sessionId: string,
  resume: SessionSummary["resume"],
) {
  if (resume?.restoreMethod === "session/load") {
    return true;
  }
  if (resume?.mode !== "reconnect") {
    return false;
  }
  const existingEntries = store.sessionTimeline[sessionId] ?? [];
  const latestDeliverySequence =
    store.sessionTimelineDeliveryState[sessionId]?.latestDeliverySequence ?? 0;
  return existingEntries.length === 0 && latestDeliverySequence === 0;
}

function applyCanonicalTimelineBatch(
  store: DeckStore,
  sessionId: string,
  batch: SessionTimelineBatch,
  context: Pick<
    SessionServerEventContext,
    "dispatch" | "rpcClientRef" | "toolCallsRef"
  >,
) {
  const emptyAppliedState = createEmptyAppliedTimelineState();
  const deliveryState = store.sessionTimelineDeliveryState[sessionId];
  const currentEntries = store.sessionTimeline[sessionId] ?? [];
  const currentState = {
    entries: currentEntries,
    latestDeliverySequence:
      deliveryState?.latestDeliverySequence ?? emptyAppliedState.latestDeliverySequence,
    reloadRequired: deliveryState?.reloadRequired ?? emptyAppliedState.reloadRequired,
  };
  const isGap =
    !batch.replace &&
    batch.deliverySequence > currentState.latestDeliverySequence + 1 &&
    currentState.latestDeliverySequence > 0;
  let cache = timelineIndexCacheBySession.get(sessionId);
  if (cache?.entries !== currentEntries) {
    cache = undefined;
  }
  if (!cache && (batch.replace || (!isGap && batch.deliverySequence > currentState.latestDeliverySequence))) {
    cache = createSessionTimelineIndexCache(currentEntries);
    timelineIndexCacheBySession.set(sessionId, cache);
  }
  const nextState = applySessionTimelineBatch(currentState, batch, cache);
  const nextDeliveryState = {
    latestDeliverySequence: nextState.latestDeliverySequence,
    reloadRequired: nextState.reloadRequired,
  };
  const deliveryChanged =
    deliveryState?.latestDeliverySequence !== nextDeliveryState.latestDeliverySequence ||
    deliveryState?.reloadRequired !== nextDeliveryState.reloadRequired;
  if (nextState.entries !== currentEntries || deliveryChanged) {
    const patch: Partial<DeckStore> = {
      sessionTimelineDeliveryState: {
        ...store.sessionTimelineDeliveryState,
        [sessionId]: nextDeliveryState,
      },
    };
    if (nextState.entries !== currentEntries) {
      patch.sessionTimeline = {
        ...store.sessionTimeline,
        [sessionId]: nextState.entries,
      };
      const overlays = removeTerminalTimelineOverlays(store, sessionId, batch.entries);
      if (overlays.messages) {
        patch.messages = overlays.messages;
      }
      if (overlays.toolCalls) {
        patch.toolCalls = overlays.toolCalls;
      }
    }
    withDeckStorePersistenceSuppressed(() => {
      useDeckStore.setState(patch);
    });
    if (patch.toolCalls) {
      context.toolCallsRef.current = patch.toolCalls;
    }
  }
  if (nextState.reloadRequired) {
    requestCanonicalTimelineReload(sessionId, context);
  }
}

function removeTerminalTimelineOverlays(
  store: DeckStore,
  sessionId: string,
  entries: SessionTimelineEntry[],
) {
  const terminalMessageIds = new Set(
    entries.flatMap((entry) => {
      if (entry.kind === "assistant_message" && entry.streaming !== true) {
        return [entry.id];
      }
      if (entry.kind === "context_compaction" && entry.summaryMessageId) {
        return [entry.summaryMessageId];
      }
      return [];
    }),
  );
  const terminalToolCallIds = new Set(
    entries.flatMap((entry) =>
      entry.kind === "tool_call" && isTerminalToolCallStatus(entry.toolCall.status)
        ? [entry.toolCall.id]
        : [],
    ),
  );
  const messages = store.messages[sessionId];
  const toolCalls = store.toolCalls[sessionId];
  const nextMessages = terminalMessageIds.size > 0 && messages
    ? messages.filter((message) => !(message.streaming && terminalMessageIds.has(message.id)))
    : messages;
  const nextToolCalls = terminalToolCallIds.size > 0 && toolCalls
    ? toolCalls.filter((toolCall) => !terminalToolCallIds.has(toolCall.id))
    : toolCalls;
  return {
    ...(nextMessages && nextMessages.length !== messages?.length
      ? { messages: { ...store.messages, [sessionId]: nextMessages } }
      : {}),
    ...(nextToolCalls && nextToolCalls.length !== toolCalls?.length
      ? { toolCalls: { ...store.toolCalls, [sessionId]: nextToolCalls } }
      : {}),
  };
}

function isTerminalToolCallStatus(status: AgentToolCall["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function removeIdleLiveToolCallOverlays(
  store: DeckStore,
  sessionId: string,
  snapshot: SessionLiveStateSnapshot | undefined,
) {
  const sequence = snapshot?.sequence;
  if (snapshot?.status?.effectiveStatus !== "idle" || typeof sequence !== "number") {
    return undefined;
  }
  const toolCalls = store.toolCalls[sessionId];
  if (!toolCalls) {
    return undefined;
  }
  const nextToolCalls = toolCalls.filter(
    (toolCall) =>
      isTerminalToolCallStatus(toolCall.status) ||
      (typeof toolCall.sequence === "number" && toolCall.sequence > sequence),
  );
  return nextToolCalls.length === toolCalls.length
    ? undefined
    : { ...store.toolCalls, [sessionId]: nextToolCalls };
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

function pruneTimelineIndexCaches(sessions: SessionSummary[]) {
  const activeSessionIds = new Set(sessions.map((session) => session.id));
  for (const sessionId of timelineIndexCacheBySession.keys()) {
    if (!activeSessionIds.has(sessionId)) {
      timelineIndexCacheBySession.delete(sessionId);
    }
  }
}

export function applySessionUpdate(
  params: SessionUpdateParams,
  context: SessionServerEventContext,
) {
  const { sessionId, update } = params;
  const store = useDeckStore.getState();

  switch (update.kind) {
    case "session_updated": {
      const previousSession = store.sessions.find((session) => session.id === sessionId);
      const lifecycleSummary = mergeSessionLifecycleSummary(
        update.session,
        store.sessionLiveStates[sessionId],
      );
      store.setSessions((current) =>
        upsertSessionSummary(current, lifecycleSummary),
      );
      if (
        !store.sessionLiveStateSequences[sessionId] &&
        (lifecycleSummary.configOptions?.length ?? 0) > 0
      ) {
        store.setSessionConfigOptions((current) => ({
          ...current,
          [lifecycleSummary.id]: applySessionConfigSelection(
            lifecycleSummary.configOptions ?? [],
            lifecycleSummary,
          ),
        }));
      }
      if (
        !store.sessionLiveStateSequences[sessionId] &&
        (lifecycleSummary.availableCommands?.length ?? 0) > 0
      ) {
        store.setSessionAvailableCommands((current) => ({
          ...current,
          [lifecycleSummary.id]: lifecycleSummary.availableCommands ?? [],
        }));
        store.setAgentAvailableCommands((current) => ({
          ...current,
          [lifecycleSummary.agentId]: lifecycleSummary.availableCommands ?? [],
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
      if (
        update.session.runtimeSessionId &&
        update.session.runtimeSessionId !== previousSession?.runtimeSessionId
      ) {
        requestAgentConnectionsRefresh(context);
      }
      return true;
    }
    case "timeline_batch":
      if (!isCanonicalConversationUpdateKind(update.kind)) {
        return false;
      }
      applyCanonicalTimelineBatch(store, sessionId, update.batch, context);
      return true;
    case "live_state":
      {
        const snapshot = update.snapshot as SessionLiveStateSnapshot;
        applySessionLiveStateSnapshot(store, sessionId, snapshot, context.toolCallsRef);
      }
      return true;
    default:
      return false;
  }
}
