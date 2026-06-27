import assert from "node:assert/strict";
import test from "node:test";
import type { MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  PermissionRequest,
  SessionConfigOption,
  SessionSummary,
  SessionTimelineEntry,
  TrustedDeviceSummary,
} from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyActivityUpdate } from "./activity-events.js";
import { applyApprovalResolved } from "./approval-events.js";
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
    sessionTimeline: {},
    messageHistoryState: {},
    outputs: {},
    toolCalls: {},
    sessionPlans: {},
    diffs: {},
    activityHistoryState: {},
    approvalItemsById: {},
    pendingApprovalIds: [],
    pendingApprovalIdsBySession: {},
    approvalToastQueue: [],
    trustedDevices: [],
    pairingFeedback: "",
    transcriptStatusBySession: {},
  } as any);
}

function createSessionEventContext(overrides: Record<string, unknown> = {}) {
  return {
    setSelectedProjectId: () => undefined,
    pendingPromptRef: { current: null },
    pendingPromptContentRef: { current: undefined },
    rpcClientRef: { current: null },
    assignSessionTitleFromPrompt: () => undefined,
    createClientUserMessageId: (sessionId: string) => `${sessionId}-user-pending`,
    appendUserMessage: () => undefined,
    dispatch: async () => undefined,
    toolCallsRef: { current: {} },
    mergeSessionToolCalls: () => undefined,
    shouldAutoStartSessionResume: () => false,
    requestSessionResumeStart: () => undefined,
    setResumeFeedback: () => undefined,
    resumeStartRequestsRef: { current: new Set<string>() },
    ...overrides,
  };
}

test("session prompt results preserve the selected model when the incoming summary omits it", () => {
  resetStore();
  useDeckStore.setState({
    sessions: [{ ...session("s1"), model: "gpt-5.5", reasoningEffort: "high" }],
  });

  const handled = applySessionResult(
    "session/prompt",
    { session: { ...session("s1"), status: "idle" as const } },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessions[0]?.model, "gpt-5.5");
  assert.equal(useDeckStore.getState().sessions[0]?.reasoningEffort, "high");
});

test("session creation results refresh ACP connection inventory when runtime is ready", () => {
  resetStore();
  const dispatched: string[] = [];

  const handled = applySessionResult(
    "session/new",
    { session: { ...session("s1"), runtimeSessionId: "runtime-s1" } },
    "helm-1",
    true,
    createSessionEventContext({
      rpcClientRef: { current: { socket: { readyState: 1 } } },
      dispatch: async (_client: unknown, method: string) => {
        dispatched.push(method);
      },
    }),
  );

  assert.equal(handled, true);
  assert.deepEqual(dispatched, ["agent/connections"]);
});

