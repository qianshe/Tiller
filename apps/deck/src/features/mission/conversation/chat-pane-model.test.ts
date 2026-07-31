import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import {
  formatSessionPreviewTime,
  hasSessionBodyScrollSnapshotChanged,
  resolveSessionConversationDisplayMode,
  resolveSessionStatusLabel,
  resolveSessionStatusTone,
  resolveSessionStreamContentLength,
  splitMissionToolCalls,
} from "./chat-pane-model";

test("session body snapshot changes when initial history loading completes", () => {
  const loadingSnapshot = {
    messageCount: 12,
    toolCallCount: 3,
    contentLength: 240,
    historyLoading: true,
  };

  assert.equal(
    hasSessionBodyScrollSnapshotChanged(loadingSnapshot, {
      ...loadingSnapshot,
      historyLoading: false,
    }),
    true,
  );
  assert.equal(
    hasSessionBodyScrollSnapshotChanged(loadingSnapshot, loadingSnapshot),
    false,
  );
});

test("splitMissionToolCalls keeps tools titled Thinking in the tool timeline", () => {
  const split = splitMissionToolCalls([
    { id: "think", commandId: "think", kind: "tool", title: "Thinking", status: "running", timestamp: "2026-05-29T00:00:00.000Z" },
    { id: "cmd", commandId: "cmd", kind: "shell", title: "Shell", status: "completed", timestamp: "2026-05-29T00:00:01.000Z" },
  ] as any);

  assert.deepEqual(split.timelineToolCalls.map((item) => item.id), ["think", "cmd"]);
  assert.deepEqual(split.boundaryTimestamps, ["2026-05-29T00:00:00.000Z", "2026-05-29T00:00:01.000Z"]);
});

test("splitMissionToolCalls leaves canonical assistant thinking in the assistant timeline", () => {
  const split = splitMissionToolCalls([], [
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:thinking",
          kind: "thinking",
          text: "Let me inspect",
          title: "Thinking",
          status: "completed",
          timestamp: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
      ],
      timestamp: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
    {
      id: "tool:cmd-1",
      kind: "tool_call",
      toolCall: {
        id: "cmd-1",
        commandId: "cmd-1",
        kind: "shell",
        title: "pnpm test",
        status: "running",
        timestamp: "2026-06-30T00:00:01.000Z",
        updatedAt: "2026-06-30T00:00:01.000Z",
      },
      timestamp: "2026-06-30T00:00:01.000Z",
      updatedAt: "2026-06-30T00:00:01.000Z",
    },
  ] as SessionTimelineEntry[]);

  assert.deepEqual(split.timelineToolCalls.map((item) => item.id), ["cmd-1"]);
  assert.deepEqual(split.boundaryTimestamps, ["2026-06-30T00:00:01.000Z"]);
});

test("splitMissionToolCalls keeps canonical Todo completion over a stale live overlay", () => {
  const liveTodos: AgentToolCall[] = [
    {
      id: "call-todo-1",
      kind: "todo",
      title: "Update todos",
      status: "running",
      timestamp: "2026-07-20T04:35:18.588Z",
      updatedAt: "2026-07-20T04:35:18.588Z",
    },
    {
      id: "call-todo-2",
      kind: "todo",
      title: "Update todos",
      status: "running",
      timestamp: "2026-07-20T04:35:23.055Z",
      updatedAt: "2026-07-20T04:35:23.055Z",
    },
  ];
  const split = splitMissionToolCalls(liveTodos, liveTodos.map((liveTodo, index) => ({
    id: `tool:${liveTodo.id}`,
    kind: "tool_call",
    toolCall: {
      ...liveTodo,
      status: "completed",
      updatedAt: "2026-07-20T04:35:28.792Z",
    },
    timestamp: liveTodo.timestamp,
    updatedAt: "2026-07-20T04:35:28.792Z",
    sequence: 14409 + index,
  })) as SessionTimelineEntry[]);

  assert.deepEqual(
    split.timelineToolCalls.map((toolCall) => [toolCall.id, toolCall.status]),
    [
      ["call-todo-1", "completed"],
      ["call-todo-2", "completed"],
    ],
  );
});

test("resolveSessionStatusTone maps session statuses", () => {
  assert.equal(resolveSessionStatusTone("running" as any), "primary");
  assert.equal(resolveSessionStatusTone("waiting_for_permission" as any), "warning");
  assert.equal(resolveSessionStatusTone("error" as any), "danger");
  assert.equal(resolveSessionStatusTone("idle" as any), "idle");
});

