import assert from "node:assert/strict";
import test from "node:test";
import type { MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  PermissionRequest,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
  SessionSummary,
  SessionTimelineEntry,
  TrustedDeviceSummary,
} from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyActivityUpdate } from "./activity-events.js";
import { applyApprovalCreated, applyApprovalResolved } from "./approval-events.js";
import { applyDeviceResult } from "./device-events.js";
import { applyInventoryResult } from "./inventory-events.js";
import {
  applySessionActivitySummary,
  applySessionResult,
  applySessionUpdate,
} from "./session-events.js";

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
    activeSessionId: null,
    statuses: {},
    sessionTitles: {},
    openChatSessionIds: [],
    messages: {},
    sessionTimeline: {},
    sessionTimelineDeliveryState: {},
    sessionLegacyEvidence: {},
    messageHistoryState: {},
    promptQueues: {},
    sessionLiveStates: {},
    sessionLiveStateSequences: {},
    outputs: {},
    toolCalls: {},
    sessionPlans: {},
    dismissedCompletedSessionPlanKeys: {},
    diffs: {},
    historicalDiffIncompleteBySession: {},
    sessionSubagentDetails: {},
    activityHistoryState: {},
    activityVisibleCounts: {},
    sessionAvailableCommands: {},
    approvalItemsById: {},
    pendingApprovalIds: [],
    pendingApprovalIdsBySession: {},
    approvalHistory: [],
    trustedDevices: [],
    pairingFeedback: "",
  } as any);
}

test("session/activity_summary stores summary data in the source Helm inventory", () => {
  resetStore();
  const summary = {
    generatedAt: "2026-08-09T12:34:56.000Z",
    promptCount: 4,
    recentToolCallCount: 7,
    toolCallCount: 18,
    activityTrend: [{ date: "2026-08-09", promptCount: 4, toolCallCount: 7 }],
    activityTrendHourly: [{ date: "2026-08-09T12:00:00.000Z", promptCount: 4, toolCallCount: 7 }],
  };

  const handled = applySessionResult(
    "session/activity_summary",
    summary,
    "helm-1",
    true,
    {} as any,
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().helmInventories["helm-1"]?.activitySummary, summary);
});

test("dashboard activity summary notifications update only their source Helm inventory", () => {
  resetStore();
  const summary = {
    generatedAt: "2026-08-09T12:34:56.000Z",
    promptCount: 5,
    recentToolCallCount: 8,
    toolCallCount: 19,
    activityTrend: [],
    activityTrendHourly: [],
  };

  assert.equal(applySessionActivitySummary(summary, "helm-2"), true);
  assert.deepEqual(useDeckStore.getState().helmInventories["helm-2"]?.activitySummary, summary);
  assert.equal(useDeckStore.getState().helmInventories["helm-1"], undefined);
});

test("session cleanup releases session-scoped caches without touching another session", () => {
  resetStore();
  const pendingRequests = new Set(["s1", "s2"]);
  let reactivePendingRequests = new Set(["s1", "s2"]);
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = {
    current: { s1: [], s2: [] },
  };

  useDeckStore.setState({
    sessions: [session("s1"), session("s2")],
    statuses: { s1: "running", s2: "idle" },
    sessionTitles: { s1: "删除标题", s2: "保留标题" },
    openChatSessionIds: ["s1", "s2"],
    messages: { s1: [], s2: [] },
    sessionTimeline: { s1: [], s2: [] },
    sessionTimelineDeliveryState: {
      s1: { latestDeliverySequence: 1, reloadRequired: false },
      s2: { latestDeliverySequence: 2, reloadRequired: false },
    },
    messageHistoryState: {
      s1: { hasMore: false, loading: false },
      s2: { hasMore: true, loading: false },
    },
    promptQueues: { s1: {} as never, s2: {} as never },
    sessionPlans: { s1: {} as AgentPlan, s2: {} as AgentPlan },
    dismissedCompletedSessionPlanKeys: { s1: "done-1", s2: "done-2" },
    activityHistoryState: {
      s1: { hasMore: false, loading: false },
      s2: { hasMore: true, loading: false },
    },
    activityVisibleCounts: { s1: 10, s2: 20 },
    sessionSubagentDetails: {
      ["s1\0root"]: {} as never,
      ["s2\0root"]: {} as never,
    },
    sessionAvailableCommands: {
      s1: [{ name: "old" }],
      s2: [{ name: "keep" }],
    },
  } as any);

  const handled = applySessionResult(
    "session/cleanup",
    { result: { sessionId: "s1", deleted: true } },
    "helm-1",
    true,
    createSessionEventContext({
      toolCallsRef,
      resumeStartRequestsRef: { current: pendingRequests },
      setResumeStartRequestIds: (update: (current: Set<string>) => Set<string>) => {
        reactivePendingRequests = update(reactivePendingRequests);
      },
    }),
  );

  const state = useDeckStore.getState();
  assert.equal(handled, true);
  assert.deepEqual(state.sessions.map((item) => item.id), ["s2"]);
  assert.equal(state.sessionTitles.s1, undefined);
  assert.deepEqual(state.openChatSessionIds, ["s2"]);
  assert.equal(state.sessionTimelineDeliveryState.s1, undefined);
  assert.equal(state.messageHistoryState.s1, undefined);
  assert.equal(state.promptQueues.s1, undefined);
  assert.equal(state.sessionPlans.s1, undefined);
  assert.equal(state.dismissedCompletedSessionPlanKeys.s1, undefined);
  assert.equal(state.activityHistoryState.s1, undefined);
  assert.equal(state.activityVisibleCounts.s1, undefined);
  assert.equal(state.sessionSubagentDetails["s1\0root"], undefined);
  assert.equal(state.sessionAvailableCommands.s1, undefined);
  assert.equal(toolCallsRef.current.s1, undefined);
  assert.equal(pendingRequests.has("s1"), false);
  assert.equal(reactivePendingRequests.has("s1"), false);
  assert.ok(state.sessionTitles.s2);
  assert.ok(state.sessionSubagentDetails["s2\0root"]);
  assert.ok(state.sessionAvailableCommands.s2);
});

