import { toast } from "../../features/toast/toast";
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
    sessions,
    setSessions,
    setStatuses,
    setSelectedProjectId,
    setActiveSessionId,
    pendingPromptRef,
    pendingPromptContentRef,
    socketRef,
    assignSessionTitleFromPrompt,
    createClientUserMessageId,
    appendUserMessage,
    dispatch,
    nextRequestId,
    requestCounter,
    setSessionConfigOptions,
    setSessionAvailableCommands,
    updateHelmInventory,
    setSessionHistoryState,
    setMessages,
    setMessageHistoryState,
    setPermissionRequests,
    setOutputs,
    setToolCalls,
    toolCallsRef,
    setActivityHistoryState,
    setDiffs,
    mergeSessionToolCalls,
    shouldAutoStartSessionResume,
    requestSessionResumeStart,
    setResumeFeedback,
    resumeStartRequestsRef,
  } = context;

  switch (payload.type) {
    case "session.created":
      setSessions((current: any) =>
        upsertSessionSummary(current, payload.session),
      );
      setStatuses((current: any) => ({
        ...current,
        [payload.session.id]: payload.session.status,
      }));
      setSelectedProjectId(payload.session.projectId);
      if (payload.session.runtimeSessionId) {
        setActiveSessionId(payload.session.id);
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
      setSessions((current: any) =>
        upsertSessionSummary(current, payload.session),
      );
      return true;
    case "session.config.options":
      setSessionConfigOptions((current: any) => ({
        ...current,
        [payload.sessionId]: payload.options,
      }));
      setSessions((current: any[]) =>
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
      setSessionAvailableCommands((current: any) => {
        if (
          availableCommandListsEqual(current[payload.sessionId], payload.commands)
        ) {
          return current;
        }
        return { ...current, [payload.sessionId]: payload.commands };
      });
      return true;
    case "session.model.options":
      setSessions((current: any[]) =>
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
        ? mergeSessionSummaries(sessions, payload.sessions)
        : payload.sessions;
      const nextStatuses = createSessionStatusMap(nextSessions);
      updateHelmInventory(sourceHelmKey, {
        sessions: nextSessions,
        statuses: nextStatuses,
      });
      if (sourceIsCurrentHelm) {
        setSessions(nextSessions);
        setSessionHistoryState({
          nextCursor: payload.nextCursor,
          hasMore: Boolean(payload.hasMore),
          loading: false,
        });
        setStatuses(nextStatuses);
        setMessages((current: any) => pruneSessionScopedMap(current, nextSessions));
        setMessageHistoryState((current: any) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        setPermissionRequests((current: any) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        setOutputs((current: any) => pruneSessionScopedMap(current, nextSessions));
        setToolCalls((current: any) => {
          const next = pruneSessionScopedMap(current, nextSessions);
          toolCallsRef.current = next;
          return next;
        });
        setActivityHistoryState((current: any) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        setDiffs((current: any) => pruneSessionScopedMap(current, nextSessions));
        setSessionConfigOptions((current: any) =>
          pruneSessionScopedMap(current, nextSessions),
        );
        setActiveSessionId((current: string | null) =>
          resolveActiveSessionId(current, nextSessions),
        );
      }
      return true;
    }
    case "session.messages.list.result":
      setMessages((current: any) => ({
        ...current,
        [payload.sessionId]: mergeMessageHistory(
          current[payload.sessionId] ?? [],
          payload.messages,
          { mode: payload.before ? "prepend" : "append" },
        ),
      }));
      setMessageHistoryState((current: any) => ({
        ...current,
        [payload.sessionId]: {
          nextCursor: payload.nextCursor,
          hasMore: Boolean(payload.hasMore),
          loading: false,
        },
      }));
      return true;
    case "session.artifacts.result":
      setOutputs((current: any) => ({
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
      setDiffs((current: any) => ({
        ...current,
        [payload.sessionId]: payload.diffs,
      }));
      setActivityHistoryState((current: any) => ({
        ...current,
        [payload.sessionId]: {
          nextCursor: payload.nextCursor,
          hasMore: Boolean(payload.hasMore),
          loading: false,
        },
      }));
      return true;
    case "session.resume.result":
      setSessions((current: any[]) =>
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
      setSessions((current: any[]) =>
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
      setSessions((current: any[]) =>
        current.filter((session) => session.id !== payload.result.sessionId),
      );
      setStatuses((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      setMessages((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      setPermissionRequests((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      setOutputs((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      setToolCalls((current: any) => {
        const next = removeSessionRecord(current, payload.result.sessionId);
        toolCallsRef.current = next;
        return next;
      });
      setDiffs((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      setSessionConfigOptions((current: any) =>
        removeSessionRecord(current, payload.result.sessionId),
      );
      setActiveSessionId((current: string | null) =>
        current === payload.result.sessionId ? null : current,
      );
      return true;
    case "session.status":
      setStatuses((current: any) => ({
        ...current,
        [payload.sessionId]: payload.status,
      }));
      setSessions((current: any[]) =>
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
