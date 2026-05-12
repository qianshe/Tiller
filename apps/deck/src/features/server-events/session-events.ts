import type { MutableRefObject } from "react";
import type {
  AgentPromptContent,
  AgentPromptImageContent,
  AgentToolCall,
  AvailableCommand,
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
  store.setStatuses((current) => ({
    ...current,
    [payload.session.id]: payload.session.status,
  }));
  setSelectedProjectId(payload.session.projectId);
  if (!payload.session.runtimeSessionId) {
    return true;
  }
  store.setActiveSessionId(payload.session.id);
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
        store.setPermissionRequests((current) =>
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
        store.setSessionConfigOptions((current) =>
          pruneSessionScopedMap(current, nextSessions),
        );
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
    case "permission/list_pending":
      if (sourceIsCurrentHelm) {
        store.setPermissionRequests(
          Object.fromEntries(
            (payload.permissions ?? []).map((permission: any) => [
              permission.sessionId,
              permission.request,
            ]),
          ),
        );
      }
      return true;
    case "session/resume":
      setResumeFeedback(payload.message);
      resumeStartRequestsRef.current.delete(payload.sessionId);
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
      if (sourceIsCurrentHelm && payload.ok && rpcClientRef.current?.socket?.readyState === 1) {
        void dispatch(rpcClientRef.current, "agent/connections", {});
      }
      return true;
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
      store.setPermissionRequests((current) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
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
      return true;
    case "config_options":
      store.setSessionConfigOptions((current) => ({
        ...current,
        [sessionId]: update.options,
      }));
      store.setSessions((current) =>
        current.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                model: update.state.model ?? session.model,
                agentMode: update.state.agentMode ?? session.agentMode,
                reasoningEffort:
                  update.state.reasoningEffort ?? session.reasoningEffort,
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      );
      return true;
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
    case "status_change":
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