test("session/list_messages replaces initial loaded history instead of mixing with local fragments", () => {
  resetStore();
  const localFragment: AgentMessage = {
    id: "session-1-msg-s0",
    role: "assistant",
    text: "本地 thinking replay 片段",
    timestamp: "2026-05-17T10:00:00.000Z",
  };
  const loadedHistory: AgentMessage = {
    id: "provider-1#p0",
    role: "assistant",
    text: "服务端历史消息",
    timestamp: "2026-05-17T10:01:00.000Z",
  };
  useDeckStore.setState({
    messages: { "session-1": [localFragment] },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [loadedHistory],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().messages["session-1"], [loadedHistory]);
});

test("session/list_messages replaces initial timeline instead of mixing stale entries", () => {
  resetStore();
  const staleEntry: SessionTimelineEntry = {
    id: "stale-assistant",
    kind: "assistant_message",
    chunks: [
      {
        id: "stale-assistant:content",
        kind: "content",
        text: "刷新前残留回复",
        timestamp: "2026-05-17T09:59:00.000Z",
      },
    ],
    timestamp: "2026-05-17T09:59:00.000Z",
    updatedAt: "2026-05-17T09:59:00.000Z",
  };
  const loadedEntry: SessionTimelineEntry = {
    id: "loaded-assistant",
    kind: "assistant_message",
    chunks: [
      {
        id: "loaded-assistant:content",
        kind: "content",
        text: "刷新后权威回复",
        timestamp: "2026-05-17T10:01:00.000Z",
      },
    ],
    timestamp: "2026-05-17T10:01:00.000Z",
    updatedAt: "2026-05-17T10:01:00.000Z",
  };
  useDeckStore.setState({
    sessionTimeline: { "session-1": [staleEntry] },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [],
      timeline: [loadedEntry],
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionTimeline["session-1"]?.map((entry) => entry.id),
    ["loaded-assistant"],
  );
});

test("session/list_messages keeps artifact tool calls when initial history returns late", () => {
  resetStore();
  const loadedEntry: SessionTimelineEntry = {
    id: "loaded-assistant",
    kind: "assistant_message",
    chunks: [
      {
        id: "loaded-assistant:content",
        kind: "content",
        text: "服务端历史回复",
        timestamp: "2026-05-17T10:00:00.000Z",
        timelineSequence: 1,
      },
    ],
    timestamp: "2026-05-17T10:00:00.000Z",
    updatedAt: "2026-05-17T10:00:00.000Z",
    timelineSequence: 1,
  };
  const artifactToolCall: SessionTimelineEntry = {
    id: "tool:call-1",
    kind: "tool_call",
    toolCall: {
      id: "call-1",
      kind: "shell",
      title: "Shell",
      status: "completed",
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
      timelineSequence: 2,
    },
    timestamp: "2026-05-17T10:00:01.000Z",
    updatedAt: "2026-05-17T10:00:01.000Z",
    timelineSequence: 2,
  };
  useDeckStore.setState({
    sessionTimeline: { "session-1": [loadedEntry, artifactToolCall] },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [],
      timeline: [loadedEntry],
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionTimeline["session-1"]?.map((entry) => entry.id),
    ["loaded-assistant", "tool:call-1"],
  );
});

test("session/get_artifacts keeps existing timeline reference for unchanged tool calls", () => {
  resetStore();
  const toolCall: AgentToolCall = {
    id: "call-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    output: "stdout",
    timestamp: "2026-05-17T10:00:01.000Z",
    updatedAt: "2026-05-17T10:00:01.000Z",
    timelineSequence: 2,
  };
  const existingTimeline: SessionTimelineEntry[] = [{
    id: "tool:call-1",
    kind: "tool_call",
    toolCall,
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    timelineSequence: toolCall.timelineSequence,
  }];
  useDeckStore.setState({
    sessionTimeline: { "session-1": existingTimeline },
  });

  const handled = applySessionResult(
    "session/get_artifacts",
    {
      sessionId: "session-1",
      outputs: [],
      diffs: [],
      toolCalls: [toolCall],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessionTimeline["session-1"], existingTimeline);
});

test("session/get_artifacts waits for initial history before projecting tool calls", () => {
  resetStore();
  const toolCall: AgentToolCall = {
    id: "call-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    output: "stdout",
    timestamp: "2026-05-17T10:00:01.000Z",
    updatedAt: "2026-05-17T10:00:01.000Z",
    timelineSequence: 2,
  };
  useDeckStore.setState({
    messageHistoryState: {
      "session-1": { loading: true, hasMore: false },
    },
  });

  const handled = applySessionResult(
    "session/get_artifacts",
    {
      sessionId: "session-1",
      outputs: [],
      diffs: [],
      toolCalls: [toolCall],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessionTimeline["session-1"], undefined);
});

test("session/list_messages preserves richer cached tool metadata", () => {
  resetStore();
  const richToolCall: AgentToolCall = {
    id: "call-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    output: "stdout",
    timestamp: "2026-05-17T10:00:01.000Z",
    updatedAt: "2026-05-17T10:00:01.000Z",
    timelineSequence: 2,
  };
  const rawToolCall: AgentToolCall = {
    ...richToolCall,
    kind: "tool",
    title: "Tool call call-1",
  };
  useDeckStore.setState({
    sessionTimeline: {
      "session-1": [{
        id: "tool:call-1",
        kind: "tool_call",
        toolCall: richToolCall,
        timestamp: richToolCall.timestamp,
        updatedAt: richToolCall.updatedAt,
        timelineSequence: richToolCall.timelineSequence,
      }],
    },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [],
      timeline: [{
        id: "tool:call-1",
        kind: "tool_call",
        toolCall: rawToolCall,
        timestamp: rawToolCall.timestamp,
        updatedAt: rawToolCall.updatedAt,
        timelineSequence: rawToolCall.timelineSequence,
      }],
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  const [entry] = useDeckStore.getState().sessionTimeline["session-1"] ?? [];

  assert.equal(handled, true);
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.kind : undefined, "shell");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.title : undefined, "Shell");
});

test("session/list_messages lets richer running tool metadata reopen a stale completed row", () => {
  resetStore();
  const currentToolCall: AgentToolCall = {
    id: "call-1",
    kind: "tool",
    title: "Tool call call-1",
    status: "completed",
    timestamp: "2026-06-20T10:00:01.000Z",
    updatedAt: "2026-06-20T10:00:01.000Z",
    timelineSequence: 2,
  };
  const incomingToolCall: AgentToolCall = {
    ...currentToolCall,
    kind: "write",
    title: "Write",
    status: "running",
    updatedAt: "2026-06-20T10:00:02.000Z",
    input: JSON.stringify({
      file_path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
    }),
  };

  useDeckStore.setState({
    sessionTimeline: {
      "session-1": [{
        id: "tool:call-1",
        kind: "tool_call",
        toolCall: currentToolCall,
        timestamp: currentToolCall.timestamp,
        updatedAt: currentToolCall.updatedAt,
        timelineSequence: currentToolCall.timelineSequence,
      }],
    },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [],
      timeline: [{
        id: "tool:call-1",
        kind: "tool_call",
        toolCall: incomingToolCall,
        timestamp: incomingToolCall.timestamp,
        updatedAt: incomingToolCall.updatedAt,
        timelineSequence: incomingToolCall.timelineSequence,
      }],
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  const [entry] = useDeckStore.getState().sessionTimeline["session-1"] ?? [];

  assert.equal(handled, true);
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.status : undefined, "running");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.kind : undefined, "write");
  assert.equal(
    entry?.kind === "tool_call" ? entry.toolCall.input : undefined,
    JSON.stringify({
      file_path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
    }),
  );
});

test("session/list_messages keeps richer split timeline when equivalent coarse history arrives later", () => {
  resetStore();
  const toolCall: AgentToolCall = {
    id: "call-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    timestamp: "2026-05-17T10:00:02.000Z",
    updatedAt: "2026-05-17T10:00:02.000Z",
    timelineSequence: 3,
  };
  const splitTimeline: SessionTimelineEntry[] = [
    {
      id: "user-1",
      kind: "user_message",
      message: {
        id: "user-1",
        role: "user",
        text: "开始",
        timestamp: "2026-05-17T10:00:00.000Z",
        timelineSequence: 1,
      },
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      timelineSequence: 1,
    },
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1:content",
        kind: "content",
        text: "先检查。",
        timestamp: "2026-05-17T10:00:01.000Z",
        timelineSequence: 2,
      }],
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
      timelineSequence: 2,
    },
    {
      id: "tool:call-1",
      kind: "tool_call",
      toolCall,
      timestamp: "2026-05-17T10:00:02.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
      timelineSequence: 3,
    },
    {
      id: "assistant-1#p1",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1:content:4",
        kind: "content",
        text: "再总结。",
        timestamp: "2026-05-17T10:00:03.000Z",
        timelineSequence: 4,
      }],
      timestamp: "2026-05-17T10:00:03.000Z",
      updatedAt: "2026-05-17T10:00:03.000Z",
      timelineSequence: 4,
    },
  ];
  const coarseTimeline: SessionTimelineEntry[] = [
    splitTimeline[0]!,
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        ...(splitTimeline[1]!.kind === "assistant_message" ? splitTimeline[1]!.chunks : []),
        ...(splitTimeline[3]!.kind === "assistant_message" ? splitTimeline[3]!.chunks : []),
      ],
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:03.000Z",
      timelineSequence: 2,
    },
    splitTimeline[2]!,
  ];
  useDeckStore.setState({
    sessionTimeline: { "session-1": splitTimeline },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [],
      timeline: coarseTimeline,
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessionTimeline["session-1"], splitTimeline);
});

