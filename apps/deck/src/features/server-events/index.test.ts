import assert from "node:assert/strict";
import test from "node:test";
import type { MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentToolCall,
  SessionSummary,
  SessionTimelineEntry,
  TrustedDeviceSummary,
} from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyActivityUpdate } from "./activity-events.js";
import { applyDeviceResult } from "./device-events.js";
import { applyInventoryResult } from "./inventory-events.js";
import { applySessionResult } from "./session-events.js";

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
    sessionTimeline: {},
    messageHistoryState: {},
    outputs: {},
    toolCalls: {},
    diffs: {},
    approvalItemsById: {},
    pendingApprovalIds: [],
    pendingApprovalIdsBySession: {},
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
    { sessionId: "s1", update: { kind: "agent_message", message, streaming: false } },
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

test("activity RPC notifications preserve and clear assistant streaming state", () => {
  resetStore();
  const streamingMessage: AgentMessage = {
    id: "m1",
    role: "assistant",
    text: "hel",
    timestamp: "2026-05-04T01:00:00.000Z",
  };
  const finalMessage: AgentMessage = {
    ...streamingMessage,
    text: "hello",
    timestamp: "2026-05-04T01:00:01.000Z",
  };

  applyActivityUpdate(
    { sessionId: "s1", update: { kind: "agent_message", message: streamingMessage, streaming: true } },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );
  applyActivityUpdate(
    { sessionId: "s1", update: { kind: "agent_message", message: finalMessage, streaming: false } },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(useDeckStore.getState().messages.s1?.[0]?.text, "hello");
  assert.equal(useDeckStore.getState().messages.s1?.[0]?.streaming, false);
});

test("streaming assistant chunks do not update session summary state", () => {
  resetStore();
  useDeckStore.setState({ sessions: [session("s1")] });

  applyActivityUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "agent_message",
        message: {
          id: "m1",
          role: "assistant",
          text: "hel",
          timestamp: "2026-05-04T01:00:00.000Z",
        } satisfies AgentMessage,
        streaming: true,
      },
    },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(
    useDeckStore.getState().sessions[0]?.updatedAt,
    "2026-05-04T00:00:00.000Z",
  );
});

test("live thinking tool calls update the chat tool-call store immediately", () => {
  resetStore();
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = { current: {} };
  const thinkingToolCall: AgentToolCall = {
    id: "think-live",
    kind: "think",
    title: "Thinking",
    status: "running",
    output: "实时 Thinking",
    timestamp: "2026-05-04T01:00:00.000Z",
    updatedAt: "2026-05-04T01:00:00.000Z",
  };

  const handled = applyActivityUpdate(
    { sessionId: "s1", update: { kind: "tool_call", toolCall: thinkingToolCall } },
    {
      toolCallsRef,
      mergeSessionToolCalls: (sessionId, incoming) => {
        useDeckStore.getState().setToolCalls((current) => {
          const next = {
            ...current,
            [sessionId]: [...(current[sessionId] ?? []), ...incoming],
          };
          toolCallsRef.current = next;
          return next;
        });
      },
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().toolCalls.s1, [thinkingToolCall]);
  assert.deepEqual(toolCallsRef.current.s1, [thinkingToolCall]);
});

test("settled regular tools keep their authoritative terminal status", () => {
  resetStore();
  const snapshots: AgentToolCall[] = [];
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  let scheduled = false;
  globalThis.requestAnimationFrame = (() => {
    scheduled = true;
    return 1;
  }) as typeof requestAnimationFrame;
  try {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const handled = applyActivityUpdate(
        {
          sessionId: "s1",
          update: {
            kind: "tool_call",
            toolCall: {
              id: `todo-live-${status}`,
              kind: "todo",
              title: "Update todos",
              status,
              timestamp: "2026-05-04T01:00:00.000Z",
              updatedAt: "2026-05-04T01:00:01.000Z",
            },
          },
        },
        {
          toolCallsRef: { current: {} },
          mergeSessionToolCalls: (_sessionId, incoming) => snapshots.push(...incoming),
          appendSystemMessage: () => undefined,
        },
      );

      assert.equal(handled, true);
    }

    assert.deepEqual(
      snapshots.map((toolCall) => toolCall.status),
      ["completed", "failed", "cancelled"],
    );
    assert.equal(scheduled, false);
  } finally {
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  }
});