test("subagent detail deltas prime cached details and ignore stale sequences", () => {
  resetStore();
  const context = createSessionEventContext();
  const update = (throughSequence: number, text: string) => ({
    sessionId: "s1",
    update: {
      kind: "subagent_detail" as const,
      delta: {
        sessionId: "s1",
        parentToolCallId: "root-1",
        batch: {
          replace: false,
          deliverySequence: throughSequence,
          lastSequence: throughSequence,
          entries: [{
            id: "reply-1",
            kind: "assistant_message" as const,
            chunks: [{
              id: "reply-1:content",
              kind: "content" as const,
              text,
              timestamp: "2026-07-22T00:00:00.000Z",
              sequence: 1,
            }],
            timestamp: "2026-07-22T00:00:00.000Z",
            updatedAt: "2026-07-22T00:00:00.000Z",
            sequence: 1,
          }],
        },
      },
    },
  });

  assert.equal(applySessionUpdate(update(1, "ignored"), context), true);
  const primed = useDeckStore.getState().sessionSubagentDetails["s1\0root-1"];
  assert.equal(primed?.throughSequence, 1);
  assert.equal(
    primed?.entries[0]?.kind === "assistant_message"
      ? primed.entries[0].chunks[0]?.text
      : undefined,
    "ignored",
  );

  useDeckStore.getState().setSessionSubagentDetails({
    ["s1\0root-1"]: {
      sessionId: "s1",
      parentToolCallId: "root-1",
      throughSequence: 0,
      entries: [],
    },
  });
  applySessionUpdate(update(2, "latest"), context);
  applySessionUpdate(update(1, "stale"), context);
  const detail = useDeckStore.getState().sessionSubagentDetails["s1\0root-1"];
  assert.equal(detail?.throughSequence, 2);
  const reply = detail?.entries[0];
  assert.equal(
    reply?.kind === "assistant_message" ? reply.chunks[0]?.text : undefined,
    "latest",
  );
});

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
    setResumeStartRequestIds: () => undefined,
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

test("remote session creation stays in the source Helm inventory", () => {
  resetStore();

  const handled = applySessionResult(
    "session/new",
    { session: { ...session("remote-session"), runtimeSessionId: "runtime-remote" } },
    "helm-remote",
    false,
    createSessionEventContext(),
  );

  const state = useDeckStore.getState();
  assert.equal(handled, true);
  assert.deepEqual(state.sessions, []);
  assert.deepEqual(
    state.helmInventories["helm-remote"]?.sessions.map((item) => item.id),
    ["remote-session"],
  );
  assert.equal(state.activeSessionId, null);
});

test("session/list_timeline replaces the canonical timeline and applies live state", () => {
  resetStore();
  const staleEntry: SessionTimelineEntry = {
    id: "stale-assistant",
    kind: "assistant_message",
    chunks: [],
    timestamp: "2026-06-29T09:59:00.000Z",
    updatedAt: "2026-06-29T09:59:00.000Z",
    sequence: 1,
  };
  const authoritativeEntry: SessionTimelineEntry = {
    id: "loaded-assistant",
    kind: "assistant_message",
    chunks: [
      {
        id: "loaded-assistant:content",
        kind: "content",
        text: "canonical reply",
        timestamp: "2026-06-29T10:00:00.000Z",
        sequence: 2,
      },
    ],
    timestamp: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-06-29T10:00:00.000Z",
    sequence: 2,
  };
  const livePlan: AgentPlan = {
    entries: [{ content: "Review batch pipeline", priority: "medium", status: "in_progress" }],
    updatedAt: "2026-06-29T10:00:01.000Z",
  };
  const livePromptQueue: SessionPromptQueueSnapshot = {
    sessionId: "session-1",
    queued: [{
      id: "queued-1",
      sessionId: "session-1",
      text: "follow-up",
      clientMessageId: "client-queued-1",
      createdAt: "2026-06-29T10:00:02.000Z",
      updatedAt: "2026-06-29T10:00:02.000Z",
      status: "queued",
    }],
  };
  useDeckStore.setState({
    sessionTimeline: { "session-1": [staleEntry] },
  });

  const handled = applySessionResult(
    "session/list_timeline",
    {
      sessionId: "session-1",
      entries: [authoritativeEntry],
      hasMore: false,
      liveState: {
        plan: livePlan,
        promptQueue: livePromptQueue,
      },
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  const state = useDeckStore.getState();
  assert.equal(handled, true);
  assert.deepEqual(state.sessionTimeline["session-1"]?.map((entry) => entry.id), ["loaded-assistant"]);
  assert.deepEqual(state.sessionPlans["session-1"], livePlan);
  assert.deepEqual(state.promptQueues["session-1"], livePromptQueue);
  assert.deepEqual(state.messageHistoryState["session-1"], {
    nextCursor: undefined,
    hasMore: false,
    loading: false,
  });
  assert.deepEqual(state.activityHistoryState["session-1"], {
    nextCursor: undefined,
    hasMore: false,
    loading: false,
  });
});

test("legacy evidence metadata stays lazy until its source page is requested", () => {
  resetStore();
  const availability = {
    sessionId: "session-1",
    available: true,
    counts: { message: 2, tool_call: 1, output: 0 },
  } as const;

  applySessionResult(
    "session/list_timeline",
    {
      sessionId: "session-1",
      entries: [],
      hasMore: false,
      legacyEvidence: availability,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.deepEqual(useDeckStore.getState().sessionLegacyEvidence["session-1"], {
    availability,
    pages: {},
    loading: {},
  });

  applySessionResult(
    "session/list_legacy_evidence",
    {
      sessionId: "session-1",
      source: "message",
      items: [{ source: "message", sourcePosition: 1, entity: { id: "legacy-message" } }],
      issues: [],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.deepEqual(
    useDeckStore.getState().sessionLegacyEvidence["session-1"]?.pages.message?.items,
    [{ source: "message", sourcePosition: 1, entity: { id: "legacy-message" } }],
  );
});

test("session/list_timeline prepends older canonical history pages", () => {
  resetStore();
  const olderEntry: SessionTimelineEntry = {
    id: "older-user",
    kind: "user_message",
    message: {
      id: "older-user",
      role: "user",
      text: "older question",
      timestamp: "2026-06-29T09:58:00.000Z",
      sequence: 1,
    },
    timestamp: "2026-06-29T09:58:00.000Z",
    updatedAt: "2026-06-29T09:58:00.000Z",
    sequence: 1,
  };
  const newerEntry: SessionTimelineEntry = {
    id: "newer-assistant",
    kind: "assistant_message",
    chunks: [],
    timestamp: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-06-29T10:00:00.000Z",
    sequence: 2,
  };
  useDeckStore.setState({
    sessionTimeline: { "session-1": [newerEntry] },
    messageHistoryState: {
      "session-1": { nextCursor: "cursor-1", hasMore: true, loading: true },
    },
  });

  const handled = applySessionResult(
    "session/list_timeline",
    {
      sessionId: "session-1",
      before: "cursor-1",
      entries: [olderEntry],
      nextCursor: "cursor-2",
      hasMore: true,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionTimeline["session-1"]?.map((entry) => entry.id),
    ["older-user", "newer-assistant"],
  );
  assert.deepEqual(useDeckStore.getState().messageHistoryState["session-1"], {
    nextCursor: "cursor-2",
    hasMore: true,
    loading: false,
  });
  assert.deepEqual(useDeckStore.getState().activityHistoryState["session-1"], {
    nextCursor: "cursor-2",
    hasMore: true,
    loading: false,
  });
});

test("session/list_timeline clears a stale running overlay once history is terminal", () => {
  resetStore();
  useDeckStore.setState({
    toolCalls: {
      "session-1": [
        {
          id: "call-1",
          kind: "shell",
          title: "Shell",
          status: "running",
          input: "{\"pattern\":\"Tiller\",\"glob\":\"**/README.md\",\"output_mode\":\"files_with_matches\"}",
          output: "Found 2 files",
          timestamp: "2026-07-07T08:06:52.322Z",
          updatedAt: "2026-07-07T08:06:52.900Z",
        } as AgentToolCall,
      ],
    },
  });

  const handled = applySessionResult(
    "session/list_timeline",
    {
      sessionId: "session-1",
      entries: [
        {
          id: "tool:call-1",
          kind: "tool_call",
          toolCall: {
            id: "call-1",
            kind: "search",
            title: "Grep",
            status: "completed",
            input: "{\"pattern\":\"Tiller\",\"glob\":\"**/README.md\",\"output_mode\":\"files_with_matches\"}",
            output: "Found 2 files",
            timestamp: "2026-07-07T08:06:52.322Z",
            updatedAt: "2026-07-07T08:06:53.266Z",
            sequence: 1,
          },
          timestamp: "2026-07-07T08:06:52.322Z",
          updatedAt: "2026-07-07T08:06:53.266Z",
          sequence: 1,
        },
      ],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().toolCalls["session-1"], []);
});

test("session updates reject legacy user_message events after canonical cutover", () => {
  resetStore();
  const existingTimeline: SessionTimelineEntry[] = [
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content",
          text: "existing",
          timestamp: "2026-06-29T10:00:00.000Z",
          sequence: 1,
        },
      ],
      timestamp: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
      sequence: 1,
    },
  ];
  useDeckStore.setState({
    sessionTimeline: { "session-1": existingTimeline },
  });

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "user_message",
        message: {
          id: "user-1",
          role: "user",
          text: "hello",
          timestamp: "2026-06-29T10:00:01.000Z",
          sequence: 2,
        },
      } as any,
    },
    createSessionEventContext(),
  );

  assert.equal(handled, false);
  assert.equal(useDeckStore.getState().sessionTimeline["session-1"], existingTimeline);
  assert.equal(useDeckStore.getState().messages["session-1"], undefined);
});

test("session updates reject legacy user_message events before timeline delivery", () => {
  resetStore();

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "user_message",
        message: {
          id: "user-1",
          role: "user",
          text: "hello",
          timestamp: "2026-06-29T10:00:01.000Z",
          sequence: 1,
        },
      } as any,
    },
    createSessionEventContext(),
  );

  assert.equal(handled, false);
  assert.equal(useDeckStore.getState().messages["session-1"], undefined);
  assert.equal(useDeckStore.getState().sessionTimeline["session-1"], undefined);
});

