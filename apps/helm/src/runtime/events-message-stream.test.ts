import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  AgentPlan,
  AgentMessage,
  AgentToolCall,
  CanonicalSessionState,
  CommandChunk,
  PromptTraceEvent,
  SessionSummary,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import {
  cleanupRuntimeEventState,
  handleRuntimeEvent,
  flushRuntimeUserEchoLogSummaryForTest,
  nextLiveEventSequenceForTest,
  publishCanonicalSessionStateEvent,
  publishPromptQueueState,
  seedLiveEventSequenceForSession,
} from "./events.js";
import {
  createManualTimerHarness,
  createTestContext,
  findStructuredLog,
  structuredLogs,
  type TestContextCapture,
} from "./session/event/test-support.js";

test("runtime events emit first runtime and broadcast prompt trace markers", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    traceEvents: [],
  };
  const context = createTestContext(logs, capture, "trace-session");

  handleRuntimeEvent(
    "trace-session",
    {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "hello",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(
    capture.traceEvents?.some((event) => event.phase === "helm.runtime.first_message"),
    true,
  );
  assert.equal(
    capture.traceEvents?.some((event) => event.phase === "helm.session_update.broadcast"),
    true,
  );
});

test("runtime session.message finalizes canonical content without stdout text", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try {
    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: "message-1",
          role: "assistant",
          text: "你",
          timestamp: "2026-04-30T00:00:01.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );

    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: "message-1",
          role: "assistant",
          text: "好\n主人",
          timestamp: "2026-04-30T00:00:02.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );

    handleRuntimeEvent(
      "session-1",
      {
        type: "status",
        status: "idle",
        message: "done",
      } satisfies SessionRuntimeEvent,
      context,
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.deepEqual(
    structuredLogs(capture).map((log) => log.event),
    ["runtime.status.changed"],
  );
  assert.equal(findStructuredLog(capture, "runtime.status.changed")?.fields?.status, "idle");
  assert.doesNotMatch(JSON.stringify(structuredLogs(capture)), /preview|text|你|好|主人/u);
  assert.deepEqual(writes, []);
  assert.equal(capture.persisted.length, 0);
  assert.deepEqual(
    capture.observedTimelineMessages?.map((message) => message.text),
    ["你好\n主人"],
  );
  assert.equal(
    capture.detailBroadcasts.some((item: any) =>
      item.params?.update?.kind === "agent_message" &&
      item.params?.update?.streaming === false &&
      item.params?.update?.message?.text === "你好\n主人",
    ),
    true,
  );
  assert.equal(capture.broadcasts.length, 0);
  assert.ok(capture.detailBroadcasts.some((item: any) =>
    item.params?.update?.kind === "timeline_batch"
  ));
});

test("runtime assistant streaming deltas coalesce inside the live window before timer flush", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    sessionUpdates: [],
  };
  const timers = createManualTimerHarness();
  const context = createTestContext(logs, capture, "session-assistant-window", {}, {
    runtimeEventThrottleConfig: {
      assistantWindowMs: 32,
      assistantMaxChars: 256,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });

  handleRuntimeEvent(
    "session-assistant-window",
    {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "你",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-assistant-window",
    {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "好",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(timers.size(), 1);
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);
  assert.equal(
    capture.detailBroadcasts.filter((item: any) => item.params?.update?.kind === "agent_message").length,
    0,
  );

  timers.flushAll();

  const streamingUpdate = capture.detailBroadcasts.find((item: any) =>
    item.params?.update?.kind === "agent_message" && item.params?.update?.streaming === true
  ) as any;
  assert.equal(streamingUpdate?.params?.update?.message?.text, "你好");
  assert.equal(capture.sessionUpdates?.length, 0);
});

test("runtime streaming chunks defer summary persistence until flush", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "你",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "message-1",
        role: "assistant",
        text: "好",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.summaryUpdates?.length, 0);

  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.summaryUpdates?.length, 2);
  assert.equal(capture.persisted.length, 0);
  assert.equal(capture.observedTimelineMessages?.[0]?.text, "你好");
});

