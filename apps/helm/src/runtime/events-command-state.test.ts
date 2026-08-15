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

test("handleRuntimeEvent broadcasts plan updates without storing a tool call", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  const appendedToolCalls: AgentToolCall[] = [];
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    appendedToolCalls.push(toolCall);
    return { toolCalls: appendedToolCalls };
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "plan-update",
      plan: {
        entries: [{ content: "Broadcast plan", priority: "medium", status: "in_progress" }],
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(context.sessionLiveStateStore?.get("session-1")?.plan?.entries, [
    { content: "Broadcast plan", priority: "medium", status: "in_progress" },
  ]);
  assert.equal(findStructuredLog(capture, "runtime.plan.updated")?.fields?.entries, 1);
  assert.deepEqual(appendedToolCalls, []);
});
test("empty plan updates are broadcast without debug log noise", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  const emptyPlanUpdate = {
    type: "plan-update",
    plan: {
      entries: [],
      updatedAt: "2026-06-02T00:00:00.000Z",
    },
  } satisfies SessionRuntimeEvent;

  handleRuntimeEvent("session-1", emptyPlanUpdate, context);
  handleRuntimeEvent("session-1", emptyPlanUpdate, context);

  assert.equal(context.sessionLiveStateStore?.get("session-1")?.plan?.entries.length, 0);
  assert.equal(
    capture.detailBroadcasts.filter((item: any) => item.params?.update?.kind === "live_state").length,
    2,
  );
  assert.equal(findStructuredLog(capture, "runtime.plan.updated"), undefined);
});

test("plan clear logs once after a non-empty plan", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  const filledPlanUpdate = {
    type: "plan-update",
    plan: {
      entries: [{ content: "Investigate logs", priority: "medium", status: "in_progress" }],
      updatedAt: "2026-06-02T00:00:00.000Z",
    },
  } satisfies SessionRuntimeEvent;
  const emptyPlanUpdate = {
    type: "plan-update",
    plan: {
      entries: [],
      updatedAt: "2026-06-02T00:00:01.000Z",
    },
  } satisfies SessionRuntimeEvent;

  handleRuntimeEvent("session-1", filledPlanUpdate, context);
  handleRuntimeEvent("session-1", emptyPlanUpdate, context);
  handleRuntimeEvent("session-1", emptyPlanUpdate, context);

  const planLogs = structuredLogs(capture).filter((log) => log.event.startsWith("runtime.plan."));
  assert.deepEqual(
    planLogs.map((log) => log.event),
    ["runtime.plan.updated", "runtime.plan.cleared"],
  );
  assert.equal(planLogs[0]?.fields?.entries, 1);
  assert.equal(planLogs[1]?.fields?.previousEntries, 1);
});

