// @ts-nocheck
import {
  normalizeModelSelection,
  useSessionCommandActions,
  useSessionMessageActions,
} from "../../mission/facade";
import { createServerEventController } from "./server-event-controller";
import { createSocketController } from "./socket-controller";

export function useAppControllers(ctx: any) {
  const source = {
    ...ctx.runtimeState,
    ...ctx.deckData,
    ...ctx.missionView,
    ...ctx.helmConnection,
    ...ctx.route,
    ...ctx.titleActions,
    ...ctx,
  };
  const {
    setMessages,
    prompt,
    promptImages,
    socketRef,
    setImagePasteNotice,
    activeSessionId,
    selectedProjectId,
    projects,
    selectedWorkspace,
    filteredWorkspaces,
    selectedAgentId,
    filteredAgents,
    pendingPromptRef,
    pendingPromptContentRef,
    effectiveDraftAgentMode,
    selectedModel,
    selectedReasoningEffort,
    navigateToView,
    setPrompt,
    setPromptImages,
    permissionRequests,
    resumeStartRequestsRef,
    setResumeFeedback,
  } = source;

  const {
    appendSystemMessage,
    appendUserMessage,
    createClientUserMessageId,
  } = useSessionMessageActions({ setMessages });

  let dispatch = (..._args: any[]) => undefined;
  let requestInitialSync = (_socket: WebSocket) => undefined;
  let requestSessionResumeStart = (_sessionId: string) => {};
  let shouldAutoStartSessionResume = (_sessionId: string) => false;

  const serverEventController = createServerEventController(source, {
    appendSystemMessage,
    appendUserMessage,
    createClientUserMessageId,
    dispatch: (...args: any[]) => dispatch(...args),
    requestInitialSync: (...args: any[]) => requestInitialSync(...args),
    requestSessionResumeStart: (...args: any[]) =>
      requestSessionResumeStart(...args),
    shouldAutoStartSessionResume: (...args: any[]) =>
      shouldAutoStartSessionResume(...args),
  });

  const socketController = createSocketController(source, {
    handleServerEvent: (...args) => serverEventController.handleServerEvent(...args),
    handleRpcResult: (...args) => serverEventController.handleRpcResult(...args),
    handleRpcNotification: (...args) => serverEventController.handleRpcNotification(...args),
  });
  dispatch = socketController.dispatch;
  requestInitialSync = socketController.requestInitialSync;

  const commandActions = useSessionCommandActions({
    prompt,
    promptImages,
    socketRef,
    setImagePasteNotice,
    activeSessionId,
    selectedProjectId,
    projects,
    selectedWorkspace,
    filteredWorkspaces,
    selectedAgentId,
    filteredAgents,
    pendingPromptRef,
    pendingPromptContentRef,
    dispatch: socketController.dispatch,
    requestCounter: source.requestCounter,
    effectiveDraftAgentMode,
    normalizeModelSelection,
    selectedModel,
    selectedReasoningEffort,
    navigateToView,
    setPrompt,
    setPromptImages,
    createClientUserMessageId,
    appendUserMessage,
    permissionRequests,
    resumeStartRequestsRef,
    setResumeFeedback,
  });

  requestSessionResumeStart = commandActions.requestSessionResumeStart;
  shouldAutoStartSessionResume = commandActions.shouldAutoStartSessionResume;

  return {
    ...socketController,
    appendSystemMessage,
    appendUserMessage,
    createClientUserMessageId,
    ...serverEventController,
    ...commandActions,
  };
}
