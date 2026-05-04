import { toast } from "../../features/toast/toast";
import { useDeckStore } from "../../store";
import { commandChunkToToolCall, mergeMessageHistory } from "../../features/logbook/timeline";
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

export function handleSessionServerEvent(
  payload: { type: string; [key: string]: any },
  sourceHelmKey: string,
  sourceIsCurrentHelm: boolean,
  context: any,
) {
  const {
    setSelectedProjectId,
    pendingPromptRef,
    pendingPromptContentRef,
    socketRef,
    assignSessionTitleFromPrompt,
    createClientUserMessageId,
    appendUserMessage,
    dispatch,
    nextRequestId,
    requestCounter,
    toolCallsRef,
    mergeSessionToolCalls,
    shouldAutoStartSessionResume,
    requestSessionResumeStart,
    setResumeFeedback,
    resumeStartRequestsRef,
  } = context;
  const store = useDeckStore.getState();
  const currentSessions = store.sessions;

  switch (payload.type) {
    case "session.created":
      store.setSessions((current: any) =>
        upsertSessionSummary(current, payload.session),
      );
      store.setStatuses((current: any) => ({
        ...current,
        [payload.session.id]: payload.session.status,
      }));
      setSelectedProjectId(payload.session.projectId);
      if (payload.session.runtimeSessionId) {
        store.setActiveSessionId(payload.session.id);
        if (pendingPromptRef.current && socketRef.current) {
          const pendingPrompt = pendingPromptRef.current;
          const pendingContent = pendingPromptContentRef.current;
          const pendingImages =
            pendingContent?.filter((item: any) => item.type === "image") ?? [];
          pendingPromptRef.current = null;
          pendingPromptContentRef.current = undefined;
          assignSessionTitleFromPrompt(payload.session.id, pendingPrompt);
          const clientMessageId = createClientUserMessageId(payload.session.id);
          appendUserMessage(
            payload.session.id,
            pendingPrompt,
            clientMessageId,
            pendingImages,
          );
          dispatch(socketRef.current, {
            type: "session.prompt",
            requestId: nextRequestId(requestCounter),
            sessionId: payload.session.id,
            text: pendingPrompt,
            content: pendingContent,
            clientMessageId,
          });
        }
      }
      return true;
    case "session.updated":
      store.setSessions((current: any) =>
        upsertSessionSummary(current, payload.session),
      );
      return true;
    case "session.config.options":
      store.setSessionConfigOptions((current: any) => ({
        ...current,
        [payload.sessionId]: payload.options,
      }));
      store.setSessions((current: any[]) =>
        current.map((session) =>
          session.id === payload.sessionId
            ? {
                ...session,
                model: payload.state.model ?? session.model,
                agentMode: payload.state.agentMode ?? session.agentMode,
                reasoningEffort:
                  payload.state.reasoningEffort ?? session.reasoningEffort,
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      );
      return true;
    case "session.commands":
      store.setSessionAvailableCommands((current: any) => {
        if (
          availableCommandListsEqual(current[payload.sessionId], payload.commands)
        ) {
          return current;
        }
        return { ...current, [payload.sessionId]: payload.commands };
      });
      return true;
    case "session.model.options":
      store.setSessions((current: any[]) =>
        current.map((session) =>
          session.id === payload.sessionId
            ? {
                ...session,
                model: payload.currentModelId ?? session.model,
                modelOptions: payload.options,
                updatedAt: new Date().toISOString(),
              }
            : session,
        ),
      );
      return true;
    case "session.list.result": {
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
        store.setMessages((current: any) => pruneSessionScopedMap(current, nextSessions));
        store.setMessageHistoryState((current: any) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setPermissionRequests((current: any) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setOutputs((current: any) => pruneSessionScopedMap(current, nextSessions));
        store.setToolCalls((current) => {
          const next = pruneSessionScopedMap(current, nextSessions);
          toolCallsRef.current = next;
          return next;
        });
        store.setActivityHistoryState((current: any) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setDiffs((current: any) => pruneSessionScopedMap(current, nextSessions));
        store.setSessionConfigOptions((current: any) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        store.setActiveSessionId((current: string | null) =>
          resolveActiveSessionId(current, nextSessions),
        );
      }
      return true;
    }
    case "session.messages.list.result":
      store.setMessages((current: any) => ({
        ...current,
        [payload.sessionId]: mergeMessageHistory(
          current[payload.sessionId] ?? [],
          payload.messages,
          { mode: payload.before ? "prepend" : "append" },
        ),
      }));
      store.setMessageHistoryState((current: any) => ({
        ...current,
        [payload.sessionId]: {
          nextCursor: payload.nextCursor,
          hasMore: Boolean(payload.hasMore),
          loading: false,
        },
      }));
      return true;
    case "session.artifacts.result":
      store.setOutputs((current: any) => ({
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
      store.setDiffs((current: any) => ({
        ...current,
        [payload.sessionId]: payload.diffs,
      }));
      store.setActivityHistoryState((current: any) => ({
        ...current,
        [payload.sessionId]: {
          nextCursor: payload.nextCursor,
          hasMore: Boolean(payload.hasMore),
          loading: false,
        },
      }));
      return true;
    case "session.resume.result":
      store.setSessions((current: any[]) =>
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
    case "session.resume.start.result":
      setResumeFeedback(payload.message);
      if (!payload.ok) {
        resumeStartRequestsRef.current.delete(payload.sessionId);
      }
      store.setSessions((current: any[]) =>
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
      return true;
    case "session.cleanup.result":
      if (payload.result.remoteDeleted) {
        toast.success("会话已删除");
      } else if (payload.result.remoteDeletionAttempted) {
        toast.warning(payload.result.message);
      } else {
        toast.info(payload.result.message);
      }
      setResumeFeedback("");
      store.setSessions((current: any[]) =>
        current.filter((session) => session.id !== payload.result.sessionId),
      );
      store.setStatuses((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setMessages((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setPermissionRequests((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setOutputs((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setToolCalls((current) => {
        const next = removeSessionRecord(current, payload.result.sessionId);
        toolCallsRef.current = next;
        return next;
      });
      store.setDiffs((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setSessionConfigOptions((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      store.setActiveSessionId((current: string | null) =>
        current === payload.result.sessionId ? null : current,
      );
      return true;
    case "session.status":
      store.setStatuses((current: any) => ({
        ...current,
        [payload.sessionId]: payload.status,
      }));
      store.setSessions((current: any[]) =>
        current.map((session) =>
          session.id === payload.sessionId
            ? {
                ...session,
                status: payload.status,
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