test("runtime timeline events carry arrival order when timestamps collide", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const storedById = new Map<string, AgentToolCall>();
  const context = createTestContext(logs, capture, "session-timeline-order");
  context.sessionArtifactStore.appendToolCall = (_sessionId: string, toolCall: AgentToolCall) => {
    const current = storedById.get(toolCall.id);
    const next = current ? { ...current, ...toolCall } : toolCall;
    storedById.set(toolCall.id, next);
    return { outputs: [], diffs: [], toolCalls: [...storedById.values()] };
  };

  const timestamp = "2026-04-30T00:00:01.000Z";
  handleRuntimeEvent(
    "session-timeline-order",
    {
      type: "message",
      message: {
        id: "session-timeline-order-msg-a",
        role: "assistant",
        contentKind: "thought",
        text: "先思考",
        timestamp,
        streaming: false,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-timeline-order",
    {
      type: "tool-call",
      toolCall: {
        id: "call-shell",
        kind: "shell",
        title: "pnpm test",
        status: "completed",
        timestamp,
        updatedAt: timestamp,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-timeline-order",
    {
      type: "message",
      message: {
        id: "message-final",
        role: "assistant",
        text: "最后回复",
        streaming: false,
        timestamp,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    capture.sessionUpdates?.map((update) => update.sequence),
    [1, 2, 3],
  );
});

test("runtime non-streaming event logs use structured status metadata", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);

  handleRuntimeEvent(
    "session-1",
    {
      type: "status",
      status: "running",
      message: "still working",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const statusLog = findStructuredLog(capture, "runtime.status.changed");
  assert.equal(statusLog?.level, "info");
  assert.equal(statusLog?.fields?.sessionId, "session-1");
  assert.equal(statusLog?.fields?.agentId, "opencode");
  assert.equal(statusLog?.fields?.cwd, "<stored>");
  assert.equal(statusLog?.fields?.status, "running");
  assert.equal(statusLog?.fields?.messageChars, "still working".length);
  assert.doesNotMatch(JSON.stringify(statusLog), /still working/u);
});

test("runtime command-output logs summary metadata without stream text", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const appendedOutputs: unknown[] = [];
  const context = createTestContext(logs, capture, "session-command-output-summary");
  context.sessionArtifactStore.appendOutput = (_sessionId: string, chunk: CommandChunk) => {
    appendedOutputs.push(chunk);
  };

  handleRuntimeEvent(
    "session-command-output-summary",
    {
      type: "command-output",
      chunk: {
        id: "chunk-1",
        commandId: "cmd-1",
        stream: "stdout",
        text: "SECRET_STREAM_TEXT\nwith details",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-command-output-summary",
    {
      type: "command-output",
      chunk: {
        id: "chunk-2",
        commandId: "cmd-1",
        stream: "stdout",
        text: "\nmore secret output",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-command-output-summary",
    {
      type: "status",
      status: "idle",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const commandLog = findStructuredLog(capture, "runtime.command_output.summary");
  assert.equal(commandLog?.level, "debug");
  assert.equal(commandLog?.fields?.commandId, "cmd-1");
  assert.equal(commandLog?.fields?.stream, "stdout");
  assert.equal(commandLog?.fields?.chunks, 2);
  assert.equal(commandLog?.fields?.chars, 31 + "\nmore secret output".length);
  assert.equal(commandLog?.fields?.firstSeq, 1);
  assert.equal(commandLog?.fields?.lastSeq, 2);
  assert.equal(findStructuredLog(capture, "runtime.command_output.chunk"), undefined);
  assert.doesNotMatch(JSON.stringify(commandLog), /SECRET_STREAM_TEXT|with details|more secret output|text|preview/u);
  assert.equal(appendedOutputs.length, 0);
  assert.equal(capture.broadcasts.length, 1);
  assert.equal((capture.broadcasts[0] as any).method, "session/update");
  assert.equal((capture.broadcasts[0] as any).params?.sessionId, "session-command-output-summary");
  assert.equal((capture.broadcasts[0] as any).params?.update?.kind, "session_updated");
  assert.equal((capture.broadcasts[0] as any).params?.update?.session?.status, "idle");
  assert.equal(
    capture.detailBroadcasts.filter((item: any) => item.params?.update?.kind === "timeline_batch").length,
    2,
  );
});

test("runtime command-output merges consecutive same-stream chunks inside the live window", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    sessionUpdates: [],
  };
  const appendedOutputs: CommandChunk[] = [];
  const timers = createManualTimerHarness();
  const context = createTestContext(logs, capture, "session-command-window", {}, {
    runtimeEventThrottleConfig: {
      commandOutputWindowMs: 32,
      commandOutputMaxChars: 256,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    },
  });
  context.sessionArtifactStore.appendOutput = (_sessionId: string, chunk: CommandChunk) => {
    appendedOutputs.push(chunk);
  };

  handleRuntimeEvent(
    "session-command-window",
    {
      type: "command-output",
      chunk: {
        id: "chunk-1",
        commandId: "cmd-1",
        stream: "stdout",
        text: "hello ",
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-command-window",
    {
      type: "command-output",
      chunk: {
        id: "chunk-2",
        commandId: "cmd-1",
        stream: "stdout",
        text: "world",
        timestamp: "2026-04-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(timers.size(), 1);
  assert.equal(appendedOutputs.length, 0);
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);

  timers.flushAll();

  assert.equal(appendedOutputs.length, 0);
  assert.equal(capture.sessionUpdates?.length, 1);
  const commandOutputEntry = capture.timelineEntries?.find((entry) => entry.kind === "command_output");
  assert.equal(commandOutputEntry?.kind === "command_output" ? commandOutputEntry.output.text : undefined, "hello world");
});

test("runtime command-output spills oversized bodies to the output store and broadcasts a preview chunk", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [], sessionUpdates: [] };
  const storedBodies: Array<{ sessionId: string; outputId: string; text: string }> = [];
  const appendedOutputs: CommandChunk[] = [];
  const context = createTestContext(logs, capture, "session-command-output-spill");
  context.sessionOutputBodyStore.putText = ({ sessionId, outputId, text }: { sessionId: string; outputId: string; text: string }) => {
    storedBodies.push({ sessionId, outputId, text });
    return {
      id: outputId,
      sessionId,
      outputId,
      mimeType: "text/plain; charset=utf-8",
      sha256: "sha256-output",
      byteSize: Buffer.byteLength(text, "utf8"),
      storageKey: "storage-key",
      uri: `/api/sessions/${sessionId}/outputs/${outputId}`,
      createdAt: "2026-04-30T00:00:00.000Z",
    };
  };
  context.sessionArtifactStore.appendOutput = (_sessionId: string, chunk: CommandChunk) => {
    appendedOutputs.push(chunk);
  };

  const largeText = "A".repeat(5000);
  handleRuntimeEvent(
    "session-command-output-spill",
    {
      type: "command-output",
      chunk: {
        id: "chunk-big",
        commandId: "cmd-big",
        stream: "stdout",
        text: largeText,
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(storedBodies, [{
    sessionId: "session-command-output-spill",
    outputId: "chunk-big",
    text: largeText,
  }]);
  assert.equal(appendedOutputs.length, 0);
  const commandOutputEntry = capture.timelineEntries?.find((entry) => entry.kind === "command_output");
  assert.equal(commandOutputEntry?.kind === "command_output" ? commandOutputEntry.output.truncated : undefined, true);
  assert.equal(commandOutputEntry?.kind === "command_output" ? commandOutputEntry.output.text.length : undefined, 1024);
  assert.equal(
    commandOutputEntry?.kind === "command_output" ? commandOutputEntry.output.contentRef?.uri : undefined,
    "/api/sessions/session-command-output-spill/outputs/chunk-big",
  );
});

test("runtime available-commands events persist commands on the session summary", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  const updatedSummaries: SessionSummary[] = [];
  context.updateSessionSummary = (
    _sessionId: string,
    mutate: (current: SessionSummary) => SessionSummary,
  ) => {
    const current = context.sessionStore.list()[0] as SessionSummary;
    const updatedSummary = mutate(current);
    updatedSummaries.push(updatedSummary);
    return updatedSummary;
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "available-commands",
      commands: [{ name: "review" }, { name: "compact" }],
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    updatedSummaries[0]?.availableCommands?.map((command) => command.name),
    ["review", "compact"],
  );
  assert.deepEqual(
    context.sessionLiveStateStore?.get("session-1")?.availableCommands?.map((command) => command.name),
    ["review", "compact"],
  );
  assert.equal(capture.broadcasts.length, 0);
});

test("permission-request emits approval/created globally and skips session-topic permission_request", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  (context as any).approvalIndex = (context as any).permissionIndex;

  const request = {
    id: "approval-1",
    command: "Run shell command :: {}",
    reason: "需要审核",
    cwd: "D:/repo",
  };

  handleRuntimeEvent(
    "session-1",
    { type: "permission-request", request } satisfies SessionRuntimeEvent,
    context,
  );

  const broadcastMethods = capture.broadcasts.map((item: any) => item.method);
  const detailMethods = capture.detailBroadcasts.map((item: any) => item.method);

  assert.equal(broadcastMethods.includes("approval/created"), true);
  assert.equal(detailMethods.some((method) => method === "session/update"), true);
  assert.equal(context.approvalIndex.get("approval-1")?.sessionId, "session-1");
});

test("canonical permission request derives waiting status from active approval count", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-approval", {}, {
    useCanonicalPipeline: true,
  });
  (context as any).approvalIndex = (context as any).permissionIndex;

  handleRuntimeEvent(
    "session-canonical-approval",
    {
      type: "permission-request",
      request: {
        id: "approval-canonical-1",
        toolCallId: "tool-1",
        command: "Run shell command :: {}",
        reason: "需要审核",
        cwd: "D:/repo",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const liveState = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "live_state"
  ) as any;
  assert.equal(liveState?.params.update.snapshot.sequence, 1);
  assert.equal(
    liveState?.params.update.snapshot.status.effectiveStatus,
    "waiting_for_permission",
  );
  assert.equal(
    liveState?.params.update.snapshot.status.pendingApprovalCount,
    1,
  );
  assert.equal(
    context.approvalIndex.get("approval-canonical-1")?.request.toolCallId,
    "tool-1",
  );
});

test("permission-request auto-resolves matching approval policy without broadcasting approval", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    summaryUpdates: [],
  };
  const context = createTestContext(logs, capture);
  let responded: { requestId: string; decision: string } | null = null;
  const runtime = {
    supportsPermissionResponses: true,
    respondPermission: (requestId: string, decision: string) => {
      responded = { requestId, decision };
    },
  };
  context.sessions.set("session-1", {
    agent: { id: "codex" },
    worktree: { path: "D:/repo" },
    summary: { id: "session-1", agentId: "codex", projectId: "tiller" },
    runtime,
  } as any);
  (context as any).readApprovalPolicy = () => ({
    rules: [
      {
        id: "rule-1",
        action: "allow",
        label: "Allow sanshu",
        providerId: "codex",
        commandPattern: "^MCP • sanshu/",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
    ],
  });

  handleRuntimeEvent(
    "session-1",
    {
      type: "permission-request",
      request: {
        id: "approval-1",
        command: "MCP • sanshu/zhi :: {}",
        reason: "Approve MCP tool call",
        cwd: "D:/repo",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(responded, { requestId: "approval-1", decision: "allow" });
  assert.equal(context.approvalIndex.has("approval-1"), false);
  assert.equal(capture.broadcasts.some((item: any) => item.method === "approval/created"), false);
  // 自动审批必须保持状态不变，避免 running→waiting_for_permission→running 抖动
  assert.equal(capture.summaryUpdates?.length, 0);
});

test("permission-request falls back to manual approval when policy read fails", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] };
  const context = createTestContext(logs, capture);
  (context as any).readApprovalPolicy = () => {
    throw new Error("config read failed");
  };

  handleRuntimeEvent(
    "session-1",
    {
      type: "permission-request",
      request: {
        id: "approval-io-fallback",
        command: "MCP • sanshu/zhi :: {}",
        reason: "Approve MCP tool call",
        cwd: "D:/repo",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(context.approvalIndex.has("approval-io-fallback"), true);
  assert.equal(capture.broadcasts.some((item: any) => item.method === "approval/created"), true);
  assert.equal(logs.some((line) => line.includes("approval policy read failed")), true);
});
