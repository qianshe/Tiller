import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
import type { LogLevel, TillerLogger } from "../logging/logger";
import {
  cleanupRuntimeEventState,
  handleRuntimeEvent,
  flushRuntimeUserEchoLogSummaryForTest,
  nextLiveEventSequenceForTest,
  publishCanonicalSessionStateEvent,
  publishPromptQueueState,
  seedLiveEventSequenceForSession,
} from "./events.js";
import { createLiveMessageBuffer } from "./live-message-buffer.js";
import { createSessionTimelineDispatcher } from "./session-timeline/dispatcher.js";
import { createSessionTimelineFlushScheduler } from "./session-timeline/flush-scheduler.js";
import { createSessionLiveStateStore } from "./session-timeline/live-state-store.js";
import { createSessionTimelineWorkerRegistry } from "./session-timeline/worker-registry.js";
import { createSessionRuntimeEventState } from "./session/event/runtime-state.js";
import { createSessionApprovalStateStore } from "./session/event/approval-store.js";

type TestContextCapture = {
  broadcasts: unknown[];
  detailBroadcasts: unknown[];
  persisted: AgentMessage[];
  observedTimelineMessages?: AgentMessage[];
  summaryUpdates?: SessionSummary[];
  timelineEntries?: SessionTimelineEntry[];
  sessionUpdates?: SessionUpdateRecord[];
  traceEvents?: PromptTraceEvent[];
  structuredLogs?: CapturedLog[];
  sessionStoreListCalls?: number;
  sequenceInitializationCalls?: number;
};

type CapturedLog = {
  level: "fatal" | "trace" | "info" | "debug" | "warn" | "error";
  event: string;
  fields?: Record<string, unknown>;
};

type ManualTimerHarness = ReturnType<typeof createManualTimerHarness>;

test("runtime keeps no second unused session sequence implementation", () => {
  assert.equal(existsSync(new URL("./session/event/sequencer.ts", import.meta.url)), false);
});

function createManualTimerHarness() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  return {
    setTimeoutFn(callback: () => void) {
      const handle = nextHandle += 1;
      callbacks.set(handle, callback);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn(handle: ReturnType<typeof setTimeout>) {
      callbacks.delete(handle as unknown as number);
    },
    flushAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) {
        callback();
      }
    },
    size() {
      return callbacks.size;
    },
  };
}

