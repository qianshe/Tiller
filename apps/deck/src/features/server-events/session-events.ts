import type { MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentPlan,
  AgentPromptContent,
  AgentPromptImageContent,
  AgentToolCall,
  SessionConfigOption,
  SessionLiveStateSnapshot,
  SessionSummary,
  SessionTimelineBatch,
  SessionTimelineEntry,
} from "@tiller/shared";
import { sortSessionTimelineEntries } from "@tiller/shared";
import { toast } from "../toast";
import { dropActiveThinkingToolCalls, mergeMessageHistory } from "../logbook";
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
import { deriveSessionListResult } from "./session-list-result";
import { resolveSessionCleanupToast } from "./session-result-effects";
import {
  pendingInitialPromptMessageId,
  pendingPromptImages,
} from "./session-message-history";
import {
  applySessionTimelineBatch,
  createEmptyAppliedTimelineState,
} from "./session-timeline-batches";
import { deriveToolCallsFromTimeline } from "../mission/utils/timeline-tool-calls";

const CANONICAL_TIMELINE_RELOAD_LIMIT = 20;

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

function hasCanonicalConversationTimeline(
  store: DeckStore,
  sessionId: string,
): boolean {
  if (store.sessionTimelineDeliveryState[sessionId]) {
    return true;
  }
  return (store.sessionTimeline[sessionId]?.length ?? 0) > 0;
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
      }, {
        toolCallsRef,
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
        if (shouldReloadCanonicalTimelineAfterResume(store, payload.sessionId, resume)) {
          requestCanonicalTimelineReload(payload.sessionId, context);
        }
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

function replaceSessionPlanPayload(
  store: DeckStore,
  sessionId: string,
  plan: AgentPlan | undefined,
) {
  store.setSessionPlans((current) => {
    if (plan) {
      return { ...current, [sessionId]: plan };
    }
    if (!Object.prototype.hasOwnProperty.call(current, sessionId)) {
      return current;
    }
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
}

function replacePromptQueuePayload(
  store: DeckStore,
  sessionId: string,
  promptQueue: DeckStore["promptQueues"][string] | undefined,
) {
  store.setPromptQueues((current) => {
    if (promptQueue) {
      return { ...current, [sessionId]: promptQueue };
    }
    if (!Object.prototype.hasOwnProperty.call(current, sessionId)) {
      return current;
    }
    const next = { ...current };
    delete next[sessionId];
    return next;
  });
}

function applySessionLiveStateSnapshot(
  store: DeckStore,
  sessionId: string,
  snapshot: SessionLiveStateSnapshot | undefined,
) {
  replaceSessionPlanPayload(
    store,
    sessionId,
    isAgentPlanPayload(snapshot?.plan) ? snapshot.plan : undefined,
  );
  replacePromptQueuePayload(store, sessionId, snapshot?.promptQueue);
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
  },
  context: Pick<SessionServerEventContext, "toolCallsRef">,
) {
  const shouldReplace = !payload.before;
  store.setSessionTimeline((current) => {
    const currentEntries = current[payload.sessionId] ?? [];
    const nextEntries = shouldReplace
      ? sortSessionTimelineEntries(payload.entries)
      : sortSessionTimelineEntries(mergeTimelineEntries(payload.entries, currentEntries));
    return {
      ...current,
      [payload.sessionId]: nextEntries,
    };
  });
  const nextTimeline = shouldReplace
    ? sortSessionTimelineEntries(payload.entries)
    : sortSessionTimelineEntries(
        mergeTimelineEntries(payload.entries, store.sessionTimeline[payload.sessionId] ?? []),
      );
  syncSessionToolCallsFromTimeline(store, payload.sessionId, nextTimeline, context.toolCallsRef);
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
  if (shouldReplace || payload.liveState) {
    applySessionLiveStateSnapshot(store, payload.sessionId, payload.liveState);
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
  context: Pick<SessionServerEventContext, "dispatch" | "rpcClientRef" | "toolCallsRef">,
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
  const nextState = applySessionTimelineBatch(currentState, batch);
  if (nextState.entries !== currentEntries) {
    store.setSessionTimeline((current) => ({
      ...current,
      [sessionId]: nextState.entries,
    }));
    syncSessionToolCallsFromTimeline(store, sessionId, nextState.entries, context.toolCallsRef);
  }
  store.setSessionTimelineDeliveryState((current) => ({
    ...current,
    [sessionId]: {
      latestDeliverySequence: nextState.latestDeliverySequence,
      reloadRequired: nextState.reloadRequired,
    },
  }));
  if (nextState.reloadRequired) {
    requestCanonicalTimelineReload(sessionId, context);
  }
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

function syncSessionToolCallsFromTimeline(
  store: DeckStore,
  sessionId: string,
  entries: SessionTimelineEntry[],
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>,
) {
  const nextSessionToolCalls = deriveToolCallsFromTimeline(entries);
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
      if (hasCanonicalConversationTimeline(store, sessionId)) {
        return true;
      }
      store.setMessages((current) => ({
        ...current,
        [sessionId]: mergeMessageHistory(
          current[sessionId] ?? [],
          [update.message],
          { mode: "append" },
        ),
      }));
      return true;
    case "transcript_event":
      return true;
    case "timeline_batch":
      if (!isCanonicalConversationUpdateKind(update.kind)) {
        return false;
      }
      applyCanonicalTimelineBatch(store, sessionId, update.batch, context);
      return true;
    case "live_state":
      applySessionLiveStateSnapshot(store, sessionId, update.snapshot as SessionLiveStateSnapshot);
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