test("session timeline_batch requests an authoritative reload when delivery sequence gaps", () => {
  resetStore();
  const dispatched: Array<{ method: string; params: unknown }> = [];
  const context = createSessionEventContext({
    rpcClientRef: { current: { socket: { readyState: 1 } } },
    dispatch: async (_client: unknown, method: string, params: unknown) => {
      dispatched.push({ method, params });
    },
  });

  const firstHandled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "timeline_batch",
        batch: {
          replace: false,
          deliverySequence: 1,
          lastSequence: 1,
          entries: [
            {
              id: "assistant-1",
              kind: "assistant_message",
              chunks: [],
              timestamp: "2026-06-29T10:00:00.000Z",
              updatedAt: "2026-06-29T10:00:00.000Z",
              sequence: 1,
            },
          ],
        },
      },
    },
    context,
  );
  const gapHandled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "timeline_batch",
        batch: {
          replace: false,
          deliverySequence: 3,
          lastSequence: 3,
          entries: [
            {
              id: "tool:1",
              kind: "tool_call",
              toolCall: {
                id: "1",
                kind: "read",
                title: "Read",
                status: "completed",
                timestamp: "2026-06-29T10:00:01.000Z",
                updatedAt: "2026-06-29T10:00:01.000Z",
                sequence: 2,
              },
              timestamp: "2026-06-29T10:00:01.000Z",
              updatedAt: "2026-06-29T10:00:01.000Z",
              sequence: 2,
            },
          ],
        },
      },
    },
    context,
  );

  assert.equal(firstHandled, true);
  assert.equal(gapHandled, true);
  assert.deepEqual(
    useDeckStore.getState().sessionTimeline["session-1"]?.map((entry) => entry.id),
    ["assistant-1"],
  );
  assert.deepEqual(dispatched, [
    {
      method: "session/list_timeline",
      params: { sessionId: "session-1", limit: 20 },
    },
  ]);
});

test("terminal session timeline_batch removes matching live tool overlays", () => {
  resetStore();
  useDeckStore.setState({
    toolCalls: {
      "session-1": [
        {
          id: "call-1",
          kind: "shell",
          title: "Shell",
          status: "running",
          input: "{\"pattern\":\"tool-call-repair\",\"output_mode\":\"files_with_matches\"}",
          output: "Found 4 files",
          timestamp: "2026-07-07T09:10:38.372Z",
          updatedAt: "2026-07-07T09:10:38.630Z",
        } as AgentToolCall,
      ],
    },
  });

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "timeline_batch",
        batch: {
          replace: false,
          deliverySequence: 1,
          lastSequence: 1,
          entries: [
            {
              id: "tool:call-1",
              kind: "tool_call",
              toolCall: {
                id: "call-1",
                kind: "search",
                title: "Grep",
                status: "completed",
                input: "{\"pattern\":\"tool-call-repair\",\"output_mode\":\"files_with_matches\"}",
                output: "Found 4 files",
                timestamp: "2026-07-07T09:10:38.372Z",
                updatedAt: "2026-07-07T09:10:39.089Z",
                sequence: 1,
              },
              timestamp: "2026-07-07T09:10:38.372Z",
              updatedAt: "2026-07-07T09:10:39.089Z",
              sequence: 1,
            },
          ],
        },
      },
    },
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().toolCalls["session-1"], []);
});

