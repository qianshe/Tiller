import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionConfigOption, SessionSummary, TrustedDeviceSummary } from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyDeviceResult, applyInventoryResult, applySessionResult, applySessionUpdate } from "./rpc-event-appliers.js";

function session(id: string): SessionSummary {
  return {
    id,
    projectId: "p1",
    projectName: "Project",
    helmId: "h1",
    cwd: "D:/repo",
    worktreeName: "Worktree",
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
    sessionTimeline: {},
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

test("applySessionUpdate projects agent_message notifications into the unified timeline", () => {
  resetStore();
  const message: AgentMessage = {
    id: "m1",
    role: "assistant",
    text: "hello from rpc",
    timestamp: "2026-05-04T01:00:00.000Z",
    sequence: 2,
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
  const timeline = useDeckStore.getState().sessionTimeline.s1 ?? [];
  assert.deepEqual(timeline.map((entry) => entry.kind), ["assistant_message"]);
  assert.deepEqual(
    timeline[0]?.kind === "assistant_message"
      ? timeline[0].chunks.map((chunk) => chunk.kind)
      : [],
    ["content"],
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

test("applyInventoryResult replaces draft config options and clears reasoning when options omit it", () => {
  resetStore();
  const defaultModelOptions: SessionConfigOption[] = [
    {
      id: "model",
      category: "model",
      name: "Model",
      currentValue: "claude-opus-4-7",
      options: [
        { value: "claude-opus-4-7", label: "claude-opus-4-7" },
        { value: "claude-haiku-4-5", label: "claude-haiku-4-5" },
      ],
    },
    {
      id: "thought_level",
      category: "thought_level",
      name: "Reasoning",
      currentValue: "high",
      options: [{ value: "high", label: "High" }],
    },
  ];
  const haikuOptions: SessionConfigOption[] = [
    {
      id: "model",
      category: "model",
      name: "Model",
      currentValue: "claude-haiku-4-5",
      options: [{ value: "claude-haiku-4-5", label: "claude-haiku-4-5" }],
    },
  ];
  useDeckStore.getState().setAgentModelOptions({
    "claude::D:/repo::p1": {
      draftId: "draft-1",
      loading: false,
      modelOptions: [],
      configOptions: defaultModelOptions,
      state: { model: "claude-opus-4-7", reasoningEffort: "high" },
    },
  });

  const handled = applyInventoryResult(
    "session/configure",
    {
      draftId: "draft-1",
      state: { model: "claude-haiku-4-5" },
      options: haikuOptions,
    },
    "helm-1",
    true,
    {
      writeAgentModelOptionsCache: () => undefined,
      setSelectedModel: () => undefined,
      setSelectedAgentMode: () => undefined,
      setSelectedReasoningEffort: () => undefined,
    } as any,
  );

  const entry = useDeckStore.getState().agentModelOptions["claude::D:/repo::p1"];
  assert.equal(handled, true);
  assert.equal(entry?.configOptions[0]?.currentValue, "claude-haiku-4-5");
  assert.equal(entry?.state.model, "claude-haiku-4-5");
  assert.equal(entry?.state.reasoningEffort, undefined);
  assert.equal(
    entry?.configOptions.some((option) => option.category === "thought_level"),
    false,
  );
});

test("applyInventoryResult preserves haiku reasoning when ACP options expose it", () => {
  resetStore();
  const optionsWithReasoning: SessionConfigOption[] = [
    {
      id: "model",
      category: "model",
      name: "Model",
      currentValue: "opencode/haiku",
      options: [{ value: "opencode/haiku", label: "opencode/haiku" }],
    },
    {
      id: "thought_level",
      category: "thought_level",
      name: "Reasoning",
      currentValue: "medium",
      options: [{ value: "medium", label: "Medium" }],
    },
  ];
  useDeckStore.getState().setAgentModelOptions({
    "opencode::D:/repo::p1": {
      draftId: "draft-2",
      loading: false,
      modelOptions: [],
      configOptions: [],
      state: {},
    },
  });

  const handled = applyInventoryResult(
    "session/configure",
    {
      draftId: "draft-2",
      state: { model: "opencode/haiku" },
      options: optionsWithReasoning,
    },
    "helm-1",
    true,
    {
      writeAgentModelOptionsCache: () => undefined,
      setSelectedModel: () => undefined,
      setSelectedAgentMode: () => undefined,
      setSelectedReasoningEffort: () => undefined,
    } as any,
  );

  const entry = useDeckStore.getState().agentModelOptions["opencode::D:/repo::p1"];
  assert.equal(handled, true);
  assert.equal(entry?.state.model, "opencode/haiku");
  assert.equal(entry?.state.reasoningEffort, "medium");
  assert.equal(
    entry?.configOptions.some((option) => option.category === "thought_level"),
    true,
  );
});

test("applySessionUpdate refreshes ACP connection inventory on status changes", () => {
  resetStore();
  useDeckStore.setState({ sessions: [session("s1")] });
  const dispatched: Array<{ method: string; params: unknown }> = [];

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "status_change",
        status: "idle",
        message: "ACP prompt completed",
      },
    },
    {
      rpcClientRef: { current: { socket: { readyState: 1 } } },
      dispatch: (_client: unknown, method: string, params: unknown) => {
        dispatched.push({ method, params });
      },
    } as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(dispatched, [{ method: "agent/connections", params: {} }]);
});