function createCapturedLogger(capture: TestContextCapture, legacyLogs: string[]): TillerLogger {
  capture.structuredLogs ??= [];
  const write = (
    level: CapturedLog["level"],
    event: string,
    fields?: Record<string, unknown>,
  ) => {
    capture.structuredLogs?.push({ level, event, fields });
  };
  const writeLegacy = (level: CapturedLog["level"], message: string) => {
    legacyLogs.push(message);
    write(level, "legacy.log", { message });
  };

  return {
    fatal: (event, fields) => write("fatal", event, fields),
    trace: (event, fields) => write("trace", event, fields),
    info: (event, fields) => write("info", event, fields),
    debug: (event, fields) => write("debug", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    logInfo: (message) => writeLegacy("info", message),
    logDebug: (message) => writeLegacy("debug", message),
    logWarn: (message) => writeLegacy("warn", message),
    logError: (message) => writeLegacy("error", message),
    writeLogLine: (level: LogLevel, message: string) => writeLegacy(level.toLowerCase() as CapturedLog["level"], message),
    getLevel: () => "debug",
    setLevel: () => undefined,
    logFile: "captured.log",
    close: async () => undefined,
  };
}

function structuredLogs(capture: TestContextCapture) {
  return capture.structuredLogs?.filter((log) => log.event !== "legacy.log") ?? [];
}

function findStructuredLog(capture: TestContextCapture, event: string) {
  return structuredLogs(capture).find((log) => log.event === event);
}

function syncObservedTimelineMessages(capture: TestContextCapture) {
  capture.observedTimelineMessages = (capture.timelineEntries ?? []).flatMap((entry) => {
    if (entry.kind === "user_message" || entry.kind === "system_message") {
      return [entry.message];
    }
    if (entry.kind !== "assistant_message") {
      return [];
    }
    const text = entry.chunks
      .filter((chunk) => chunk.kind === "content")
      .map((chunk) => chunk.text)
      .join("");
    return text
      ? [{
          id: entry.id,
          role: "assistant" as const,
          text,
          timestamp: entry.timestamp,
          sequence: entry.sequence,
          streaming: entry.streaming,
        }]
      : [];
  });
}

function createTestContext(
  logs: string[],
  capture: TestContextCapture = { broadcasts: [], detailBroadcasts: [], persisted: [] },
  sessionId = "session-1",
  summaryPatch: Partial<SessionSummary> = {},
  options: {
    useCanonicalPipeline?: boolean;
    runtimeEventThrottleConfig?: {
      assistantWindowMs?: number;
      assistantMaxChars?: number;
      commandOutputWindowMs?: number;
      commandOutputMaxChars?: number;
      toolCallWindowMs?: number;
      toolCallMaxChars?: number;
      setTimeoutFn?: ManualTimerHarness["setTimeoutFn"];
      clearTimeoutFn?: ManualTimerHarness["clearTimeoutFn"];
    };
  } = {},
): HelmHandlerContext {
  const summary: SessionSummary = {
    id: sessionId,
    projectId: "project-1",
    projectName: "Project One",
    helmId: "helm-1",
    cwd: "worktree-1",
    worktreeName: "Worktree One",
    agentId: "opencode",
    agentName: "OpenCode",
    status: "running",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    messageCount: 0,
    ...summaryPatch,
  };
  const logger = createCapturedLogger(capture, logs);
  capture.sessionUpdates ??= [];
  const agentId = summaryPatch.agentId ?? "opencode";
  const sessionTimelineStore = {
    append: (_sessionId: string, entry: SessionTimelineEntry) => {
      capture.timelineEntries = [
        ...(capture.timelineEntries ?? []).filter((candidate) => candidate.id !== entry.id),
        entry,
      ];
      syncObservedTimelineMessages(capture);
      return capture.timelineEntries;
    },
    replace: (_sessionId: string, entries: SessionTimelineEntry[]) => {
      capture.timelineEntries = entries;
      syncObservedTimelineMessages(capture);
      return entries;
    },
    applyBatch: (_sessionId: string, batch: import("@tiller/shared").SessionTimelineBatch) => {
      if (batch.replace) {
        capture.timelineEntries = batch.entries;
        syncObservedTimelineMessages(capture);
        return batch.entries;
      }
      const byId = new Map((capture.timelineEntries ?? []).map((entry) => [entry.id, entry]));
      for (const entry of batch.entries) {
        byId.set(entry.id, entry);
      }
      capture.timelineEntries = [...byId.values()];
      syncObservedTimelineMessages(capture);
      return capture.timelineEntries;
    },
    commitBatch: (
      _sessionId: string,
      batch: import("@tiller/shared").SessionTimelineBatch,
      updates: SessionUpdateRecord[],
    ) => {
      capture.sessionUpdates?.push(...updates);
      if (batch.replace) {
        capture.timelineEntries = batch.entries;
        syncObservedTimelineMessages(capture);
        return batch.entries;
      }
      const byId = new Map((capture.timelineEntries ?? []).map((entry) => [entry.id, entry]));
      for (const entry of batch.entries) {
        byId.set(entry.id, entry);
      }
      capture.timelineEntries = [...byId.values()];
      syncObservedTimelineMessages(capture);
      return capture.timelineEntries;
    },
    list: () => capture.timelineEntries ?? [],
    listPage: () => ({
      entries: capture.timelineEntries ?? [],
      hasMore: false,
    }),
    remove: () => {
      capture.timelineEntries = [];
      syncObservedTimelineMessages(capture);
    },
  };
  const sessionTimelineWorkers = createSessionTimelineWorkerRegistry();
  const sessionRuntimeEventState = createSessionRuntimeEventState();
  const sessionStates = new Map<string, CanonicalSessionState>();
  const sessionLiveStateStore = createSessionLiveStateStore({
    get: (targetSessionId) => sessionStates.get(targetSessionId),
    getAppliedSequence: (targetSessionId) => sessionStates.get(targetSessionId)?.sequence ?? 0,
    replace: (targetSessionId, state) => {
      sessionStates.set(targetSessionId, state);
      return state;
    },
    commitUpdate: (update, state) => {
      capture.sessionUpdates = [...(capture.sessionUpdates ?? []), update];
      sessionStates.set(update.sessionId, state);
      return state;
    },
    remove: (targetSessionId) => {
      sessionStates.delete(targetSessionId);
    },
    close: async () => undefined,
  });
  const sessionTimelineDispatcher = createSessionTimelineDispatcher({
    store: sessionTimelineStore as unknown as import("@tiller/persistence").SessionTimelineStore,
    publish: (targetSessionId, batch) => {
      capture.detailBroadcasts.push({
        sessionId: targetSessionId,
        method: "session/update",
        params: {
          sessionId: targetSessionId,
          update: {
            kind: "timeline_batch",
            batch,
          },
        },
      });
    },
  });
  const sessionTimelineFlushScheduler = createSessionTimelineFlushScheduler({
    workers: sessionTimelineWorkers,
    dispatcher: sessionTimelineDispatcher,
    windowMs: 0,
  });
  const sessionApprovalStateStore = createSessionApprovalStateStore({
    get: () => undefined,
    commitUpdate: () => undefined,
    remove: () => undefined,
  } as any);

  const baseContext = {
    sessions: new Map([
      [
        sessionId,
        {
          agent: { id: agentId },
          worktree: { id: "worktree-1" },
          summary: { ...summary, runtimeSessionId: "runtime-1" },
        },
      ],
    ]),
    sessionStore: {
      get: (id: string) => id === sessionId ? summary : undefined,
      list: () => {
        capture.sessionStoreListCalls = (capture.sessionStoreListCalls ?? 0) + 1;
        return [summary];
      },
    },
    logInfo: logger.logInfo,
    logDebug: logger.logDebug,
    logWarn: logger.logWarn,
    logError: logger.logError,
    logger,
    promptTrace: capture.traceEvents
      ? { emit: (event: PromptTraceEvent) => capture.traceEvents?.push(event) }
      : undefined,
    persistSessionMessage: (_sessionId: string, message: AgentMessage) => {
      capture.persisted.push(message);
    },
    updateSessionSummary: (
      _sessionId: string,
      mutate: (current: SessionSummary) => SessionSummary,
    ) => {
      const next = mutate(summary);
      capture.summaryUpdates?.push(next);
      return next;
    },
    broadcastNotification: (method: string, params: unknown) => {
      capture.broadcasts.push({ method, params });
    },
    broadcastSessionTopic: (sessionId: string, method: string, params: unknown) => {
      capture.detailBroadcasts.push({ sessionId, method, params });
    },
    approvalIndex: new Map(),
    permissionIndex: new Map(),
    readApprovalPolicy: () => ({ rules: [] }),
    saveApprovalPolicyRule: () => undefined,
    liveMessageBuffer: createLiveMessageBuffer(),
    sessionArtifactStore: {
      appendOutput: () => undefined,
      appendToolCall: () => undefined,
      replaceDiffs: () => undefined,
    },
    sessionOutputBodyStore: {
      putText: () => ({
        id: "chunk-1",
        sessionId,
        outputId: "chunk-1",
        mimeType: "text/plain; charset=utf-8" as const,
        sha256: "sha256",
        byteSize: 0,
        storageKey: "storage-key",
        uri: `/api/sessions/${sessionId}/outputs/chunk-1`,
        createdAt: new Date(0).toISOString(),
      }),
      get: () => undefined,
      readText: () => undefined,
      removeSession: () => undefined,
    },
    sessionTimelineStore,
    sessionUpdateStore: {
      append: (update: SessionUpdateRecord) => {
        capture.sessionUpdates = [...(capture.sessionUpdates ?? []), update];
      },
      getMaxSequence: () => {
        capture.sequenceInitializationCalls = (capture.sequenceInitializationCalls ?? 0) + 1;
        return 0;
      },
      compactTail: () => 0,
    },
    runtimeEventThrottleConfig: {
      assistantWindowMs: 0,
      assistantMaxChars: 256,
      commandOutputWindowMs: 0,
      commandOutputMaxChars: 256,
      toolCallWindowMs: 0,
      toolCallMaxChars: 512,
      ...options.runtimeEventThrottleConfig,
    },
    publishDiffUpdate: async () => undefined,
    hydrateSessionSummary: (item: SessionSummary) => item,
  } as Record<string, unknown>;

  baseContext.sessionTimelineWorkers = sessionTimelineWorkers;
  baseContext.sessionLiveStateStore = sessionLiveStateStore;
  baseContext.sessionApprovalStateStore = sessionApprovalStateStore;
  baseContext.sessionRuntimeEventState = sessionRuntimeEventState;
  baseContext.sessionTimelineDispatcher = sessionTimelineDispatcher;
  baseContext.sessionTimelineFlushScheduler = sessionTimelineFlushScheduler;

  return baseContext as HelmHandlerContext;
}

test("live event sequence resumes above persisted timeline sequences", () => {
  const context = createTestContext([], { broadcasts: [], detailBroadcasts: [], persisted: [] });
  seedLiveEventSequenceForSession("session-seed", [3, 12, undefined, 7], context);

  assert.equal(nextLiveEventSequenceForTest("session-seed", context), 13);
  assert.equal(nextLiveEventSequenceForTest("session-seed", context), 14);
});

test("live event sequence ignores invalid persisted values", () => {
  const context = createTestContext([], { broadcasts: [], detailBroadcasts: [], persisted: [] });
  seedLiveEventSequenceForSession("session-invalid", [undefined, Number.NaN, -1, 0, 2], context);

  assert.equal(nextLiveEventSequenceForTest("session-invalid", context), 3);
});

test("active runtime notifications initialize sequence once without listing sessions", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
  };
  const context = createTestContext([], capture, "sequence-once");

  handleRuntimeEvent("sequence-once", {
    type: "plan-update",
    plan: { entries: [], updatedAt: "2026-07-12T00:00:00.000Z" },
  }, context);
  handleRuntimeEvent("sequence-once", {
    type: "usage-update",
    usage: { used: 1, size: 1 },
  }, context);

  assert.equal(capture.sessionStoreListCalls ?? 0, 0);
  assert.equal(capture.sequenceInitializationCalls, 1);
});

