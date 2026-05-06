import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionSummary, TrustedDeviceSummary } from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyDeviceResult, applySessionUpdate } from "./rpc-event-appliers.js";

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
    helmInventories: {},
    sessions: [],
    messages: {},
    trustedDevices: [],
  });
}

test("applyDeviceResult syncs device/list RPC results into the current helm", () => {
  resetStore();
  const device: TrustedDeviceSummary = {
    deviceId: "deck-1",
    deviceName: "Deck",
    clientKind: "web",
    createdAt: "2026-05-04T00:00:00.000Z",
    lastSeenAt: "2026-05-04T00:00:00.000Z",
    expiresAt: "2026-05-05T00:00:00.000Z",
  };

  const handled = applyDeviceResult("device/list", { devices: [device] }, "helm-1", {
    primaryHelmKeyRef: { current: "helm-1" },
    daemonProfileKey: (host: string, port: string) => `${host}:${port}`,
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
  } as any);

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().trustedDevices[0]?.deviceId, "deck-1");
});

test("applySessionUpdate routes agent_message notifications into activity state", () => {
  resetStore();
  useDeckStore.setState({ sessions: [session("s1")] });
  const message: AgentMessage = {
    id: "m1",
    role: "assistant",
    text: "hello from rpc",
    timestamp: "2026-05-04T01:00:00.000Z",
  };

  const handled = applySessionUpdate(
    { sessionId: "s1", update: { kind: "agent_message", message } },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    } as any,
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().messages.s1?.[0]?.text, "hello from rpc");
  assert.equal(useDeckStore.getState().sessions[0]?.messageCount, 1);
});
