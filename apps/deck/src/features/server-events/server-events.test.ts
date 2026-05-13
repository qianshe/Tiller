import assert from "node:assert/strict";
import test from "node:test";
import type { MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentToolCall,
  PermissionRequest,
  SessionSummary,
  TrustedDeviceSummary,
} from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyActivityUpdate } from "./activity-events.js";
import { applyDeviceResult } from "./device-events.js";
import { applyInventoryResult } from "./inventory-events.js";
import { applySessionResult, applySessionUpdate } from "./session-events.js";

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
    agents: [],
    agentModelOptions: {},
    helms: [],
    helmInventories: {},
    projects: [],
    worktrees: [],
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

test("activity RPC notifications append assistant messages without changing session prompt metadata", () => {
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
    text: "hello",
    timestamp: "2026-05-04T01:00:00.000Z",
  };

  const handled = applyActivityUpdate(
    { sessionId: "s1", update: { kind: "agent_message", message } },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().messages.s1?.[0]?.text, "hello");
  assert.equal(useDeckStore.getState().sessions[0]?.messageCount, 1);
  assert.equal(
    useDeckStore.getState().sessions[0]?.lastMessagePreview,
    "用户输入的 Prompt",
  );
});

test("permission resolved notifications clear pending permission requests", () => {
  resetStore();
  useDeckStore.setState({
    permissionRequests: {
      s1: {
        id: "permission-1",
        command: "Approve MCP tool call :: {}",
        reason: "等待审核",
        cwd: "D:/repo",
      },
    },
  });

  const handled = applyActivityUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "permission_resolved",
        permissionRequestId: "permission-1",
        decision: "allow",
      },
    },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().permissionRequests.s1, null);
});

test("device RPC results sync trusted device inventory for the current helm", () => {
  resetStore();
  const device: TrustedDeviceSummary = {
    deviceId: "deck-1",
    deviceName: "Deck",
    clientKind: "web",
    createdAt: "2026-05-04T00:00:00.000Z",
    lastSeenAt: "2026-05-04T00:00:00.000Z",
    expiresAt: "2026-05-05T00:00:00.000Z",
  };

  const handled = applyDeviceResult(
    "device/list",
    { devices: [device] },
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
      rpcClientRef: { current: null },
      requestInitialSync: () => undefined,
      readTrustedDeviceCache: () => null,
      clearTrustedDeviceCache: () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().trustedDevices[0]?.deviceId, "deck-1");
});