test("runtime stores OpenCode automatic compaction summaries as compaction entries", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture);
  const summary = [
    "## Objective",
    "- Continue the repository cleanup task.",
    "",
    "## Important Details",
    "- Preserve the existing worktree changes.",
    "",
    "## Work State",
    "### Completed",
    "- Located the relevant runtime path.",
    "",
    "### Active",
    "- Waiting for the next prompt.",
    "",
    "### Blocked",
    "- (none)",
    "",
    "## Next Move",
    "1. Continue from the recorded state.",
    "",
    "## Relevant Files",
    "- packages/acp-runtime/src/events.ts: maps ACP updates.",
  ].join("\n");

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "msg-opencode-compaction",
        role: "assistant",
        text: summary.slice(0, 120),
        timestamp: "2026-07-20T14:01:13.000Z",
        streaming: true,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "msg-opencode-compaction",
        role: "assistant",
        text: summary.slice(120),
        timestamp: "2026-07-20T14:01:13.159Z",
        streaming: true,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    { type: "status", status: "idle" } satisfies SessionRuntimeEvent,
    context,
  );

  const compactionEntries =
    capture.timelineEntries?.filter((entry) => entry.kind === "context_compaction") ?? [];
  assert.equal(compactionEntries.length, 1);
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction"
      ? compactionEntries[0].summaryText
      : undefined,
    summary,
  );
  assert.equal(
    capture.timelineEntries?.some((entry) => entry.kind === "assistant_message"),
    false,
  );
  assert.equal(
    capture.sessionUpdates?.some((update) => update.updateType === "message"),
    false,
  );
  assert.equal(
    capture.sessionUpdates?.some((update) => update.updateType === "compaction"),
    true,
  );
  assert.equal(
    capture.sessionUpdates?.find((update) => update.updateType === "compaction")?.sequence,
    1,
  );
});