test("runtime rejects missing canonical services instead of writing legacy artifacts", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-required");
  let artifactWrites = 0;
  context.sessionArtifactStore.appendOutput = () => {
    artifactWrites += 1;
  };
  delete (context as any).sessionTimelineWorkers;
  delete (context as any).sessionTimelineDispatcher;
  delete (context as any).sessionTimelineFlushScheduler;
  delete (context as any).sessionLiveStateStore;

  assert.throws(
    () => handleRuntimeEvent(
      "session-canonical-required",
      {
        type: "command-output",
        chunk: {
          id: "output-1",
          commandId: "command-1",
          stream: "stdout",
          text: "output",
          timestamp: "2026-07-11T00:00:00.000Z",
        },
      },
      context,
    ),
    /Canonical runtime services are required/u,
  );
  assert.equal(artifactWrites, 0);
});

test("runtime message events persist source-neutral session update records", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "record-session");

  handleRuntimeEvent(
    "record-session",
    {
      type: "message",
      message: {
        id: "assistant-record",
        role: "assistant",
        text: "hello",
        streaming: false,
        timestamp: "2026-04-30T00:00:01.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.equal(capture.sessionUpdates?.length, 1);
  assert.equal(capture.sessionUpdates?.[0]?.source, "acp_live");
  assert.equal(capture.sessionUpdates?.[0]?.providerId, "opencode");
  assert.equal(capture.sessionUpdates?.[0]?.runtimeSessionId, "runtime-1");
  assert.equal(capture.sessionUpdates?.[0]?.updateType, "message");
  assert.equal(JSON.parse(capture.sessionUpdates?.[0]?.payloadJson ?? "{}").message.text, "hello");
});

test("runtime accepts late tool-call events when the session is errored but still active", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    sessionUpdates: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-error-active", {
    status: "error",
  });

  handleRuntimeEvent(
    "session-error-active",
    {
      type: "tool-call",
      toolCall: {
        id: "late-tool-1",
        kind: "shell",
        title: "late tool",
        status: "running",
        timestamp: "2026-07-05T21:12:50.000Z",
        updatedAt: "2026-07-05T21:12:50.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const liveToolCallUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "tool_call"
  ) as { params?: { update?: { toolCall?: { status?: string } } } } | undefined;

  assert.equal(findStructuredLog(capture, "runtime.event.ignored_late"), undefined);
  assert.ok(liveToolCallUpdate);
  assert.equal(liveToolCallUpdate?.params?.update?.toolCall?.status, "running");
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);
  assert.equal(capture.timelineEntries?.length ?? 0, 0);
});

