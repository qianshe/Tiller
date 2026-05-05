// @ts-nocheck
import type { FormEvent } from "react";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import type { AgentToolCall } from "@tiller/shared";
import { daemonProfileKey, type DaemonProfile } from "../features/helm-connection/daemon-profiles";
import type { ConnectionState } from "../store/slices/connection-slice";
import type { HelmInventoryBucket } from "../store/slices/helms-slice";
import { clearTrustedDeviceCache, readTrustedDeviceCache, writeTrustedDeviceCache } from "../features/auth/beacon-cache";
import { mergeToolCallHistory } from "../features/logbook/timeline";
import { handleActivityServerEvent, handleDeviceServerEvent, handleInventoryServerEvent, handleSessionServerEvent } from "../features/server-events/index";
import { agentModelOptionsKey, writeAgentModelOptionsCache } from "../features/agents/utils/agent-model-options-cache";
import { normalizeModelSelection, resolveModelOptions, resolvePreferredModel } from "../features/mission/utils/composer-options";
import { projectFilesKey } from "../features/mission/utils/project-files-key";
import { connectHelmSocket as connectHelmSocketImpl, connectToDaemon as connectToDaemonImpl, type ConnectToDaemonOptions } from "../features/helm-connection/sockets";
import { dispatchWithTrace, nextRequestId, requestInitialSync as requestInitialSyncImpl } from "../features/helm-connection/request-dispatch";
import { useSessionCommandActions } from "./session-command-actions";
import { useSessionMessageActions } from "./session-message-actions";
import { DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "../features/helm-connection/helm-endpoint";
import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT, DEFAULT_SESSION_PAGE_LIMIT, IS_EMBEDDED_HELM_DECK } from "./constants";