test("streaming thinking timeline batches keep the live thought overlay stable", () => {
  resetStore();
  const sessionId = "session-thinking-stream";
  const context = createSessionEventContext();
  const applyTimelineBatch = (deliverySequence: number, text: string, streaming: boolean) =>
    applySessionUpdate(
      {
        sessionId,
        update: {
          kind: "timeline_batch",
          batch: {
            replace: false,
            deliverySequence,
            lastSequence: deliverySequence,
            entries: [{
              id: "thought-1",
              kind: "assistant_message",
              chunks: [{
                id: "thought-1:thinking",
                kind: "thinking",
                text,
                title: "Thinking",
                status: streaming ? "running" : "completed",
                streamMode: "delta",
                timestamp: `2026-07-04T10:00:0${deliverySequence}.000Z`,
                updatedAt: `2026-07-04T10:00:0${deliverySequence}.000Z`,
                sequence: deliverySequence,
              }],
              timestamp: `2026-07-04T10:00:0${deliverySequence}.000Z`,
              updatedAt: `2026-07-04T10:00:0${deliverySequence}.000Z`,
              sequence: deliverySequence,
              streaming,
            }],
          },
        },
      },
      context,
    );

  useDeckStore.setState({
    messages: {
      [sessionId]: [{
        id: "thought-1",
        role: "assistant",
        contentKind: "thought",
        text: "首行内容",
        timestamp: "2026-07-04T10:00:01.000Z",
        streaming: true,
        streamMode: "delta",
      }],
    },
  });

  applyTimelineBatch(1, "首行内容", true);
  assert.equal(useDeckStore.getState().messages[sessionId]?.[0]?.text, "首行内容");

  useDeckStore.getState().setMessages((current) => ({
    ...current,
    [sessionId]: [{
      id: "thought-1",
      role: "assistant",
      contentKind: "thought",
      text: "首行内容\n后续内容",
      timestamp: "2026-07-04T10:00:02.000Z",
      streaming: true,
      streamMode: "delta",
    }],
  }));
  applyTimelineBatch(2, "首行内容\n后续内容", true);
  assert.equal(
    useDeckStore.getState().messages[sessionId]?.[0]?.text,
    "首行内容\n后续内容",
  );

  applyTimelineBatch(3, "首行内容\n后续内容", false);
  assert.equal(useDeckStore.getState().messages[sessionId]?.[0]?.text, undefined);
});

test("compaction timeline_batch removes its matching live assistant overlay", () => {
  resetStore();
  useDeckStore.setState({
    messages: {
      "session-1": [
        {
          id: "opencode-compaction-summary",
          role: "assistant",
          text: "## Objective\n- Continue the task.",
          timestamp: "2026-07-20T14:01:13.000Z",
          streaming: true,
        } as AgentMessage,
      ],
    },
  });

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "timeline_batch",
        batch: {
          replace: false,
          deliverySequence: 1,
          lastSequence: 1,
          entries: [
            {
              id: "compaction:opencode-compaction-summary",
              kind: "context_compaction",
              phase: "completed",
              source: "provider",
              summaryMessageId: "opencode-compaction-summary",
              summaryText: "## Objective\n- Continue the task.",
              timestamp: "2026-07-20T14:01:13.159Z",
              updatedAt: "2026-07-20T14:01:13.159Z",
              replayCompleteness: "compacted",
              detailsVisibility: "expandable",
            },
          ],
        },
      },
    },
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().messages["session-1"], []);
});

test("idle live_state clears stale non-terminal live tool overlays without terminal history", () => {
  resetStore();
  const toolCalls = {
    "session-1": [
      {
        id: "subagent-1",
        kind: "subagent",
        title: "Read-only subagent",
        status: "running",
        timestamp: "2026-07-19T15:20:00.000Z",
        updatedAt: "2026-07-19T15:20:01.000Z",
      } as AgentToolCall,
    ],
  };
  const toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>> = { current: toolCalls };
  useDeckStore.setState({ toolCalls });

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "live_state",
        snapshot: {
          sequence: 12,
          status: { runtimeStatus: "idle", effectiveStatus: "idle", pendingApprovalCount: 0 },
          config: { configOptions: [], modelOptions: [] },
          availableCommands: [],
          sessionInfo: {},
          diffs: [],
        },
      } as any,
    },
    createSessionEventContext({ toolCallsRef }),
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().toolCalls["session-1"], []);
  assert.equal(toolCallsRef.current, useDeckStore.getState().toolCalls);
});

test("session live_state snapshots replace plan and prompt queue", () => {
  resetStore();
  useDeckStore.setState({
    sessions: [{ ...session("session-1"), status: "running", model: "old-model" }],
    statuses: { "session-1": "running" },
    diffs: {
      "session-1": [{ path: "src/current.ts", status: "modified", additions: 1, deletions: 0 }],
    },
    sessionPlans: {
      "session-1": {
        entries: [{ content: "Old plan", priority: "medium", status: "completed" }],
        updatedAt: "2026-06-29T09:00:00.000Z",
      },
    },
    promptQueues: {
      "session-1": {
        sessionId: "session-1",
        queued: [{
          id: "queued-old",
          sessionId: "session-1",
          text: "old",
          clientMessageId: "client-queued-old",
          createdAt: "2026-06-29T09:00:00.000Z",
          updatedAt: "2026-06-29T09:00:00.000Z",
          status: "queued",
        }],
      },
    },
  });

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "live_state",
        snapshot: {
          status: {
            runtimeStatus: "idle",
            effectiveStatus: "idle",
            pendingApprovalCount: 0,
          },
          config: { model: "legacy-model", configOptions: [], modelOptions: [] },
          diffs: [{ path: "src/legacy.ts", status: "modified", additions: 9, deletions: 0 }],
          promptQueue: {
            sessionId: "session-1",
            queued: [{
              id: "queued-new",
              sessionId: "session-1",
              text: "new",
              clientMessageId: "client-queued-new",
              createdAt: "2026-06-29T10:00:00.000Z",
              updatedAt: "2026-06-29T10:00:00.000Z",
              status: "queued",
            }],
          },
        },
      },
    },
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessions[0]?.status, "running");
  assert.equal(useDeckStore.getState().sessions[0]?.model, "old-model");
  assert.equal(useDeckStore.getState().diffs["session-1"]?.[0]?.path, "src/current.ts");
  assert.deepEqual(useDeckStore.getState().sessionPlans["session-1"], {
    entries: [{ content: "Old plan", priority: "medium", status: "completed" }],
    updatedAt: "2026-06-29T09:00:00.000Z",
  });
  assert.deepEqual(useDeckStore.getState().promptQueues["session-1"], {
    sessionId: "session-1",
    queued: [{
      id: "queued-new",
      sessionId: "session-1",
      text: "new",
      clientMessageId: "client-queued-new",
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
      status: "queued",
    }],
  });
});

