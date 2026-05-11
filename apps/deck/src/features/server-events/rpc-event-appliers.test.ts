import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionSummary, TrustedDeviceSummary } from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyDeviceResult, applySessionResult, applySessionUpdate } from "./rpc-event-appliers.js";

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
    sessionAvailableCommands: {},
    agentAvailableCommands: {},
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

test("applyDeviceResult completes pending Helm add when auth-disabled sync reaches device/list", () => {
  resetStore();
  useDeckStore.setState({ pairingState: "paired" });
  const persistedProfiles: unknown[] = [];
  const localStorageWrites: Record<string, string> = {};
  const modalStates: boolean[] = [];
  const stages: string[] = [];
  const pendingAddHelmProfileRef = {
    current: {
      id: "phone-helm-192-168-1-9-47631",
      name: "Phone Helm",
      host: "192.168.1.9",
      port: "47631",
    },
  };

  const previousWindow = globalThis.window;
  (globalThis as any).window = {
    localStorage: {
      setItem(key: string, value: string) {
        localStorageWrites[key] = value;
      },
    },
  };

  try {
    const handled = applyDeviceResult("device/list", { devices: [] }, "192.168.1.9:47631", {
      primaryHelmKeyRef: { current: "192.168.1.9:47631" },
      daemonProfileKey: (host: string, port: string) => `${host}:${port}`,
      daemonHost: "localhost",
      daemonPort: "47631",
      defaultDaemonHost: "localhost",
      defaultDaemonPort: "47631",
      deckDeviceId: "deck-1",
      pendingAddHelmProfileRef,
      writeTrustedDeviceCache: () => undefined,
      persistDaemonProfile: (profile: unknown) => persistedProfiles.push(profile),
      daemonHostStorageKey: "tiller.daemon-host",
      daemonPortStorageKey: "tiller.daemon-port",
      setSelectedHelmKey: () => undefined,
      setFleetAddHelmModalOpen: (open: boolean) => modalStates.push(open),
      setFleetAddHelmStage: (stage: string) => stages.push(stage),
      autoConnectAttemptRef: { current: null },
      rpcClientRef: { current: null },
      requestInitialSync: () => undefined,
      readTrustedDeviceCache: () => null,
      clearTrustedDeviceCache: () => undefined,
    } as any);

    assert.equal(handled, true);
    assert.deepEqual(persistedProfiles, [{
      id: "phone-helm-192-168-1-9-47631",
      name: "Phone Helm",
      host: "192.168.1.9",
      port: "47631",
    }]);
    assert.equal(localStorageWrites["tiller.daemon-host"], "192.168.1.9");
    assert.equal(localStorageWrites["tiller.daemon-port"], "47631");
    assert.deepEqual(modalStates, [false]);
    assert.deepEqual(stages, ["connect"]);
    assert.equal(pendingAddHelmProfileRef.current, null);
  } finally {
    (globalThis as any).window = previousWindow;
  }
});

test("applySessionUpdate routes agent_message notifications into activity state without changing prompt metadata", () => {
  resetStore();
  useDeckStore.setState({
    sessions: [
      {
        ...session("s1"),
        messageCount: 1,
        lastMessagePreview: "用户输入的 Prompt",
      },
    ],
  });
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
  assert.equal(
    useDeckStore.getState().sessions[0]?.lastMessagePreview,
    "用户输入的 Prompt",
  );
});

test("applySessionUpdate caches available commands by session and agent", () => {
  resetStore();
  useDeckStore.setState({ sessions: [session("s1")] });

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "commands_available",
        commands: [{ name: "review" }, { name: "compact" }],
      },
    },
    {} as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionAvailableCommands.s1?.map((command) => command.name),
    ["review", "compact"],
  );
  assert.deepEqual(
    useDeckStore.getState().agentAvailableCommands.a1?.map((command) => command.name),
    ["review", "compact"],
  );
});

test("applySessionResult hydrates available commands from persisted session summaries", () => {
  resetStore();

  const handled = applySessionResult(
    "session/list",
    {
      sessions: [
        {
          ...session("s1"),
          availableCommands: [{ name: "review" }, { name: "compact" }],
        },
      ],
      hasMore: false,
    },
    "helm-1",
    true,
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      shouldAutoStartSessionResume: () => false,
      requestSessionResumeStart: () => undefined,
      setResumeFeedback: () => undefined,
      resumeStartRequestsRef: { current: new Set<string>() },
    } as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionAvailableCommands.s1?.map((command) => command.name),
    ["review", "compact"],
  );
  assert.deepEqual(
    useDeckStore.getState().agentAvailableCommands.a1?.map((command) => command.name),
    ["review", "compact"],
  );
});