test("runtime keeps ignoring late tool-call events after cancellation", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    sessionUpdates: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-cancelled", {
    status: "cancelled",
  });

  handleRuntimeEvent(
    "session-cancelled",
    {
      type: "tool-call",
      toolCall: {
        id: "late-tool-2",
        kind: "shell",
        title: "late tool",
        status: "running",
        timestamp: "2026-07-05T21:12:51.000Z",
        updatedAt: "2026-07-05T21:12:51.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.ok(findStructuredLog(capture, "runtime.event.ignored_late"));
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);
  assert.equal(capture.timelineEntries?.length ?? 0, 0);
});

test("runtime compaction started publishes a canonical timeline batch when the pipeline is available", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-compaction-live", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-compaction-live",
    {
      type: "compaction",
      phase: "started",
      source: "provider",
      timestamp: "2026-06-28T00:00:00.000Z",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  ) as { params?: { update?: { batch?: import("@tiller/shared").SessionTimelineBatch } } } | undefined;
  const compactionStateUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "compaction_state"
  ) as { params?: { update?: { phase?: string; source?: string } } } | undefined;

  assert.ok(timelineBatchUpdate?.params?.update?.batch);
  assert.equal(compactionStateUpdate, undefined);
  assert.equal(capture.timelineEntries?.length ?? 0, 1);
  assert.equal(capture.timelineEntries?.[0]?.kind, "context_compaction");
  if (capture.timelineEntries?.[0]?.kind === "context_compaction") {
    assert.equal(capture.timelineEntries[0].phase, "started");
    assert.equal(capture.timelineEntries[0].source, "provider");
  }
});

test("runtime infers compaction completion from the first post-compaction assistant message", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-compaction-inferred", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-compaction-inferred",
    {
      type: "compaction",
      phase: "started",
      source: "provider",
      timestamp: "2026-06-28T00:00:00.000Z",
    } satisfies SessionRuntimeEvent,
    context,
  );

  handleRuntimeEvent(
    "session-compaction-inferred",
    {
      type: "message",
      message: {
        id: "assistant-after-compaction",
        role: "assistant",
        text: "压缩后继续。",
        timestamp: "2026-06-28T00:00:05.000Z",
        streaming: false,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const compactionEntry = capture.timelineEntries?.find((entry) => entry.kind === "context_compaction");
  assert.equal(compactionEntry?.kind, "context_compaction");
  if (compactionEntry?.kind === "context_compaction") {
    assert.equal(compactionEntry.phase, "completed");
    assert.equal(compactionEntry.summaryText, undefined);
  }
});

test("runtime finalized assistant messages publish canonical timeline batches when the pipeline is available", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-message", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-canonical-message",
    {
      type: "message",
      message: {
        id: "assistant-1",
        role: "assistant",
        text: "hello canonical timeline",
        timestamp: "2026-06-29T00:00:01.000Z",
        streaming: false,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  ) as { params?: { update?: { batch?: import("@tiller/shared").SessionTimelineBatch } } } | undefined;
  const agentMessageUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "agent_message"
  );

  assert.ok(timelineBatchUpdate?.params?.update?.batch);
  assert.equal(agentMessageUpdate, undefined);
  assert.equal(timelineBatchUpdate?.params?.update?.batch?.entries[0]?.kind, "assistant_message");
  assert.equal(capture.persisted.length, 0);
  assert.deepEqual(capture.sessionUpdates?.map((update) => update.updateType), ["message"]);
});

