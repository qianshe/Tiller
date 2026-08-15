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
  flushRuntimeSessionState,
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

function assistantThoughtEvent(
  id: string,
  text: string,
  timestamp: string,
  options: { streaming?: boolean; streamMode?: AgentMessage["streamMode"] } = {},
): Extract<SessionRuntimeEvent, { type: "message" }> {
  return {
    type: "message",
    message: {
      id,
      role: "assistant",
      contentKind: "thought",
      text,
      timestamp,
      streaming: options.streaming ?? true,
      streamMode: options.streamMode ?? "delta",
    },
  };
}

test("runtime keeps a tool titled Thinking in the tool timeline", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext([], capture, "session-legacy-think-tool");

  handleRuntimeEvent(
    "session-legacy-think-tool",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-think-1",
        kind: "tool",
        title: "Thinking",
        status: "completed",
        output: "Inspect the repository",
        timestamp: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:01.000Z",
      },
    },
    context,
  );

  assert.equal(capture.timelineEntries?.length, 1);
  const entry = capture.timelineEntries?.[0];
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.kind : undefined, "tool");
});

test("runtime terminal tool calls publish canonical timeline batches without compatibility tool_call updates", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture, "session-canonical-tool-call", {}, {
    useCanonicalPipeline: true,
  });
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };

  handleRuntimeEvent(
    "session-canonical-tool-call",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-1",
        kind: "shell",
        title: "pnpm test",
        status: "completed",
        commandId: "cmd-1",
        timestamp: "2026-06-30T00:00:01.000Z",
        updatedAt: "2026-06-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  );
  const legacyToolCallUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "tool_call"
  );

  assert.ok(timelineBatchUpdate);
  assert.equal(legacyToolCallUpdate, undefined);
  assert.deepEqual(capture.sessionUpdates?.map((update) => update.updateType), ["tool-call"]);
  assert.equal(appendedToolCalls.length, 0);
});

