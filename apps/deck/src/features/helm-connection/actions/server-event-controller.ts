import type { AgentToolCall, PromptTraceEvent } from "@tiller/shared";
import { daemonProfileKey } from "../daemon-profiles";
import {
  clearHelmUpdateIntent,
  readHelmUpdateIntent,
  writeHelmUpdateIntent,
} from "../update-intent";
import { resolveHelmUpdateStatus } from "../update-status";
import { useDeckStore } from "../../../store";
import { DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "../helm-endpoint";
import { clearTrustedDeviceCache, readTrustedDeviceCache, writeTrustedDeviceCache } from "../../auth/beacon-cache";
import { agentModelOptionsKey, writeAgentModelOptionsCache } from "../../agents/facade";
import { mergeToolCallHistory } from "../../logbook";
import {
  projectFilesKey,
  resolveModelOptions,
  resolvePreferredModel,
} from "../../mission/facade";
import {
  applyActivityUpdate,
  applyApprovalCreated,
  applyApprovalResolved,
  applyDeviceResult,
  applyErrorRaised,
  applyNotificationRaised,
  applyInventoryResult,
  applySessionResult,
  applySessionUpdate,
  applyPromptTraceEvent,
  createDeckSessionUpdateTraceEvent,
} from "../../server-events";
import type { SessionUpdateParams } from "../../server-events";
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
    rpcClientRef,
    helmRpcClientRefs,
    setProjectFilesByScope,
    setSelectedCwd,
    setWorktreePickerOpen,
    setAgentTestResult,
    selectedAgentId,
    selectedCwd,
    selectedModel,
    setSelectedModel,
    setSelectedAgentMode,
    setSelectedReasoningEffort,
    setConfigSaveMessage,
    setFleetProjectSaveMessage,
    setSelectedProjectId,
    pendingPromptRef,
    pendingPromptContentRef,
    assignSessionTitleFromPrompt,
    setResumeFeedback,
    resumeStartRequestsRef,
    setResumeStartRequestIds,
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
    setToolCalls((current: Record<string, AgentToolCall[]>) => {
      const next = {
        ...current,
        [sessionId]: mergeToolCallHistory(current[sessionId] ?? [], incoming),
      };
      toolCallsRef.current = next;
      return next;
    });
  }

  function defaultHelmKey() {
    return daemonProfileKey(
      daemonHost.trim() || DEFAULT_DAEMON_HOST,
      daemonPort.trim() || DEFAULT_DAEMON_PORT,
    );
  }

  function sourceIsCurrent(sourceHelmKey: string) {
    const currentEventHelmKey = primaryHelmKeyRef.current ?? defaultHelmKey();
    if (sourceHelmKey === currentEventHelmKey) {
      return true;
    }
    const [sourceHost, sourcePort] = sourceHelmKey.split(":");
    const [currentHost, currentPort] = currentEventHelmKey.split(":");
    const sourceIsLoopback = sourceHost === "localhost" || sourceHost === "127.0.0.1";
    const currentIsLoopback = currentHost === "localhost" || currentHost === "127.0.0.1";
    return Boolean(sourcePort && sourcePort === currentPort && sourceIsLoopback && currentIsLoopback);
  }

  function deviceContext() {
    return {
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
      rpcClientRef,
      requestInitialSync,
      readTrustedDeviceCache,
      clearTrustedDeviceCache,
    };
  }

  function inventoryContext() {
    return {
      projectFilesKey,
      setProjectFilesByScope,
      setSelectedCwd,
      setWorktreePickerOpen,
      setAgentTestResult,
      agentModelOptionsKey,
      writeAgentModelOptionsCache,
      selectedAgentId,
      selectedCwd,
      resolveModelOptions,
      resolvePreferredModel,
      selectedModel,
      setSelectedModel,
      setSelectedAgentMode,
      setSelectedReasoningEffort,
      setConfigSaveMessage,
      setFleetProjectSaveMessage,
      setSelectedProjectId,
      rpcClientRef,
      helmRpcClientRefs,
      dispatch,
    };
  }

  function sessionContext() {
    return {
      setSelectedProjectId,
      pendingPromptRef,
      pendingPromptContentRef,
      rpcClientRef,
      assignSessionTitleFromPrompt,
      createClientUserMessageId,
      appendUserMessage,
      dispatch,
      toolCallsRef,
      mergeSessionToolCalls,
      shouldAutoStartSessionResume,
      requestSessionResumeStart,
      setResumeFeedback,
      resumeStartRequestsRef,
      setResumeStartRequestIds,
    };
  }

  function activityContext() {
    return {
      toolCallsRef,
      mergeSessionToolCalls,
      appendSystemMessage,
      addNotification: source.addNotification,
    };
  }

  function handleServerEvent() {
    // Legacy custom WebSocket frames are intentionally no longer handled.
  }

  function handleRpcResult(method: string, result: unknown, sourceHelmKey = defaultHelmKey()) {
    const current = sourceIsCurrent(sourceHelmKey);

    if (applyDeviceResult(method, result, sourceHelmKey, deviceContext())) return;
    if (applyInventoryResult(method, result, sourceHelmKey, current, inventoryContext())) return;
    applySessionResult(method, result, sourceHelmKey, current, sessionContext());
  }

  function handleRpcNotification(method: string, params: unknown, sourceHelmKey = defaultHelmKey()) {
    if (method === "daemon/update/status") {
      const payload = params as Record<string, unknown>;
      const previous = useDeckStore.getState().helmInventories[sourceHelmKey]?.update;
      const resolved = resolveHelmUpdateStatus(
        payload,
        previous,
        readHelmUpdateIntent(sourceHelmKey)?.targetVersion,
      );
      useDeckStore.getState().applyHelmInventory(sourceHelmKey, { update: resolved.update });
      if (resolved.intent.kind === "write") {
        writeHelmUpdateIntent(sourceHelmKey, resolved.intent.targetVersion);
      } else if (resolved.intent.kind === "clear") {
        clearHelmUpdateIntent(sourceHelmKey);
      }
      return;
    }
    if (method === "approval/created") {
      applyApprovalCreated(params as any);
      return;
    }
    if (method === "approval/resolved") {
      applyApprovalResolved(params as any);
      return;
    }
    if (method === "debug/prompt_trace") {
      applyPromptTraceEvent(params as PromptTraceEvent);
      return;
    }
    if (method === "session/update") {
      const sessionUpdateParams = params as SessionUpdateParams;
      applyPromptTraceEvent(createDeckSessionUpdateTraceEvent(sessionUpdateParams, "deck.session_update.received"));
      const handledBySession = applySessionUpdate(sessionUpdateParams, sessionContext());
      const handled = handledBySession || applyActivityUpdate(sessionUpdateParams, activityContext());
      if (handled) {
        applyPromptTraceEvent(createDeckSessionUpdateTraceEvent(sessionUpdateParams, "deck.session_update.applied"));
      }
      return;
    }
    if (method === "error/raised") {
      applyErrorRaised(params as any, activityContext());
      return;
    }
    if (method === "notification/raised") {
      applyNotificationRaised(params as any, activityContext());
    }
  }

  return {
    mergeSessionToolCalls,
    handleServerEvent,
    handleRpcResult,
    handleRpcNotification,
  };
}
