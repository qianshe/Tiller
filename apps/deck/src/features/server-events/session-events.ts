import type { MutableRefObject } from "react";
import type {
  AgentPromptContent,
  AgentPromptImageContent,
  AgentToolCall,
  AvailableCommand,
  SessionConfigOption,
  SessionSummary,
} from "@tiller/shared";
import { toast } from "../toast";
import { commandChunkToToolCall, mergeMessageHistory } from "../logbook";
import type { DeckRpcClient, DispatchToHelm } from "../helm-connection/facade";
import { useDeckStore } from "../../store";
import {
  createSessionStatusMap,
  pruneSessionScopedMap,
  resolveActiveSessionId,
} from "../mission/utils/session-derivations";
import {
  availableCommandListsEqual,
  mergeCommandHistory,
  mergeSessionSummaries,
  removeSessionRecord,
  upsertSessionSummary,
} from "./helpers";

function deriveAvailableCommandMapsFromSessions(sessions: SessionSummary[]) {
  const bySession: Record<string, AvailableCommand[]> = {};
  const byAgent: Record<string, AvailableCommand[]> = {};
  for (const session of sessions) {
    const commands = session.availableCommands ?? [];
    if (commands.length === 0) {
      continue;
    }
    bySession[session.id] = commands;
    byAgent[session.agentId] = commands;
  }
  return { bySession, byAgent };
}

function deriveConfigOptionMapsFromSessions(sessions: SessionSummary[]) {
  return Object.fromEntries(
    sessions
      .filter((session) => (session.configOptions?.length ?? 0) > 0)
      .map((session) => [
        session.id,
        applySessionConfigSelection(session.configOptions ?? [], session),
      ] as const),
  );
}

type SessionConfigSelection = Pick<SessionSummary, "agentMode" | "model" | "reasoningEffort">;

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

function configOptionCategory(option: SessionConfigOption) {
  return option.category?.toLowerCase() ?? option.id.toLowerCase();
}

function isReasoningConfigOption(option: SessionConfigOption) {
  const category = configOptionCategory(option);
  return category === "reasoning" ||
    category === "reasoning_effort" ||
    category === "thought_level";
}

function hasReasoningConfigOption(options: SessionConfigOption[]) {
  return options.some((option) => isReasoningConfigOption(option));
}

function readConfigSelectionFromOptions(options: SessionConfigOption[]) {
  return options.reduce<SessionConfigSelection>((selection, option) => {
    const category = configOptionCategory(option);
    const currentValue = option.currentValue ?? option.selectedValue ?? option.value;
    if (category === "mode" && typeof currentValue === "string") {
      selection.agentMode = currentValue;
    } else if (category === "model" && typeof currentValue === "string") {
      selection.model = currentValue;
    } else if (isReasoningConfigOption(option) && typeof currentValue === "string") {
      selection.reasoningEffort = currentValue as SessionConfigSelection["reasoningEffort"];
    }
    return selection;
  }, {});
}

function resolveSessionConfigSelection(
  current: SessionConfigSelection | undefined,
  state: Partial<SessionConfigSelection> | undefined,
  options?: SessionConfigOption[],
): SessionConfigSelection {
  const selection: SessionConfigSelection = {
    ...(current ?? {}),
    ...(options ? readConfigSelectionFromOptions(options) : {}),
    ...(state ?? {}),
  };
  if (options && !hasReasoningConfigOption(options)) {
    const { reasoningEffort: _reasoningEffort, ...withoutReasoning } = selection;
    return withoutReasoning as SessionConfigSelection;
  }
  return selection;
}

function applySessionConfigSelection(
  options: SessionConfigOption[],
  selection: SessionConfigSelection,
) {
  return options.map((option) => {
    const category = configOptionCategory(option);
    let selectedValue: SessionConfigOption["currentValue"] | undefined;
    if (category === "model") {
      selectedValue = selection.model;
    } else if (category === "mode") {
      selectedValue = selection.agentMode;
    } else if (isReasoningConfigOption(option)) {
      selectedValue = selection.reasoningEffort;
    }
    return selectedValue === undefined
      ? option
      : { ...option, currentValue: selectedValue };
  });
}
type SessionUpdateParams = {
  sessionId: string;
  update: { kind: string } & Record<string, any>;
};

function pendingInitialPromptMessageId(sessionId: string) {
  return `${sessionId}-user-pending`;
}

function pendingPromptImages(content: AgentPromptContent[] | undefined) {
  return content?.filter(
    (item): item is AgentPromptImageContent => item.type === "image",
  ) ?? [];
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
      const nextSessions = payload.before
        ? mergeSessionSummaries(currentSessions, payload.sessions)
        : payload.sessions;
      const nextStatuses = createSessionStatusMap(nextSessions);
      store.applyHelmInventory(sourceHelmKey, {
        sessions: nextSessions,
        statuses: nextStatuses,
      });
      if (sourceIsCurrentHelm) {
        store.setSessions(nextSessions);
        store.setSessionHistoryState({
          nextCursor: payload.nextCursor,
          hasMore: Boolean(payload.hasMore),
          loading: false,
        });
        store.setStatuses(nextStatuses);
        store.setMessages((current) => pruneSessionScopedMap(current, nextSessions));
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
        store.setActivityHistoryState((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setDiffs((current) => pruneSessionScopedMap(current, nextSessions));
        store.setSessionConfigOptions((current) => ({
          ...pruneSessionScopedMap(current, nextSessions),
          ...deriveConfigOptionMapsFromSessions(nextSessions),
        }));
        {
          const commandMaps = deriveAvailableCommandMapsFromSessions(nextSessions);
          store.setSessionAvailableCommands((current) => ({
            ...pruneSessionScopedMap(current, nextSessions),
            ...commandMaps.bySession,
          }));
          store.setAgentAvailableCommands((current) => ({
            ...current,
            ...commandMaps.byAgent,
          }));
        }
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
    case "session/list_messages":
      store.setMessages((current) => ({
        ...current,
        [payload.sessionId]: mergeMessageHistory(
          current[payload.sessionId] ?? [],
          payload.messages,
          { mode: payload.before ? "prepend" : "append" },
        ),
      }));
      store.setMessageHistoryState((current) => ({
        ...current,
        [payload.sessionId]: {
          nextCursor: payload.nextCursor,
          hasMore: Boolean(payload.hasMore),
          loading: false,
        },
      }));
      return true;
    case "session/get_artifacts":
      store.setOutputs((current) => ({
        ...current,
        [payload.sessionId]: mergeCommandHistory(
          current[payload.sessionId] ?? [],
          payload.outputs,
        ),
      }));
      mergeSessionToolCalls(payload.sessionId, [
        ...payload.outputs.map(commandChunkToToolCall),
        ...(payload.toolCalls ?? []),
      ]);
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
    case "session/cleanup":
      if (payload.result.remoteDeleted) {
        toast.success("会话已删除");
      } else if (payload.result.remoteDeletionAttempted) {
        toast.warning(payload.result.message);
      } else {
        toast.info(payload.result.message);
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