test("session/list_messages keeps split timeline when coarse history coalesces assistant text and drops tool sequences", () => {
  resetStore();
  const firstTool: AgentToolCall = {
    id: "call-1",
    kind: "shell",
    title: "Shell 1",
    status: "completed",
    timestamp: "2026-05-17T10:00:02.000Z",
    updatedAt: "2026-05-17T10:00:02.000Z",
    timelineSequence: 3,
  };
  const secondTool: AgentToolCall = {
    id: "call-2",
    kind: "read",
    title: "Read 2",
    status: "completed",
    timestamp: "2026-05-17T10:00:04.000Z",
    updatedAt: "2026-05-17T10:00:04.000Z",
    timelineSequence: 5,
  };
  const splitTimeline: SessionTimelineEntry[] = [
    {
      id: "user-1",
      kind: "user_message",
      message: {
        id: "user-1",
        role: "user",
        text: "开始",
        timestamp: "2026-05-17T10:00:00.000Z",
        timelineSequence: 1,
      },
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      timelineSequence: 1,
    },
    {
      id: "assistant-turn",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-turn:content",
        kind: "content",
        text: "先检查。",
        timestamp: "2026-05-17T10:00:01.000Z",
        timelineSequence: 2,
      }],
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
      timelineSequence: 2,
    },
    {
      id: "tool:call-1",
      kind: "tool_call",
      toolCall: firstTool,
      timestamp: firstTool.timestamp,
      updatedAt: firstTool.updatedAt,
      timelineSequence: firstTool.timelineSequence,
    },
    {
      id: "assistant-turn#p1",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-turn:content:4",
        kind: "content",
        text: "再读取。",
        timestamp: "2026-05-17T10:00:03.000Z",
        timelineSequence: 4,
      }],
      timestamp: "2026-05-17T10:00:03.000Z",
      updatedAt: "2026-05-17T10:00:03.000Z",
      timelineSequence: 4,
    },
    {
      id: "tool:call-2",
      kind: "tool_call",
      toolCall: secondTool,
      timestamp: secondTool.timestamp,
      updatedAt: secondTool.updatedAt,
      timelineSequence: secondTool.timelineSequence,
    },
    {
      id: "assistant-turn#p2",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-turn:content:6",
        kind: "content",
        text: "最后总结。",
        timestamp: "2026-05-17T10:00:05.000Z",
        timelineSequence: 6,
      }],
      timestamp: "2026-05-17T10:00:05.000Z",
      updatedAt: "2026-05-17T10:00:05.000Z",
      timelineSequence: 6,
    },
  ];
  const coarseTimeline: SessionTimelineEntry[] = [
    splitTimeline[0]!,
    {
      id: "assistant-turn",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-turn:content",
        kind: "content",
        text: "先检查。再读取。最后总结。",
        timestamp: "2026-05-17T10:00:01.000Z",
        timelineSequence: 2,
      }],
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:05.000Z",
      timelineSequence: 2,
    },
    {
      id: "tool:call-1",
      kind: "tool_call",
      toolCall: { ...firstTool, timelineSequence: undefined },
      timestamp: firstTool.timestamp,
      updatedAt: firstTool.updatedAt,
    },
    {
      id: "tool:call-2",
      kind: "tool_call",
      toolCall: { ...secondTool, timelineSequence: undefined },
      timestamp: secondTool.timestamp,
      updatedAt: secondTool.updatedAt,
    },
  ];
  useDeckStore.setState({
    sessionTimeline: { "session-1": splitTimeline },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [],
      timeline: coarseTimeline,
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessionTimeline["session-1"], splitTimeline);
});