test("runtime assistant chunks reuse one ordered segment id", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture, "session-stream-ordered");

  handleRuntimeEvent(
    "session-stream-ordered",
    {
      type: "message",
      message: {
        id: "session-stream-ordered-msg-a",
        role: "assistant",
        text: "hello",
        timestamp: "2026-05-15T10:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-stream-ordered",
    {
      type: "message",
      message: {
        id: "session-stream-ordered-msg-000001-000000-c1234abcd",
        role: "assistant",
        text: "hello world",
        timestamp: "2026-05-15T10:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-stream-ordered",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.persisted.length, 0);
  assert.equal(capture.observedTimelineMessages?.[0]?.text, "hello world");
  assert.match(capture.observedTimelineMessages?.[0]?.id ?? "", /^session-stream-ordered-msg-000001-000000-/u);
});

test("repeated running status does not advance turn without an active assistant segment", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture, "session-no-bump");

  handleRuntimeEvent(
    "session-no-bump",
    {
      type: "status",
      status: "running",
      message: "started",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-no-bump",
    {
      type: "status",
      status: "running",
      message: "still running",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-no-bump",
    {
      type: "message",
      message: {
        id: "session-no-bump-msg-a",
        role: "assistant",
        text: "一次回复",
        timestamp: "2026-05-15T10:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-no-bump",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.match(capture.observedTimelineMessages?.[0]?.id ?? "", /^session-no-bump-msg-000001-000000-/u);
});

test("runtime assistant stream closes before the next stage log", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try {
    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: "message-1",
          role: "assistant",
          text: "连续输出",
          timestamp: "2026-04-30T00:00:01.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );
    handleRuntimeEvent(
      "session-1",
      {
        type: "status",
        status: "idle",
        message: "done",
      } satisfies SessionRuntimeEvent,
      context,
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.deepEqual(
    structuredLogs(capture).map((log) => log.event),
    ["runtime.status.changed"],
  );
  assert.deepEqual(writes, []);
});

test("runtime user echo messages are ignored because prompts are already persisted before sending", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture);
  context.sessionMessageStore = {
    list: () => [
      {
        id: "client-user-1",
        role: "user",
        text: "你好",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    ],
  } as HelmHandlerContext["sessionMessageStore"];
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try {
    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: "runtime-user-echo-1",
          role: "user",
          text: "你好",
          timestamp: "2026-04-30T00:00:03.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );
  } finally {
    process.stdout.write = originalWrite;
  }

  flushRuntimeUserEchoLogSummaryForTest("session-1", context);

  const userEchoLog = findStructuredLog(capture, "runtime.message.user_echo.ignored_summary");
  assert.equal(userEchoLog?.level, "debug");
  assert.equal(userEchoLog?.fields?.count, 1);
  assert.equal(userEchoLog?.fields?.firstMessageId, "runtime-user-echo-1");
  assert.equal(userEchoLog?.fields?.lastMessageId, "runtime-user-echo-1");
  assert.equal(userEchoLog?.fields?.totalChars, 2);
  assert.doesNotMatch(JSON.stringify(userEchoLog), /你好|text/u);
  assert.deepEqual(writes, []);
  assert.deepEqual(capture.persisted, []);
  assert.equal(appendedToolCalls.length, 0);
  assert.equal(capture.broadcasts.length, 0);
});

test("runtime user messages are persisted when no local prompt matches the provider message", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture);
  context.sessionMessageStore = {
    list: () => [],
  } as HelmHandlerContext["sessionMessageStore"];

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "runtime-user-opencode-1",
        role: "user",
        text: "[build-mode]\nOpenCode processed prompt",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    capture.observedTimelineMessages?.map((message) => [message.id, message.role, message.text]),
    [["runtime-user-opencode-1", "user", "[build-mode]\nOpenCode processed prompt"]],
  );
  assert.deepEqual(capture.timelineEntries?.map((entry) => entry.kind), ["user_message"]);
  assert.equal(capture.summaryUpdates?.[0]?.lastMessagePreview, "[build-mode]\nOpenCode processed prompt");
  assert.equal(
    capture.detailBroadcasts.some((item: any) => item.params?.update?.kind === "timeline_batch"),
    true,
  );
});

test("runtime user echo debug logs are summarized across a replay burst", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  context.sessionMessageStore = {
    list: () => [
      {
        id: "client-user-1",
        role: "user",
        text: "first prompt",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
      {
        id: "client-user-2",
        role: "user",
        text: "ok",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
      {
        id: "client-user-3",
        role: "user",
        text: "third prompt",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    ],
  } as HelmHandlerContext["sessionMessageStore"];

  for (const [index, text] of ["first prompt", "ok", "third prompt"].entries()) {
    handleRuntimeEvent(
      "session-1",
      {
        type: "message",
        message: {
          id: `runtime-user-echo-${index + 1}`,
          role: "user",
          text,
          timestamp: "2026-04-30T00:00:03.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );
  }
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
      message: "done",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const userEchoLogs = structuredLogs(capture).filter((log) => (
    log.event === "runtime.message.user_echo.ignored"
  ));
  const userEchoSummary = findStructuredLog(capture, "runtime.message.user_echo.ignored_summary");
  assert.equal(userEchoLogs.length, 0);
  assert.equal(userEchoSummary?.level, "debug");
  assert.equal(userEchoSummary?.fields?.count, 3);
  assert.equal(userEchoSummary?.fields?.uniqueMessages, 3);
  assert.equal(userEchoSummary?.fields?.totalChars, "first prompt".length + "ok".length + "third prompt".length);
  assert.equal(userEchoSummary?.fields?.firstSeq, userEchoSummary?.fields?.lastSeq);
  assert.equal(userEchoSummary?.fields?.firstMessageId, "runtime-user-echo-1");
  assert.equal(userEchoSummary?.fields?.lastMessageId, "runtime-user-echo-3");
  assert.doesNotMatch(JSON.stringify(userEchoSummary), /first prompt|third prompt|text/u);
  assert.deepEqual(capture.persisted, []);
});

test("fatal ACP connection errors mark the active runtime stale", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "error",
      code: "ACP_CONNECTION_EXITED",
      message: "ACP process exited with code=1 signal=none",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(context.sessions.has("session-1"), false);
  assert.deepEqual(capture.persisted, []);
  assert.equal(findStructuredLog(capture, "runtime.recoverable.marked")?.fields?.code, "ACP_CONNECTION_EXITED");
});

test("runtime wrapped user echoes are ignored when they contain the client prompt", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  context.sessionMessageStore = {
    list: () => [
      {
        id: "client-user-1",
        role: "user",
        text: "你深度检查一下前端还有什么缺陷？",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    ],
  } as HelmHandlerContext["sessionMessageStore"];
  const wrappedEchoText = "[search-mode]\nMAXIMIZE SEARCH EFFORT.\n\n你深度检查一下前端还有什么缺陷？";

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "runtime-user-wrapper-1",
        role: "user",
        text: wrappedEchoText,
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  flushRuntimeUserEchoLogSummaryForTest("session-1", context);

  const wrappedEchoLog = findStructuredLog(capture, "runtime.message.user_echo.ignored_summary");
  assert.equal(wrappedEchoLog?.fields?.count, 1);
  assert.equal(wrappedEchoLog?.fields?.firstMessageId, "runtime-user-wrapper-1");
  assert.equal(wrappedEchoLog?.fields?.lastMessageId, "runtime-user-wrapper-1");
  assert.equal(wrappedEchoLog?.fields?.totalChars, wrappedEchoText.length);
  assert.doesNotMatch(JSON.stringify(wrappedEchoLog), /MAXIMIZE SEARCH EFFORT|text/u);
  assert.deepEqual(capture.persisted, []);
  assert.deepEqual(capture.broadcasts, []);
});

test("runtime assistant chunks stay split when tool activity occurs between text streams", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture);
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-a",
        role: "assistant",
        text: "工具前说明",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "tool-call",
      toolCall: {
        id: "call-branch",
        kind: "tool",
        title: "Show branch",
        status: "completed",
        timestamp: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-b",
        role: "assistant",
        text: "工具后继续",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    capture.observedTimelineMessages?.map((message) => message.text),
    ["工具前说明", "工具后继续"],
  );
  const messages = capture.observedTimelineMessages ?? [];
  assert.match(messages[0]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.match(messages[1]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.notEqual(messages[0]?.id, messages[1]?.id);
  assert.equal(capture.persisted.length, 0);
  assert.equal(appendedToolCalls.length, 0);
});

test("runtime tool-call updates do not split assistant content after the tool boundary", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const sessionId = "session-tool-update-message";
  const context = createTestContext(logs, capture, sessionId, {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    sessionId,
    {
      type: "message",
      message: {
        id: "provider-message-1",
        role: "assistant",
        text: "工具前说明",
        timestamp: "2026-07-22T00:00:01.000Z",
        streamMode: "delta",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    sessionId,
    {
      type: "tool-call",
      toolCall: {
        id: "call-shell-1",
        commandId: "command-shell-1",
        kind: "shell",
        title: "Run tests",
        status: "running",
        input: "pnpm test",
        timestamp: "2026-07-22T00:00:02.000Z",
        updatedAt: "2026-07-22T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    sessionId,
    {
      type: "message",
      message: {
        id: "provider-message-1",
        role: "assistant",
        text: "工具后第一段",
        timestamp: "2026-07-22T00:00:03.000Z",
        streamMode: "delta",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    sessionId,
    {
      type: "tool-call",
      toolCall: {
        id: "call-shell-1",
        commandId: "command-shell-1",
        kind: "shell",
        title: "Run tests",
        status: "completed",
        output: "PASS",
        timestamp: "2026-07-22T00:00:02.000Z",
        updatedAt: "2026-07-22T00:00:04.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    sessionId,
    {
      type: "message",
      message: {
        id: "provider-message-1",
        role: "assistant",
        text: "工具后第二段",
        timestamp: "2026-07-22T00:00:05.000Z",
        streamMode: "delta",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    sessionId,
    { type: "status", status: "idle" } satisfies SessionRuntimeEvent,
    context,
  );

  const assistantEntries = capture.timelineEntries?.filter(
    (entry) => entry.kind === "assistant_message",
  ) ?? [];
  assert.equal(assistantEntries.length, 2);
  assert.deepEqual(
    assistantEntries.map((entry) => entry.chunks.map((chunk) => chunk.text).join("")),
    ["工具前说明", "工具后第一段工具后第二段"],
  );
  const toolEntry = capture.timelineEntries?.find((entry) => entry.kind === "tool_call");
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.toolCall.status : undefined, "completed");
});

test("runtime command output does not split assistant content", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const sessionId = "session-command-output-message";
  const context = createTestContext(logs, capture, sessionId, {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    sessionId,
    {
      type: "message",
      message: {
        id: "provider-message-1",
        role: "assistant",
        text: "正文第一段",
        timestamp: "2026-07-22T00:00:01.000Z",
        streamMode: "delta",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    sessionId,
    {
      type: "command-output",
      chunk: {
        id: "output-1",
        commandId: "command-shell-1",
        stream: "stdout",
        text: "PASS",
        timestamp: "2026-07-22T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    sessionId,
    {
      type: "message",
      message: {
        id: "provider-message-1",
        role: "assistant",
        text: "正文第二段",
        timestamp: "2026-07-22T00:00:03.000Z",
        streamMode: "delta",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    sessionId,
    { type: "status", status: "idle" } satisfies SessionRuntimeEvent,
    context,
  );

  const assistantEntries = capture.timelineEntries?.filter(
    (entry) => entry.kind === "assistant_message",
  ) ?? [];
  assert.equal(assistantEntries.length, 1);
  assert.equal(
    assistantEntries[0]?.chunks.map((chunk) => chunk.text).join(""),
    "正文第一段正文第二段",
  );
  assert.equal(
    capture.timelineEntries?.filter((entry) => entry.kind === "command_output").length,
    1,
  );
});

test("runtime subagent child tools do not split cumulative assistant text", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-subagent-child-message", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-subagent-child-message",
    {
      type: "message",
      message: {
        id: "session-subagent-child-message-a",
        role: "assistant",
        text: "我",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  for (const [index, kind] of (["read", "shell"] as const).entries()) {
    handleRuntimeEvent(
      "session-subagent-child-message",
      {
        type: "tool-call",
        toolCall: {
          id: `call-subagent-child-${index}`,
          kind,
          title: kind === "read" ? "Read file" : "Run command",
          status: "completed",
          timestamp: `2026-04-30T00:00:0${index + 2}.000Z`,
          updatedAt: `2026-04-30T00:00:0${index + 2}.000Z`,
        },
        origin: {
          scope: "subagent",
          parentToolCallId: `call-parent-subagent-${index}`,
        },
      } satisfies SessionRuntimeEvent,
      context,
    );
  }
  handleRuntimeEvent(
    "session-subagent-child-message",
    {
      type: "message",
      message: {
        id: "session-subagent-child-message-a",
        role: "assistant",
        text: "我准备继续处理。",
        timestamp: "2026-04-30T00:00:04.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-child-message",
    { type: "status", status: "idle" } satisfies SessionRuntimeEvent,
    context,
  );

  const assistantEntries = capture.timelineEntries?.filter((entry) => entry.kind === "assistant_message") ?? [];
  const toolEntries = capture.timelineEntries?.filter((entry) => entry.kind === "tool_call") ?? [];
  assert.equal(assistantEntries.length, 1);
  assert.equal(toolEntries.length, 0);
  assert.equal(
    capture.sessionUpdates?.some((update) =>
      Object.hasOwn(JSON.parse(update.payloadJson) as object, "origin")
    ),
    false,
  );
  assert.doesNotMatch(JSON.stringify(capture.detailBroadcasts), /"origin"/u);
  assert.equal(assistantEntries[0]?.kind, "assistant_message");
  if (assistantEntries[0]?.kind !== "assistant_message") {
    throw new Error("Expected assistant_message");
  }
  assert.equal(assistantEntries[0].chunks[0]?.text, "我准备继续处理。");
});

test("runtime subagent child tools do not finalize the main thinking segment", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-subagent-child-thinking", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-subagent-child-thinking",
    {
      type: "tool-call",
      toolCall: {
        id: "provider-main-thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "先分析",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-child-thinking",
    {
      type: "tool-call",
      toolCall: {
        id: "call-subagent-child-read",
        kind: "read",
        title: "Read file",
        status: "completed",
        timestamp: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
      origin: {
        scope: "subagent",
        parentToolCallId: "call-parent-subagent",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-child-thinking",
    {
      type: "tool-call",
      toolCall: {
        id: "provider-main-thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "先分析，再继续",
        timestamp: "2026-04-30T00:00:03.000Z",
        updatedAt: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-child-thinking",
    { type: "status", status: "idle" } satisfies SessionRuntimeEvent,
    context,
  );

  const thinkingChunks = (capture.timelineEntries ?? []).flatMap((entry) =>
    entry.kind === "assistant_message"
      ? entry.chunks.filter((chunk) => chunk.kind === "thinking")
      : [],
  );
  assert.equal(thinkingChunks.length, 1);
  assert.equal(thinkingChunks[0]?.text, "先分析，再继续");
});

test("runtime splits compaction summary and reply on distinct provider message ids", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-boundary-split", {}, {
    useCanonicalPipeline: true,
  });
  const summary = [
    "## Objective",
    "- Continue the repository cleanup task.",
    "",
    "## Important Details",
    "- Preserve the existing worktree changes.",
    "",
    "## Work State",
    "### Completed",
    "- Located the relevant runtime path.",
    "",
    "### Active",
    "- Waiting for the next prompt.",
    "",
    "### Blocked",
    "- (none)",
    "",
    "## Next Move",
    "1. Continue from the recorded state.",
    "",
    "## Relevant Files",
    "- packages/acp-runtime/src/adapters/opencode/compaction-events.ts",
  ].join("\n");

  handleRuntimeEvent(
    "session-boundary-split",
    {
      type: "message",
      message: {
        id: "msg_opencode_summary",
        role: "assistant",
        text: summary.slice(0, 120),
        timestamp: "2026-07-20T14:01:13.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-boundary-split",
    {
      type: "message",
      message: {
        id: "msg_opencode_summary",
        role: "assistant",
        text: summary.slice(120),
        timestamp: "2026-07-20T14:01:13.159Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-boundary-split",
    {
      type: "message",
      message: {
        id: "msg_opencode_reply",
        role: "assistant",
        text: "I will continue processing.",
        timestamp: "2026-07-20T14:01:20.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-boundary-split",
    { type: "status", status: "idle" } satisfies SessionRuntimeEvent,
    context,
  );

  const timeline = capture.timelineEntries ?? [];
  assert.deepEqual(
    timeline.map((entry) => entry.kind),
    ["context_compaction", "assistant_message"],
  );
  const compactionEntry = timeline.find((entry) => entry.kind === "context_compaction");
  assert.equal(
    compactionEntry?.kind === "context_compaction" ? compactionEntry.summaryText : undefined,
    summary,
  );
  const assistantEntry = timeline.find((entry) => entry.kind === "assistant_message");
  assert.equal(
    assistantEntry?.kind === "assistant_message" ? assistantEntry.chunks[0]?.text : undefined,
    "I will continue processing.",
  );
});

test("runtime assistant chunks stay in one canonical segment when subagent activity occurs between cumulative text updates", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-subagent-message", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-subagent-message",
    {
      type: "message",
      message: {
        id: "session-subagent-message-msg-a",
        role: "assistant",
        text: "我",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-message",
    {
      type: "tool-call",
      toolCall: {
        id: "call-subagent",
        kind: "subagent",
        title: "spawn_agent",
        status: "running",
        input: JSON.stringify({ message: "只回一句 simple subagent ok" }),
        timestamp: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-message",
    {
      type: "message",
      message: {
        id: "session-subagent-message-msg-b",
        role: "assistant",
        text: "我会重新做一次最小 subagent 调用测试。",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-message",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const assistantEntries = capture.timelineEntries?.filter((entry) => entry.kind === "assistant_message") ?? [];
  const subagentEntries = capture.timelineEntries?.filter((entry) => entry.kind === "tool_call") ?? [];
  assert.equal(assistantEntries.length, 1);
  assert.equal(subagentEntries.length, 1);
  assert.equal(subagentEntries[0]?.kind === "tool_call" ? subagentEntries[0].toolCall.kind : undefined, "subagent");
  assert.equal(subagentEntries[0]?.kind === "tool_call" ? subagentEntries[0].toolCall.status : undefined, "running");
  assert.equal(assistantEntries[0]?.kind, "assistant_message");
  if (assistantEntries[0]?.kind !== "assistant_message") {
    throw new Error("Expected assistant_message");
  }
  assert.equal(assistantEntries[0].chunks.length, 1);
  assert.equal(
    assistantEntries[0].chunks[0]?.text,
    "我会重新做一次最小 subagent 调用测试。",
  );
});

test("runtime keeps independent assistant occurrences around a Subagent result without Built-in events", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-subagent-independent", {}, {
    useCanonicalPipeline: true,
  });
  const running: AgentToolCall = {
    id: "call-subagent-independent",
    commandId: "child-independent",
    kind: "subagent",
    title: "Run child",
    status: "running",
    timestamp: "2026-04-30T00:00:01.000Z",
    updatedAt: "2026-04-30T00:00:01.000Z",
  };

  handleRuntimeEvent(
    "session-subagent-independent",
    { type: "tool-call", toolCall: running } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-independent",
    {
      type: "message",
      message: {
        id: "provider-reused-message",
        role: "assistant",
        text: "正文1",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-independent",
    {
      type: "tool-call",
      toolCall: {
        ...running,
        status: "completed",
        output: "child result",
        timestamp: "2026-04-30T00:00:03.000Z",
        updatedAt: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-independent",
    {
      type: "message",
      message: {
        id: "provider-reused-message",
        role: "assistant",
        text: "正文2",
        timestamp: "2026-04-30T00:00:04.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-subagent-independent",
    { type: "status", status: "idle" } satisfies SessionRuntimeEvent,
    context,
  );

  const timeline = capture.timelineEntries ?? [];
  assert.deepEqual(timeline.map((entry) => entry.kind), [
    "tool_call",
    "assistant_message",
    "assistant_message",
  ]);
  const toolEntry = timeline[0];
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.toolCall.status : undefined, "completed");
  const assistantEntries = timeline.filter((entry) => entry.kind === "assistant_message");
  assert.deepEqual(
    assistantEntries.flatMap((entry) => entry.chunks.map((chunk) => chunk.text)),
    ["正文1", "正文2"],
  );
  assert.notEqual(assistantEntries[0]?.id, assistantEntries[1]?.id);
});

test("runtime-generated delta chunks with fresh source ids stay in one stream segment", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-alpha",
        role: "assistant",
        text: "当前分支是 `codex/debug-st",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-beta",
        role: "assistant",
        text: "ream-tool-logs`,看起来正在调",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.match(capture.observedTimelineMessages?.[0]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.deepEqual(
    capture.observedTimelineMessages?.map((message) => message.text),
    ["当前分支是 `codex/debug-stream-tool-logs`,看起来正在调"],
  );
});

test("runtime-generated independent assistant messages get distinct stream segment ids", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-alpha",
        role: "assistant",
        text: "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata.",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-beta",
        role: "assistant",
        text: "你好主人，我会按你的项目规则继续处理。",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.observedTimelineMessages?.[0]?.text, "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata.");
  assert.equal(capture.observedTimelineMessages?.[1]?.text, "你好主人，我会按你的项目规则继续处理。");
  assert.match(capture.observedTimelineMessages?.[0]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.match(capture.observedTimelineMessages?.[1]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.notEqual(capture.observedTimelineMessages?.[0]?.id, capture.observedTimelineMessages?.[1]?.id);
});

test("runtime config state overwrites a stale stored model selection", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-selected-model", {
    model: "gpt-5.4",
    reasoningEffort: "medium",
  });

  handleRuntimeEvent(
    "session-selected-model",
    {
      type: "config-options",
      state: { model: "gpt-5.5", reasoningEffort: "medium" },
      options: [],
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.summaryUpdates?.at(-1)?.model, "gpt-5.5");
});

test("runtime config options omit reasoning when authoritative options omit reasoning", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-haiku", {
    model: "claude-haiku-4-5",
    reasoningEffort: "medium",
  });

  handleRuntimeEvent(
    "session-haiku",
    {
      type: "config-options",
      state: { model: "claude-haiku-4-5", reasoningEffort: "medium" },
      options: [
        {
          id: "model",
          category: "model",
          currentValue: "claude-haiku-4-5",
          options: [{ value: "claude-haiku-4-5", label: "claude-haiku-4-5" }],
        },
      ],
    } satisfies SessionRuntimeEvent,
    context,
  );

  const liveState = context.sessionLiveStateStore?.get("session-haiku");
  assert.equal(capture.summaryUpdates?.at(-1)?.reasoningEffort, undefined);
  assert.equal(liveState?.config.reasoningEffort, undefined);
  assert.equal(
    liveState?.config.configOptions.some((option) => option.category === "thought_level"),
    false,
  );
});

test("runtime config options preserve reasoning for haiku when ACP exposes reasoning", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-opencode-haiku", {
    model: "opencode/haiku",
  });

  handleRuntimeEvent(
    "session-opencode-haiku",
    {
      type: "config-options",
      state: { model: "opencode/haiku", reasoningEffort: "medium" },
      options: [
        {
          id: "model",
          category: "model",
          currentValue: "opencode/haiku",
          options: [{ value: "opencode/haiku", label: "opencode/haiku" }],
        },
        {
          id: "thought_level",
          category: "thought_level",
          currentValue: "medium",
          options: [{ value: "medium", label: "Medium" }],
        },
      ],
    } satisfies SessionRuntimeEvent,
    context,
  );

  const liveState = context.sessionLiveStateStore?.get("session-opencode-haiku");
  assert.equal(capture.summaryUpdates?.at(-1)?.reasoningEffort, "medium");
  assert.equal(liveState?.config.reasoningEffort, "medium");
  assert.equal(
    liveState?.config.configOptions.some((option) => option.category === "thought_level"),
    true,
  );
});

test("runtime config options replace stale model-specific options", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-stale-haiku", {
    model: "claude-haiku-4-5",
    configOptions: [
      {
        id: "model",
        category: "model",
        currentValue: "claude-haiku-4-5",
        options: [{ value: "claude-haiku-4-5", label: "claude-haiku-4-5" }],
      },
    ],
  });

  handleRuntimeEvent(
    "session-stale-haiku",
    {
      type: "config-options",
      state: { model: "claude-opus-4-7", reasoningEffort: "medium" },
      options: [
        {
          id: "model",
          category: "model",
          currentValue: "claude-opus-4-7",
          options: [
            { value: "claude-opus-4-7", label: "claude-opus-4-7" },
            { value: "claude-haiku-4-5", label: "claude-haiku-4-5" },
          ],
        },
        {
          id: "thought_level",
          category: "thought_level",
          currentValue: "medium",
          options: [{ value: "medium", label: "Medium" }],
        },
      ],
    } satisfies SessionRuntimeEvent,
    context,
  );

  const liveState = context.sessionLiveStateStore?.get("session-stale-haiku");
  assert.equal(capture.summaryUpdates?.at(-1)?.model, "claude-opus-4-7");
  assert.equal(capture.summaryUpdates?.at(-1)?.reasoningEffort, "medium");
  assert.equal(liveState?.config.model, "claude-opus-4-7");
  assert.equal(
    liveState?.config.configOptions.some((option) => option.category === "thought_level"),
    true,
  );
});

test("runtime model state overwrites a stale stored model selection", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-selected-native-model", {
    model: "gpt-5.4",
  });

  handleRuntimeEvent(
    "session-selected-native-model",
    {
      type: "model-options",
      state: {
        currentModelId: "gpt-5.5",
        options: [{ id: "gpt-5.4", name: "gpt-5.4" }, { id: "gpt-5.5", name: "gpt-5.5" }],
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.summaryUpdates?.at(-1)?.model, "gpt-5.5");
  assert.deepEqual(
    capture.summaryUpdates?.at(-1)?.modelOptions?.map((option) => option.id),
    ["gpt-5.4", "gpt-5.5"],
  );
});

test("runtime-generated short assistant replies split after provider diagnostics", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-diagnostic",
        role: "assistant",
        text: "Model metadata for `gpt-5.5` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-ok",
        role: "assistant",
        text: "OK",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.observedTimelineMessages?.[0]?.text.startsWith("Model metadata for"), true);
  assert.equal(capture.observedTimelineMessages?.[1]?.text, "OK");
  assert.notEqual(capture.observedTimelineMessages?.[0]?.id, capture.observedTimelineMessages?.[1]?.id);
});

test("runtime running status starts a fresh assistant segment for the next prompt", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-first",
        role: "assistant",
        text: "第一轮回复",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "running",
      message: "ACP agent is responding",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "message",
      message: {
        id: "session-1-msg-second",
        role: "assistant",
        text: "第二轮回复",
        timestamp: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.match(capture.observedTimelineMessages?.[0]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.match(capture.observedTimelineMessages?.[1]?.id ?? "", /^session-1-msg-\d{6}-\d{6}-/u);
  assert.notEqual(capture.observedTimelineMessages?.[0]?.id, capture.observedTimelineMessages?.[1]?.id);
});
