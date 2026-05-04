import assert from "node:assert/strict";
import test from "node:test";
import type { MutableRefObject } from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type {
  AgentMessage,
  AgentToolCall,
  SessionSummary,
  TrustedDeviceSummary,
} from "@tiller/shared";
import { useDeckStore } from "../../store";
import { handleActivityServerEvent } from "./activity-events.js";
import { handleDeviceServerEvent } from "./device-events.js";
import { handleInventoryServerEvent } from "./inventory-events.js";
import { handleSessionServerEvent } from "./session-events.js";

function session(id: string): SessionSummary {
  return {
    id,
    projectId: "p1",
    projectName: "Project",
    helmId: "h1",
    workspaceId: "w1",
    workspaceName: "Workspace",
    agentId: "a1",
    agentName: "Agent",
    status: "running",
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
    messageCount: 0,
  };
}

function resetStore() {
  useDeckStore.setState({
    agents: [],
    agentModelOptions: {},
    helms: [],
    helmInventories: {},
    projects: [],
    workspaces: [],
    sessions: [],
    statuses: {},
    messages: {},
    messageHistoryState: {},
    outputs: {},
    toolCalls: {},
    diffs: {},
    permissionRequests: {},
    trustedDevices: [],
    pairingFeedback: "",
  });
}

test("activity events append assistant messages and update session metadata", () => {
  resetStore();
  useDeckStore.setState({ sessions: [session("s1")] });
  const message: AgentMessage = {
    id: "m1",
    role: "assistant",
    text: "hello",
    timestamp: "2026-05-04T01:00:00.000Z",
  };

  const handled = handleActivityServerEvent(
    { type: "agent.message", sessionId: "s1", message },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().messages.s1?.[0]?.text, "hello");
  assert.equal(useDeckStore.getState().sessions[0]?.messageCount, 1);
});

test("device events sync trusted device inventory for the current helm", () => {
  resetStore();
  const device: TrustedDeviceSummary = {
    deviceId: "deck-1",
    deviceName: "Deck",
    clientKind: "web",
    createdAt: "2026-05-04T00:00:00.000Z",
    lastSeenAt: "2026-05-04T00:00:00.000Z",
    expiresAt: "2026-05-05T00:00:00.000Z",
  };

  const handled = handleDeviceServerEvent(
    { type: "device.list.result", requestId: "r1", devices: [device] },
    "127.0.0.1:47631",
    {
      primaryHelmKeyRef: { current: "127.0.0.1:47631" },
      daemonProfileKey: (host, port) => `${host}:${port}`,
      daemonHost: "127.0.0.1",
      daemonPort: "47631",
      defaultDaemonHost: "127.0.0.1",
      defaultDaemonPort: "47631",
      deckDeviceId: "deck-1",
      pendingAddHelmProfileRef: { current: null },
      writeTrustedDeviceCache: () => undefined,
      persistDaemonProfile: () => undefined,
      daemonHostStorageKey: "host",
      daemonPortStorageKey: "port",
      setSelectedHelmKey: () => undefined,
      setFleetAddHelmModalOpen: () => undefined,
      setFleetAddHelmStage: () => undefined,
      autoConnectAttemptRef: { current: null },
      socketRef: { current: null },
      requestInitialSync: () => undefined,
      readTrustedDeviceCache: () => null,
      clearTrustedDeviceCache: () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().trustedDevices[0]?.deviceId, "deck-1");
});

test("inventory events hydrate projects for the current helm", () => {
  resetStore();
  const handled = handleInventoryServerEvent(
    {
      type: "project.list.result",
      requestId: "r1",
      projects: [{ id: "p1", name: "Project", helmId: "h1" }],
    },
    "helm-1",
    true,
    {
      projectFilesKey: (projectId, workspaceId) =>
        `${projectId}:${workspaceId ?? ""}`,
      setProjectFilesByScope: () => undefined,
      setSelectedWorkspaceId: () => undefined,
      setWorktreePickerOpen: () => undefined,
      setAgentTestResult: () => undefined,
      agentModelOptionsKey: (providerId, workspaceId) =>
        `${providerId}:${workspaceId}`,
      writeAgentModelOptionsCache: () => undefined,
      selectedAgentId: null,
      selectedWorkspaceId: null,
      resolveModelOptions: () => [],
      resolvePreferredModel: (_current, options) => options[0],
      selectedModel: "provider-default",
      setSelectedModel: () => undefined,
      setSelectedAgentMode: () => undefined,
      setSelectedReasoningEffort: () => undefined,
      setConfigSaveMessage: () => undefined,
      setFleetProjectSaveMessage: () => undefined,
      setSelectedProjectId: () => undefined,
      socketRef: { current: null },
      helmSocketRefs: { current: new Map() },
      dispatch: () => undefined,
      nextRequestId: () => "r2",
      requestCounter: { current: 0 },
    },
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().projects[0]?.id, "p1");
});

test("session events apply session list results and prune scoped maps", () => {
  resetStore();
  useDeckStore.setState({
    messages: {
      stale: [{ id: "m", role: "assistant", text: "old", timestamp: "t" }],
    },
  });
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = {
    current: { stale: [] },
  };
  const dispatched: ClientToHelm[] = [];

  const handled = handleSessionServerEvent(
    {
      type: "session.list.result",
      requestId: "r1",
      sessions: [session("s1")],
      hasMore: false,
    },
    "helm-1",
    true,
    {
      setSelectedProjectId: () => undefined,
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      socketRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      createClientUserMessageId: () => "m1",
      appendUserMessage: () => undefined,
      dispatch: (_socket, payload) => {
        dispatched.push(payload);
      },
      nextRequestId: () => "r2",
      requestCounter: { current: 0 },
      toolCallsRef,
      mergeSessionToolCalls: () => undefined,
      shouldAutoStartSessionResume: () => false,
      requestSessionResumeStart: () => undefined,
      setResumeFeedback: () => undefined,
      resumeStartRequestsRef: { current: new Set() },
    },
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessions[0]?.id, "s1");
  assert.equal(useDeckStore.getState().messages.stale, undefined);
  assert.deepEqual(dispatched, []);
});
