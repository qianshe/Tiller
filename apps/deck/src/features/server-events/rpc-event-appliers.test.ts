import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionConfigOption, SessionSummary, TrustedDeviceSummary } from "@tiller/shared";
import { useDeckStore } from "../../store";
import { toast } from "../toast";
import {
  applyDeviceResult,
  applyErrorRaised,
  applyNotificationRaised,
  applyNotificationCleared,
  applyNotificationResult,
  applyInventoryResult,
  applySessionResult,
  applySessionUpdate,
} from "./rpc-event-appliers.js";

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
  toast.clear();
  useDeckStore.setState({
    helmInventories: {},
    sessions: [],
    messages: {},
    sessionTimeline: {},
    notifications: [],
    notificationsClearedAt: null,
    trustedDevices: [],
    sessionAvailableCommands: {},
    agentAvailableCommands: {},
    focusedChatWindowId: null,
    completedUnreadSessionIds: {},
    acknowledgedSessionCompletionAt: {},
  });
}

test("applyErrorRaised records error context without prompt contents", () => {
  resetStore();
  useDeckStore.setState({ sessions: [session("s1")] });
  const systemMessages: Array<{ sessionId: string; text: string }> = [];

  const handled = applyErrorRaised(
    {
      sessionId: "s1",
      code: "ACP_PROMPT_FAILED",
      message: "ACP agent produced no prompt progress within 45000ms.",
    },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: (sessionId: string, text: string) => {
        systemMessages.push({ sessionId, text });
      },
      addNotification: (notification) => {
        useDeckStore.getState().addNotification(notification);
      },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(systemMessages, [{
    sessionId: "s1",
    text: "[ACP_PROMPT_FAILED] ACP agent produced no prompt progress within 45000ms.",
  }]);
  assert.deepEqual(useDeckStore.getState().notifications[0], {
    id: useDeckStore.getState().notifications[0]?.id,
    kind: "error",
    message: "ACP agent produced no prompt progress within 45000ms.",
    source: "rpc",
    code: "ACP_PROMPT_FAILED",
    sessionId: "s1",
    createdAt: useDeckStore.getState().notifications[0]?.createdAt,
  });
  assert.equal(useDeckStore.getState().sessions[0]?.status, "error");
  assert.match(useDeckStore.getState().sessions[0]?.lastMessagePreview ?? "", /ACP_PROMPT_FAILED/);
  assert.deepEqual(toast.getSnapshot().map((item) => ({ variant: item.variant, message: item.message })), [
    { variant: "error", message: "[ACP_PROMPT_FAILED] ACP agent produced no prompt progress within 45000ms." },
  ]);
});

test("applyNotificationRaised accepts non-error system notifications", () => {
  resetStore();
  const handled = applyNotificationRaised(
    {
      kind: "warning",
      source: "storage",
      code: "STORAGE_DEGRADED",
      message: "Storage is temporarily unavailable; new events remain in memory.",
      occurredAt: "2026-07-18T12:00:00.000Z",
    },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => {
        throw new Error("warning notifications are not conversation messages");
      },
      addNotification: (notification) => useDeckStore.getState().addNotification(notification),
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().notifications[0], {
    id: useDeckStore.getState().notifications[0]?.id,
    kind: "warning",
    source: "storage",
    code: "STORAGE_DEGRADED",
    message: "Storage is temporarily unavailable; new events remain in memory.",
    createdAt: "2026-07-18T12:00:00.000Z",
  });
  assert.deepEqual(toast.getSnapshot().map((item) => ({ variant: item.variant, message: item.message })), [
    { variant: "warning", message: "[STORAGE_DEGRADED] Storage is temporarily unavailable; new events remain in memory." },
  ]);
});

test("applyNotificationRaised surfaces info notifications as Toasts", () => {
  resetStore();
  const handled = applyNotificationRaised(
    {
      kind: "info",
      source: "session",
      code: "ACP_SESSION_RESTORED",
      message: "ACP session/load completed for this session.",
    },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
      addNotification: (notification) => useDeckStore.getState().addNotification(notification),
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(toast.getSnapshot().map((item) => ({ variant: item.variant, message: item.message })), [
    { variant: "info", message: "[ACP_SESSION_RESTORED] ACP session/load completed for this session." },
  ]);
});

test("applyNotificationResult hydrates persisted notifications without replaying Toasts", () => {
  resetStore();
  const handled = applyNotificationResult("notification/list", {
    notifications: [{
      id: "notification-1",
      kind: "warning",
      source: "storage",
      code: "STORAGE_DEGRADED",
      message: "Storage is temporarily unavailable.",
      occurredAt: "2026-07-18T12:00:00.000Z",
    }],
  });

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().notifications[0], {
    id: "notification-1",
    kind: "warning",
    source: "storage",
    code: "STORAGE_DEGRADED",
    message: "Storage is temporarily unavailable.",
    createdAt: "2026-07-18T12:00:00.000Z",
  });
  assert.deepEqual(toast.getSnapshot(), []);
});

test("notification clear events remove local history and preserve the server watermark", () => {
  resetStore();
  useDeckStore.getState().addNotification({
    kind: "warning",
    source: "storage",
    message: "Old notification",
    createdAt: "2026-07-18T12:00:00.000Z",
  });

  assert.equal(applyNotificationCleared({ clearedAt: "2026-08-15T00:00:00.000Z" }), true);
  assert.deepEqual(useDeckStore.getState().notifications, []);
  assert.equal(useDeckStore.getState().notificationsClearedAt, "2026-08-15T00:00:00.000Z");
  assert.equal(applyNotificationCleared({ clearedAt: "2026-08-14T00:00:00.000Z" }), true);
  assert.equal(useDeckStore.getState().notificationsClearedAt, "2026-08-15T00:00:00.000Z");
});

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

test("applySessionUpdate keeps agent_message notifications out of the canonical timeline", () => {
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
  assert.equal(useDeckStore.getState().messages.s1?.[0]?.text, "hello from rpc");
  assert.deepEqual(useDeckStore.getState().sessionTimeline.s1 ?? [], []);
});

test("applySessionUpdate marks an unfocused session when it completes", () => {
  resetStore();
  const runningSession = session("s1");
  useDeckStore.setState({
    sessions: [runningSession],
    statuses: { s1: "running" },
    focusedChatWindowId: null,
    completedUnreadSessionIds: {},
  } as any);

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "session_updated",
        session: {
          ...runningSession,
          status: "idle",
          updatedAt: "2026-05-04T01:00:00.000Z",
        },
      },
    },
    {
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      appendUserMessage: () => undefined,
    } as any,
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().statuses.s1, "idle");
  assert.equal(useDeckStore.getState().completedUnreadSessionIds.s1, true);
});

