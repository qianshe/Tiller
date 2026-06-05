// @ts-nocheck
import { useEffect } from "react";
import { readTrustedDeviceCache } from "../../auth/beacon-cache";
import { useReconnectEffects } from "../../helm-connection/hooks/reconnect-effects";
import { usePromptAutosize } from "../hooks/prompt-autosize";
import { useSnapshotCache } from "../hooks/snapshot-cache";
import { DEFAULT_ACTIVITY_PAGE_LIMIT, DEFAULT_MESSAGE_PAGE_LIMIT } from "../config";
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  IS_EMBEDDED_HELM_DECK,
} from "../../../shared/config/deck-runtime";
import { useMissionSelectionEffects } from "./mission-selection-effects";
import { buildMissionEffectsSource } from "./mission-effects-source";

export function useMissionEffects(ctx: any) {
  const source = buildMissionEffectsSource(ctx);
  const {
    projects,
    pairingState,
    rpcClientRef,
    dispatch,
    activeView,
    chatMainRef,
    preserveChatScrollRef,
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
    const preserve = preserveChatScrollRef.current;
    if (preserve) {
      chatMain.scrollTop =
        chatMain.scrollHeight - preserve.scrollHeight + preserve.scrollTop;
      preserveChatScrollRef.current = null;
      return;
    }
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
// Opening an old session is windowed: Deck asks Helm for the latest message/artifact
// page, then starts ACP resume separately. Restore replay is handled inside Helm and
// must not be treated as a replacement for these paged history requests.
useEffect(() => {
  if (
    !activeSessionId ||
    (openChatSessionIds?.length ?? 0) > 1 ||
    pairingState !== "paired" ||
    !rpcClientRef.current ||
    rpcClientRef.current.socket.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  setMessageHistoryState((current) => ({
    ...current,
    [activeSessionId]: { hasMore: false, loading: true },
  }));
  setActivityHistoryState((current) => ({
    ...current,
    [activeSessionId]: { hasMore: false, loading: true },
  }));
  void dispatch(rpcClientRef.current, "session/list_messages", {
    sessionId: activeSessionId,
    limit: DEFAULT_MESSAGE_PAGE_LIMIT,
  });
  void dispatch(rpcClientRef.current, "session/get_artifacts", {
    sessionId: activeSessionId,
    limit: DEFAULT_ACTIVITY_PAGE_LIMIT,
  });
  setResumeFeedback("正在检查 ACP 会话恢复能力...");
  void dispatch(rpcClientRef.current, "session/check_resume", {
    sessionId: activeSessionId,
  });
}, [activeSessionId, openChatSessionIds?.length, pairingState]);
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
});
}