test("runtime keeps a merged Codex subagent lifecycle under the spawn id", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const sessionId = "session-codex-merged-subagent";
  const context = createTestContext([], capture, sessionId, {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(sessionId, {
    type: "tool-call",
    toolCall: {
      id: "spawn-call",
      kind: "subagent",
      title: "Inspect the adapter",
      status: "completed",
      input: JSON.stringify({ prompt: "Inspect the adapter" }),
      subagentOperation: { action: "spawn", targets: [{ id: "child-thread" }] },
      timestamp: "2026-07-01T00:00:01.000Z",
      updatedAt: "2026-07-01T00:00:02.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  handleRuntimeEvent(sessionId, {
    type: "tool-call",
    toolCall: {
      id: "spawn-call",
      kind: "subagent",
      title: "Inspect the adapter",
      status: "completed",
      input: JSON.stringify({ prompt: "Inspect the adapter" }),
      output: "All tests passed.",
      subagentOperation: { action: "wait", targets: [{ id: "child-thread" }] },
      timestamp: "2026-07-01T00:00:01.000Z",
      updatedAt: "2026-07-01T00:00:04.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  const entries = capture.timelineEntries?.filter((entry) => entry.kind === "tool_call") ?? [];
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.toolCall.id, "spawn-call");
  assert.equal(entry?.toolCall.status, "completed");
  assert.equal(entry?.toolCall.output, "All tests passed.");
  assert.equal(entry?.toolCall.subagentOperation?.action, "wait");
});

test("runtime allows a merged Codex wait timeout to remain running", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const sessionId = "session-codex-wait-timeout";
  const context = createTestContext([], capture, sessionId, {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(sessionId, {
    type: "tool-call",
    toolCall: {
      id: "spawn-call",
      kind: "subagent",
      title: "Inspect the adapter",
      status: "completed",
      subagentOperation: { action: "spawn", targets: [{ id: "child-thread" }] },
      timestamp: "2026-07-01T00:00:01.000Z",
      updatedAt: "2026-07-01T00:00:02.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  handleRuntimeEvent(sessionId, {
    type: "tool-call",
    toolCall: {
      id: "spawn-call",
      kind: "subagent",
      title: "Inspect the adapter",
      status: "running",
      output: "等待超时，子代理仍在运行",
      subagentOperation: { action: "wait", targets: [{ id: "child-thread" }] },
      timestamp: "2026-07-01T00:00:01.000Z",
      updatedAt: "2026-07-01T00:00:04.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  const entry = capture.timelineEntries?.find((candidate) => candidate.kind === "tool_call");
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.toolCall.id, "spawn-call");
  assert.equal(entry?.toolCall.status, "running");
});

test("runtime running tool calls enter canonical history without a duplicate journal row", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-running-tool-call", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-canonical-running-tool-call",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-running-1",
        kind: "shell",
        title: "pnpm test",
        status: "running",
        commandId: "cmd-1",
        timestamp: "2026-06-30T00:00:01.000Z",
        updatedAt: "2026-06-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  );
  const legacyToolCallUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "tool_call"
  ) as { params?: { update?: { toolCall?: { status?: string } } } } | undefined;

  assert.ok(timelineBatchUpdate);
  assert.equal(legacyToolCallUpdate, undefined);
  assert.equal(
    capture.timelineEntries?.find((entry) => entry.kind === "tool_call")?.toolCall.status,
    "running",
  );
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);
});

test("runtime cleanup persists an ordinary running tool without changing its status", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext([], capture, "session-cleanup-running-tool", {}, {
    useCanonicalPipeline: true,
    runtimeEventThrottleConfig: { toolCallWindowMs: 64 },
  });

  handleRuntimeEvent("session-cleanup-running-tool", {
    type: "tool-call",
    toolCall: {
      id: "tool-cleanup-running",
      kind: "shell",
      title: "pnpm test",
      status: "running",
      commandId: "cmd-cleanup-running",
      output: "still running",
      timestamp: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:01.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  flushRuntimeSessionState("session-cleanup-running-tool", context);

  const entry = capture.timelineEntries?.find((candidate) =>
    candidate.kind === "tool_call" && candidate.toolCall.id === "tool-cleanup-running",
  );
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.toolCall.status, "running");
  assert.equal(entry?.toolCall.output, "still running");
  assert.deepEqual(capture.sessionUpdates?.map((update) => update.updateType), ["tool-call"]);
});

test("runtime cleanup persists a running background_output snapshot for recovery", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext([], capture, "session-cleanup-background-output", {}, {
    useCanonicalPipeline: true,
    runtimeEventThrottleConfig: { toolCallWindowMs: 64 },
  });

  handleRuntimeEvent("session-cleanup-background-output", {
    type: "tool-call",
    toolCall: {
      id: "background-output-1",
      kind: "tool",
      title: "background_output",
      status: "running",
      input: JSON.stringify({ task_id: "task-1" }),
      output: "Background task is still running",
      timestamp: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:01.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  flushRuntimeSessionState("session-cleanup-background-output", context);

  const entry = capture.timelineEntries?.find((candidate) =>
    candidate.kind === "tool_call" && candidate.toolCall.id === "background-output-1",
  );
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.toolCall.status, "running");
  assert.equal(entry?.toolCall.title, "background_output");
});

test("runtime completes OpenCode background_output when its subagent result arrives", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext([], capture, "session-opencode-background-completion", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent("session-opencode-background-completion", {
    type: "tool-call",
    toolCall: {
      id: "background-output-before-result",
      kind: "tool",
      title: "background_output",
      status: "running",
      input: JSON.stringify({ task_id: "bg-before-result" }),
      timestamp: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:01.000Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent("session-opencode-background-completion", {
    type: "tool-call",
    toolCall: {
      id: "subagent-before-result",
      kind: "subagent",
      title: "Run the background task",
      status: "completed",
      input: JSON.stringify({ backgroundTaskId: "bg-before-result" }),
      timestamp: "2026-07-28T00:00:02.000Z",
      updatedAt: "2026-07-28T00:00:03.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  const completedFirst = capture.timelineEntries?.find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "background-output-before-result",
  );
  assert.equal(completedFirst?.kind, "tool_call");
  assert.equal(completedFirst?.toolCall.status, "completed");

  handleRuntimeEvent("session-opencode-background-completion", {
    type: "tool-call",
    toolCall: {
      id: "subagent-after-result",
      kind: "subagent",
      title: "Run the second background task",
      status: "completed",
      input: JSON.stringify({ backgroundTaskId: "bg-after-result" }),
      timestamp: "2026-07-28T00:00:04.000Z",
      updatedAt: "2026-07-28T00:00:05.000Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent("session-opencode-background-completion", {
    type: "tool-call",
    toolCall: {
      id: "background-output-after-result",
      kind: "tool",
      title: "background_output",
      status: "running",
      input: JSON.stringify({ task_id: "bg-after-result" }),
      timestamp: "2026-07-28T00:00:06.000Z",
      updatedAt: "2026-07-28T00:00:07.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  const completedAfter = capture.timelineEntries?.find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "background-output-after-result",
  );
  assert.equal(completedAfter?.kind, "tool_call");
  assert.equal(completedAfter?.toolCall.status, "completed");
  assert.equal(completedAfter?.toolCall.kind, "tool");
});

test("runtime completes OpenCode background_output from the real launch and result payloads", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext([], capture, "session-opencode-background-real-shape");
  const taskId = "bg-real-shape";
  const subagentSessionId = "ses-real-shape";
  const launchInput = JSON.stringify({
    truncated: false,
    prompt: "Reply with exactly: SUBAGENT_OK",
    agent: "Sisyphus-Junior",
    category: "quick",
    description: "Reply with exactly: SUBAGENT_OK",
    run_in_background: true,
    taskId: subagentSessionId,
    sessionId: subagentSessionId,
    backgroundTaskId: taskId,
  });
  const launchOutput = JSON.stringify({
    output: [
      "Background task launched.",
      "Background Task ID: bg-real-shape",
      "Status: pending",
      "<task_metadata>",
      "session_id: ses-real-shape",
      "background_task_id: bg-real-shape",
      "</task_metadata>",
    ].join("\\n"),
    metadata: {
      taskId: subagentSessionId,
      sessionId: subagentSessionId,
      backgroundTaskId: taskId,
    },
  });

  handleRuntimeEvent("session-opencode-background-real-shape", {
    type: "tool-call",
    toolCall: {
      id: "call-real-subagent",
      kind: "subagent",
      title: "Reply with exactly: SUBAGENT_OK",
      status: "running",
      input: launchInput,
      output: launchOutput,
      timestamp: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.100Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent("session-opencode-background-real-shape", {
    type: "tool-call",
    toolCall: {
      id: "call-real-background-output",
      kind: "tool",
      title: "background_output",
      status: "running",
      input: JSON.stringify({ task_id: taskId }),
      timestamp: "2026-07-28T00:00:01.000Z",
      updatedAt: "2026-07-28T00:00:01.100Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent("session-opencode-background-real-shape", {
    type: "tool-call",
    toolCall: {
      id: "call-real-subagent",
      kind: "subagent",
      title: "Reply with exactly: SUBAGENT_OK",
      status: "completed",
      input: JSON.stringify({
        truncated: false,
        backgroundTaskId: taskId,
        agent: "Sisyphus-Junior",
        category: "quick",
        description: "Reply with exactly: SUBAGENT_OK",
        sessionId: subagentSessionId,
        taskId: subagentSessionId,
      }),
      output: JSON.stringify({
        output: "Task Result\\n\\nTask ID: bg-real-shape\\n\\n---\\n\\nSUBAGENT_OK",
        metadata: {
          truncated: false,
          backgroundTaskId: taskId,
          agent: "Sisyphus-Junior",
          category: "quick",
          description: "Reply with exactly: SUBAGENT_OK",
          sessionId: subagentSessionId,
          taskId: subagentSessionId,
        },
      }),
      timestamp: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:02.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  const backgroundOutput = (capture.timelineEntries ?? []).find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "call-real-background-output",
  );
  assert.equal(backgroundOutput?.kind, "tool_call");
  assert.equal(backgroundOutput?.toolCall.status, "completed");
});

test("runtime closes the real OpenCode background_output and Thinking sequence", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const sessionId = "session-opencode-real-retest";
  const context = createTestContext([], capture, sessionId);
  const taskId = "bg_348250a7";
  const subagentSessionId = "ses_0593ecee3ffeelSz5IDVb2Bh49";
  const subagentId = "call_71f5f74135514d80beeeb548";
  const thinkingId = `${sessionId}-msg-000001-000001-pmsgfa6c17c390015`;

  for (const output of ["The", " user wants to", " test again."]) {
    handleRuntimeEvent(
      sessionId,
      assistantThoughtEvent(thinkingId, output, "2026-07-28T03:25:10.000Z"),
      context,
    );
  }
  handleRuntimeEvent(sessionId, {
    type: "tool-call",
    toolCall: {
      id: subagentId,
      kind: "subagent",
      title: "Reply with exactly: SUBAGENT_RETEST_OK",
      status: "running",
      input: JSON.stringify({
        category: "quick",
        load_skills: [],
        prompt: "Reply with exactly: SUBAGENT_RETEST_OK",
        run_in_background: true,
      }),
      timestamp: "2026-07-28T03:25:10.000Z",
      updatedAt: "2026-07-28T03:25:10.000Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent(sessionId, {
    type: "tool-call",
    toolCall: {
      id: subagentId,
      kind: "subagent",
      title: "Reply with exactly: SUBAGENT_RETEST_OK",
      status: "running",
      input: JSON.stringify({
        truncated: false,
        prompt: "Reply with exactly: SUBAGENT_RETEST_OK",
        agent: "Sisyphus-Junior",
        category: "quick",
        requested_subagent_type: "sisyphus-junior",
        load_skills: [],
        description: "Reply with exactly: SUBAGENT_RETEST_OK",
        run_in_background: true,
        taskId: subagentSessionId,
        sessionId: subagentSessionId,
        backgroundTaskId: taskId,
      }),
      output: JSON.stringify({
        output: "Background task launched. Status: pending",
        metadata: { backgroundTaskId: taskId, sessionId: subagentSessionId, taskId: subagentSessionId },
      }),
      timestamp: "2026-07-28T03:25:10.000Z",
      updatedAt: "2026-07-28T03:25:10.000Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent(sessionId, {
    type: "message",
    message: {
      id: `${sessionId}-msg-000001-000000-pmsgfa6c107940016i`,
      role: "assistant",
      text: "已启动，等待结果中...",
      streaming: false,
      timestamp: "2026-07-28T03:25:10.000Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent(sessionId, {
    type: "status",
    status: "idle",
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent(sessionId, {
    type: "tool-call",
    toolCall: {
      id: "call_4360d36dcdbe40f3b768c4b4",
      kind: "tool",
      title: "background_output",
      status: "running",
      input: JSON.stringify({ task_id: taskId }),
      timestamp: "2026-07-28T03:25:20.000Z",
      updatedAt: "2026-07-28T03:25:20.000Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent(sessionId, {
    type: "tool-call",
    toolCall: {
      id: subagentId,
      kind: "subagent",
      title: "Reply with exactly: SUBAGENT_RETEST_OK",
      status: "completed",
      input: JSON.stringify({
        truncated: false,
        backgroundTaskId: taskId,
        agent: "Sisyphus-Junior",
        category: "quick",
        description: "Reply with exactly: SUBAGENT_RETEST_OK",
        sessionId: subagentSessionId,
        taskId: subagentSessionId,
      }),
      output: JSON.stringify({
        output: "Task Result\\n\\nTask ID: bg_348250a7\\n\\n---\\n\\nSUBAGENT_RETEST_OK",
        metadata: {
          truncated: false,
          backgroundTaskId: taskId,
          agent: "Sisyphus-Junior",
          category: "quick",
          description: "Reply with exactly: SUBAGENT_RETEST_OK",
          sessionId: subagentSessionId,
          taskId: subagentSessionId,
        },
      }),
      timestamp: "2026-07-28T03:25:20.000Z",
      updatedAt: "2026-07-28T03:25:22.000Z",
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent(
    sessionId,
    assistantThoughtEvent(
      `${sessionId}-msg-000001-000001-pmsgfa6c17c390015`,
      "The subagent test passed again.",
      "2026-07-28T03:25:22.000Z",
    ),
    context,
  );
  handleRuntimeEvent(sessionId, {
    type: "message",
    message: {
      id: `${sessionId}-msg-000001-000001-pmsgfa6c390015`,
      role: "assistant",
      text: "重测通过 ✅ — 收到 `SUBAGENT_RETEST_OK`，耗时 15 秒。",
      streaming: false,
      timestamp: "2026-07-28T03:25:22.000Z",
    },
  } satisfies SessionRuntimeEvent, context);

  const backgroundOutput = (capture.timelineEntries ?? []).find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "call_4360d36dcdbe40f3b768c4b4",
  );
  assert.equal(backgroundOutput?.kind, "tool_call");
  assert.equal(backgroundOutput?.toolCall.status, "completed");

  const thinkingChunks = (capture.timelineEntries ?? [])
    .filter((entry) => entry.kind === "assistant_message")
    .flatMap((entry) => entry.chunks)
    .filter((chunk) => chunk.kind === "thinking");
  assert.equal(thinkingChunks.at(-1)?.status, "completed");
  assert.equal(
    (capture.timelineEntries ?? []).some((entry) =>
      entry.kind === "assistant_message" &&
      entry.chunks.some((chunk) => chunk.kind === "content" && chunk.text.includes("重测通过")),
    ),
    true,
  );
});

test("runtime repairs a shell placeholder when native search input arrives", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const timers = createManualTimerHarness();
  const context = createTestContext([], capture, "session-native-search-repair", {}, {
    useCanonicalPipeline: true,
    runtimeEventThrottleConfig: {
      toolCallWindowMs: 64,
      toolCallMaxChars: 512,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });

  handleRuntimeEvent("session-native-search-repair", {
    type: "tool-call",
    toolCall: {
      id: "call-native-grep",
      kind: "shell",
      title: "Search",
      status: "running",
      input: "{}",
      timestamp: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    },
  }, context);
  assert.equal(timers.size(), 1);

  handleRuntimeEvent("session-native-search-repair", {
    type: "tool-call",
    toolCall: {
      id: "call-native-grep",
      kind: "search",
      title: "Grep",
      status: "completed",
      input: JSON.stringify({ pattern: "tool-title", glob: "**/*.ts" }),
      output: "Found 1 file",
      timestamp: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:01.000Z",
    },
  }, context);

  assert.equal(timers.size(), 0);
  const entry = capture.timelineEntries?.find((candidate) =>
    candidate.kind === "tool_call" && candidate.toolCall.id === "call-native-grep"
  );
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.kind : undefined, "search");
  cleanupRuntimeEventState("session-native-search-repair", context);
});

test("runtime persists terminal tool-call boundary snapshots only", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-tool-boundary", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-tool-boundary",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-1",
        kind: "shell",
        title: "pnpm test",
        status: "running",
        commandId: "cmd-1",
        timestamp: "2026-06-30T00:00:01.000Z",
        updatedAt: "2026-06-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-tool-boundary",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-1",
        kind: "shell",
        title: "pnpm test",
        status: "completed",
        commandId: "cmd-1",
        timestamp: "2026-06-30T00:00:01.000Z",
        updatedAt: "2026-06-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  ) as any;

  assert.ok(timelineBatchUpdate);
  assert.deepEqual(capture.sessionUpdates?.map((update) => update.updateType), ["tool-call"]);
  assert.deepEqual(capture.timelineEntries?.map((entry) => entry.kind), ["tool_call"]);
});

test("runtime publishes the first running tool-call immediately and coalesces later updates", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    sessionUpdates: [],
  };
  const timers = createManualTimerHarness();
  const context = createTestContext(logs, capture, "session-tool-window", {}, {
    runtimeEventThrottleConfig: {
      toolCallWindowMs: 64,
      toolCallMaxChars: 512,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });

  handleRuntimeEvent(
    "session-tool-window",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-window-1",
        kind: "shell",
        title: "rg test",
        status: "running",
        output: "A",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-tool-window",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-window-1",
        kind: "search",
        title: "rg test",
        status: "running",
        output: "AB",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(timers.size(), 1);
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);
  const initialTimelineBatch = capture.detailBroadcasts.find(
    (item: any) => item.params?.update?.kind === "timeline_batch",
  ) as any;
  const initialToolCallEntry = initialTimelineBatch?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call",
  );
  assert.equal(initialToolCallEntry?.toolCall?.status, "running");
  assert.equal(initialToolCallEntry?.toolCall?.title, "rg test");
  assert.equal(initialToolCallEntry?.toolCall?.output, "A");

  handleRuntimeEvent(
    "session-tool-window",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-window-1",
        kind: "shell",
        title: "rg test",
        status: "completed",
        output: "ABC",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:03.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.filter(
    (item: any) => item.params?.update?.kind === "timeline_batch",
  ).at(-1) as any;
  const toolCallEntry = timelineBatchUpdate?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call",
  );
  assert.equal(toolCallEntry?.toolCall?.kind, "shell");
  assert.equal(toolCallEntry?.toolCall?.status, "completed");
  assert.equal(toolCallEntry?.toolCall?.output, "ABC");
  assert.equal(capture.sessionUpdates?.length, 1);
  assert.equal(JSON.parse(capture.sessionUpdates?.[0]?.payloadJson ?? "{}").toolCall.status, "completed");
});

test("runtime terminal tool-call snapshots retain live MCP metadata when completion is opaque", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    sessionUpdates: [],
  };
  const timers = createManualTimerHarness();
  const context = createTestContext(logs, capture, "session-tool-mcp-window", {}, {
    runtimeEventThrottleConfig: {
      toolCallWindowMs: 64,
      toolCallMaxChars: 512,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });

  handleRuntimeEvent(
    "session-tool-mcp-window",
    {
      type: "tool-call",
      toolCall: {
        id: "call-mcp-window-1",
        kind: "mcp",
        title: "Tool: sanshu/zhi",
        mcp: { serverName: "sanshu", toolName: "zhi", source: "structured-input" },
        input: JSON.stringify({ project_root_path: "D:/project", message: "review" }),
        status: "running",
        timestamp: "2026-07-10T12:00:00.000Z",
        updatedAt: "2026-07-10T12:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-tool-mcp-window",
    {
      type: "tool-call",
      toolCall: {
        id: "call-mcp-window-1",
        kind: "tool",
        title: "Tool call call_mcp…",
        output: "选择的选项: 完成并结束（推荐）",
        status: "completed",
        timestamp: "2026-07-10T12:00:00.000Z",
        updatedAt: "2026-07-10T12:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.filter(
    (item: any) => item.params?.update?.kind === "timeline_batch",
  ).at(-1) as any;
  const toolCallEntry = timelineBatchUpdate?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call",
  );
  assert.equal(toolCallEntry?.toolCall?.kind, "mcp");
  assert.equal(toolCallEntry?.toolCall?.title, "Tool: sanshu/zhi");
  assert.deepEqual(toolCallEntry?.toolCall?.mcp, {
    serverName: "sanshu",
    toolName: "zhi",
    source: "structured-input",
  });
  assert.equal(toolCallEntry?.toolCall?.status, "completed");
});

test("runtime subagent tool-call updates bypass the live window and publish immediately", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const timers = createManualTimerHarness();
  const context = createTestContext(logs, capture, "session-subagent-window", {}, {
    useCanonicalPipeline: true,
    runtimeEventThrottleConfig: {
      toolCallWindowMs: 64,
      toolCallMaxChars: 512,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });

  handleRuntimeEvent(
    "session-subagent-window",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-subagent-1",
        kind: "subagent",
        title: "spawn_agent",
        status: "running",
        input: JSON.stringify({ fork_context: true, message: "只改 docs" }),
        timestamp: "2026-07-08T12:39:49.467Z",
        updatedAt: "2026-07-08T12:39:49.467Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(timers.size(), 0);
  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  ) as any;
  const liveToolCallUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "tool_call"
  ) as any;
  assert.ok(timelineBatchUpdate);
  assert.equal(liveToolCallUpdate, undefined);
  const timelineToolCall = timelineBatchUpdate?.params?.update?.batch?.entries?.[0]?.toolCall;
  assert.equal(timelineToolCall?.kind, "subagent");
  assert.equal(timelineToolCall?.title, "spawn_agent");
  assert.equal(timelineToolCall?.status, "running");
  assert.equal(capture.sessionUpdates?.length ?? 0, 1);
  assert.equal(capture.timelineEntries?.length ?? 0, 1);
});

test("runtime terminal subagent keeps its invocation position and terminal update sequence", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-subagent-order", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-subagent-order",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-subagent-order",
        kind: "subagent",
        title: "Inspect lifecycle",
        status: "running",
        input: JSON.stringify({ subagent_type: "general", description: "Inspect lifecycle" }),
        timestamp: "2026-07-13T00:00:01.000Z",
        updatedAt: "2026-07-13T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  const invocationUpdate = capture.detailBroadcasts.find((item: any) =>
    item.params?.update?.kind === "timeline_batch"
  ) as any;
  const invocationSequence = invocationUpdate?.params?.update?.batch?.entries?.[0]?.toolCall?.sequence;

  handleRuntimeEvent(
    "session-subagent-order",
    {
      type: "tool-call",
      toolCall: {
        id: "tool-subagent-order",
        kind: "subagent",
        title: "Inspect lifecycle",
        status: "completed",
        commandId: "subagent:task-42",
        output: JSON.stringify({ output: "SUBAGENT_OK" }),
        timestamp: "2026-07-13T00:00:10.000Z",
        updatedAt: "2026-07-13T00:00:10.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const terminalEntry = capture.timelineEntries?.find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "tool-subagent-order"
  );
  assert.equal(typeof invocationSequence, "number");
  assert.equal(
    terminalEntry?.kind === "tool_call" ? terminalEntry.toolCall.sequence : undefined,
    invocationSequence,
  );
  assert.equal(
    terminalEntry?.kind === "tool_call" ? terminalEntry.toolCall.input : undefined,
    JSON.stringify({ subagent_type: "general", description: "Inspect lifecycle" }),
  );
  assert.ok((capture.sessionUpdates?.at(-1)?.sequence ?? 0) > invocationSequence);
});

test("runtime terminal tool call keeps the richer running title", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext([], capture, "session-tool-title");

  handleRuntimeEvent("session-tool-title", {
    type: "tool-call",
    toolCall: {
      id: "tool-search-title",
      kind: "search",
      title: "Grep: normalizeOpenCodeToolCall",
      status: "running",
      input: JSON.stringify({ pattern: "normalizeOpenCodeToolCall" }),
      timestamp: "2026-07-14T00:00:01.000Z",
      updatedAt: "2026-07-14T00:00:01.000Z",
    },
  }, context);
  handleRuntimeEvent("session-tool-title", {
    type: "tool-call",
    toolCall: {
      id: "tool-search-title",
      kind: "search",
      title: "Search",
      status: "completed",
      output: "Found 1 match",
      timestamp: "2026-07-14T00:00:02.000Z",
      updatedAt: "2026-07-14T00:00:02.000Z",
    },
  }, context);

  const terminalEntry = capture.timelineEntries?.find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "tool-search-title"
  );
  assert.equal(
    terminalEntry?.kind === "tool_call" ? terminalEntry.toolCall.title : undefined,
    "Grep: normalizeOpenCodeToolCall",
  );
});

test("runtime upgrades an OpenCode task placeholder to its dynamic category while running", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const sessionId = "session-opencode-dynamic-category";
  const context = createTestContext([], capture, sessionId, {}, {
    useCanonicalPipeline: true,
  });
  const initial: SessionRuntimeEvent = {
    type: "tool-call",
    toolCall: {
      id: "call-opencode-dynamic-category",
      kind: "subagent",
      title: "task",
      status: "running",
      input: "{}",
      timestamp: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    },
  };
  const identified: SessionRuntimeEvent = {
    type: "tool-call",
    toolCall: {
      ...initial.toolCall,
      title: "oracle",
      input: JSON.stringify({
        description: "Inspect the repository",
        prompt: "Inspect the repository",
        category: "oracle",
        run_in_background: false,
      }),
      updatedAt: "2026-08-04T00:00:01.000Z",
    },
  };

  handleRuntimeEvent(sessionId, initial, context);
  handleRuntimeEvent(sessionId, identified, context);

  const entry = capture.timelineEntries?.find((item) =>
    item.kind === "tool_call" && item.toolCall.id === "call-opencode-dynamic-category",
  );
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.kind : undefined, "subagent");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.title : undefined, "oracle");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.status : undefined, "running");
});

test("runtime hides an empty search pending snapshot until the descriptive running snapshot arrives", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const timers = createManualTimerHarness();
  const context = createTestContext([], capture, "session-search-placeholder", {}, {
    useCanonicalPipeline: true,
    runtimeEventThrottleConfig: {
      toolCallWindowMs: 64,
      toolCallMaxChars: 512,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });

  handleRuntimeEvent("session-search-placeholder", {
    type: "tool-call",
    toolCall: {
      id: "call-native-grep",
      kind: "search",
      title: "grep",
      status: "running",
      input: "{}",
      sequence: 42,
      timestamp: "2026-07-16T06:31:23.696Z",
      updatedAt: "2026-07-16T06:31:23.696Z",
    },
  }, context);

  assert.equal(timers.size(), 1);
  assert.equal(
    capture.detailBroadcasts.some((item: any) => item.params?.update?.kind === "tool_call"),
    false,
  );

  handleRuntimeEvent("session-search-placeholder", {
    type: "tool-call",
    toolCall: {
      id: "call-native-grep",
      kind: "search",
      title: "Grep: export type",
      status: "running",
      input: JSON.stringify({
        pattern: "export type",
        path: "D:/myProject/tools/Tiller/packages/shared/src",
        include: "*.ts",
        output_mode: "count",
      }),
      sequence: 43,
      timestamp: "2026-07-16T06:31:24.157Z",
      updatedAt: "2026-07-16T06:31:24.157Z",
    },
  }, context);

  assert.equal(timers.size(), 0);

  const runningTimelineUpdate = capture.detailBroadcasts.filter((item: any) =>
    item.params?.update?.kind === "timeline_batch" &&
    item.params.update.batch?.entries?.some?.((entry: any) => entry.toolCall?.id === "call-native-grep")
  ).at(-1) as any;
  const runningEntry = runningTimelineUpdate?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call" && entry.toolCall?.id === "call-native-grep",
  );
  assert.equal(runningEntry?.toolCall?.title, "Grep: export type");
  assert.equal(runningEntry?.toolCall?.status, "running");
  assert.equal(runningEntry?.toolCall?.sequence, 42);
  assert.equal(
    capture.detailBroadcasts.some((item: any) =>
      item.params?.update?.kind === "tool_call" &&
      ["Search", "grep"].includes(item.params.update.toolCall?.title)
    ),
    false,
  );

  handleRuntimeEvent("session-search-placeholder", {
    type: "tool-call",
    toolCall: {
      id: "call-native-grep",
      kind: "search",
      title: "Search",
      status: "completed",
      output: "Found 102 matches",
      sequence: 44,
      timestamp: "2026-07-16T06:31:24.400Z",
      updatedAt: "2026-07-16T06:31:24.400Z",
    },
  }, context);

  const terminalEntry = capture.timelineEntries?.find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "call-native-grep"
  );
  assert.equal(
    terminalEntry?.kind === "tool_call" ? terminalEntry.toolCall.title : undefined,
    "Grep: export type",
  );
  assert.equal(
    terminalEntry?.kind === "tool_call" ? terminalEntry.toolCall.sequence : undefined,
    42,
  );
});

test("runtime falls back to a generic live tool title and clears its placeholder timer", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
  };
  const timers = createManualTimerHarness();
  const context = createTestContext([], capture, "session-search-placeholder-fallback", {}, {
    useCanonicalPipeline: true,
    runtimeEventThrottleConfig: {
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });

  handleRuntimeEvent("session-search-placeholder-fallback", {
    type: "tool-call",
    toolCall: {
      id: "call-native-grep-fallback",
      kind: "search",
      title: "grep",
      status: "running",
      input: "{}",
      timestamp: "2026-07-16T06:31:23.696Z",
      updatedAt: "2026-07-16T06:31:23.696Z",
    },
  }, context);

  assert.equal(timers.size(), 1);
  timers.flushAll();
  assert.equal(timers.size(), 0);
  const fallbackTimelineUpdate = capture.detailBroadcasts.filter((item: any) =>
    item.params?.update?.kind === "timeline_batch" &&
    item.params.update.batch?.entries?.some?.((entry: any) => entry.toolCall?.id === "call-native-grep-fallback")
  ).at(-1) as any;
  const fallbackEntry = fallbackTimelineUpdate?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call" && entry.toolCall?.id === "call-native-grep-fallback",
  );
  assert.equal(fallbackEntry?.toolCall?.title, "grep");
  assert.equal(fallbackEntry?.toolCall?.status, "running");

  handleRuntimeEvent("session-search-placeholder-fallback", {
    type: "tool-call",
    toolCall: {
      id: "call-never-visible",
      kind: "search",
      title: "Search",
      status: "running",
      input: "{}",
      timestamp: "2026-07-16T06:31:25.000Z",
      updatedAt: "2026-07-16T06:31:25.000Z",
    },
  }, context);
  assert.equal(timers.size(), 1);
  cleanupRuntimeEventState("session-search-placeholder-fallback", context);
  assert.equal(timers.size(), 0);
});

test("runtime keeps parallel tool placeholders hidden until descriptive snapshots arrive", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const timers = createManualTimerHarness();
  const context = createTestContext([], capture, "session-sparse-terminal-tool", {}, {
    useCanonicalPipeline: true,
    runtimeEventThrottleConfig: {
      toolCallWindowMs: 64,
      toolCallMaxChars: 512,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });

  handleRuntimeEvent("session-sparse-terminal-tool", {
    type: "tool-call",
    toolCall: {
      id: "tool-search-placeholder",
      kind: "search",
      title: "Search",
      status: "completed",
      input: "{}",
      timestamp: "2026-07-16T00:00:01.000Z",
      updatedAt: "2026-07-16T00:00:01.000Z",
    },
  }, context);

  handleRuntimeEvent("session-sparse-terminal-tool", {
    type: "tool-call",
    toolCall: {
      id: "tool-opaque-placeholder",
      kind: "search",
      title: "Tool call call_03_n…",
      status: "completed",
      timestamp: "2026-07-16T00:00:01.100Z",
      updatedAt: "2026-07-16T00:00:01.100Z",
    },
  }, context);

  handleRuntimeEvent("session-sparse-terminal-tool", {
    type: "message",
    message: {
      id: "assistant-between-tool-snapshots",
      role: "assistant",
      text: "继续检查",
      timestamp: "2026-07-16T00:00:01.500Z",
    },
  }, context);

  assert.equal(timers.size(), 0);
  assert.equal(
    capture.timelineEntries?.some((entry) => entry.kind === "tool_call"),
    false,
  );
  assert.equal(
    capture.sessionUpdates?.filter((update) => update.updateType === "tool-call").length,
    0,
  );

  handleRuntimeEvent("session-sparse-terminal-tool", {
    type: "tool-call",
    toolCall: {
      id: "tool-search-placeholder",
      kind: "search",
      title: "Grep: create\\(",
      status: "completed",
      input: JSON.stringify({ pattern: "create\\(" }),
      timestamp: "2026-07-16T00:00:01.000Z",
      updatedAt: "2026-07-16T00:00:02.000Z",
    },
  }, context);

  handleRuntimeEvent("session-sparse-terminal-tool", {
    type: "tool-call",
    toolCall: {
      id: "tool-opaque-placeholder",
      kind: "search",
      title: "AST search: export type $TYPE = $$$",
      status: "completed",
      input: JSON.stringify({ pattern: "export type $TYPE = $$$" }),
      timestamp: "2026-07-16T00:00:01.100Z",
      updatedAt: "2026-07-16T00:00:02.100Z",
    },
  }, context);

  assert.equal(timers.size(), 0);
  assert.equal(
    capture.sessionUpdates?.filter((update) => update.updateType === "tool-call").length,
    2,
  );
  const entry = capture.timelineEntries?.find((candidate) =>
    candidate.kind === "tool_call" && candidate.toolCall.id === "tool-search-placeholder"
  );
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.title : undefined, "Grep: create\\(");
  assert.equal(
    entry?.kind === "tool_call" ? entry.toolCall.input : undefined,
    JSON.stringify({ pattern: "create\\(" }),
  );
  assert.equal(
    capture.detailBroadcasts.some((item: any) =>
      item.params?.update?.kind === "tool_call" &&
      ["Search", "Tool call call_03_n…"].includes(item.params.update.toolCall?.title)
    ),
    false,
  );
  const opaqueEntry = capture.timelineEntries?.find((candidate) =>
    candidate.kind === "tool_call" && candidate.toolCall.id === "tool-opaque-placeholder"
  );
  assert.equal(
    opaqueEntry?.kind === "tool_call" ? opaqueEntry.toolCall.title : undefined,
    "AST search: export type $TYPE = $$$",
  );
});

test("runtime canonical tool-call persistence preserves the mapper classification", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-classified-tool", {}, {
    useCanonicalPipeline: true,
  });
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => ({
    outputs: [],
    diffs: [],
    toolCalls: [
      {
        ...toolCall,
        kind: "mcp",
        title: "Tool: sanshu/zhi",
      },
    ],
  });

  handleRuntimeEvent(
    "session-canonical-classified-tool",
    {
      type: "tool-call",
      toolCall: {
        id: "call-1",
        kind: "tool",
        title: "Review request",
        status: "completed",
        timestamp: "2026-07-06T00:00:01.000Z",
        updatedAt: "2026-07-06T00:00:02.000Z",
        input: JSON.stringify({
          project_root_path: "D:/myProject/tools/Tiller",
          message: "review",
          predefined_options: ["按当前结果结束（推荐）"],
        }),
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  ) as any;
  const toolCallEntry = timelineBatchUpdate?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call",
  );

  assert.equal(toolCallEntry?.toolCall.kind, "tool");
  assert.equal(toolCallEntry?.toolCall.title, "Review request");
  assert.deepEqual(capture.sessionUpdates?.map((update) => update.updateType), ["tool-call"]);
});

test("runtime canonical MCP tool-call persistence strips inline image outputs before storage", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture, "session-canonical-image-tool", {}, {
    useCanonicalPipeline: true,
  });
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
    return {
      outputs: [],
      diffs: [],
      toolCalls: [toolCall],
    };
  };

  handleRuntimeEvent(
    "session-canonical-image-tool",
    {
      type: "tool-call",
      toolCall: {
        id: "call-mcp-image",
        kind: "mcp",
        title: "mcp__image_tool",
        status: "completed",
        input: JSON.stringify({ query: "render preview" }),
        output: JSON.stringify({
          content: [
            { type: "text", text: "preview ready" },
            {
              type: "image",
              data: `data:image/jpeg;base64,${"A".repeat(2048)}`,
              mimeType: "image/jpeg",
            },
          ],
          requestId: "request-1",
        }),
        timestamp: "2026-07-08T06:00:00.000Z",
        updatedAt: "2026-07-08T06:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const expectedOutput = JSON.stringify({
    content: [
      { type: "text", text: "preview ready" },
      {
        type: "image",
        data: "[image content omitted from history]",
        mimeType: "image/jpeg",
      },
    ],
    requestId: "request-1",
  });
  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  ) as any;
  const toolCallEntry = timelineBatchUpdate?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call",
  );

  assert.equal(appendedToolCalls.length, 0);
  assert.equal(toolCallEntry?.toolCall.output, expectedOutput);
  assert.doesNotMatch(toolCallEntry?.toolCall.output ?? "", /data:image\/jpeg;base64/u);
  assert.doesNotMatch(JSON.stringify(capture.sessionUpdates), /data:image\/jpeg;base64/u);
  assert.deepEqual(capture.sessionUpdates?.map((update) => update.updateType), ["tool-call"]);
});

test("runtime tool-call events persist and broadcast without stage log", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: unknown[] = [];
  const context = createTestContext(logs, capture);
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "tool-call",
      toolCall: {
        id: "call-1",
        kind: "tool",
        title: "zhi",
        status: "running",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
        input: "git branch --show-current",
        output: "main",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(logs, []);
  assert.equal(appendedToolCalls.length, 0);
  assert.deepEqual(capture.broadcasts, []);
  const toolCallTimeline = capture.detailBroadcasts.find((item: any) =>
    item.params?.update?.kind === "timeline_batch",
  ) as any;
  const toolCallEntry = toolCallTimeline?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call",
  );
  assert.equal(typeof toolCallEntry?.toolCall?.sequence, "number");
  assert.equal(toolCallEntry?.toolCall?.id, "call-1");
  assert.equal(toolCallEntry?.toolCall?.status, "running");
  assert.equal(toolCallEntry?.toolCall?.input, "git branch --show-current");
  assert.equal(toolCallEntry?.toolCall?.output, "main");
});

test("runtime assistant thought chunks with generated ids stay in one thinking stream", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture, "session-thought-stream");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };

  handleRuntimeEvent(
    "session-thought-stream",
    assistantThoughtEvent(
      "session-thought-stream-msg-alpha",
      "先看 ACP ",
      "2026-04-30T00:00:01.000Z",
    ),
    context,
  );
  handleRuntimeEvent(
    "session-thought-stream",
    assistantThoughtEvent(
      "session-thought-stream-msg-beta",
      "再对照 Zed",
      "2026-04-30T00:00:02.000Z",
    ),
    context,
  );

  const assistantEntry = capture.timelineEntries?.find(
    (entry) => entry.kind === "assistant_message",
  );
  assert.equal(assistantEntry?.kind, "assistant_message");
  assert.match(assistantEntry?.id ?? "", /^session-thought-stream-msg-\d{6}-\d{6}-.+$/u);
  assert.equal(
    assistantEntry?.kind === "assistant_message"
      ? assistantEntry.chunks.find((chunk) => chunk.kind === "thinking")?.text
      : undefined,
    "先看 ACP 再对照 Zed",
  );
  assert.equal(
    capture.timelineEntries?.some((entry) => entry.kind === "tool_call"),
    false,
  );
  assert.equal(appendedToolCalls.length, 0);
  assert.equal(capture.persisted.length, 0);
});

test("runtime assistant thinking broadcasts message deltas", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const storedById = new Map<string, AgentToolCall>();
  const context = createTestContext(logs, capture, "session-thinking-delta");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    const current = storedById.get(toolCall.id);
    const next = current
      ? {
          ...current,
          ...toolCall,
          output: `${current.output ?? ""}${toolCall.output ?? ""}`,
        }
      : toolCall;
    storedById.set(toolCall.id, next);
    return { outputs: [], diffs: [], toolCalls: [...storedById.values()] };
  };

  handleRuntimeEvent(
    "session-thinking-delta",
    assistantThoughtEvent(
      "session-thinking-delta-msg-a",
      "A",
      "2026-04-30T00:00:01.000Z",
    ),
    context,
  );
  handleRuntimeEvent(
    "session-thinking-delta",
    assistantThoughtEvent(
      "session-thinking-delta-msg-b",
      "B",
      "2026-04-30T00:00:02.000Z",
    ),
    context,
  );

  const thoughtOutputs = capture.detailBroadcasts
    .filter((item: any) =>
      item.method === "session/update" &&
      item.params?.update?.kind === "agent_message" &&
      item.params.update.message?.contentKind === "thought" &&
      item.params.update.streaming === true
    )
    .map((item: any) => item.params.update.message.text);
  assert.deepEqual(thoughtOutputs, ["A", "B"]);
  assert.deepEqual([...storedById.values()], []);
});

test("runtime status completion finalizes active thinking stream", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const storedById = new Map<string, AgentToolCall>();
  const context = createTestContext(logs, capture, "session-thinking-complete");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    const current = storedById.get(toolCall.id);
    const next = current
      ? {
          ...current,
          ...toolCall,
          output: `${current.output ?? ""}${toolCall.output ?? ""}`,
          timestamp: current.timestamp,
        }
      : toolCall;
    storedById.set(toolCall.id, next);
    return { outputs: [], diffs: [], toolCalls: [...storedById.values()] };
  };

  handleRuntimeEvent(
    "session-thinking-complete",
    assistantThoughtEvent(
      "session-thinking-complete-msg-a",
      "A",
      "2026-04-30T00:00:01.000Z",
    ),
    context,
  );
  handleRuntimeEvent(
    "session-thinking-complete",
    {
      type: "status",
      status: "idle",
      message: "ACP prompt completed",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const thinkingEntry = capture.timelineEntries?.find((entry) => entry.kind === "assistant_message");
  const thinkingChunk = thinkingEntry?.kind === "assistant_message"
    ? thinkingEntry.chunks.find((chunk) => chunk.kind === "thinking")
    : undefined;
  assert.equal(thinkingChunk?.kind === "thinking" ? thinkingChunk.status : undefined, "completed");
  assert.equal(thinkingChunk?.kind === "thinking" ? thinkingChunk.text : undefined, "A");
  assert.equal(thinkingEntry?.sequence, 1);
  const updateSequences = capture.sessionUpdates?.map((update) => update.sequence) ?? [];
  assert.equal(new Set(updateSequences).size, updateSequences.length, JSON.stringify(updateSequences));
  assert.deepEqual([...storedById.values()], []);
});

test("runtime idle status preserves background subagents and unique journal sequences", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-background-subagent-idle");

  handleRuntimeEvent(
    "session-background-subagent-idle",
    {
      type: "tool-call",
      toolCall: {
        id: "background-subagent",
        commandId: "subagent:ses_child",
        kind: "subagent",
        title: "Run helm tests",
        status: "running",
        timestamp: "2026-07-15T00:00:01.000Z",
        updatedAt: "2026-07-15T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-background-subagent-idle",
    {
      type: "status",
      status: "idle",
      message: "ACP prompt completed",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const subagentEntry = capture.timelineEntries?.find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "background-subagent"
  );
  assert.equal(
    subagentEntry?.kind === "tool_call" ? subagentEntry.toolCall.status : undefined,
    "running",
  );
  handleRuntimeEvent(
    "session-background-subagent-idle",
    {
      type: "error",
      code: "ACP_CONNECTION_EXITED",
      message: "Provider exited before the background result arrived",
    } satisfies SessionRuntimeEvent,
    context,
  );
  const failedSubagentEntry = capture.timelineEntries?.find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "background-subagent"
  );
  assert.equal(
    failedSubagentEntry?.kind === "tool_call" ? failedSubagentEntry.toolCall.status : undefined,
    "failed",
  );
  const updateSequences = capture.sessionUpdates?.map((update) => update.sequence) ?? [];
  assert.equal(new Set(updateSequences).size, updateSequences.length, JSON.stringify(updateSequences));
});

test("runtime errors flush active assistant thinking without reusing its journal sequence", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-thinking-error");

  handleRuntimeEvent(
    "session-thinking-error",
    assistantThoughtEvent(
      "error-thinking",
      "Inspect the failed request",
      "2026-07-13T00:00:01.000Z",
    ),
    context,
  );
  handleRuntimeEvent(
    "session-thinking-error",
    {
      type: "error",
      code: "ACP_PROMPT_FAILED",
      message: "Provider request failed",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const thinkingEntry = capture.timelineEntries?.find((entry) => entry.kind === "assistant_message");
  const thinkingChunk = thinkingEntry?.kind === "assistant_message"
    ? thinkingEntry.chunks.find((chunk) => chunk.kind === "thinking")
    : undefined;
  assert.equal(thinkingChunk?.kind === "thinking" ? thinkingChunk.status : undefined, "completed");
  assert.equal(thinkingEntry?.sequence, 1);
  const updateSequences = capture.sessionUpdates?.map((update) => update.sequence) ?? [];
  assert.equal(new Set(updateSequences).size, updateSequences.length, JSON.stringify(updateSequences));
});

test("runtime tool boundaries finalize active thinking before splitting the assistant segment", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-thinking-tool-boundary");

  handleRuntimeEvent(
    "session-thinking-tool-boundary",
    assistantThoughtEvent(
      "tool-boundary-thinking",
      "Choose the next command",
      "2026-07-13T00:00:01.000Z",
    ),
    context,
  );
  handleRuntimeEvent(
    "session-thinking-tool-boundary",
    {
      type: "tool-call",
      toolCall: {
        id: "shell-after-thinking",
        kind: "shell",
        title: "Get-Date",
        status: "completed",
        timestamp: "2026-07-13T00:00:02.000Z",
        updatedAt: "2026-07-13T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const thinkingEntry = capture.timelineEntries?.find((entry) => entry.kind === "assistant_message");
  const thinkingChunk = thinkingEntry?.kind === "assistant_message"
    ? thinkingEntry.chunks.find((chunk) => chunk.kind === "thinking")
    : undefined;
  assert.equal(thinkingChunk?.kind === "thinking" ? thinkingChunk.status : undefined, "completed");
  assert.equal(thinkingEntry?.sequence, 1);
  const updateSequences = capture.sessionUpdates?.map((update) => update.sequence) ?? [];
  assert.equal(new Set(updateSequences).size, updateSequences.length, JSON.stringify(updateSequences));
});

test("runtime assistant content finalizes active thinking before clearing its segment", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-thinking-before-content");

  handleRuntimeEvent(
    "session-thinking-before-content",
    assistantThoughtEvent(
      "reply-with-thought",
      "Inspect the canonical timeline",
      "2026-07-13T00:00:01.000Z",
    ),
    context,
  );
  handleRuntimeEvent(
    "session-thinking-before-content",
    {
      type: "message",
      message: {
        id: "reply-with-thought",
        role: "assistant",
        text: "Done",
        timestamp: "2026-07-13T00:00:02.000Z",
        streaming: false,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const assistantEntry = capture.timelineEntries?.find(
    (entry) => entry.kind === "assistant_message",
  );
  const thinkingChunk = assistantEntry?.kind === "assistant_message"
    ? assistantEntry.chunks.find((chunk) => chunk.kind === "thinking")
    : undefined;
  assert.equal(thinkingChunk?.kind === "thinking" ? thinkingChunk.status : undefined, "completed");
  assert.equal(
    thinkingChunk?.kind === "thinking" ? thinkingChunk.text : undefined,
    "Inspect the canonical timeline",
  );
});

test("runtime assistant deltas without an explicit streaming flag finalize active thinking", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-thinking-before-implicit-content");

  handleRuntimeEvent(
    "session-thinking-before-implicit-content",
    assistantThoughtEvent(
      "implicit-content-thinking",
      "Wait for the background result",
      "2026-07-28T00:00:00.000Z",
    ),
    context,
  );
  handleRuntimeEvent("session-thinking-before-implicit-content", {
    type: "message",
    message: {
      id: "implicit-content",
      role: "assistant",
      text: "The background result is complete.",
      timestamp: "2026-07-28T00:00:01.000Z",
      streamMode: "delta",
    },
  } satisfies SessionRuntimeEvent, context);
  flushRuntimeSessionState("session-thinking-before-implicit-content", context);

  const assistantEntry = capture.timelineEntries?.find(
    (entry) => entry.kind === "assistant_message",
  );
  const thinkingChunk = assistantEntry?.kind === "assistant_message"
    ? assistantEntry.chunks.find((chunk) => chunk.kind === "thinking")
    : undefined;
  assert.equal(thinkingChunk?.kind === "thinking" ? thinkingChunk.status : undefined, "completed");
  assert.equal(assistantEntry?.kind === "assistant_message" ? assistantEntry.streaming : undefined, false);
});

test("runtime finalized assistant messages complete thinking before rotating message segments", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext([], capture, "session-thinking-segment-rotation");

  handleRuntimeEvent("session-thinking-segment-rotation", {
    type: "message",
    message: {
      id: "provider-message-before-thinking",
      role: "assistant",
      text: "已启动，等待结果中...",
      timestamp: "2026-07-28T00:00:00.000Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent, context);
  handleRuntimeEvent(
    "session-thinking-segment-rotation",
    assistantThoughtEvent(
      "provider-thinking",
      "等待后台任务结果",
      "2026-07-28T00:00:01.000Z",
    ),
    context,
  );
  handleRuntimeEvent("session-thinking-segment-rotation", {
    type: "message",
    message: {
      id: "provider-message-after-thinking",
      role: "assistant",
      text: "重测通过 ✅",
      timestamp: "2026-07-28T00:00:02.000Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent, context);

  const thinkingChunks = (capture.timelineEntries ?? [])
    .filter((entry) => entry.kind === "assistant_message")
    .flatMap((entry) => entry.chunks)
    .filter((chunk) => chunk.kind === "thinking");
  assert.equal(thinkingChunks.length, 1);
  assert.equal(thinkingChunks[0]?.status, "completed");
  assert.equal(
    (capture.timelineEntries ?? []).some((entry) =>
      entry.kind === "assistant_message" &&
      entry.chunks.some((chunk) => chunk.kind === "content" && chunk.text === "重测通过 ✅"),
    ),
    true,
  );
});

test("runtime timeline store nests thinking and assistant content under one assistant entry", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const storedById = new Map<string, AgentToolCall>();
  const context = createTestContext(logs, capture, "session-timeline-nested");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    const current = storedById.get(toolCall.id);
    const next = current
      ? {
          ...current,
          ...toolCall,
          output: `${current.output ?? ""}${toolCall.output ?? ""}`,
          timestamp: current.timestamp,
        }
      : toolCall;
    storedById.set(toolCall.id, next);
    return { outputs: [], diffs: [], toolCalls: [...storedById.values()] };
  };

  handleRuntimeEvent(
    "session-timeline-nested",
    assistantThoughtEvent("reply-1", "Plan", "2026-04-30T00:00:01.000Z"),
    context,
  );
  handleRuntimeEvent(
    "session-timeline-nested",
    {
      type: "message",
      message: {
        id: "reply-1",
        role: "assistant",
        text: "Done",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-timeline-nested",
    {
      type: "status",
      status: "idle",
      message: "done",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    capture.timelineEntries?.map((entry) => entry.kind),
    ["assistant_message"],
  );
  const assistantEntry = capture.timelineEntries?.[0];
  assert.deepEqual(
    assistantEntry?.kind === "assistant_message"
      ? assistantEntry.chunks.map((chunk) => chunk.kind)
      : [],
    ["thinking", "content"],
  );
});

test("runtime tool-call batches preserve normalized classifications", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  handleRuntimeEvent(
    "session-1",
    {
      type: "tool-call",
      toolCall: {
        id: "call-1",
        kind: "mcp",
        title: "Tool: node_repl/js",
        status: "completed",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatch = capture.detailBroadcasts.find((item: any) =>
    item.params?.update?.kind === "timeline_batch",
  ) as any;
  const toolCallEntry = timelineBatch?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call",
  );
  assert.equal(toolCallEntry?.toolCall?.sequence, 1);
  assert.equal(toolCallEntry?.toolCall?.kind, "mcp");
  assert.equal(toolCallEntry?.toolCall?.title, "Tool: node_repl/js");
  const persistedUpdatePayload = JSON.parse(capture.sessionUpdates?.[0]?.payloadJson ?? "{}") as {
    type?: string;
    toolCall?: AgentToolCall;
  };
  assert.equal(persistedUpdatePayload.type, "tool-call");
  assert.equal(persistedUpdatePayload.toolCall?.kind, "mcp");
  assert.equal(persistedUpdatePayload.toolCall?.title, "Tool: node_repl/js");
});

test("runtime keeps the initial Context7 MCP title across later search-shaped snapshots", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-stable-tool-kind", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-stable-tool-kind",
    {
      type: "tool-call",
      toolCall: {
        id: "call-stable-kind",
        kind: "mcp",
        title: "Tool: context7/query-docs",
        status: "completed",
        mcp: {
          serverName: "context7",
          toolName: "query-docs",
          source: "provider-title",
          rawTitle: "context7_query-docs",
        },
        timestamp: "2026-07-13T00:00:01.000Z",
        updatedAt: "2026-07-13T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-stable-tool-kind",
    {
      type: "tool-call",
      toolCall: {
        id: "call-stable-kind",
        kind: "search",
        title: "Search: How to use persist middleware with partialize to exclude…",
        status: "completed",
        output: "Found 3 matches",
        timestamp: "2026-07-13T00:00:01.000Z",
        updatedAt: "2026-07-13T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const entry = capture.timelineEntries?.find((candidate) =>
    candidate.kind === "tool_call" && candidate.toolCall.id === "call-stable-kind"
  );
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.kind : undefined, "mcp");
  assert.deepEqual(
    entry?.kind === "tool_call" ? entry.toolCall.mcp : undefined,
    {
      serverName: "context7",
      toolName: "query-docs",
      source: "provider-title",
      rawTitle: "context7_query-docs",
    },
  );
  assert.equal(
    entry?.kind === "tool_call" ? entry.toolCall.title : undefined,
    "Tool: context7/query-docs",
  );
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.output : undefined, "Found 3 matches");
});