test("inventory RPC results hydrate projects for the current helm", () => {
  resetStore();
  const handled = applyInventoryResult(
    "project/list",
    { projects: [{ id: "p1", name: "Project", helmId: "h1" }] },
    "helm-1",
    true,
    {
      projectFilesKey: (projectId, worktreeId) => `${projectId}:${worktreeId ?? ""}`,
      setProjectFilesByScope: () => undefined,
      setSelectedCwd: () => undefined,
      setWorktreePickerOpen: () => undefined,
      setAgentTestResult: () => undefined,
      agentModelOptionsKey: (providerId, worktreeId) => `${providerId}:${worktreeId}`,
      writeAgentModelOptionsCache: () => undefined,
      selectedAgentId: null,
      selectedCwd: null,
      resolveModelOptions: () => [],
      resolvePreferredModel: (_current, options) => options[0],
      selectedModel: "provider-default",
      setSelectedModel: () => undefined,
      setSelectedAgentMode: () => undefined,
      setSelectedReasoningEffort: () => undefined,
      setConfigSaveMessage: () => undefined,
      setFleetProjectSaveMessage: () => undefined,
      setSelectedProjectId: () => undefined,
      rpcClientRef: { current: null },
      helmRpcClientRefs: { current: new Map() },
      dispatch: async () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().projects[0]?.id, "p1");
});

test("session draft result hydrates draft model options and commands", () => {
  resetStore();
  let cached: unknown;
  let selectedModel = "provider-default";
  const handled = applyInventoryResult(
    "session/draft",
    {
      ok: true,
      draftId: "draft-1",
      deckClientId: "deck-1",
      scopeKey: "deck-1:main:codex",
      logicalScopeKey: "main:codex",
      warmed: true,
      providerId: "codex",
      cwd: "main",
      runtimeSessionId: "runtime-1",
      currentModelId: "gpt-5.5",
      modelOptions: [{ id: "gpt-5.5", name: "GPT 5.5" }],
      configOptions: [],
      availableCommands: [{ name: "review" }, { name: "compact" }],
      state: { model: "gpt-5.5" },
      message: "ACP runtime prewarmed.",
    },
    "helm-1",
    true,
    {
      projectFilesKey: (projectId, worktreeId) => `${projectId}:${worktreeId ?? ""}`,
      setProjectFilesByScope: () => undefined,
      setSelectedCwd: () => undefined,
      setWorktreePickerOpen: () => undefined,
      setAgentTestResult: () => undefined,
      agentModelOptionsKey: (providerId, worktreeId) => `${providerId}:${worktreeId}`,
      writeAgentModelOptionsCache: (entries) => {
        cached = entries;
      },
      selectedAgentId: "codex",
      selectedCwd: "main",
      resolveModelOptions: (currentModel) => currentModel ? [currentModel] : [],
      resolvePreferredModel: (_current, options) => options[0],
      selectedModel,
      setSelectedModel: (model) => {
        selectedModel = model;
      },
      setSelectedAgentMode: () => undefined,
      setSelectedReasoningEffort: () => undefined,
      setConfigSaveMessage: () => undefined,
      setFleetProjectSaveMessage: () => undefined,
      setSelectedProjectId: () => undefined,
      rpcClientRef: { current: null },
      helmRpcClientRefs: { current: new Map() },
      dispatch: async () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.equal(selectedModel, "gpt-5.5");
  assert.deepEqual(useDeckStore.getState().agentModelOptions["codex:main"], {
    loading: false,
    warmed: true,
    projectId: undefined,
    draftId: "draft-1",
    deckClientId: "deck-1",
    scopeKey: "deck-1:main:codex",
    logicalScopeKey: "main:codex",
    runtimeSessionId: "runtime-1",
    message: "ACP runtime prewarmed.",
    modelOptions: [{ id: "gpt-5.5", name: "GPT 5.5" }],
    configOptions: [],
    state: { model: "gpt-5.5" },
  });
  assert.deepEqual(
    useDeckStore.getState().agentAvailableCommands.codex?.map((command) => command.name),
    ["review", "compact"],
  );
  assert.deepEqual(cached, useDeckStore.getState().agentModelOptions);
});

test("session draft result merges with an existing project scoped model options entry", () => {
  resetStore();
  useDeckStore.getState().setAgentModelOptions({
    "opencode::main::project-2": {
      loading: false,
      warmed: true,
      projectId: "project-2",
      runtimeSessionId: undefined,
      message: "Model options loaded.",
      modelOptions: [{ id: "cpa-oai/gpt-5.5", name: "GPT 5.5" }],
      configOptions: [{ id: "model", label: "Model", type: "string" } as any],
      state: { model: "cpa-oai/gpt-5.5" },
    },
  });

  let cached: unknown;
  const handled = applyInventoryResult(
    "session/draft",
    {
      ok: true,
      draftId: "draft-1",
      deckClientId: "deck-1",
      scopeKey: "deck-1:main:opencode",
      logicalScopeKey: "main:opencode",
      warmed: true,
      providerId: "opencode",
      cwd: "main",
      runtimeSessionId: "runtime-warm-1",
      currentModelId: "cpa-oai/gpt-5.5",
      modelOptions: [],
      configOptions: [],
      state: {},
      message: "ACP runtime prewarmed.",
    },
    "helm-1",
    true,
    {
      projectFilesKey: (projectId, worktreeId) => `${projectId}:${worktreeId ?? ""}`,
      setProjectFilesByScope: () => undefined,
      setSelectedCwd: () => undefined,
      setWorktreePickerOpen: () => undefined,
      setAgentTestResult: () => undefined,
      agentModelOptionsKey: (providerId, worktreeId, projectId) =>
        projectId ? `${providerId}::${worktreeId}::${projectId}` : `${providerId}::${worktreeId}`,
      writeAgentModelOptionsCache: (entries) => {
        cached = entries;
      },
      selectedAgentId: "opencode",
      selectedCwd: "main",
      resolveModelOptions: (currentModel) => currentModel ? [currentModel] : [],
      resolvePreferredModel: (_current, options) => options[0],
      selectedModel: "cpa-oai/gpt-5.5",
      setSelectedModel: () => undefined,
      setSelectedAgentMode: () => undefined,
      setSelectedReasoningEffort: () => undefined,
      setConfigSaveMessage: () => undefined,
      setFleetProjectSaveMessage: () => undefined,
      setSelectedProjectId: () => undefined,
      rpcClientRef: { current: null },
      helmRpcClientRefs: { current: new Map() },
      dispatch: async () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().agentModelOptions, {
    "opencode::main::project-2": {
      loading: false,
      warmed: true,
      projectId: "project-2",
      draftId: "draft-1",
      deckClientId: "deck-1",
      scopeKey: "deck-1:main:opencode",
      logicalScopeKey: "main:opencode",
      runtimeSessionId: "runtime-warm-1",
      message: "ACP runtime prewarmed.",
      modelOptions: [{ id: "cpa-oai/gpt-5.5", name: "GPT 5.5" }],
      configOptions: [{ id: "model", label: "Model", type: "string" }],
      state: { model: "cpa-oai/gpt-5.5" },
    },
  });
  assert.deepEqual(cached, useDeckStore.getState().agentModelOptions);
});


test("starting session update activates chat and preserves first pending prompt", () => {
  resetStore();
  const pendingPromptRef: MutableRefObject<string | null> = { current: "你好" };
  const pendingPromptContentRef: MutableRefObject<any[] | undefined> = {
    current: [{ type: "text", text: "你好" }],
  };
  const dispatched: Array<{ method: string; params: any }> = [];
  const context = {
    setSelectedProjectId: () => undefined,
    pendingPromptRef,
    pendingPromptContentRef,
    rpcClientRef: { current: {} as any },
    assignSessionTitleFromPrompt: () => undefined,
    createClientUserMessageId: () => "unused",
    appendUserMessage: (sessionId: string, text: string, id: string) => {
      const current = useDeckStore.getState().messages;
      const messages = current[sessionId] ?? [];
      if (messages.some((message) => message.id === id)) {
        return;
      }
      useDeckStore.setState({
        messages: {
          ...current,
          [sessionId]: [
            ...messages,
            { id, role: "user", text, timestamp: "2026-05-04T00:00:00.000Z" },
          ],
        },
      });
    },
    dispatch: async (_client: any, method: string, params: any) => {
      dispatched.push({ method, params });
    },
    toolCallsRef: { current: {} },
    mergeSessionToolCalls: () => undefined,
    shouldAutoStartSessionResume: () => false,
    requestSessionResumeStart: () => undefined,
    setResumeFeedback: () => undefined,
    resumeStartRequestsRef: { current: new Set<string>() },
  };

  const starting = { ...session("s1"), status: "starting" as const };
  const updateHandled = applySessionUpdate(
    { sessionId: "s1", update: { kind: "session_updated", session: starting } },
    context,
  );

  assert.equal(updateHandled, true);
  assert.equal(useDeckStore.getState().activeSessionId, "s1");
  assert.equal(useDeckStore.getState().messages.s1?.[0]?.text, "你好");
  assert.equal(useDeckStore.getState().messages.s1?.[0]?.id, "s1-user-pending");

  const resultHandled = applySessionResult(
    "session/new",
    { session: { ...starting, status: "idle" as const, runtimeSessionId: "remote-s1" } },
    "helm-1",
    true,
    context,
  );

  assert.equal(resultHandled, true);
  assert.equal(useDeckStore.getState().messages.s1?.length, 1);
  assert.equal(pendingPromptRef.current, null);
  assert.equal(dispatched[0]?.method, "session/prompt");
  assert.equal(dispatched[0]?.params.clientMessageId, "s1-user-pending");
});

test("session RPC results apply session list results and prune scoped maps", () => {
  resetStore();
  useDeckStore.setState({
    messages: { stale: [{ id: "m", role: "assistant", text: "old", timestamp: "t" }] },
  });
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = {
    current: { stale: [] },
  };
  const dispatched: string[] = [];

  const handled = applySessionResult(
    "session/list",
    {
      sessions: [session("s1")],
      hasMore: false,
    },
    "helm-1",
    true,
    {
      setSelectedProjectId: () => undefined,
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      createClientUserMessageId: () => "m1",
      appendUserMessage: () => undefined,
      dispatch: async (_client, method) => {
        dispatched.push(method);
      },
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

test("session RPC results hydrate config options from listed sessions", () => {
  resetStore();
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = {
    current: {},
  };
  const configOptions = [
    {
      id: "permission-mode",
      name: "Permission Mode",
      category: "mode",
      currentValue: "bypassPermissions",
      options: [{ value: "bypassPermissions", label: "Bypass Permissions" }],
    },
  ];

  const handled = applySessionResult(
    "session/list",
    {
      sessions: [{ ...session("s1"), configOptions }],
      hasMore: false,
    },
    "helm-1",
    true,
    {
      setSelectedProjectId: () => undefined,
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      createClientUserMessageId: () => "m1",
      appendUserMessage: () => undefined,
      dispatch: async () => undefined,
      toolCallsRef,
      mergeSessionToolCalls: () => undefined,
      shouldAutoStartSessionResume: () => false,
      requestSessionResumeStart: () => undefined,
      setResumeFeedback: () => undefined,
      resumeStartRequestsRef: { current: new Set() },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().sessionConfigOptions.s1, configOptions);
});

test("session check resume auto starts provider restore", () => {
  resetStore();
  let requested: { sessionId: string; reason: string } | null = null;
  useDeckStore.setState({ sessions: [session("s1")] });

  const handled = applySessionResult(
    "session/check_resume",
    {
      sessionId: "s1",
      resume: {
        state: "resume-available",
        mode: "reconnect",
        restoreMethod: "session/load",
        runtimeSessionId: "runtime-s1",
        reason: "ACP agent advertises session/load; Helm can try agent-side restore and history replay.",
      },
    },
    "helm-1",
    true,
    {
      setSelectedProjectId: () => undefined,
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: { socket: { readyState: 1 } } as any },
      assignSessionTitleFromPrompt: () => undefined,
      createClientUserMessageId: () => "m1",
      appendUserMessage: () => undefined,
      dispatch: async () => undefined,
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      shouldAutoStartSessionResume: (session: any) => session.resume?.state === "resume-available",
      requestSessionResumeStart: (sessionId: string, reason: string) => {
        requested = { sessionId, reason };
      },
      setResumeFeedback: () => undefined,
      resumeStartRequestsRef: { current: new Set<string>() },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(requested, {
    sessionId: "s1",
    reason: "检测到历史任务可恢复，正在自动重连 ACP 会话...",
  });
});

test("successful session resume clears the pending restore request", () => {
  resetStore();
  const pendingRequests = new Set<string>(["s1"]);
  let feedback = "";
  const dispatched: string[] = [];
  useDeckStore.setState({ sessions: [session("s1")] });

  const handled = applySessionResult(
    "session/resume",
    {
      sessionId: "s1",
      ok: true,
      message: "已恢复",
      resume: {
        state: "resume-available",
        mode: "same-process",
        restoreMethod: "client-reconnect",
        runtimeSessionId: "runtime-s1",
      },
    },
    "helm-1",
    true,
    {
      setSelectedProjectId: () => undefined,
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: { socket: { readyState: 1 } } as any },
      assignSessionTitleFromPrompt: () => undefined,
      createClientUserMessageId: () => "m1",
      appendUserMessage: () => undefined,
      dispatch: async (_client, method) => {
        dispatched.push(method);
      },
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      shouldAutoStartSessionResume: () => false,
      requestSessionResumeStart: () => undefined,
      setResumeFeedback: (value: string) => {
        feedback = value;
      },
      resumeStartRequestsRef: { current: pendingRequests },
    },
  );

  assert.equal(handled, true);
  assert.equal(pendingRequests.has("s1"), false);
  assert.equal(feedback, "已恢复");
  assert.equal(useDeckStore.getState().sessions[0]?.runtimeSessionId, "runtime-s1");
  assert.deepEqual(dispatched, ["agent/connections"]);
});

test("failed session resume marks stale available metadata as unavailable", () => {
  resetStore();
  const pendingRequests = new Set<string>(["s1"]);
  let feedback = "";
  useDeckStore.setState({ sessions: [session("s1")] });

  const handled = applySessionResult(
    "session/resume",
    {
      sessionId: "s1",
      ok: false,
      message: "Worktree worktree-1 is not configured.",
      resume: {
        state: "resume-available",
        mode: "reconnect",
        restoreMethod: "session/load",
        runtimeSessionId: "runtime-s1",
        reason: "ACP agent advertises session/load; Helm can try agent-side restore and history replay.",
      },
    },
    "helm-1",
    true,
    {
      setSelectedProjectId: () => undefined,
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: { socket: { readyState: 1 } } as any },
      assignSessionTitleFromPrompt: () => undefined,
      createClientUserMessageId: () => "m1",
      appendUserMessage: () => undefined,
      dispatch: async () => undefined,
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      shouldAutoStartSessionResume: () => false,
      requestSessionResumeStart: () => undefined,
      setResumeFeedback: (value: string) => {
        feedback = value;
      },
      resumeStartRequestsRef: { current: pendingRequests },
    },
  );

  assert.equal(handled, true);
  assert.equal(pendingRequests.has("s1"), false);
  assert.equal(feedback, "Worktree worktree-1 is not configured.");
  assert.equal(useDeckStore.getState().sessions[0]?.resume?.state, "resume-unavailable");
  assert.equal(
    useDeckStore.getState().sessions[0]?.resume?.reason,
    "Worktree worktree-1 is not configured.",
  );
});

test("permission list results hydrate pending permission requests", () => {
  resetStore();
  const request: PermissionRequest = {
    id: "permission-1",
    command: "Approve MCP tool call :: {}",
    reason: "需要审核工具调用",
    cwd: "D:/repo",
  };

  const handled = applySessionResult(
    "permission/list_pending",
    { permissions: [{ sessionId: "s1", request }] },
    "helm-1",
    true,
    {
      setSelectedProjectId: () => undefined,
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      createClientUserMessageId: () => "m1",
      appendUserMessage: () => undefined,
      dispatch: async () => undefined,
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      shouldAutoStartSessionResume: () => false,
      requestSessionResumeStart: () => undefined,
      setResumeFeedback: () => undefined,
      resumeStartRequestsRef: { current: new Set() },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().permissionRequests, {
    s1: request,
  });
});

test("empty permission list clears stale pending permission requests", () => {
  resetStore();
  useDeckStore.setState({
    permissionRequests: {
      s1: {
        id: "permission-1",
        command: "Approve MCP tool call :: {}",
        reason: "已过期的审核请求",
        cwd: "D:/repo",
      },
    },
  });

  const handled = applySessionResult(
    "permission/list_pending",
    { permissions: [] },
    "helm-1",
    true,
    {
      setSelectedProjectId: () => undefined,
      pendingPromptRef: { current: null },
      pendingPromptContentRef: { current: undefined },
      rpcClientRef: { current: null },
      assignSessionTitleFromPrompt: () => undefined,
      createClientUserMessageId: () => "m1",
      appendUserMessage: () => undefined,
      dispatch: async () => undefined,
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      shouldAutoStartSessionResume: () => false,
      requestSessionResumeStart: () => undefined,
      setResumeFeedback: () => undefined,
      resumeStartRequestsRef: { current: new Set() },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().permissionRequests, {});
});