test("runtime event cleanup releases per-session sequence state", () => {
  const context = createTestContext([], {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
  }, "session-cleanup-state");

  assert.equal(nextLiveEventSequenceForTest("session-cleanup-state", context), 1);
  assert.equal(nextLiveEventSequenceForTest("session-cleanup-state", context), 2);
  cleanupRuntimeEventState("session-cleanup-state", context);

  assert.equal(nextLiveEventSequenceForTest("session-cleanup-state", context), 1);
});

test("runtime assistant streaming deltas stay in live updates and do not append canonical history", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-streaming-message", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-canonical-streaming-message",
    {
      type: "message",
      message: {
        id: "assistant-stream-1",
        role: "assistant",
        text: "partial",
        timestamp: "2026-06-29T00:00:01.000Z",
        streaming: true,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  );
  const agentMessageUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "agent_message"
  ) as { params?: { update?: { streaming?: boolean } } } | undefined;

  assert.equal(timelineBatchUpdate, undefined);
  assert.ok(agentMessageUpdate);
  assert.equal(agentMessageUpdate?.params?.update?.streaming, true);
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);
});

test("runtime Codex mixed compaction chunks split into a compaction entry and stripped assistant message", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(
    logs,
    capture,
    "session-canonical-codex-mixed-compaction",
    {
      agentId: "codex",
      agentName: "Codex",
    },
    {
      useCanonicalPipeline: true,
    },
  );

  handleRuntimeEvent(
    "session-canonical-codex-mixed-compaction",
    {
      type: "message",
      message: {
        id: "reply-mixed",
        role: "assistant",
        text: "Context compacted 我先做个完成度确认，再继续往下处理。",
        timestamp: "2026-07-06T18:00:00.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    capture.timelineEntries?.map((entry) => entry.kind),
    ["context_compaction", "assistant_message"],
  );
  const compactionEntry = capture.timelineEntries?.find((entry) => entry.kind === "context_compaction");
  assert.equal(compactionEntry?.kind, "context_compaction");
  if (compactionEntry?.kind === "context_compaction") {
    assert.equal(
      compactionEntry.id,
      "compaction:session-canonical-codex-mixed-compaction:reply-mixed:compaction-marker",
    );
    assert.equal(compactionEntry.phase, "completed");
    assert.equal(compactionEntry.summaryText, undefined);
    assert.equal(compactionEntry.detailsVisibility, "hidden");
  }
  const assistantEntry = capture.timelineEntries?.find((entry) => entry.kind === "assistant_message");
  assert.equal(assistantEntry?.kind, "assistant_message");
  if (assistantEntry?.kind === "assistant_message") {
    assert.equal(assistantEntry.chunks[0]?.text, "我先做个完成度确认，再继续往下处理。");
  }
  assert.deepEqual(
    capture.sessionUpdates?.map((update) => update.updateType),
    ["compaction", "message"],
  );
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
  assert.equal(timelineBatchUpdate, undefined);
  assert.ok(liveToolCallUpdate);
  assert.equal(liveToolCallUpdate?.params?.update?.toolCall?.kind, "subagent");
  assert.equal(liveToolCallUpdate?.params?.update?.toolCall?.title, "spawn_agent");
  assert.equal(liveToolCallUpdate?.params?.update?.toolCall?.status, "running");
  assert.equal(capture.sessionUpdates?.length ?? 0, 0);
  assert.equal(capture.timelineEntries?.length ?? 0, 0);
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
  const liveUpdate = capture.detailBroadcasts.find((item: any) =>
    item.params?.update?.kind === "tool_call"
  ) as any;
  const invocationSequence = liveUpdate?.params?.update?.toolCall?.sequence;

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
  assert.ok((capture.sessionUpdates?.[0]?.sequence ?? 0) > invocationSequence);
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
        title: "Tool call call-1",
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
  assert.equal(toolCallEntry?.toolCall.title, "Tool call call-1");
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

test("runtime plan updates publish live_state snapshots when the pipeline is available", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-plan", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-canonical-plan",
    {
      type: "plan-update",
      plan: {
        updatedAt: "2026-06-29T00:00:02.000Z",
        entries: [{
          content: "do the thing",
          priority: "high",
          status: "in_progress",
        }],
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const liveStateUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "live_state"
  ) as {
    params?: {
      update?: {
        snapshot?: {
          sequence?: number;
          plan?: AgentPlan;
          status?: { effectiveStatus?: string };
        };
      };
    };
  } | undefined;
  const legacyPlanUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "plan_update"
  );

  assert.ok(liveStateUpdate?.params?.update?.snapshot?.plan);
  assert.equal(legacyPlanUpdate, undefined);
  assert.equal(
    liveStateUpdate?.params?.update?.snapshot?.plan?.entries[0]?.content,
    "do the thing",
  );
  assert.equal(liveStateUpdate?.params?.update?.snapshot?.sequence, 1);
  assert.equal(
    liveStateUpdate?.params?.update?.snapshot?.status?.effectiveStatus,
    "starting",
  );
});

test("runtime session state variants publish canonical live_state in arrival order", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-state", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent("session-canonical-state", {
    type: "mode-update",
    agentMode: "architect",
  }, context);
  handleRuntimeEvent("session-canonical-state", {
    type: "session-info",
    title: null,
    updatedAt: "2026-07-11T12:00:00.000Z",
  }, context);
  handleRuntimeEvent("session-canonical-state", {
    type: "usage-update",
    usage: {
      used: 100,
      size: 200_000,
      cost: { amount: 0.02, currency: "USD" },
    },
  }, context);

  const snapshots = capture.detailBroadcasts
    .filter((item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "live_state"
    )
    .map((item: any) => item.params.update.snapshot);

  assert.deepEqual(snapshots.map((snapshot: any) => snapshot.sequence), [1, 2, 3]);
  assert.equal(snapshots[2]?.config?.agentMode, "architect");
  assert.deepEqual(snapshots[2]?.sessionInfo, {
    title: null,
    updatedAt: "2026-07-11T12:00:00.000Z",
  });
  assert.deepEqual(snapshots[2]?.usage, {
    used: 100,
    size: 200_000,
    cost: { amount: 0.02, currency: "USD" },
  });
});