test("applySessionUpdate does not create completion unread state for a focused session", () => {
  resetStore();
  const runningSession = session("s1");
  useDeckStore.setState({
    sessions: [runningSession],
    statuses: { s1: "running" },
    focusedChatWindowId: "session:s1",
    completedUnreadSessionIds: {},
  } as any);

  applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "session_updated",
        session: {
          ...runningSession,
          status: "idle",
          updatedAt: "2026-05-04T01:00:00.000Z",
        },
      },
    },
    {
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      appendUserMessage: () => undefined,
    } as any,
  );

  assert.deepEqual(useDeckStore.getState().completedUnreadSessionIds, {});
});

test("applySessionUpdate clears completion unread state acknowledged by another device", () => {
  resetStore();
  const completedAt = "2026-05-04T01:00:00.000Z";
  const runningSession = {
    ...session("s1"),
    status: "running" as const,
    lastCompletedAt: completedAt,
  };
  useDeckStore.setState({
    sessions: [runningSession],
    statuses: { s1: "running" },
    completedUnreadSessionIds: { s1: true },
    focusedChatWindowId: null,
  } as any);

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "session_updated",
        session: {
          ...runningSession,
          status: "idle",
          completionAcknowledgedAt: completedAt,
          updatedAt: completedAt,
        },
      },
    },
    {
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      appendUserMessage: () => undefined,
    } as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().completedUnreadSessionIds, {});
  assert.equal(
    useDeckStore.getState().acknowledgedSessionCompletionAt.s1,
    completedAt,
  );
});

test("applySessionUpdate clears an existing idle completion marker acknowledged by another device", () => {
  resetStore();
  const completedAt = "2026-05-04T01:00:00.000Z";
  const completedSession = {
    ...session("s1"),
    status: "idle" as const,
    lastCompletedAt: completedAt,
  };
  useDeckStore.setState({
    sessions: [completedSession],
    statuses: { s1: "idle" },
    completedUnreadSessionIds: { s1: true },
    focusedChatWindowId: null,
  } as any);

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "session_updated",
        session: {
          ...completedSession,
          completionAcknowledgedAt: completedAt,
          updatedAt: completedAt,
        },
      },
    },
    {
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      appendUserMessage: () => undefined,
    } as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().completedUnreadSessionIds, {});
  assert.equal(
    useDeckStore.getState().acknowledgedSessionCompletionAt.s1,
    completedAt,
  );
});

test("applySessionUpdate caches canonical live-state commands by session and agent", () => {
  resetStore();
  useDeckStore.setState({ sessions: [session("s1")] });

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "live_state",
        snapshot: {
          sequence: 1,
          status: { effectiveStatus: "running", pendingApprovalCount: 0 },
          availableCommands: [{ name: "review" }, { name: "compact" }],
        },
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

test("applySessionResult restores an unread completion on a newly opened device", () => {
  resetStore();
  useDeckStore.setState({
    completedUnreadSessionIds: {},
    acknowledgedSessionCompletionAt: {},
  } as any);

  const completedSession = {
    ...session("s1"),
    status: "idle" as const,
    updatedAt: "2026-05-04T01:00:00.000Z",
    lastCompletedAt: "2026-05-04T01:00:00.000Z",
  };
  const handled = applySessionResult(
    "session/list",
    { sessions: [completedSession], hasMore: false },
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
  assert.equal(useDeckStore.getState().completedUnreadSessionIds.s1, true);
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

test("applySessionUpdate does not refresh ACP connection inventory on canonical status snapshots", () => {
  resetStore();
  useDeckStore.setState({ sessions: [session("s1")] });
  const dispatched: Array<{ method: string; params: unknown }> = [];

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "live_state",
        snapshot: {
          sequence: 1,
          status: { effectiveStatus: "idle", pendingApprovalCount: 0 },
        },
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
  assert.deepEqual(dispatched, []);
});
