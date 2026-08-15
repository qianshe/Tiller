// @ts-nocheck
import { useEffect } from "react";
import { useDeckStore } from "../../../store";
import { readTrustedDeviceCache } from "../../auth/beacon-cache";
import { useReconnectEffects } from "../../helm-connection/hooks/reconnect-effects";
import { useHelmLivenessProbe } from "../../helm-connection/hooks/liveness-effects";
import { usePromptAutosize } from "../hooks/prompt-autosize";
import { useSnapshotCache } from "../hooks/snapshot-cache";
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  IS_EMBEDDED_HELM_DECK,
} from "../../../shared/config/deck-runtime";
import { useMissionSelectionEffects } from "./mission-selection-effects";
import { buildMissionEffectsSource } from "./mission-effects-source";

export function useMissionEffects(ctx: any) {
  const source = buildMissionEffectsSource(ctx);
  const setHelmHealthStatus = useDeckStore((state) => state.setHelmHealthStatus);
  const {
    projects,
    pairingState,
    rpcClientRef,
    dispatch,
    activeView,
    chatMainRef,
    activeSessionId,
    stickChatToBottomRef,
    pendingSessionScrollToBottomRef,
    lastAutoScrollSessionIdRef,
    activeSessionMessages,
    activeConversationUpdateKey,
    messageHistoryState,
    sessionOpenScrollTick,
    setMessageHistoryState,
    setActivityHistoryState,
    missionPromptRef,
    imagePasteNotice,
    prompt,
    openChatSessionIds,
    promptImages,
    fleetAddHelmModalOpen,
    fleetAddHelmStage,
    connection,
    setFleetAddHelmStage,
    fleetProjectSaveMessage,
    setFleetProjectSaveMessage,
    setTrustedDevice,
    setTrustedDevices,
    daemonHost,
    daemonPort,
    activeProfileId,
    missionVisualMode,
    sessions,
    worktrees,
    agents,
    setProjects,
    setSessions,
    setWorktrees,
    setAgents,
    setStatuses,
    setActiveSessionId,
    sessionAvailableCommands,
    setSessionAvailableCommands,
    agentAvailableCommands,
    setAgentAvailableCommands,
    setResumeFeedback,
    trustedDevice,
    autoConnectAttemptRef,
    manualDisconnectRef,
    connectToDaemon,
  } = source;
useMissionSelectionEffects(source);
useEffect(() => {
  if (activeView !== "sessions") {
    return;
  }
  if ((openChatSessionIds?.length ?? 0) > 1) {
    return;
  }
  const chatMain = chatMainRef.current;
  if (!chatMain) {
    return;
  }
  requestAnimationFrame(() => {
    const sessionChanged =
      lastAutoScrollSessionIdRef.current !== activeSessionId;
    const shouldForceSessionBottom = Boolean(
      activeSessionId &&
        pendingSessionScrollToBottomRef.current === activeSessionId,
    );
    lastAutoScrollSessionIdRef.current = activeSessionId;
    if (
      !sessionChanged &&
      !shouldForceSessionBottom &&
      !stickChatToBottomRef.current
    ) {
      return;
    }
    chatMain.scrollTop = chatMain.scrollHeight;
    requestAnimationFrame(() => {
      chatMain.scrollTop = chatMain.scrollHeight;
    });
    if (
      shouldForceSessionBottom &&
      activeSessionId &&
      activeSessionMessages.length > 0 &&
      !messageHistoryState[activeSessionId]?.loading
    ) {
      pendingSessionScrollToBottomRef.current = null;
    }
  });
}, [
  activeConversationUpdateKey,
  activeView,
  activeSessionId,
  activeSessionMessages.length,
  openChatSessionIds?.length,
  messageHistoryState,
  sessionOpenScrollTick,
]);
usePromptAutosize({
  activeView,
  activeSessionId,
  imagePasteNotice,
  prompt,
  promptImageCount: promptImages.length,
  promptRef: missionPromptRef,
});
useEffect(() => {
  if (
    fleetAddHelmModalOpen &&
    fleetAddHelmStage === "connecting" &&
    connection === "connected"
  ) {
    setFleetAddHelmStage("pair");
  }
}, [connection, fleetAddHelmModalOpen, fleetAddHelmStage]);
useEffect(() => {
  if (
    !fleetProjectSaveMessage ||
    fleetProjectSaveMessage.startsWith("正在")
  ) {
    return;
  }
  const timer = window.setTimeout(() => setFleetProjectSaveMessage(""), 3600);
  return () => window.clearTimeout(timer);
}, [fleetProjectSaveMessage]);
useEffect(() => {
  setTrustedDevice(
    readTrustedDeviceCache(
      window.localStorage,
      daemonHost.trim() || DEFAULT_DAEMON_HOST,
      daemonPort.trim() || DEFAULT_DAEMON_PORT,
    ),
  );
  setTrustedDevices([]);
}, [daemonHost, daemonPort]);
useSnapshotCache({
  activeProfileId,
  missionVisualMode,
  pairingState,
  projects,
  sessions,
  worktrees,
  agents,
  activeSessionId,
  sessionAvailableCommands,
  agentAvailableCommands,
  setProjects,
  setSessions,
  setWorktrees,
  setAgents,
  setStatuses,
  setActiveSessionId,
  setSessionAvailableCommands,
  setAgentAvailableCommands,
});
useHelmLivenessProbe({
  connection,
  missionVisualMode,
  rpcClientRef,
});
useReconnectEffects({
  activeProfileId,
  activeView,
  connection,
  daemonHost,
  daemonPort,
  embedded: IS_EMBEDDED_HELM_DECK,
  missionVisualMode,
  tokenPresent: Boolean(trustedDevice?.token),
  autoConnectAttemptRef,
  manualDisconnectRef,
  connectToDaemon,
  setHelmHealthStatus,
});
}