export function useAppControllers(ctx: any) {
  const source = { ...ctx.runtimeState, ...ctx.deckData, ...ctx.missionView, ...ctx.helmConnection, ...ctx.route, ...ctx.titleActions, ...ctx };
  const {
    setSessionHistoryState,
    setHelmConnection,
    applyHelmInventory,
    setMessages,
    setToolCalls,
    toolCallsRef,
    helmSocketRefs,
    setDaemonProfileMessage,
    requestCounter,
    primaryHelmKeyRef,
    manualDisconnectRef,
    socketRef,
    setSessions,
    setStatuses,
    setPermissionRequests,
    setOutputs,
    setDiffs,
    setSessionConfigOptions,
    setTrustedDevices,
    setActiveSessionId,
    setSelectedProjectId,
    setResumeFeedback,
    setDebugTrace,
    setConnection,
    setConnectFeedback,
    copy,
    setPairingState,
    setPairingCodeInput,
    setPairingFeedback,
    pairingState,
    setTrustedDevice,
    lastFilesScopeKeyRef,
    prompt,
    promptImages,
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
    daemonHost,
    daemonPort,
    deckDeviceId,
    pendingAddHelmProfileRef,
    selectHelmKey,
    setFleetAddHelmModalOpen,
    setFleetAddHelmStage,
    setProjectFilesByScope,
    setSelectedWorkspaceId,
    setWorktreePickerOpen,
    setAgentTestResult,
    selectedWorkspaceId,
    setSelectedModel,
    setSelectedAgentMode,
    setSelectedReasoningEffort,
    setConfigSaveMessage,
    setFleetProjectSaveMessage,
    assignSessionTitleFromPrompt,
    autoConnectAttemptRef,
    appActionsRef,
  } = source;
function requestInitialSync(socket: WebSocket) {
  requestInitialSyncImpl(socket, {
    dispatch,
    requestCounter,
    setSessionHistoryState,
    sessionPageLimit: DEFAULT_SESSION_PAGE_LIMIT,
  });
}
function setHelmConnectionState(helmKey: string, state: ConnectionState) {
  setHelmConnection(helmKey, state);
}
function updateHelmInventory(
  helmKey: string,
  patch: Partial<HelmInventoryBucket>,
) {
  applyHelmInventory(helmKey, patch);
}
const {
  appendSystemMessage,
  appendUserMessage,
  createClientUserMessageId,
} = useSessionMessageActions({ setMessages });
function mergeSessionToolCalls(sessionId: string, incoming: AgentToolCall[]) {
  setToolCalls((current) => {
    const next = {
      ...current,
      [sessionId]: mergeToolCallHistory(current[sessionId] ?? [], incoming),
    };
    toolCallsRef.current = next;
    return next;
  });
}
function connectHelmSocket(profile: DaemonProfile) {
  connectHelmSocketImpl(profile, {
    embedded: IS_EMBEDDED_HELM_DECK,
    location: window.location,
    helmSocketRefs,
    setHelmConnectionState,
    setDaemonProfileMessage,
    readTrustedDeviceCache,
    requestInitialSync,
    dispatch,
    nextRequestId,
    requestCounter,
    handleServerEvent,
  });
}
function connectToDaemon(
  event?: FormEvent<HTMLFormElement>,
  options?: ConnectToDaemonOptions,
) {
  connectToDaemonImpl(event, options, {
    embedded: IS_EMBEDDED_HELM_DECK,
    location: window.location,
    daemonHost,
    daemonPort,
    defaultDaemonHost: DEFAULT_DAEMON_HOST,
    defaultDaemonPort: DEFAULT_DAEMON_PORT,
    primaryHelmKeyRef,
    manualDisconnectRef,
    socketRef,
    setSessions,
    setStatuses,
    setMessages,
    setPermissionRequests,
    setOutputs,
    toolCallsRef,
    setToolCalls,
    setDiffs,
    setSessionConfigOptions,
    setTrustedDevices,
    setActiveSessionId,
    setSelectedProjectId,
    setResumeFeedback,
    setDebugTrace,
    setHelmConnectionState,
    setConnection,
    setConnectFeedback,
    copy,
    setPairingState,
    setPairingCodeInput,
    setPairingFeedback,
    pairingState,
    setTrustedDevice,
    readTrustedDeviceCache,
    dispatch,
    nextRequestId,
    requestCounter,
    requestInitialSync,
    lastFilesScopeKeyRef,
    handleServerEvent,
  });
}
function dispatch(socket: WebSocket, payload: ClientToHelm) {
  dispatchWithTrace(socket, payload, setDebugTrace);
}
const {
  cancelSession,
  cleanupSession,
  createSession,
  requestSessionResumeStart,
  respondToPermission,
  shouldAutoStartSessionResume,
  startResume,
  submitPrompt,
  submitPromptFromKeyboard,
} = useSessionCommandActions({
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
  dispatch,
  requestCounter,
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
function handleServerEvent(
  payload: HelmToClient,
  sourceHelmKey = daemonProfileKey(
    daemonHost.trim() || DEFAULT_DAEMON_HOST,
    daemonPort.trim() || DEFAULT_DAEMON_PORT,
  ),
) {
  const currentEventHelmKey =
    primaryHelmKeyRef.current ??
    daemonProfileKey(
      daemonHost.trim() || DEFAULT_DAEMON_HOST,
      daemonPort.trim() || DEFAULT_DAEMON_PORT,
    );
  const sourceIsCurrentHelm = sourceHelmKey === currentEventHelmKey;
  if (
    handleDeviceServerEvent(payload, sourceHelmKey, {
      primaryHelmKeyRef,
      daemonProfileKey,
      daemonHost,
      daemonPort,
      defaultDaemonHost: DEFAULT_DAEMON_HOST,
      defaultDaemonPort: DEFAULT_DAEMON_PORT,
      deckDeviceId,
      pendingAddHelmProfileRef,
      writeTrustedDeviceCache,
      persistDaemonProfile: appActionsRef.current.persistDaemonProfile,
      daemonHostStorageKey: DAEMON_HOST_KEY,
      daemonPortStorageKey: DAEMON_PORT_KEY,
      setSelectedHelmKey: selectHelmKey,
      setFleetAddHelmModalOpen,
      setFleetAddHelmStage,
      autoConnectAttemptRef,
      socketRef,
      requestInitialSync,
      readTrustedDeviceCache,
      clearTrustedDeviceCache,
    })
  ) {
    return;
  }
  if (
    handleInventoryServerEvent(payload, sourceHelmKey, sourceIsCurrentHelm, {
      projectFilesKey,
      setProjectFilesByScope,
      setSelectedWorkspaceId,
      setWorktreePickerOpen,
      setAgentTestResult,
      agentModelOptionsKey,
      writeAgentModelOptionsCache,
      selectedAgentId,
      selectedWorkspaceId,
      resolveModelOptions,
      resolvePreferredModel,
      selectedModel,
      setSelectedModel,
      setSelectedAgentMode,
      setSelectedReasoningEffort,
      setConfigSaveMessage,
      setFleetProjectSaveMessage,
      setSelectedProjectId,
      socketRef,
      helmSocketRefs,
      dispatch,
      nextRequestId,
      requestCounter,
    })
  ) {
    return;
  }
  if (
    handleSessionServerEvent(payload, sourceHelmKey, sourceIsCurrentHelm, {
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
    })
  ) {
    return;
  }
  if (
    handleActivityServerEvent(payload, {
      toolCallsRef,
      mergeSessionToolCalls,
      appendSystemMessage,
    })
  ) {
    return;
  }
}
  return {
    requestInitialSync,
    setHelmConnectionState,
    updateHelmInventory,
    appendSystemMessage,
    appendUserMessage,
    createClientUserMessageId,
    mergeSessionToolCalls,
    connectHelmSocket,
    connectToDaemon,
    cancelSession,
    cleanupSession,
    createSession,
    requestSessionResumeStart,
    respondToPermission,
    shouldAutoStartSessionResume,
    startResume,
    submitPrompt,
    submitPromptFromKeyboard,
    handleServerEvent,
  };
}