test("canonical session state replaces competing legacy state notifications", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-state-cutover", {}, {
    useCanonicalPipeline: true,
  });

  const events: SessionRuntimeEvent[] = [
    { type: "status", status: "running" },
    {
      type: "config-options",
      state: { model: "gpt-5", reasoningEffort: "high" },
      options: [
        { id: "model", currentValue: "gpt-5" },
        { id: "reasoning", currentValue: "high" },
      ],
    },
    {
      type: "model-options",
      state: {
        currentModelId: "gpt-5",
        options: [{ id: "gpt-5", name: "GPT-5" }],
      },
    },
    {
      type: "available-commands",
      commands: [{ name: "review", kind: "command" }],
    },
    {
      type: "diff-update",
      files: [{ path: "src/a.ts", status: "modified", additions: 2, deletions: 1 }],
    },
  ];
  for (const event of events) {
    handleRuntimeEvent("session-canonical-state-cutover", event, context);
  }

  const sessionUpdates = capture.detailBroadcasts
    .filter((item: any) => item.method === "session/update")
    .map((item: any) => item.params.update);
  const liveStates = sessionUpdates.filter((update: any) => update.kind === "live_state");
  const legacyKinds = new Set([
    "status_change",
    "config_options",
    "model_options",
    "commands_available",
    "session_updated",
  ]);

  assert.deepEqual(liveStates.map((update: any) => update.snapshot.sequence), [1, 2, 3, 4, 5]);
  assert.equal(sessionUpdates.some((update: any) => legacyKinds.has(update.kind)), false);
  const finalState = liveStates.at(-1)?.snapshot;
  assert.equal(finalState.status.effectiveStatus, "running");
  assert.equal(finalState.config.model, "gpt-5");
  assert.equal(finalState.config.reasoningEffort, "high");
  assert.equal(finalState.availableCommands[0]?.name, "review");
  assert.equal(finalState.diffs[0]?.path, "src/a.ts");
});

test("prompt queue uses the canonical persisted live-state path", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-canonical-queue", {}, {
    useCanonicalPipeline: true,
  });
  const queue = {
    sessionId: "session-canonical-queue",
    queued: [{
      id: "queued-1",
      sessionId: "session-canonical-queue",
      text: "continue",
      clientMessageId: "client-queued-1",
      createdAt: "2026-07-11T13:00:00.000Z",
      updatedAt: "2026-07-11T13:00:00.000Z",
      status: "queued" as const,
    }],
  };

  publishPromptQueueState("session-canonical-queue", queue, context);

  assert.deepEqual(
    capture.sessionUpdates?.map((update) => [update.sequence, update.updateType]),
    [[1, "prompt-queue"]],
  );
  const updates = capture.detailBroadcasts
    .filter((item: any) => item.method === "session/update")
    .map((item: any) => item.params.update);
  assert.equal(updates.some((update: any) => update.kind === "prompt_queue"), false);
  assert.equal(updates[0]?.kind, "live_state");
  assert.equal(updates[0]?.snapshot?.sequence, 1);
  assert.deepEqual(updates[0]?.snapshot?.promptQueue, queue);
});