test("resolveSessionStatusLabel maps every session status to a short word", () => {
  assert.equal(resolveSessionStatusLabel("starting" as any), "启动中");
  assert.equal(resolveSessionStatusLabel("running" as any), "运行中");
  assert.equal(resolveSessionStatusLabel("waiting_for_permission" as any), "等待审批");
  assert.equal(resolveSessionStatusLabel("idle" as any), "空闲");
  assert.equal(resolveSessionStatusLabel("error" as any), "错误");
  assert.equal(resolveSessionStatusLabel("cancelled" as any), "已取消");
});

test("resolveSessionConversationDisplayMode keeps optimistic live session messages visible until timeline arrives", () => {
  assert.equal(
    resolveSessionConversationDisplayMode({
      sessionId: "session-1",
      sessionMessages: [
        {
          id: "session-1-user-1751650000000",
          role: "user",
          text: "马上要进 timeline 的用户消息",
          timestamp: "2026-05-29T00:00:00.000Z",
        },
      ] as any,
      sessionStatus: "running" as any,
      timelineItemsLength: 0,
    }),
    "conversation",
  );
  assert.equal(
    resolveSessionConversationDisplayMode({
      sessionId: "session-1",
      sessionMessages: [
        {
          id: "assistant-streaming",
          role: "assistant",
          text: "流式输出中",
          streaming: true,
          timestamp: "2026-05-29T00:00:01.000Z",
        },
      ] as any,
      sessionStatus: "waiting_for_permission" as any,
      timelineItemsLength: 0,
    }),
    "conversation",
  );
});

test("resolveSessionConversationDisplayMode hides stable legacy history fallback before canonical timeline loads", () => {
  assert.equal(
    resolveSessionConversationDisplayMode({
      sessionId: "session-1",
      sessionMessages: [
        {
          id: "user-stable",
          role: "user",
          text: "旧会话里的稳定消息",
          timestamp: "2026-05-29T00:00:02.000Z",
        },
      ] as any,
      sessionStatus: "idle" as any,
      timelineItemsLength: 0,
    }),
    "history-loading",
  );
  assert.equal(
    resolveSessionConversationDisplayMode({
      sessionId: "session-1",
      sessionMessages: [],
      sessionStatus: "idle" as any,
      timelineItemsLength: 0,
    }),
    "preview",
  );
  assert.equal(
    resolveSessionConversationDisplayMode({
      sessionId: "session-1",
      sessionMessages: [
        {
          id: "user-stable",
          role: "user",
          text: "旧会话里的稳定消息",
          timestamp: "2026-05-29T00:00:02.000Z",
        },
      ] as any,
      sessionStatus: "idle" as any,
      timelineItemsLength: 3,
    }),
    "conversation",
  );
  assert.equal(
    resolveSessionConversationDisplayMode({
      sessionId: "session-1",
      sessionMessages: [
        {
          id: "assistant-streaming",
          role: "assistant",
          text: "旧 store 残留的 streaming 标记不该触发 fallback",
          streaming: true,
          timestamp: "2026-05-29T00:00:03.000Z",
        },
      ] as any,
      sessionStatus: "idle" as any,
      timelineItemsLength: 0,
    }),
    "history-loading",
  );
});

test("formatSessionPreviewTime returns placeholder for missing or invalid values", () => {
  assert.equal(formatSessionPreviewTime(undefined), "--:--");
  assert.equal(formatSessionPreviewTime("not-a-date"), "--:--");
});

test("resolveSessionStreamContentLength grows as streamed text and tool output grow", () => {
  const baseTimeline: SessionTimelineEntry[] = [
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content",
          text: "答",
          timestamp: "2026-05-29T00:00:00.000Z",
        },
      ],
      timestamp: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
    },
  ];
  const grownTimeline: SessionTimelineEntry[] = [
    {
      ...baseTimeline[0],
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content",
          text: "答案更长了",
          timestamp: "2026-05-29T00:00:00.000Z",
        },
      ],
    } as SessionTimelineEntry,
  ];

  const before = resolveSessionStreamContentLength({ timeline: baseTimeline });
  const after = resolveSessionStreamContentLength({ timeline: grownTimeline });
  assert.ok(after > before, "streamed content growth must increase the signature");

  const toolBefore = resolveSessionStreamContentLength({
    toolCalls: [
      { id: "t", kind: "shell", title: "Run", status: "running", output: "12", timestamp: "2026-05-29T00:00:00.000Z" },
    ] as any,
  });
  const toolAfter = resolveSessionStreamContentLength({
    toolCalls: [
      { id: "t", kind: "shell", title: "Run", status: "running", output: "123456", timestamp: "2026-05-29T00:00:00.000Z" },
    ] as any,
  });
  assert.ok(toolAfter > toolBefore, "growing tool output must increase the signature");

  assert.equal(resolveSessionStreamContentLength({}), 0);
});