test("session live_state projects the full canonical snapshot", () => {
  resetStore();
  useDeckStore.setState({
    sessions: [{ ...session("session-1"), status: "starting" }],
    statuses: { "session-1": "starting" },
  });

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "live_state",
        snapshot: {
          sequence: 8,
          status: {
            runtimeStatus: "running",
            effectiveStatus: "waiting_for_permission",
            pendingApprovalCount: 1,
          },
          config: {
            agentMode: "plan",
            model: "gpt-5",
            reasoningEffort: "high",
            configOptions: [{ id: "mode", label: "Mode", category: "mode" }],
            modelOptions: [{ id: "gpt-5", name: "GPT-5", label: "GPT-5" }],
          },
          availableCommands: [{ name: "review", description: "Review changes" }],
          usage: { used: 12, size: 100 },
          sessionInfo: { title: "Canonical title", updatedAt: "2026-07-12T10:00:00.000Z" },
          diffs: [{ path: "src/a.ts", status: "modified", additions: 2, deletions: 1 }],
          plan: {
            entries: [{ content: "Review", priority: "high", status: "in_progress" }],
            updatedAt: "2026-07-12T10:00:00.000Z",
          },
        },
      } as any,
    },
    createSessionEventContext(),
  );

  const state = useDeckStore.getState();
  assert.equal(handled, true);
  assert.equal(state.statuses["session-1"], "starting");
  assert.equal(state.sessions[0]?.status, "starting");
  assert.equal(state.sessions[0]?.model, "gpt-5");
  assert.equal(state.sessions[0]?.agentMode, "plan");
  assert.equal(state.sessions[0]?.reasoningEffort, "high");
  assert.equal(state.sessions[0]?.title, "Canonical title");
  assert.equal(state.sessionConfigOptions["session-1"]?.[0]?.currentValue, "plan");
  assert.equal(state.sessionAvailableCommands["session-1"]?.[0]?.name, "review");
  assert.equal(state.agentAvailableCommands.a1?.[0]?.name, "review");
  assert.equal(state.diffs["session-1"]?.[0]?.path, "src/a.ts");
  assert.equal(state.sessionLiveStates["session-1"]?.usage?.used, 12);
  assert.equal(state.sessionLiveStateSequences["session-1"], 8);
});

test("session live_state does not erase known config with an uninitialized canonical config", () => {
  resetStore();
  const configOptions = [{
    id: "model",
    name: "Model",
    category: "model",
    currentValue: "cpa-oai/gpt-5.5",
    options: [{ value: "cpa-oai/gpt-5.5", label: "GPT-5.5" }],
  }];
  useDeckStore.setState({
    sessions: [{
      ...session("session-1"),
      model: "cpa-oai/gpt-5.5",
      configOptions,
    }],
    sessionConfigOptions: { "session-1": configOptions },
  });

  applySessionUpdate({
    sessionId: "session-1",
    update: {
      kind: "live_state",
      snapshot: {
        sequence: 1496,
        status: { runtimeStatus: "idle", effectiveStatus: "idle", pendingApprovalCount: 0 },
        config: { configOptions: [], modelOptions: [] },
        availableCommands: [],
        sessionInfo: {},
        diffs: [],
      },
    } as any,
  }, createSessionEventContext());

  const state = useDeckStore.getState();
  assert.equal(state.sessions[0]?.model, "cpa-oai/gpt-5.5");
  assert.deepEqual(state.sessions[0]?.configOptions, configOptions);
  assert.deepEqual(state.sessionConfigOptions["session-1"], configOptions);
  assert.equal(state.sessionLiveStateSequences["session-1"], 1496);
});

test("sequenced live_state applies one atomic Deck store update", () => {
  resetStore();
  useDeckStore.setState({ sessions: [{ ...session("session-1"), status: "starting" }] });
  let updates = 0;
  const unsubscribe = useDeckStore.subscribe(() => {
    updates += 1;
  });

  applySessionUpdate({
    sessionId: "session-1",
    update: {
      kind: "live_state",
      snapshot: {
        sequence: 1,
        status: { runtimeStatus: "running", effectiveStatus: "running", pendingApprovalCount: 0 },
        config: { configOptions: [], modelOptions: [] },
        availableCommands: [],
        sessionInfo: {},
        diffs: [],
        plan: { entries: [], updatedAt: "2026-07-12T00:00:00.000Z" },
        promptQueue: { sessionId: "session-1", queued: [] },
      },
    } as any,
  }, createSessionEventContext());
  unsubscribe();

  assert.equal(updates, 1);
});

test("session live_state ignores an out-of-order canonical snapshot", () => {
  resetStore();
  useDeckStore.setState({
    sessions: [{ ...session("session-1"), status: "starting" }],
    statuses: { "session-1": "starting" },
  });
  const context = createSessionEventContext();

  applySessionUpdate({
    sessionId: "session-1",
    update: {
      kind: "live_state",
      snapshot: {
        sequence: 8,
        status: { runtimeStatus: "running", effectiveStatus: "running", pendingApprovalCount: 0 },
        config: { configOptions: [], modelOptions: [], model: "gpt-5" },
        availableCommands: [],
        sessionInfo: {},
        diffs: [],
      },
    } as any,
  }, context);
  applySessionUpdate({
    sessionId: "session-1",
    update: {
      kind: "live_state",
      snapshot: {
        sequence: 7,
        status: { runtimeStatus: "error", effectiveStatus: "error", pendingApprovalCount: 0 },
        config: { configOptions: [], modelOptions: [], model: "stale-model" },
        availableCommands: [],
        sessionInfo: {},
        diffs: [],
      },
    } as any,
  }, context);

  const state = useDeckStore.getState();
  assert.equal(state.statuses["session-1"], "starting");
  assert.equal(state.sessions[0]?.model, "gpt-5");
  assert.equal(state.sessionLiveStateSequences["session-1"], 8);
});

test("session lifecycle updates keep canonical status over a stale live snapshot", () => {
  resetStore();
  useDeckStore.setState({ sessions: [{ ...session("session-1"), status: "starting" }] });
  const context = createSessionEventContext();

  applySessionUpdate({
    sessionId: "session-1",
    update: {
      kind: "live_state",
      snapshot: {
        sequence: 8,
        status: { runtimeStatus: "running", effectiveStatus: "waiting_for_permission", pendingApprovalCount: 1 },
        config: { configOptions: [], modelOptions: [], model: "gpt-5" },
        availableCommands: [],
        sessionInfo: {},
        diffs: [],
      },
    } as any,
  }, context);
  applySessionUpdate({
    sessionId: "session-1",
    update: { kind: "session_updated", session: { ...session("session-1"), status: "idle", model: "stale-model" } },
  }, context);

  const state = useDeckStore.getState();
  assert.equal(state.statuses["session-1"], "idle");
  assert.equal(state.sessions[0]?.status, "idle");
  assert.equal(state.sessions[0]?.model, "gpt-5");
});

test("a stale live_state cannot overwrite a later global idle lifecycle update", () => {
  resetStore();
  useDeckStore.setState({
    sessions: [{ ...session("session-1"), status: "running" }],
    statuses: { "session-1": "running" },
  });
  const context = createSessionEventContext();

  applySessionUpdate({
    sessionId: "session-1",
    update: {
      kind: "session_updated",
      session: { ...session("session-1"), status: "idle" },
    },
  }, context);
  applySessionUpdate({
    sessionId: "session-1",
    update: {
      kind: "live_state",
      snapshot: {
        sequence: 9,
        status: { runtimeStatus: "running", effectiveStatus: "running", pendingApprovalCount: 0 },
        config: { configOptions: [], modelOptions: [] },
        availableCommands: [],
        sessionInfo: {},
        diffs: [],
      },
    } as any,
  }, context);

  const state = useDeckStore.getState();
  assert.equal(state.statuses["session-1"], "idle");
  assert.equal(state.sessions[0]?.status, "idle");
});