test("explicit canonical state publisher persists status and emits only live_state", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-explicit-state", {}, {
    useCanonicalPipeline: true,
  });

  publishCanonicalSessionStateEvent(
    "session-explicit-state",
    { type: "status", status: "error" },
    context,
  );

  const updates = capture.detailBroadcasts
    .filter((item: any) => item.method === "session/update")
    .map((item: any) => item.params.update);
  assert.deepEqual(capture.sessionUpdates?.map((update) => [update.sequence, update.updateType]), [[1, "status"]]);
  assert.equal(updates[0]?.kind, "live_state");
  assert.equal(updates[0]?.snapshot?.sequence, 1);
  assert.equal(updates[0]?.snapshot?.status?.effectiveStatus, "error");
  assert.equal(updates.some((update: any) => update.kind === "status_change"), false);
});

test("canonical state is not published when the atomic commit fails", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext(logs, capture, "session-state-rollback", {}, {
    useCanonicalPipeline: true,
  });
  context.sessionLiveStateStore = createSessionLiveStateStore({
    get: () => undefined,
    getAppliedSequence: () => 0,
    replace: (_sessionId, state) => state,
    commitUpdate: () => {
      throw new Error("atomic commit failed");
    },
    remove: () => undefined,
    close: async () => undefined,
  });

  handleRuntimeEvent("session-state-rollback", {
    type: "status",
    status: "running",
  }, context);

  assert.equal(capture.sessionUpdates?.length, 0);
  assert.equal(
    capture.detailBroadcasts.some((item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "live_state"
    ),
    false,
  );
  assert.equal(
    findStructuredLog(capture, "runtime.session_state.commit_failed")?.fields?.message,
    "atomic commit failed",
  );
});

test("canonical conversation is not materialized or published when update persistence fails", () => {
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const context = createTestContext([], capture, "session-conversation-rollback", {}, {
    useCanonicalPipeline: true,
  });
  if (!context.sessionTimelineStore?.commitBatch) {
    throw new Error("test requires atomic timeline store");
  }
  context.sessionTimelineStore.commitBatch = () => {
    throw new Error("conversation update failed");
  };

  assert.throws(() => {
    handleRuntimeEvent("session-conversation-rollback", {
      type: "message",
      message: {
        id: "assistant-failed",
        role: "assistant",
        text: "must not publish",
        timestamp: "2026-07-11T15:30:00.000Z",
        streaming: false,
      },
    }, context);
  }, /conversation update failed/u);

  assert.deepEqual(capture.timelineEntries, []);
  assert.equal(
    capture.detailBroadcasts.some((item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
    ),
    false,
  );
});

test("runtime command outputs publish canonical timeline batches without compatibility command_output updates", async () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
    sessionUpdates: [],
  };
  const appendedOutputs: CommandChunk[] = [];
  const context = createTestContext(logs, capture, "session-canonical-command-output", {}, {
    useCanonicalPipeline: true,
  });
  context.sessionArtifactStore.appendOutput = (_sessionId: string, chunk: CommandChunk) => {
    appendedOutputs.push(chunk);
  };

  handleRuntimeEvent(
    "session-canonical-command-output",
    {
      type: "command-output",
      chunk: {
        id: "chunk-1",
        commandId: "cmd-1",
        text: "PASS",
        stream: "stdout",
        timestamp: "2026-06-30T00:00:02.000Z",
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  context.sessionTimelineFlushScheduler?.flushNow("session-canonical-command-output");
  await new Promise<void>((resolve) => setImmediate(resolve));

  const timelineBatchUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "timeline_batch"
  );
  const legacyCommandOutputUpdate = capture.detailBroadcasts.find((item: any) =>
    item.method === "session/update" && item.params?.update?.kind === "command_output"
  );

  assert.ok(timelineBatchUpdate);
  assert.equal(legacyCommandOutputUpdate, undefined);
  assert.deepEqual(capture.sessionUpdates?.map((update) => update.updateType), ["command-output"]);
  assert.equal(appendedOutputs.length, 0);
});

test("runtime compaction completed hides summary details for codex providers", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-compaction-codex", {
    agentId: "codex",
    agentName: "Codex",
  });

  handleRuntimeEvent(
    "session-compaction-codex",
    {
      type: "compaction",
      phase: "completed",
      source: "heuristic",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      timestamp: "2026-06-28T00:00:02.000Z",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const compactionEntry = capture.timelineEntries?.find((entry) => entry.kind === "context_compaction");

  assert.equal(
    compactionEntry?.kind === "context_compaction"
      ? compactionEntry.detailsVisibility
      : undefined,
    "hidden",
  );
});