test("session/list_messages preserves active local timeline entries when initial history returns late", () => {
  resetStore();
  const loadedEntry: SessionTimelineEntry = {
    id: "loaded-assistant",
    kind: "assistant_message",
    chunks: [
      {
        id: "loaded-assistant:content",
        kind: "content",
        text: "服务端历史回复",
        timestamp: "2026-05-17T10:01:00.000Z",
      },
    ],
    timestamp: "2026-05-17T10:01:00.000Z",
    updatedAt: "2026-05-17T10:01:00.000Z",
  };
  const liveEntry: SessionTimelineEntry = {
    id: "live-assistant",
    kind: "assistant_message",
    chunks: [
      {
        id: "live-assistant:content",
        kind: "content",
        text: "实时流式回复",
        timestamp: "2026-05-17T10:02:00.000Z",
        streaming: true,
      },
    ],
    timestamp: "2026-05-17T10:02:00.000Z",
    updatedAt: "2026-05-17T10:02:00.000Z",
    streaming: true,
  };
  useDeckStore.setState({
    sessionTimeline: { "session-1": [liveEntry] },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [],
      timeline: [loadedEntry],
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionTimeline["session-1"]?.map((entry) => entry.id),
    ["loaded-assistant", "live-assistant"],
  );
});

test("session/list_messages stores unified timeline entries when provided by Helm", () => {
  resetStore();
  const loadedUser: AgentMessage = {
    id: "user-1",
    role: "user",
    text: "开始",
    timestamp: "2026-05-24T10:00:00.000Z",
    timelineSequence: 1,
  };
  const timeline: SessionTimelineEntry[] = [
    {
      id: "user-1",
      kind: "user_message",
      message: loadedUser,
      timestamp: loadedUser.timestamp,
      updatedAt: loadedUser.timestamp,
      timelineSequence: 1,
    },
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:thinking",
          kind: "thinking",
          text: "先思考",
          title: "Thinking",
          status: "completed",
          timestamp: "2026-05-24T10:00:01.000Z",
          updatedAt: "2026-05-24T10:00:01.000Z",
          timelineSequence: 2,
        },
        {
          id: "assistant-1:content",
          kind: "content",
          text: "完成",
          timestamp: "2026-05-24T10:00:02.000Z",
          timelineSequence: 3,
        },
      ],
      timestamp: "2026-05-24T10:00:01.000Z",
      updatedAt: "2026-05-24T10:00:02.000Z",
      timelineSequence: 2,
    },
  ];

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [loadedUser],
      timeline,
      transcriptStatus: {
        source: "local",
        replayCompleteness: "compacted",
        integrity: "local-prefix-preserved",
        runtimeRestoreState: "history-only",
      },
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionTimeline["session-1"]?.map((entry) => entry.kind),
    ["user_message", "assistant_message"],
  );
  assert.deepEqual(
    (useDeckStore.getState() as any).transcriptStatusBySession?.["session-1"],
    {
      source: "local",
      replayCompleteness: "compacted",
      integrity: "local-prefix-preserved",
      runtimeRestoreState: "history-only",
    },
  );
});

test("session/list_messages preserves provided timeline order with partial sequence data", () => {
  resetStore();
  const loadedUser: AgentMessage = {
    id: "user-1",
    role: "user",
    text: "开始",
    timestamp: "2026-05-24T10:00:30.000Z",
    timelineSequence: 1,
  };
  const timeline: SessionTimelineEntry[] = [
    {
      id: "user-1",
      kind: "user_message",
      message: loadedUser,
      timestamp: loadedUser.timestamp,
      updatedAt: loadedUser.timestamp,
      timelineSequence: 1,
    },
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1:thinking",
        kind: "thinking",
        text: "先思考",
        title: "Thinking",
        status: "completed",
        timestamp: "2026-05-24T10:00:10.000Z",
        updatedAt: "2026-05-24T10:00:10.000Z",
      }],
      timestamp: "2026-05-24T10:00:10.000Z",
      updatedAt: "2026-05-24T10:00:10.000Z",
    },
    {
      id: "tool:tool-1",
      kind: "tool_call",
      toolCall: {
        id: "tool-1",
        kind: "read",
        title: "Read",
        status: "completed",
        timestamp: "2026-05-24T10:00:20.000Z",
        updatedAt: "2026-05-24T10:00:20.000Z",
      },
      timestamp: "2026-05-24T10:00:20.000Z",
      updatedAt: "2026-05-24T10:00:20.000Z",
    },
    {
      id: "assistant-1#p0",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1#p0:content",
        kind: "content",
        text: "完成",
        timestamp: "2026-05-24T10:00:40.000Z",
        timelineSequence: 2,
      }],
      timestamp: "2026-05-24T10:00:40.000Z",
      updatedAt: "2026-05-24T10:00:40.000Z",
      timelineSequence: 2,
    },
  ];

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [loadedUser],
      timeline,
      timelineHasMore: false,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionTimeline["session-1"]?.map((entry) => entry.id),
    ["user-1", "assistant-1", "tool:tool-1", "assistant-1#p0"],
  );
});

test("session/list_messages applies timeline-only pages without replacing legacy messages", () => {
  resetStore();
  const existingMessage: AgentMessage = {
    id: "message-existing",
    role: "assistant",
    text: "当前正文",
    timestamp: "2026-05-24T10:00:10.000Z",
  };
  const unexpectedMessage: AgentMessage = {
    id: "message-unexpected",
    role: "assistant",
    text: "不应替换当前正文",
    timestamp: "2026-05-24T10:00:20.000Z",
  };
  const timeline: SessionTimelineEntry[] = [
    {
      id: "older-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content",
          text: "更早的时间线正文",
          timestamp: "2026-05-24T09:59:00.000Z",
          timelineSequence: 1,
        },
      ],
      timestamp: "2026-05-24T09:59:00.000Z",
      updatedAt: "2026-05-24T09:59:00.000Z",
      timelineSequence: 1,
    },
  ];
  useDeckStore.setState({
    messages: { "session-1": [existingMessage] },
    messageHistoryState: {
      "session-1": {
        nextCursor: "legacy-message-cursor",
        hasMore: false,
        timelineNextCursor: "timeline-cursor-1",
        timelineHasMore: true,
        loading: true,
      },
    },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [unexpectedMessage],
      timeline,
      timelineBefore: "timeline-cursor-1",
      timelineNextCursor: "timeline-cursor-0",
      timelineHasMore: false,
      nextCursor: "unexpected-message-cursor",
      hasMore: true,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  const state = useDeckStore.getState();
  assert.equal(handled, true);
  assert.deepEqual(state.messages["session-1"], [existingMessage]);
  assert.deepEqual(
    state.sessionTimeline["session-1"]?.map((entry) => entry.id),
    ["older-assistant"],
  );
  assert.deepEqual(state.messageHistoryState["session-1"], {
    nextCursor: "legacy-message-cursor",
    hasMore: false,
    timelineNextCursor: "timeline-cursor-0",
    timelineHasMore: false,
    loading: false,
  });
});