test("session_updated synchronizes the lifecycle status map", () => {
  resetStore();
  useDeckStore.setState({
    sessions: [{ ...session("session-1"), status: "error" }],
    statuses: { "session-1": "error" },
  });

  const handled = applySessionUpdate({
    sessionId: "session-1",
    update: {
      kind: "session_updated",
      session: { ...session("session-1"), status: "idle" },
    },
  }, createSessionEventContext());

  const state = useDeckStore.getState();
  assert.equal(handled, true);
  assert.equal(state.sessions[0]?.status, "idle");
  assert.equal(state.statuses["session-1"], "idle");
});

test("session updates reject legacy transcript_event events", () => {
  resetStore();
  useDeckStore.setState({
    sessionTimeline: {
      "session-1": [
        {
          id: "compaction-session-1",
          kind: "context_compaction",
          phase: "completed",
          source: "provider",
          summaryText: "Earlier compact summary",
          timestamp: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          replayCompleteness: "compacted",
          detailsVisibility: "expandable",
        },
      ],
    },
  });

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "transcript_event",
        entry: {
          id: "compaction-session-1",
          kind: "context_compaction",
          phase: "completed",
          source: "provider",
          summaryText: "Updated compact summary",
          timestamp: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:01.000Z",
          replayCompleteness: "compacted",
          detailsVisibility: "hidden",
        },
      } as any,
    },
    createSessionEventContext(),
  );

  const [entry] = useDeckStore.getState().sessionTimeline["session-1"] ?? [];
  assert.equal(handled, false);
  assert.equal(entry?.kind, "context_compaction");
  assert.equal(entry?.kind === "context_compaction" ? entry.summaryText : undefined, "Earlier compact summary");
  assert.equal(entry?.kind === "context_compaction" ? entry.detailsVisibility : undefined, "expandable");
});

test("session updates reject legacy transcript events without changing timeline anchors", () => {
  resetStore();
  useDeckStore.setState({
    sessionTimeline: {
      "session-1": [
        {
          id: "user-1",
          kind: "user_message",
          message: {
            id: "user-1",
            role: "user",
            text: "继续",
            timestamp: "2026-06-28T00:00:00.000Z",
            sequence: 1,
          },
          timestamp: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          sequence: 1,
        },
        {
          id: "synthetic-compaction",
          kind: "context_compaction",
          phase: "completed",
          source: "provider",
          summaryMessageId: "compaction-completed-message",
          timestamp: "2026-06-28T00:00:01.000Z",
          updatedAt: "2026-06-28T00:00:01.000Z",
          replayCompleteness: "compacted",
        },
        {
          id: "assistant-1",
          kind: "assistant_message",
          chunks: [
            {
              id: "assistant-1:content",
              kind: "content",
              text: "压缩后继续处理。",
              timestamp: "2026-06-28T00:00:02.000Z",
              sequence: 2,
            },
          ],
          timestamp: "2026-06-28T00:00:02.000Z",
          updatedAt: "2026-06-28T00:00:02.000Z",
          sequence: 2,
        },
      ],
    },
  });

  const handled = applySessionUpdate(
    {
      sessionId: "session-1",
      update: {
        kind: "transcript_event",
        entry: {
          id: "authoritative-compaction",
          kind: "context_compaction",
          phase: "completed",
          source: "provider",
          summaryMessageId: "compaction-summary-message",
          summaryText: "This session is being continued from a previous conversation that ran out of context.",
          timestamp: "2026-06-28T00:00:05.000Z",
          updatedAt: "2026-06-28T00:00:05.000Z",
          replayCompleteness: "compacted",
          detailsVisibility: "expandable",
        },
      } as any,
    },
    createSessionEventContext(),
  );

  const timeline = useDeckStore.getState().sessionTimeline["session-1"] ?? [];
  const compactionEntries = timeline.filter((entry) => entry.kind === "context_compaction");
  assert.equal(handled, false);
  assert.equal(compactionEntries.length, 1);
  assert.deepEqual(timeline.map((entry) => entry.id), [
    "user-1",
    "synthetic-compaction",
    "assistant-1",
  ]);
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction" ? compactionEntries[0].summaryText : undefined,
    undefined,
  );
});