test("runtime compaction summary enrichment updates the existing compaction row instead of appending a second one", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-compaction-merge", {
    agentId: "claude",
    agentName: "Claude",
  });

  handleRuntimeEvent(
    "session-compaction-merge",
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      timestamp: "2026-06-28T00:00:01.000Z",
      messageId: "compaction-completed",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-compaction-merge",
    {
      type: "compaction",
      phase: "completed",
      source: "heuristic",
      timestamp: "2026-06-28T00:00:02.000Z",
      messageId: "compaction-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const compactionEntries = capture.timelineEntries?.filter((entry) => entry.kind === "context_compaction") ?? [];
  assert.equal(compactionEntries.length, 1);
  assert.equal(compactionEntries[0]?.id, "compaction:session-compaction-merge:compaction-completed");
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction" ? compactionEntries[0].summaryText : undefined,
    "This session is being continued from a previous conversation that ran out of context.",
  );
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction" ? compactionEntries[0].detailsVisibility : undefined,
    "expandable",
  );
});

test("runtime compaction starts a fresh assistant segment after the divider", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-compaction-boundary");

  handleRuntimeEvent(
    "session-compaction-boundary",
    {
      type: "message",
      message: {
        id: "reply-1",
        role: "assistant",
        text: "压缩前说明。",
        timestamp: "2026-06-28T00:00:00.000Z",
        streaming: false,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-compaction-boundary",
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      timestamp: "2026-06-28T00:00:01.000Z",
      messageId: "compaction-completed",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-compaction-boundary",
    {
      type: "message",
      message: {
        id: "reply-1",
        role: "assistant",
        text: "压缩后继续。",
        timestamp: "2026-06-28T00:00:02.000Z",
        streaming: false,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-compaction-boundary",
    {
      type: "status",
      status: "idle",
      message: "done",
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    capture.timelineEntries?.map((entry) => entry.kind),
    ["assistant_message", "context_compaction", "assistant_message"],
  );
  const assistantEntries = capture.timelineEntries?.filter((entry) => entry.kind === "assistant_message") ?? [];
  assert.equal(assistantEntries.length, 2);
  assert.notEqual(assistantEntries[0]?.id, assistantEntries[1]?.id);
});

test("runtime compaction starts a fresh assistant segment after the divider in canonical mode", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(logs, capture, "session-compaction-boundary-canonical", {}, {
    useCanonicalPipeline: true,
  });

  handleRuntimeEvent(
    "session-compaction-boundary-canonical",
    {
      type: "message",
      message: {
        id: "reply-1",
        role: "assistant",
        text: "压缩前说明。",
        timestamp: "2026-06-28T00:00:00.000Z",
        streaming: false,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-compaction-boundary-canonical",
    {
      type: "compaction",
      phase: "started",
      source: "provider",
      timestamp: "2026-06-28T00:00:01.000Z",
    } satisfies SessionRuntimeEvent,
    context,
  );
  handleRuntimeEvent(
    "session-compaction-boundary-canonical",
    {
      type: "message",
      message: {
        id: "reply-1",
        role: "assistant",
        text: "压缩后继续。",
        timestamp: "2026-06-28T00:00:02.000Z",
        streaming: false,
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  assert.deepEqual(
    capture.timelineEntries?.map((entry) => entry.kind),
    ["assistant_message", "context_compaction", "assistant_message"],
  );
  const assistantEntries = capture.timelineEntries?.filter((entry) => entry.kind === "assistant_message") ?? [];
  assert.equal(assistantEntries.length, 2);
  assert.notEqual(assistantEntries[0]?.id, assistantEntries[1]?.id);
});

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
  assert.equal(subagentEntries[0]?.kind === "tool_call" ? subagentEntries[0].toolCall.status : undefined, "completed");
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

test("runtime config option defaults do not overwrite a stored session model selection", () => {
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

  assert.equal(capture.summaryUpdates?.at(-1)?.model, "gpt-5.4");
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

test("runtime stale config option defaults do not re-add reasoning for selected model", () => {
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
  assert.equal(capture.summaryUpdates?.at(-1)?.model, "claude-haiku-4-5");
  assert.equal(capture.summaryUpdates?.at(-1)?.reasoningEffort, undefined);
  assert.equal(liveState?.config.model, "claude-haiku-4-5");
  assert.equal(
    liveState?.config.configOptions.some((option) => option.category === "thought_level"),
    false,
  );
});

test("runtime model option defaults do not overwrite a stored session model selection", () => {
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

  assert.equal(capture.summaryUpdates?.at(-1)?.model, "gpt-5.4");
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

test("runtime locks the first specific tool classification across later snapshots", () => {
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
        title: "Tool: mcp_router/codebase_search",
        status: "completed",
        mcp: {
          serverName: "mcp_router",
          toolName: "codebase_search",
          source: "structured-tool-name",
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
        title: "Search",
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
      serverName: "mcp_router",
      toolName: "codebase_search",
      source: "structured-tool-name",
    },
  );
  assert.equal(
    entry?.kind === "tool_call" ? entry.toolCall.title : undefined,
    "Tool: mcp_router/codebase_search",
  );
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.output : undefined, "Found 3 matches");
});

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
      type: "tool-call",
      toolCall: {
        id: "session-timeline-order-msg-a:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "先思考",
        timestamp,
        updatedAt: timestamp,
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
    [1, 2, 3, 4],
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
  assert.equal(capture.broadcasts.length, 0);
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
