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

test("runtime running tool calls stay in live updates and do not append canonical history", () => {
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

  assert.equal(timelineBatchUpdate, undefined);
  assert.ok(legacyToolCallUpdate);
  assert.equal(legacyToolCallUpdate?.params?.update?.toolCall?.status, "running");
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);
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

test("runtime running tool-call updates coalesce into one terminal historical snapshot inside the live window", () => {
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
  assert.equal(
    capture.detailBroadcasts.filter((item: any) => item.params?.update?.kind === "tool_call").length,
    0,
  );

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

  const timelineBatchUpdate = capture.detailBroadcasts.find(
    (item: any) => item.params?.update?.kind === "timeline_batch",
  ) as any;
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

  const timelineBatchUpdate = capture.detailBroadcasts.find(
    (item: any) => item.params?.update?.kind === "timeline_batch",
  ) as any;
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

  assert.equal(timers.size(), 1);
  timers.flushAll();

  const liveUpdate = capture.detailBroadcasts.find((item: any) =>
    item.params?.update?.kind === "tool_call" &&
    item.params.update.toolCall?.id === "call-native-grep"
  ) as any;
  assert.equal(liveUpdate?.params?.update?.toolCall?.title, "Grep: export type");
  assert.equal(liveUpdate?.params?.update?.toolCall?.status, "running");
  assert.equal(liveUpdate?.params?.update?.toolCall?.sequence, 42);
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
  const liveUpdate = capture.detailBroadcasts.find((item: any) =>
    item.params?.update?.kind === "tool_call" &&
    item.params.update.toolCall?.id === "call-native-grep-fallback"
  ) as any;
  assert.equal(liveUpdate?.params?.update?.toolCall?.title, "grep");
  assert.equal(liveUpdate?.params?.update?.toolCall?.status, "running");

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

test("runtime canonical tool-call persistence compacts inline image outputs before storage", () => {
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
        id: "call-view-image",
        kind: "read",
        title: "D:/myProject/tools/Tiller/apps/deck/public/landing/command-deck-bg.png",
        status: "completed",
        input: JSON.stringify({
          path: "D:/myProject/tools/Tiller/apps/deck/public/landing/command-deck-bg.png",
          detail: "high",
        }),
        output: JSON.stringify([
          {
            type: "input_image",
            image_url: `data:image/png;base64,${"A".repeat(2048)}`,
            detail: "high",
          },
        ]),
        timestamp: "2026-07-08T06:00:00.000Z",
        updatedAt: "2026-07-08T06:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const expectedOutput = [
    "[image content omitted from history]",
    "path: D:/myProject/tools/Tiller/apps/deck/public/landing/command-deck-bg.png",
    "mimeType: image/png",
    "detail: high",
  ].join("\n");
  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  ) as any;
  const toolCallEntry = timelineBatchUpdate?.params?.update?.batch?.entries?.find(
    (entry: any) => entry.kind === "tool_call",
  );

  assert.equal(appendedToolCalls.length, 0);
  assert.equal(toolCallEntry?.toolCall.output, expectedOutput);
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
  const toolCallBroadcast = capture.detailBroadcasts[0] as any;
  assert.equal(typeof toolCallBroadcast.params.update.toolCall.sequence, "number");
  delete toolCallBroadcast.params.update.toolCall.sequence;
  assert.deepEqual(capture.detailBroadcasts, [
    {
      sessionId: "session-1",
      method: "session/update",
      params: {
        sessionId: "session-1",
        update: {
          kind: "tool_call",
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
        },
      },
    },
  ]);
});

test("runtime ACP thought chunks with generated ids stay in one thinking stream", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedToolCalls: AgentToolCall[] = [];
  const context = createTestContext(logs, capture, "session-thought-stream");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
  };

  handleRuntimeEvent(
    "session-thought-stream",
    {
      type: "tool-call",
      toolCall: {
        id: "session-thought-stream-msg-alpha:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "先看 ACP ",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-thought-stream",
    {
      type: "tool-call",
      toolCall: {
        id: "session-thought-stream-msg-beta:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "再对照 Zed",
        timestamp: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const thoughtUpdates = capture.sessionUpdates?.map((update) =>
    JSON.parse(update.payloadJson).toolCall as AgentToolCall,
  ) ?? [];
  assert.equal(thoughtUpdates.length, 2);
  assert.equal(thoughtUpdates[0]?.id, thoughtUpdates[1]?.id);
  assert.match(thoughtUpdates[0]?.id ?? "", /^session-thought-stream-msg-\d{6}-\d{6}-.+:thinking$/u);
  assert.deepEqual(capture.sessionUpdates?.map((update) => update.sequence), [1, 2]);
  assert.equal(appendedToolCalls.length, 0);
  assert.equal(capture.persisted.length, 0);
});

test("runtime thinking broadcasts deltas instead of persisted cumulative output", () => {
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
    {
      type: "tool-call",
      toolCall: {
        id: "session-thinking-delta-msg-a:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "A",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-thinking-delta",
    {
      type: "tool-call",
      toolCall: {
        id: "session-thinking-delta-msg-b:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "B",
        timestamp: "2026-04-30T00:00:02.000Z",
        updatedAt: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const thoughtOutputs = capture.sessionUpdates?.map((update) =>
    (JSON.parse(update.payloadJson).toolCall as AgentToolCall).output,
  );
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
    {
      type: "tool-call",
      toolCall: {
        id: "session-thinking-complete-msg-a:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "A",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
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

test("runtime errors finalize active thinking without reusing its journal sequence", () => {
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
    {
      type: "tool-call",
      toolCall: {
        id: "error-thinking:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "Inspect the failed request",
        timestamp: "2026-07-13T00:00:01.000Z",
        updatedAt: "2026-07-13T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
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
  assert.equal(thinkingChunk?.kind === "thinking" ? thinkingChunk.status : undefined, "failed");
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
    {
      type: "tool-call",
      toolCall: {
        id: "tool-boundary-thinking:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "Choose the next command",
        timestamp: "2026-07-13T00:00:01.000Z",
        updatedAt: "2026-07-13T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
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

test("runtime ignores structurally empty thinking frames", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-empty-thinking");

  for (const [index, output] of ["\u200B\u2060\uFEFF", "{}", "[]", "null"].entries()) {
    handleRuntimeEvent(
      "session-empty-thinking",
      {
        type: "tool-call",
        toolCall: {
          id: `empty-thinking-${index}:thinking`,
          kind: "think",
          title: "Thinking",
          status: "running",
          output,
          timestamp: "2026-07-13T00:00:01.000Z",
          updatedAt: "2026-07-13T00:00:01.000Z",
        },
      } satisfies SessionRuntimeEvent,
      context,
    );
  }
  handleRuntimeEvent(
    "session-empty-thinking",
    { type: "status", status: "idle" } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(capture.timelineEntries, []);
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
    {
      type: "tool-call",
      toolCall: {
        id: "reply-with-thought:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "Inspect the canonical timeline",
        timestamp: "2026-07-13T00:00:01.000Z",
        updatedAt: "2026-07-13T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
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
    {
      type: "tool-call",
      toolCall: {
        id: "reply-1:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "Plan",
        timestamp: "2026-04-30T00:00:01.000Z",
        updatedAt: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
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