test("session/get_artifacts preserves existing canonical timeline reference", () => {
  resetStore();
  const toolCallsRef = { current: {} as Record<string, AgentToolCall[]> };
  const mergeSessionToolCalls = (sessionId: string, incoming: AgentToolCall[]) => {
    useDeckStore.getState().setToolCalls((current) => {
      const nextSessionToolCalls = [...(current[sessionId] ?? [])];
      for (const toolCall of incoming) {
        const index = nextSessionToolCalls.findIndex((entry) => entry.id === toolCall.id);
        if (index === -1) {
          nextSessionToolCalls.push(toolCall);
        } else {
          nextSessionToolCalls[index] = toolCall;
        }
      }
      const next = { ...current, [sessionId]: nextSessionToolCalls };
      toolCallsRef.current = next;
      return next;
    });
  };
  const toolCall: AgentToolCall = {
    id: "call-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    output: "stdout",
    timestamp: "2026-05-17T10:00:01.000Z",
    updatedAt: "2026-05-17T10:00:01.000Z",
    sequence: 2,
  };
  const existingTimeline: SessionTimelineEntry[] = [{
    id: "tool:call-1",
    kind: "tool_call",
    toolCall,
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    sequence: toolCall.sequence,
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
    createSessionEventContext({
      toolCallsRef,
      mergeSessionToolCalls,
    }),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessionTimeline["session-1"], existingTimeline);
  assert.deepEqual(
    useDeckStore.getState().toolCalls["session-1"]?.map((entry) => entry.id),
    ["call-1"],
  );
});

test("session/get_artifacts updates live tool calls before initial canonical history finishes loading", () => {
  resetStore();
  const toolCallsRef = { current: {} as Record<string, AgentToolCall[]> };
  const mergeSessionToolCalls = (sessionId: string, incoming: AgentToolCall[]) => {
    useDeckStore.getState().setToolCalls((current) => {
      const nextSessionToolCalls = [...(current[sessionId] ?? [])];
      for (const toolCall of incoming) {
        const index = nextSessionToolCalls.findIndex((entry) => entry.id === toolCall.id);
        if (index === -1) {
          nextSessionToolCalls.push(toolCall);
        } else {
          nextSessionToolCalls[index] = toolCall;
        }
      }
      const next = { ...current, [sessionId]: nextSessionToolCalls };
      toolCallsRef.current = next;
      return next;
    });
  };
  const toolCall: AgentToolCall = {
    id: "call-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    output: "stdout",
    timestamp: "2026-05-17T10:00:01.000Z",
    updatedAt: "2026-05-17T10:00:01.000Z",
    sequence: 2,
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
    createSessionEventContext({
      toolCallsRef,
      mergeSessionToolCalls,
    }),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessionTimeline["session-1"], undefined);
  assert.deepEqual(
    useDeckStore.getState().toolCalls["session-1"]?.map((entry) => entry.id),
    ["call-1"],
  );
});

test("session/get_artifacts keeps canonical timeline untouched while refreshing live tool activity", () => {
  resetStore();
  const toolCallsRef = { current: {} as Record<string, AgentToolCall[]> };
  const mergeSessionToolCalls = (sessionId: string, incoming: AgentToolCall[]) => {
    useDeckStore.getState().setToolCalls((current) => {
      const nextSessionToolCalls = [...(current[sessionId] ?? [])];
      for (const toolCall of incoming) {
        const index = nextSessionToolCalls.findIndex((entry) => entry.id === toolCall.id);
        if (index === -1) {
          nextSessionToolCalls.push(toolCall);
        } else {
          nextSessionToolCalls[index] = toolCall;
        }
      }
      const next = { ...current, [sessionId]: nextSessionToolCalls };
      toolCallsRef.current = next;
      return next;
    });
  };
  const existingAssistant: SessionTimelineEntry = {
    id: "assistant-1",
    kind: "assistant_message",
    chunks: [
      {
        id: "assistant-1:content",
        kind: "content",
        text: "我先检查文件。",
        timestamp: "2026-05-24T10:00:00.000Z",
        sequence: 1,
      },
    ],
    timestamp: "2026-05-24T10:00:00.000Z",
    updatedAt: "2026-05-24T10:00:00.000Z",
    sequence: 1,
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
          sequence: 2,
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
          sequence: 2,
        },
      ],
      diffs: [],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext({
      toolCallsRef,
      mergeSessionToolCalls,
    }),
  );

  const timeline = useDeckStore.getState().sessionTimeline["session-1"] ?? [];
  const liveToolCalls = useDeckStore.getState().toolCalls["session-1"] ?? [];
  const outputs = useDeckStore.getState().outputs["session-1"] ?? [];
  assert.equal(handled, true);
  assert.deepEqual(timeline.map((entry) => entry.id), ["assistant-1"]);
  assert.deepEqual(outputs.map((output) => output.id), ["output-1"]);
  assert.equal(outputs[0]?.text, "stdout");
  assert.deepEqual(liveToolCalls.map((toolCall) => toolCall.id), ["call-1"]);
  assert.equal(liveToolCalls.find((toolCall) => toolCall.id === "call-1")?.status, "running");
});

test("session/get_artifacts no longer stores session plans", () => {
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
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessionPlans["session-1"], undefined);
});

test("session/get_artifacts records incomplete legacy diff snapshots", () => {
  resetStore();

  const handled = applySessionResult(
    "session/get_artifacts",
    {
      sessionId: "legacy-diff-session",
      outputs: [],
      toolCalls: [],
      diffs: [{ path: "src/legacy.ts", status: "modified", additions: 2, deletions: 1 }],
      historicalDiffIncomplete: true,
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().historicalDiffIncompleteBySession["legacy-diff-session"], true);
});

test("session/get_artifacts preserves existing session plans because it no longer owns them", () => {
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

test("session_updated replaces stale model data on the active session summary", () => {
  resetStore();
  useDeckStore.setState({
    sessions: [
      {
        ...session("s1"),
        projectId: "p1",
        cwd: "D:/repo",
        agentId: "claude-code",
        model: "claude-sonnet-old",
        modelOptions: [{ id: "claude-sonnet-old", name: "Claude Sonnet Old" }],
      },
    ],
  });
  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "session_updated",
        session: {
          ...session("s1"),
          projectId: "p1",
          cwd: "D:/repo",
          agentId: "claude-code",
          runtimeSessionId: "runtime-new",
          model: "claude-sonnet-new",
          modelOptions: [{ id: "claude-sonnet-new", name: "Claude Sonnet New" }],
        },
      },
    },
    createSessionEventContext(),
  );

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().sessions[0]?.model, "claude-sonnet-new");
  assert.deepEqual(useDeckStore.getState().sessions[0]?.modelOptions, [
    { id: "claude-sonnet-new", name: "Claude Sonnet New" },
  ]);
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

test("activity updates reject legacy plan_update events", () => {
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
      } as any,
    },
    {
      toolCallsRef: { current: {} },
      mergeSessionToolCalls: () => undefined,
      appendSystemMessage: () => undefined,
    },
  );

  assert.equal(handled, false);
  assert.equal(useDeckStore.getState().sessionPlans.s1, undefined);
});

test("activity updates reject legacy plan updates without changing stored plans", () => {
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
      } as any,
    },
    context,
  );

  assert.equal(emptyHandled, false);
  assert.equal(useDeckStore.getState().sessionPlans.s1?.entries.length, 2);

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
      } as any,
    },
    context,
  );

  assert.equal(replacementHandled, false);
  assert.deepEqual(useDeckStore.getState().sessionPlans.s1?.entries, [
    { content: "复核 Markdown 渲染", priority: "medium", status: "completed" },
    { content: "检查权限审核抽屉", priority: "medium", status: "completed" },
  ]);
});

test("approval created notifications hydrate active inventory and history", () => {
  resetStore();
  const approval = {
    id: "approval-1",
    sessionId: "s1",
    runtimeInstanceId: "runtime-1",
    sequence: 1,
    status: "pending" as const,
    request: {
      id: "approval-1",
      command: "Approve MCP tool call :: {}",
      reason: "等待审核",
      cwd: "D:/repo",
    },
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
  };

  const handled = applyApprovalCreated({
    sessionId: "s1",
    request: approval.request as any,
    approval,
  });

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().approvalItemsById["approval-1"]?.createdAt, approval.createdAt);
  assert.deepEqual(useDeckStore.getState().approvalHistory, [approval]);
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
    approval: {
      id: "approval-1",
      sessionId: "s1",
      runtimeInstanceId: "runtime-1",
      sequence: 2,
      status: "resolved",
      decision: "allow",
      request: {
        id: "approval-1",
        command: "Approve MCP tool call :: {}",
        reason: "等待审核",
        cwd: "D:/repo",
      },
      createdAt: "2026-07-26T10:00:00.000Z",
      updatedAt: "2026-07-26T10:01:00.000Z",
    },
  });

  assert.equal(handled, true);
  assert.equal(useDeckStore.getState().approvalItemsById["approval-1"], undefined);
  assert.deepEqual(useDeckStore.getState().pendingApprovalIds, []);
  assert.equal(useDeckStore.getState().approvalHistory[0]?.status, "resolved");
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