test("session/list_messages preserves local user prompts when loaded history omits users", () => {
  resetStore();
  const localUser: AgentMessage = {
    id: "client-user-1",
    role: "user",
    text: "为什么 session 里看不到用户消息？",
    timestamp: "2026-05-24T10:00:00.000Z",
  };
  const loadedAssistant: AgentMessage = {
    id: "provider-assistant-1#p0",
    role: "assistant",
    text: "我来定位原因。",
    timestamp: "2026-05-24T10:01:00.000Z",
  };
  useDeckStore.setState({
    messages: { "session-1": [localUser] },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [loadedAssistant],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().messages["session-1"], [
    localUser,
    loadedAssistant,
  ]);
});

test("session/list_messages prefers the authoritative compacted timeline over a richer local replay", () => {
  resetStore();
  useDeckStore.setState({
    sessionTimeline: {
      "session-1": [
        {
          id: "current-user",
          kind: "user_message",
          message: {
            id: "current-user",
            role: "user",
            text: "结束任务",
            timestamp: "2026-06-18T14:01:49.292Z",
            timelineSequence: 256,
          },
          timestamp: "2026-06-18T14:01:49.292Z",
          updatedAt: "2026-06-18T14:01:49.292Z",
          timelineSequence: 256,
        },
        {
          id: "assistant-part-1",
          kind: "assistant_message",
          chunks: [
            {
              id: "assistant-part-1:content",
              kind: "content",
              text: "好的，我来完成剩余的",
              timestamp: "2026-06-18T14:02:15.000Z",
              timelineSequence: 275,
            },
          ],
          timestamp: "2026-06-18T14:02:15.000Z",
          updatedAt: "2026-06-18T14:02:15.000Z",
          timelineSequence: 275,
        },
        {
          id: "assistant-part-2",
          kind: "assistant_message",
          chunks: [
            {
              id: "assistant-part-2:content",
              kind: "content",
              text: "两处改动然后收尾。",
              timestamp: "2026-06-18T14:02:16.000Z",
              timelineSequence: 276,
            },
          ],
          timestamp: "2026-06-18T14:02:16.000Z",
          updatedAt: "2026-06-18T14:02:16.000Z",
          timelineSequence: 276,
        },
      ],
    },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [
        {
          id: "compaction-summary",
          role: "user",
          text: "This session is being continued from a previous conversation that ran out of context.",
          timestamp: "2026-06-18T14:05:25.193Z",
        },
        {
          id: "previous-user",
          role: "user",
          text: "完成了嘛？",
          timestamp: "2026-06-18T14:05:25.197Z",
        },
        {
          id: "provider-current-user",
          role: "user",
          text: "结束任务",
          timestamp: "2026-06-18T14:01:49.292Z",
          timelineSequence: 256,
        },
        {
          id: "provider-current-assistant",
          role: "assistant",
          text: "好的，我来完成剩余的两处改动然后收尾。",
          timestamp: "2026-06-18T14:02:16.000Z",
          timelineSequence: 276,
        },
      ],
      timeline: [
        {
          id: "current-user",
          kind: "user_message",
          message: {
            id: "current-user",
            role: "user",
            text: "结束任务",
            timestamp: "2026-06-18T14:01:49.292Z",
            timelineSequence: 256,
          },
          timestamp: "2026-06-18T14:01:49.292Z",
          updatedAt: "2026-06-18T14:01:49.292Z",
          timelineSequence: 256,
        },
        {
          id: "provider-current-assistant",
          kind: "assistant_message",
          chunks: [
            {
              id: "provider-current-assistant:content",
              kind: "content",
              text: "好的，我来完成剩余的两处改动然后收尾。",
              timestamp: "2026-06-18T14:02:16.000Z",
              timelineSequence: 276,
            },
          ],
          timestamp: "2026-06-18T14:02:16.000Z",
          updatedAt: "2026-06-18T14:02:16.000Z",
          timelineSequence: 276,
        },
      ],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  const nextTimeline = useDeckStore.getState().sessionTimeline["session-1"] ?? [];
  assert.equal(handled, true);
  assert.deepEqual(nextTimeline.map((entry) => entry.id), [
    "current-user",
    "provider-current-assistant",
  ]);
});

test("session/list_messages preserves local user attachments represented by provider history", () => {
  resetStore();
  const localUser: AgentMessage = {
    id: "client-user-with-image",
    role: "user",
    text: "请看这张图",
    timestamp: "2026-05-24T10:00:00.000Z",
    timelineSequence: 1,
    attachments: [
      {
        type: "image",
        data: "aW1hZ2U=",
        mimeType: "image/png",
        name: "screenshot.png",
      },
    ],
  };
  const providerUser: AgentMessage = {
    id: "provider-user-1",
    role: "user",
    text: "请看这张图",
    timestamp: "2026-05-24T10:00:01.000Z",
    timelineSequence: 1,
  };
  useDeckStore.setState({
    messages: { "session-1": [localUser] },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [providerUser],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().messages["session-1"], [
    {
      ...providerUser,
      id: localUser.id,
      timestamp: localUser.timestamp,
      attachments: localUser.attachments,
    },
  ]);
});

test("session/get_artifacts projects active tool calls into the unified timeline", () => {
  resetStore();
  const existingAssistant: SessionTimelineEntry = {
    id: "assistant-1",
    kind: "assistant_message",
    chunks: [
      {
        id: "assistant-1:content",
        kind: "content",
        text: "我先检查文件。",
        timestamp: "2026-05-24T10:00:00.000Z",
        timelineSequence: 1,
      },
    ],
    timestamp: "2026-05-24T10:00:00.000Z",
    updatedAt: "2026-05-24T10:00:00.000Z",
    timelineSequence: 1,
  };
  useDeckStore.setState({
    sessionTimeline: { "session-1": [existingAssistant] },
  });

  const handled = applySessionResult(
    "session/get_artifacts",
    {
      sessionId: "session-1",
      outputs: [
        {
          id: "output-1",
          commandId: "command-1",
          text: "stdout",
          stream: "stdout",
          timestamp: "2026-05-24T10:00:02.000Z",
          timelineSequence: 2,
        },
      ],
      toolCalls: [
        {
          id: "call-1",
          commandId: "command-1",
          kind: "shell",
          title: "Shell",
          status: "running",
          timestamp: "2026-05-24T10:00:01.000Z",
          updatedAt: "2026-05-24T10:00:01.000Z",
          timelineSequence: 2,
        },
      ],
      diffs: [],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  const timeline = useDeckStore.getState().sessionTimeline["session-1"] ?? [];
  const toolEntries = timeline.filter((entry) => entry.kind === "tool_call");
  assert.equal(handled, true);
  assert.deepEqual(timeline.map((entry) => entry.id), ["assistant-1", "tool:call-1"]);
  assert.equal(toolEntries.length, 1);
  assert.equal(toolEntries[0]?.kind === "tool_call" ? toolEntries[0].toolCall.status : undefined, "running");
  assert.equal(toolEntries[0]?.kind === "tool_call" ? toolEntries[0].toolCall.output : undefined, "stdout");
});

test("session/get_artifacts stores returned session plans", () => {
  resetStore();
  const plan = {
    updatedAt: "2026-06-02T13:37:09.663Z",
    entries: [
      { content: "并行委派 apps/helm 竞态模式搜索", priority: "high", status: "completed" },
      { content: "补充读取候选代码并验证是否真有 await 竞态", priority: "high", status: "completed" },
      { content: "汇总类似问题、风险等级与证据位置", priority: "high", status: "completed" },
    ],
  };

  const handled = applySessionResult(
    "session/get_artifacts",
    {
      sessionId: "session-1",
      outputs: [],
      toolCalls: [],
      diffs: [],
      plan,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().sessionPlans["session-1"], plan);
});

test("session/get_artifacts preserves existing session plans when plan is omitted", () => {
  resetStore();
  const plan: AgentPlan = {
    updatedAt: "2026-06-05T14:10:22.497Z",
    entries: [
      { content: "恢复 Claude plan", priority: "medium", status: "in_progress" },
    ],
  };
  useDeckStore.setState({
    sessionPlans: { "session-1": plan },
  });

  const handled = applySessionResult(
    "session/get_artifacts",
    {
      sessionId: "session-1",
      outputs: [],
      toolCalls: [],
      diffs: [],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().sessionPlans["session-1"], plan);
});

test("session/list_messages preserves live streaming messages when initial history returns late", () => {
  resetStore();
  const loadedHistory: AgentMessage = {
    id: "provider-1#p0",
    role: "assistant",
    text: "服务端历史消息",
    timestamp: "2026-05-17T10:01:00.000Z",
  };
  const liveStreaming: AgentMessage = {
    id: "session-1-msg-s1",
    role: "assistant",
    text: "实时流式消息",
    timestamp: "2026-05-17T10:02:00.000Z",
    streaming: true,
  };
  useDeckStore.setState({
    messages: { "session-1": [liveStreaming] },
  });

  const handled = applySessionResult(
    "session/list_messages",
    {
      sessionId: "session-1",
      messages: [loadedHistory],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().messages["session-1"], [
    loadedHistory,
    liveStreaming,
  ]);
});

test("session prompt creation clears consumed draft metadata from model options", () => {
  resetStore();
  useDeckStore.getState().setAgentModelOptions({
    "codex::D:/repo::p1": {
      loading: false,
      warmed: true,
      projectId: "p1",
      draftId: "draft-codex-1",
      deckClientId: "deck-1",
      scopeKey: "deck-1:p1:D:/repo:codex",
      logicalScopeKey: "p1:D:/repo:codex",
      runtimeSessionId: "runtime-s1",
      message: "ACP runtime prewarmed.",
      modelOptions: [{ id: "gpt-5.5", name: "GPT 5.5" }],
      configOptions: [{ id: "model", label: "Model", type: "string" } as any],
      state: { model: "gpt-5.5" },
    },
  });

  const handled = applySessionResult(
    "session/prompt",
    { session: { ...session("s1"), runtimeSessionId: "runtime-s1" } },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  const entry = useDeckStore.getState().agentModelOptions["codex::D:/repo::p1"];
  assert.equal(handled, true);
  assert.equal(entry?.draftId, undefined);
  assert.equal(entry?.deckClientId, undefined);
  assert.equal(entry?.scopeKey, undefined);
  assert.equal(entry?.logicalScopeKey, undefined);
  assert.equal(entry?.runtimeSessionId, "runtime-s1");
  assert.deepEqual(entry?.modelOptions, [{ id: "gpt-5.5", name: "GPT 5.5" }]);
});

test("runtime-ready session updates refresh ACP connection inventory", () => {
  resetStore();
  const dispatched: string[] = [];

  const handled = applySessionUpdate(
    { sessionId: "s1", update: { kind: "session_updated", session: { ...session("s1"), runtimeSessionId: "runtime-s1" } } },
    createSessionEventContext({
      rpcClientRef: { current: { socket: { readyState: 1 } } },
      dispatch: async (_client: unknown, method: string) => {
        dispatched.push(method);
      },
    }),
  );

  assert.equal(handled, true);
  assert.deepEqual(dispatched, ["agent/connections"]);
});

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

test("activity update stores ACP plan updates by session", () => {
  resetStore();
  const handled = applyActivityUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "plan_update",
        plan: {
          entries: [{ content: "Render drawer", priority: "medium", status: "in_progress" }],
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      },
    },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().sessionPlans.s1?.entries, [
    { content: "Render drawer", priority: "medium", status: "in_progress" },
  ]);
});

test("activity update clears completed plans when an empty plan update arrives", () => {
  resetStore();
  useDeckStore.setState({
    sessionPlans: {
      s1: {
        entries: [
          { content: "复核 Markdown 渲染", priority: "medium", status: "completed" },
          { content: "检查权限审核抽屉", priority: "medium", status: "completed" },
        ],
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    },
  });
  const context = {
    toolCallsRef: { current: {} },
    mergeSessionToolCalls: () => undefined,
    appendSystemMessage: () => undefined,
  };

  const emptyHandled = applyActivityUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "plan_update",
        plan: {
          entries: [],
          updatedAt: "2026-06-02T00:01:00.000Z",
        },
      },
    },
    context,
  );

  assert.equal(emptyHandled, true);
  assert.equal(useDeckStore.getState().sessionPlans.s1, undefined);

  const replacementHandled = applyActivityUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "plan_update",
        plan: {
          entries: [
            { content: "汇总 Diff 详情", priority: "medium", status: "in_progress" },
          ],
          updatedAt: "2026-06-02T00:02:00.000Z",
        },
      },
    },
    context,
  );

  assert.equal(replacementHandled, true);
  assert.deepEqual(useDeckStore.getState().sessionPlans.s1?.entries, [
    { content: "汇总 Diff 详情", priority: "medium", status: "in_progress" },
  ]);
});

test("approval resolved notifications drop pending approvals from inventory", () => {
  resetStore();
  useDeckStore.getState().upsertApproval({
    sessionId: "s1",
    request: {
      id: "approval-1",
      command: "Approve MCP tool call :: {}",
      reason: "等待审核",
      cwd: "D:/repo",
    } as any,
  });

  const handled = applyApprovalResolved({
    sessionId: "s1",
    approvalRequestId: "approval-1",
    decision: "allow" as any,
  });

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().approvalItemsById["approval-1"], undefined);
  assert.deepEqual(useDeckStore.getState().pendingApprovalIds, []);
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

test("project list refreshes current helm worktrees from project inventory", () => {
  resetStore();
  useDeckStore.setState({
    worktrees: [{ name: "worktree", path: "D:/myProject/tools/Tiller/apps/helm" }],
  });

  const handled = applyInventoryResult(
    "project/list",
    {
      projects: [
        {
          id: "p1",
          name: "Tiller",
          helmId: "helm-1",
          worktrees: [{ name: "feature/0.1.6", path: "D:/myProject/tools/Tiller" }],
        },
        {
          id: "p2",
          name: "Tiller-Pro",
          helmId: "helm-1",
          worktrees: [{ name: "main", path: "D:/myProject/tools/Tiller-Pro" }],
        },
      ],
    },
    "helm-1",
    true,
    {} as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().worktrees.map((worktree) => worktree.path),
    ["D:/myProject/tools/Tiller", "D:/myProject/tools/Tiller-Pro"],
  );
  assert.deepEqual(
    useDeckStore.getState().helmInventories["helm-1"]?.worktrees.map((worktree) => worktree.path),
    ["D:/myProject/tools/Tiller", "D:/myProject/tools/Tiller-Pro"],
  );
});

test("project worktree refresh merges the requested project without dropping other projects", () => {
  resetStore();
  useDeckStore.setState({
    projects: [
      {
        id: "p1",
        name: "Tiller",
        helmId: "helm-1",
        worktrees: [{ name: "feature/0.1.6", path: "D:/myProject/tools/Tiller" }],
      },
      {
        id: "p2",
        name: "sandbox",
        helmId: "helm-1",
        worktrees: [{ name: "main", path: "D:/myProject/tools/tiller-test-sandbox" }],
      },
    ],
    worktrees: [
      { name: "feature/0.1.6", path: "D:/myProject/tools/Tiller" },
      { name: "main", path: "D:/myProject/tools/tiller-test-sandbox" },
    ],
  });

  const handled = applyInventoryResult(
    "project/list_worktrees",
    {
      projectId: "p2",
      worktrees: [
        { name: "main", path: "D:/myProject/tools/tiller-test-sandbox", kind: "root" },
        {
          name: "test-worktree",
          path: "D:/myProject/tools/tiller-test-sandbox/.worktrees/test-worktree",
          kind: "git-worktree",
        },
      ],
    },
    "helm-1",
    true,
    {} as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().worktrees.map((worktree) => worktree.path),
    [
      "D:/myProject/tools/Tiller",
      "D:/myProject/tools/tiller-test-sandbox",
      "D:/myProject/tools/tiller-test-sandbox/.worktrees/test-worktree",
    ],
  );
});

test("git worktree inventory replaces stale current helm worktrees", () => {
  resetStore();
  useDeckStore.setState({
    worktrees: [
      { name: "worktree", path: "D:/myProject/tools/Tiller/apps/helm" },
      {
        name: "feature/0.1.6",
        path: "D:/myProject/tools/Tiller",
        branch: "feature/0.1.6",
        kind: "root",
      },
    ],
  });

  const handled = applyInventoryResult(
    "project/git/list_branches",
    {
      projectId: "project-2",
      branches: ["feature/0.1.6"],
      currentBranch: "feature/0.1.6",
      worktrees: [
        {
          name: "feature/0.1.6",
          path: "D:/myProject/tools/Tiller",
          branch: "feature/0.1.6",
          kind: "root",
        },
        {
          name: "main",
          path: "D:/myProject/tools/Tiller-Pro",
          branch: "main",
          kind: "root",
        },
      ],
    },
    "helm-1",
    true,
    {
      setSelectedCwd: () => undefined,
      setWorktreePickerOpen: () => undefined,
    } as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().worktrees.map((worktree) => worktree.path),
    ["D:/myProject/tools/Tiller", "D:/myProject/tools/Tiller-Pro"],
  );
});

test("inventory RPC results hydrate logging settings for the source helm", () => {
  resetStore();
  const handled = applyInventoryResult(
    "logging/get",
    { logging: { level: "trace", format: "pretty", acpTrace: "summary" } },
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
  assert.deepEqual(useDeckStore.getState().helmInventories["helm-1"]?.logging, {
    level: "trace",
    format: "pretty",
    acpTrace: "summary",
  });
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
    sessionPlans: {
      stale: {
        entries: [{ content: "Old plan", priority: "medium", status: "pending" }],
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    },
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
  assert.equal(useDeckStore.getState().sessionPlans.stale, undefined);
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

test("session config option display preserves session-bound model over provider defaults", () => {
  resetStore();
  const configOptions: SessionConfigOption[] = [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "gpt-5.5",
      options: [
        { value: "gpt-5.4", label: "gpt-5.4" },
        { value: "gpt-5.5", label: "GPT-5.5" },
      ],
    },
    {
      id: "reasoning_effort",
      name: "Reasoning",
      category: "reasoning_effort",
      currentValue: "medium",
      options: [
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    },
  ];
  useDeckStore.setState({
    sessions: [
      {
        ...session("s1"),
        model: "gpt-5.4",
        reasoningEffort: "high",
      },
    ],
  });

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "config_options",
        state: { model: "gpt-5.5", reasoningEffort: "medium" },
        options: configOptions,
      },
    },
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessions[0]?.model, "gpt-5.5");
  assert.equal(useDeckStore.getState().sessions[0]?.reasoningEffort, "medium");
  assert.deepEqual(
    useDeckStore.getState().sessionConfigOptions.s1?.map((option) => option.currentValue),
    ["gpt-5.5", "medium"],
  );
});

test("session config option updates clear stale reasoning when options omit reasoning", () => {
  resetStore();
  const configOptions: SessionConfigOption[] = [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "claude-haiku-4-5",
      options: [{ value: "claude-haiku-4-5", label: "claude-haiku-4-5" }],
    },
  ];
  useDeckStore.setState({
    sessions: [
      {
        ...session("s1"),
        model: "claude-haiku-4-5",
        reasoningEffort: "medium",
      },
    ],
  });

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "config_options",
        state: { model: "claude-haiku-4-5" },
        options: configOptions,
      },
    },
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessions[0]?.model, "claude-haiku-4-5");
  assert.equal(useDeckStore.getState().sessions[0]?.reasoningEffort, undefined);
  assert.deepEqual(
    useDeckStore.getState().sessionConfigOptions.s1?.map((option) => option.currentValue),
    ["claude-haiku-4-5"],
  );
});

test("arbitrary ACP config options stay scoped to their session", () => {
  resetStore();
  const approvalOption: SessionConfigOption = {
    id: "approval-mode",
    name: "Approval Mode",
    category: "approval",
    currentValue: "on-request",
    options: [
      { value: "on-request", label: "On Request" },
      { value: "auto", label: "Auto" },
    ],
  };
  const approvalOptions: SessionConfigOption[] = [approvalOption];
  useDeckStore.setState({
    sessions: [session("s1"), session("s2")],
    sessionConfigOptions: {
      s2: [
        {
          ...approvalOption,
          currentValue: "auto",
        },
      ],
    },
  });

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "config_options",
        state: {},
        options: approvalOptions,
      },
    },
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessionConfigOptions.s1?.[0]?.currentValue, "on-request");
  assert.equal(useDeckStore.getState().sessionConfigOptions.s2?.[0]?.currentValue, "auto");
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

test("approval list results hydrate pending approval inventory", () => {
  resetStore();
  const request: PermissionRequest = {
    id: "approval-1",
    command: "Approve MCP tool call :: {}",
    reason: "需要审核工具调用",
    cwd: "D:/repo",
  };

  const handled = applySessionResult(
    "approval/list_pending",
    { approvals: [{ sessionId: "s1", request }] },
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
  assert.deepEqual(useDeckStore.getState().pendingApprovalIds, ["approval-1"]);
  assert.equal(useDeckStore.getState().approvalItemsById["approval-1"]?.request.id, "approval-1");
});

test("empty approval list clears stale pending approval inventory", () => {
  resetStore();
  useDeckStore.getState().upsertApproval({
    sessionId: "s1",
    request: {
      id: "approval-stale",
      command: "Approve MCP tool call :: {}",
      reason: "已过期的审核请求",
      cwd: "D:/repo",
    } as any,
  });

  const handled = applySessionResult(
    "approval/list_pending",
    { approvals: [] },
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
  assert.deepEqual(useDeckStore.getState().pendingApprovalIds, []);
  assert.deepEqual(useDeckStore.getState().approvalItemsById, {});
});