test("shouldAutoScrollSessionBody suppresses auto-follow during history restore windows", async () => {
  const model = await import("./chat-pane-model.js") as Record<string, unknown>;
  assert.equal(typeof model.shouldAutoScrollSessionBody, "function");
  const shouldAutoScrollSessionBody = model.shouldAutoScrollSessionBody as (input: {
    stickToBottom?: boolean;
    forceInitialScroll?: boolean;
    historyLoading?: boolean;
    historyRevealLocked?: boolean;
    previousHistoryLoading?: boolean;
    allowAfterInitialHistoryLoad?: boolean;
  }) => boolean;

  assert.equal(
    shouldAutoScrollSessionBody({ stickToBottom: false, historyLoading: false }),
    false,
  );
  assert.equal(
    shouldAutoScrollSessionBody({
      stickToBottom: false,
      forceInitialScroll: true,
      previousHistoryLoading: true,
      historyLoading: false,
    }),
    true,
  );
  assert.equal(
    shouldAutoScrollSessionBody({
      stickToBottom: false,
      forceInitialScroll: true,
      historyLoading: false,
      historyRevealLocked: true,
    }),
    false,
  );
  assert.equal(
    shouldAutoScrollSessionBody({ stickToBottom: true, historyLoading: true }),
    false,
  );
  assert.equal(
    shouldAutoScrollSessionBody({ stickToBottom: true, previousHistoryLoading: true, historyLoading: false }),
    false,
  );
  assert.equal(
    shouldAutoScrollSessionBody({
      stickToBottom: true,
      previousHistoryLoading: true,
      historyLoading: false,
      allowAfterInitialHistoryLoad: true,
    }),
    true,
  );
  assert.equal(
    shouldAutoScrollSessionBody({ stickToBottom: true, historyLoading: false, historyRevealLocked: true }),
    false,
  );
  assert.equal(
    shouldAutoScrollSessionBody({ stickToBottom: true, historyLoading: false, historyRevealLocked: false }),
    true,
  );
});

test("resolveSessionBodyStickToBottom preserves sticky intent while streamed content grows", async () => {
  const model = await import("./chat-pane-model.js");
  assert.equal(typeof model.resolveSessionBodyStickToBottom, "function");

  assert.equal(
    model.resolveSessionBodyStickToBottom({
      current: { scrollTop: 400, scrollHeight: 1200, clientHeight: 500 },
      previous: { scrollTop: 400, scrollHeight: 900 },
      previousStickToBottom: true,
      threshold: 80,
    }),
    true,
  );
  assert.equal(
    model.resolveSessionBodyStickToBottom({
      current: { scrollTop: 300, scrollHeight: 1200, clientHeight: 500 },
      previous: { scrollTop: 400, scrollHeight: 1200 },
      previousStickToBottom: true,
      threshold: 80,
    }),
    false,
  );
  assert.equal(
    model.resolveSessionBodyStickToBottom({
      current: { scrollTop: 680, scrollHeight: 1200, clientHeight: 500 },
      previous: { scrollTop: 600, scrollHeight: 1200 },
      previousStickToBottom: false,
      threshold: 80,
    }),
    true,
  );
});

test("pruneSessionCardScrollState drops closed session snapshots", async () => {
  const model = await import("./chat-pane-model.js") as Record<string, unknown>;
  assert.equal(typeof model.pruneSessionCardScrollState, "function");
  const pruneSessionCardScrollState = model.pruneSessionCardScrollState as <T>(
    state: Record<string, T>,
    openSessionIds: ReadonlyArray<string>,
  ) => Record<string, T>;

  const pruned = pruneSessionCardScrollState(
    {
      "session-open": { scrollTop: 10, scrollHeight: 100 },
      "session-closed": { scrollTop: 20, scrollHeight: 200 },
    },
    ["session-open"],
  );

  assert.deepEqual(pruned, {
    "session-open": { scrollTop: 10, scrollHeight: 100 },
  });
});
