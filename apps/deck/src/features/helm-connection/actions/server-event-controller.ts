// @ts-nocheck
import type { HelmToClient } from "@tiller/sync-protocol";
import type { AgentToolCall } from "@tiller/shared";
import { daemonProfileKey } from "../daemon-profiles";
import { DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "../helm-endpoint";
import { nextRequestId } from "../request-dispatch";
import { clearTrustedDeviceCache, readTrustedDeviceCache, writeTrustedDeviceCache } from "../../auth/beacon-cache";
import { agentModelOptionsKey, writeAgentModelOptionsCache } from "../../agents/utils/agent-model-options-cache";
import { mergeToolCallHistory } from "../../logbook/timeline";
import { resolveModelOptions, resolvePreferredModel } from "../../mission/utils/composer-options";
import { projectFilesKey } from "../../mission/utils/project-files-key";
import {
  handleActivityServerEvent,
  handleDeviceServerEvent,
  handleInventoryServerEvent,
  handleSessionServerEvent,
} from "../../server-events";
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
} from "../../../shared/config/deck-runtime";

export function createServerEventController(source: any, helpers: any) {
  const {
    setToolCalls,
    toolCallsRef,
    primaryHelmKeyRef,
    daemonHost,
    daemonPort,
    deckDeviceId,
    pendingAddHelmProfileRef,
    appActionsRef,
    selectHelmKey,
    setFleetAddHelmModalOpen,
    setFleetAddHelmStage,
    autoConnectAttemptRef,
    socketRef,
    setProjectFilesByScope,
    setSelectedWorkspaceId,
    setWorktreePickerOpen,
    setAgentTestResult,
    selectedAgentId,
    selectedWorkspaceId,
    selectedModel,
    setSelectedModel,
    setSelectedAgentMode,
    setSelectedReasoningEffort,
    setConfigSaveMessage,
    setFleetProjectSaveMessage,
    setSelectedProjectId,
    helmSocketRefs,
    pendingPromptRef,
    pendingPromptContentRef,
    assignSessionTitleFromPrompt,
    setResumeFeedback,
    resumeStartRequestsRef,
    requestCounter,
  } = source;
  const {
    appendSystemMessage,
    appendUserMessage,
    createClientUserMessageId,
    dispatch,
    requestInitialSync,
    requestSessionResumeStart,
    shouldAutoStartSessionResume,
  } = helpers;

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

    handleActivityServerEvent(payload, {
      toolCallsRef,
      mergeSessionToolCalls,
      appendSystemMessage,
    });
  }

  return {
    mergeSessionToolCalls,
    handleServerEvent,
  };
}