test("session list clears stale resume requests for authoritative same-process sessions", () => {
  resetStore();
  const resumeStartRequestsRef = {
    current: new Set(["same-process", "historical"]),
  };
  let resumeStartRequestIds = new Set(["same-process", "historical"]);

  const handled = applySessionResult(
    "session/list",
    {
      sessions: [
        {
          ...session("same-process"),
          status: "idle" as const,
          resume: {
            state: "resume-available" as const,
            mode: "same-process" as const,
            restoreMethod: "client-reconnect" as const,
          },
        },
        {
          ...session("historical"),
          status: "idle" as const,
          resume: {
            state: "resume-available" as const,
            mode: "reconnect" as const,
            restoreMethod: "session/load" as const,
          },
        },
      ],
      hasMore: false,
    },
    "helm-1",
    true,
    createSessionEventContext({
      resumeStartRequestsRef,
      setResumeStartRequestIds: (update: (current: Set<string>) => Set<string>) => {
        resumeStartRequestIds = update(resumeStartRequestIds);
      },
    }),
  );

  assert.equal(handled, true);
  assert.deepEqual([...resumeStartRequestsRef.current], ["historical"]);
  assert.deepEqual([...resumeStartRequestIds], ["historical"]);
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

test("session updates reject legacy config option events", () => {
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
  const initialConfigOptions = useDeckStore.getState().sessionConfigOptions.s1;

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "config_options",
        state: { model: "gpt-5.5", reasoningEffort: "medium" },
        options: configOptions,
      } as any,
    },
    createSessionEventContext(),
  );

  assert.equal(handled, false);
  assert.equal(useDeckStore.getState().sessions[0]?.model, "gpt-5.4");
  assert.equal(useDeckStore.getState().sessions[0]?.reasoningEffort, "high");
  assert.deepEqual(useDeckStore.getState().sessionConfigOptions.s1, initialConfigOptions);
});

test("session updates reject legacy config option events without changing configuration", () => {
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
  const initialConfigOptions = useDeckStore.getState().sessionConfigOptions.s1;

  const handled = applySessionUpdate(
    {
      sessionId: "s1",
      update: {
        kind: "config_options",
        state: { model: "claude-haiku-4-5" },
        options: configOptions,
      } as any,
    },
    createSessionEventContext(),
  );

  assert.equal(handled, false);
  assert.equal(useDeckStore.getState().sessions[0]?.model, "claude-haiku-4-5");
  assert.equal(useDeckStore.getState().sessions[0]?.reasoningEffort, "medium");
  assert.deepEqual(useDeckStore.getState().sessionConfigOptions.s1, initialConfigOptions);
});

test("session updates reject legacy arbitrary config option events", () => {
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
      } as any,
    },
    createSessionEventContext(),
  );

  assert.equal(handled, false);
  assert.equal(useDeckStore.getState().sessionConfigOptions.s1, undefined);
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
  let resumeStartRequestIds = new Set<string>(["s1"]);
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
      setResumeStartRequestIds: (update: (current: Set<string>) => Set<string>) => {
        resumeStartRequestIds = update(resumeStartRequestIds);
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(pendingRequests.has("s1"), false);
  assert.equal(resumeStartRequestIds.has("s1"), false);
  assert.equal(feedback, "已恢复");
  assert.equal(useDeckStore.getState().sessions[0]?.runtimeSessionId, "runtime-s1");
  assert.deepEqual(dispatched, ["agent/connections"]);
});

test("successful session/load resume reloads canonical timeline", () => {
  resetStore();
  const pendingRequests = new Set<string>(["s1"]);
  let feedback = "";
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];
  useDeckStore.setState({
    sessions: [session("s1")],
    messageHistoryState: {
      s1: {
        hasMore: true,
        nextCursor: "cursor-1",
        loading: false,
      } as any,
    },
  });

  const handled = applySessionResult(
    "session/resume",
    {
      sessionId: "s1",
      ok: true,
      message: "已恢复",
      resume: {
        state: "resume-available",
        mode: "reconnect",
        restoreMethod: "session/load",
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
      dispatch: async (_client, method, params) => {
        dispatched.push({ method, params: (params ?? {}) as Record<string, unknown> });
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
  assert.deepEqual(dispatched, [
    { method: "agent/connections", params: {} },
    { method: "session/list_timeline", params: { sessionId: "s1", limit: 20 } },
  ]);
  assert.deepEqual(useDeckStore.getState().messageHistoryState.s1, {
    hasMore: true,
    nextCursor: "cursor-1",
    loading: true,
  });
});

test("successful client-reconnect resume reloads canonical timeline when no canonical entries are loaded yet", () => {
  resetStore();
  const pendingRequests = new Set<string>(["s1"]);
  let feedback = "";
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];
  useDeckStore.setState({
    sessions: [session("s1")],
    sessionTimeline: {
      s1: [],
    },
    messageHistoryState: {
      s1: {
        hasMore: true,
        nextCursor: "cursor-1",
        loading: false,
      },
    },
  });

  const handled = applySessionResult(
    "session/resume",
    {
      sessionId: "s1",
      ok: true,
      message: "已恢复",
      resume: {
        state: "resume-available",
        mode: "reconnect",
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
      dispatch: async (_client, method, params) => {
        dispatched.push({ method, params: (params ?? {}) as Record<string, unknown> });
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
  assert.deepEqual(dispatched, [
    { method: "agent/connections", params: {} },
    { method: "session/list_timeline", params: { sessionId: "s1", limit: 20 } },
  ]);
  assert.deepEqual(useDeckStore.getState().messageHistoryState.s1, {
    hasMore: true,
    nextCursor: "cursor-1",
    loading: true,
  });
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
    { approvals: [{ sessionId: "s1", request, status: "resolving" }] },
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
  assert.equal(useDeckStore.getState().approvalItemsById["approval-1"]?.resolving, true);
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

test("approval history list results replace the persisted dashboard projection", () => {
  resetStore();
  const approval = {
    id: "approval-history-1",
    sessionId: "s1",
    runtimeInstanceId: "runtime-1",
    sequence: 3,
    status: "expired",
    request: {
      id: "approval-history-1",
      command: "shell_command",
      reason: "Run tests",
      cwd: "D:/repo",
    },
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:02:00.000Z",
  } as any;

  const context = {
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
    resumeStartRequestsRef: { current: new Set<string>() },
  };
  const handled = applySessionResult(
    "approval/list",
    { approvals: [approval], hasMore: false },
    "helm-1",
    true,
    context,
  );

  assert.equal(handled, true);
  assert.deepEqual(useDeckStore.getState().approvalHistory, [approval]);

  const pending = { ...approval, id: "approval-pending", status: "pending" };
  const clearHandled = applySessionResult(
    "approval/clear_history",
    { ok: true, removed: 1, approvals: [pending], hasMore: false },
    "helm-1",
    true,
    context,
  );

  assert.equal(clearHandled, true);
  assert.deepEqual(useDeckStore.getState().approvalHistory, [pending]);
});