test("settled subagent activity exposes a visible running state before its result", () => {
  resetStore();
  const snapshots: AgentToolCall[] = [];
  let settleSubagent: (() => void) | undefined;
  const subagentToolCall: AgentToolCall = {
    id: "subagent-live",
    kind: "subagent",
    title: "Explore repository",
    status: "completed",
    output: "探索完成",
    timestamp: "2026-05-04T01:00:00.000Z",
    updatedAt: "2026-05-04T01:00:01.000Z",
  };

  const handled = applyActivityUpdate(
    { sessionId: "s1", update: { kind: "tool_call", toolCall: subagentToolCall } },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: (_sessionId, incoming) => snapshots.push(...incoming),
      appendSystemMessage: () => undefined,
      scheduleSubagentSettlement: (callback) => {
        settleSubagent = callback;
      },
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(
    snapshots.map((toolCall) => toolCall.status),
    ["running"],
  );
  assert.equal(snapshots[0]?.output, undefined);

  assert.ok(settleSubagent);
  settleSubagent();
  assert.deepEqual(
    snapshots.map((toolCall) => toolCall.status),
    ["running", "completed"],
  );
  assert.equal(snapshots[1]?.output, "探索完成");
});

test("activity tool overlays keep canonical timeline untouched", () => {
  resetStore();
  const existingTimeline: SessionTimelineEntry[] = [
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1:content",
        kind: "content",
        text: "existing",
        timestamp: "2026-05-04T01:00:00.000Z",
        sequence: 1,
      }],
      timestamp: "2026-05-04T01:00:00.000Z",
      updatedAt: "2026-05-04T01:00:00.000Z",
      sequence: 1,
    },
  ];
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = { current: {} };
  useDeckStore.setState({
    sessionTimeline: { s1: existingTimeline },
  });

  const toolCall: AgentToolCall = {
    id: "tool-1",
    kind: "read",
    title: "Read",
    status: "running",
    timestamp: "2026-05-04T01:00:01.000Z",
    updatedAt: "2026-05-04T01:00:01.000Z",
    sequence: 2,
  };
  applyActivityUpdate(
    { sessionId: "s1", update: { kind: "tool_call", toolCall } },
    {
      toolCallsRef,
      mergeSessionToolCalls: (sessionId, incoming) => {
        useDeckStore.getState().setToolCalls((current) => {
          const next = {
            ...current,
            [sessionId]: [...(current[sessionId] ?? []), ...incoming],
          };
          toolCallsRef.current = next;
          return next;
        });
      },
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(useDeckStore.getState().sessionTimeline.s1, existingTimeline);
  assert.equal(useDeckStore.getState().outputs.s1, undefined);
  assert.equal(useDeckStore.getState().toolCalls.s1?.length, 1);
});

test("timeline refresh clears a stale live running tool overlay", () => {
  resetStore();
  const runningTool: AgentToolCall = {
    id: "todo-live",
    kind: "todo",
    title: "Update todos",
    status: "running",
    timestamp: "2026-07-19T14:12:45.768Z",
    updatedAt: "2026-07-19T14:12:45.768Z",
  };
  const completedTool: AgentToolCall = {
    ...runningTool,
    status: "completed",
    updatedAt: "2026-07-19T14:12:55.834Z",
  };
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = {
    current: { s1: [runningTool] },
  };
  useDeckStore.setState({ toolCalls: toolCallsRef.current });

  const handled = applySessionResult(
    "session/list_timeline",
    {
      sessionId: "s1",
      entries: [{
        id: "tool:todo-live",
        kind: "tool_call",
        toolCall: completedTool,
        timestamp: completedTool.timestamp,
        updatedAt: completedTool.updatedAt,
      }],
      hasMore: false,
    },
    "helm-1",
    true,
    { toolCallsRef } as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().toolCalls.s1, []);
  assert.deepEqual(toolCallsRef.current.s1, []);
  const timelineEntry = useDeckStore.getState().sessionTimeline.s1?.[0];
  assert.equal(
    timelineEntry?.kind === "tool_call"
      ? timelineEntry.toolCall.status
      : undefined,
    "completed",
  );
});

test("assistant message chunks clear active live thinking from the chat store", () => {
  resetStore();
  const liveThinking: AgentToolCall = {
    id: "think-live",
    kind: "think",
    title: "Thinking",
    status: "running",
    output: "实时 Thinking",
    timestamp: "2026-05-04T01:00:00.000Z",
    updatedAt: "2026-05-04T01:00:00.000Z",
  };
  const completedTool: AgentToolCall = {
    id: "tool-read",
    kind: "read",
    title: "Read",
    status: "completed",
    output: "file content",
    timestamp: "2026-05-04T01:00:01.000Z",
    updatedAt: "2026-05-04T01:00:01.000Z",
  };
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = {
    current: { s1: [liveThinking, completedTool] },
  };
  useDeckStore.setState({
    toolCalls: { s1: [liveThinking, completedTool] },
  });

  const handled = applyActivityUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "agent_message",
        message: {
          id: "m1",
          role: "assistant",
          text: "最终结论开始输出",
          timestamp: "2026-05-04T01:00:02.000Z",
        },
        streaming: true,
      },
    },
    {
      toolCallsRef,
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().toolCalls.s1, [completedTool]);
  assert.deepEqual(toolCallsRef.current.s1, [completedTool]);
});

test("session artifact refresh prunes active live thinking that is absent from the payload", () => {
  resetStore();
  const staleThinking: AgentToolCall = {
    id: "runtime-thinking:thinking",
    kind: "think",
    title: "Thinking",
    status: "running",
    output: "旧实时 Thinking",
    timestamp: "2026-05-04T01:00:00.000Z",
    updatedAt: "2026-05-04T01:00:00.000Z",
  };
  const authoritativeTool: AgentToolCall = {
    id: "tool-read",
    kind: "read",
    title: "Read",
    status: "completed",
    output: "file content",
    timestamp: "2026-05-04T01:00:01.000Z",
    updatedAt: "2026-05-04T01:00:01.000Z",
  };
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = {
    current: { s1: [staleThinking] },
  };
  useDeckStore.setState({
    toolCalls: { s1: [staleThinking] },
  });

  const handled = applySessionResult(
    "session/get_artifacts",
    {
      sessionId: "s1",
      outputs: [],
      diffs: [],
      toolCalls: [authoritativeTool],
      hasMore: false,
    },
    "helm-1",
    true,
    {
      toolCallsRef,
      mergeSessionToolCalls: (sessionId: string, incoming: AgentToolCall[]) => {
        useDeckStore.getState().setToolCalls((current) => {
          const existing = current[sessionId] ?? [];
          const nextSessionToolCalls = [
            ...existing,
            ...incoming.filter((toolCall: AgentToolCall) => !existing.some((item) => item.id === toolCall.id)),
          ];
          const next = {
            ...current,
            [sessionId]: nextSessionToolCalls,
          };
          toolCallsRef.current = next;
          return next;
        });
      },
      shouldAutoStartSessionResume: () => false,
      requestSessionResumeStart: () => undefined,
      setResumeFeedback: () => undefined,
      resumeStartRequestsRef: { current: new Set() },
    } as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().toolCalls.s1, [authoritativeTool]);
  assert.deepEqual(toolCallsRef.current.s1, [authoritativeTool]);
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
