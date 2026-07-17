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
import { createSessionLiveStateStore } from "./session-timeline/live-state-store.js";

test("runtime keeps no second unused session sequence implementation", () => {
  assert.equal(existsSync(new URL("./session/event/sequencer.ts", import.meta.url)), false);
});

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

  handleRuntimeEvent(
    "sequence-once",
    {
      type: "plan-update",
      plan: { entries: [], updatedAt: "2026-07-12T00:00:00.000Z" },
    },
    context,
  );
  handleRuntimeEvent(
    "sequence-once",
    {
      type: "usage-update",
      usage: { used: 1, size: 1 },
    },
    context,
  );

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
    () =>
      handleRuntimeEvent(
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

  const liveToolCallUpdate = capture.detailBroadcasts.find(
    (item: any) => item.method === "session/update" && item.params?.update?.kind === "tool_call",
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
  const context = createTestContext(
    logs,
    capture,
    "session-compaction-live",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

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

  const timelineBatchUpdate = capture.detailBroadcasts.find(
    (item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "timeline_batch",
  ) as
    | { params?: { update?: { batch?: import("@tiller/shared").SessionTimelineBatch } } }
    | undefined;
  const compactionStateUpdate = capture.detailBroadcasts.find(
    (item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "compaction_state",
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
  const context = createTestContext(
    logs,
    capture,
    "session-compaction-inferred",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

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

  const compactionEntry = capture.timelineEntries?.find(
    (entry) => entry.kind === "context_compaction",
  );
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
  const context = createTestContext(
    logs,
    capture,
    "session-canonical-message",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

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

  const timelineBatchUpdate = capture.detailBroadcasts.find(
    (item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "timeline_batch",
  ) as
    | { params?: { update?: { batch?: import("@tiller/shared").SessionTimelineBatch } } }
    | undefined;
  const agentMessageUpdate = capture.detailBroadcasts.find(
    (item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "agent_message",
  );

  assert.ok(timelineBatchUpdate?.params?.update?.batch);
  assert.equal(agentMessageUpdate, undefined);
  assert.equal(timelineBatchUpdate?.params?.update?.batch?.entries[0]?.kind, "assistant_message");
  assert.equal(capture.persisted.length, 0);
  assert.deepEqual(
    capture.sessionUpdates?.map((update) => update.updateType),
    ["message"],
  );
});

test("runtime event cleanup releases per-session sequence state", () => {
  const context = createTestContext(
    [],
    {
      broadcasts: [],
      detailBroadcasts: [],
      persisted: [],
    },
    "session-cleanup-state",
  );

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
  const context = createTestContext(
    logs,
    capture,
    "session-canonical-streaming-message",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

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

  const timelineBatchUpdate = capture.detailBroadcasts.find(
    (item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "timeline_batch",
  );
  const agentMessageUpdate = capture.detailBroadcasts.find(
    (item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "agent_message",
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
  const compactionEntry = capture.timelineEntries?.find(
    (entry) => entry.kind === "context_compaction",
  );
  assert.equal(compactionEntry?.kind, "context_compaction");
  if (compactionEntry?.kind === "context_compaction") {
    assert.equal(
      compactionEntry.id,
      "compaction:session-canonical-codex-mixed-compaction:reply-mixed:compaction-marker",
    );
    assert.equal(compactionEntry.phase, "completed");
    assert.equal(compactionEntry.summaryText, undefined);
    assert.equal(compactionEntry.detailsVisibility, undefined);
  }
  const assistantEntry = capture.timelineEntries?.find(
    (entry) => entry.kind === "assistant_message",
  );
  assert.equal(assistantEntry?.kind, "assistant_message");
  if (assistantEntry?.kind === "assistant_message") {
    assert.equal(assistantEntry.chunks[0]?.text, "我先做个完成度确认，再继续往下处理。");
  }
  assert.deepEqual(
    capture.sessionUpdates?.map((update) => update.updateType),
    ["compaction", "message"],
  );
});

test("runtime plan updates publish live_state snapshots when the pipeline is available", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(
    logs,
    capture,
    "session-canonical-plan",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

  handleRuntimeEvent(
    "session-canonical-plan",
    {
      type: "plan-update",
      plan: {
        updatedAt: "2026-06-29T00:00:02.000Z",
        entries: [
          {
            content: "do the thing",
            priority: "high",
            status: "in_progress",
          },
        ],
      },
    } satisfies SessionRuntimeEvent,
    context,
  );

  const liveStateUpdate = capture.detailBroadcasts.find(
    (item: any) => item.method === "session/update" && item.params?.update?.kind === "live_state",
  ) as
    | {
        params?: {
          update?: {
            snapshot?: {
              sequence?: number;
              plan?: AgentPlan;
              status?: { effectiveStatus?: string };
            };
          };
        };
      }
    | undefined;
  const legacyPlanUpdate = capture.detailBroadcasts.find(
    (item: any) => item.method === "session/update" && item.params?.update?.kind === "plan_update",
  );

  assert.ok(liveStateUpdate?.params?.update?.snapshot?.plan);
  assert.equal(legacyPlanUpdate, undefined);
  assert.equal(
    liveStateUpdate?.params?.update?.snapshot?.plan?.entries[0]?.content,
    "do the thing",
  );
  assert.equal(liveStateUpdate?.params?.update?.snapshot?.sequence, 1);
  assert.equal(liveStateUpdate?.params?.update?.snapshot?.status?.effectiveStatus, "starting");
});

test("runtime session state variants publish canonical live_state in arrival order", () => {
  const logs: string[] = [];
  const capture: TestContextCapture = {
    broadcasts: [],
    detailBroadcasts: [],
    persisted: [],
    timelineEntries: [],
  };
  const context = createTestContext(
    logs,
    capture,
    "session-canonical-state",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

  handleRuntimeEvent(
    "session-canonical-state",
    {
      type: "mode-update",
      agentMode: "architect",
    },
    context,
  );
  handleRuntimeEvent(
    "session-canonical-state",
    {
      type: "session-info",
      title: null,
      updatedAt: "2026-07-11T12:00:00.000Z",
    },
    context,
  );
  handleRuntimeEvent(
    "session-canonical-state",
    {
      type: "usage-update",
      usage: {
        used: 100,
        size: 200_000,
        cost: { amount: 0.02, currency: "USD" },
      },
    },
    context,
  );

  const snapshots = capture.detailBroadcasts
    .filter(
      (item: any) => item.method === "session/update" && item.params?.update?.kind === "live_state",
    )
    .map((item: any) => item.params.update.snapshot);

  assert.deepEqual(
    snapshots.map((snapshot: any) => snapshot.sequence),
    [1, 2, 3],
  );
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
  const context = createTestContext(
    logs,
    capture,
    "session-canonical-state-cutover",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

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

  assert.deepEqual(
    liveStates.map((update: any) => update.snapshot.sequence),
    [1, 2, 3, 4, 5],
  );
  assert.equal(
    sessionUpdates.some((update: any) => legacyKinds.has(update.kind)),
    false,
  );
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
  const context = createTestContext(
    logs,
    capture,
    "session-canonical-queue",
    {},
    {
      useCanonicalPipeline: true,
    },
  );
  const queue = {
    sessionId: "session-canonical-queue",
    queued: [
      {
        id: "queued-1",
        sessionId: "session-canonical-queue",
        text: "continue",
        clientMessageId: "client-queued-1",
        createdAt: "2026-07-11T13:00:00.000Z",
        updatedAt: "2026-07-11T13:00:00.000Z",
        status: "queued" as const,
      },
    ],
  };

  publishPromptQueueState("session-canonical-queue", queue, context);

  assert.deepEqual(
    capture.sessionUpdates?.map((update) => [update.sequence, update.updateType]),
    [[1, "prompt-queue"]],
  );
  const updates = capture.detailBroadcasts
    .filter((item: any) => item.method === "session/update")
    .map((item: any) => item.params.update);
  assert.equal(
    updates.some((update: any) => update.kind === "prompt_queue"),
    false,
  );
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
  const context = createTestContext(
    logs,
    capture,
    "session-explicit-state",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

  publishCanonicalSessionStateEvent(
    "session-explicit-state",
    { type: "status", status: "error" },
    context,
  );

  const updates = capture.detailBroadcasts
    .filter((item: any) => item.method === "session/update")
    .map((item: any) => item.params.update);
  assert.deepEqual(
    capture.sessionUpdates?.map((update) => [update.sequence, update.updateType]),
    [[1, "status"]],
  );
  assert.equal(updates[0]?.kind, "live_state");
  assert.equal(updates[0]?.snapshot?.sequence, 1);
  assert.equal(updates[0]?.snapshot?.status?.effectiveStatus, "error");
  assert.equal(
    updates.some((update: any) => update.kind === "status_change"),
    false,
  );
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
  const context = createTestContext(
    logs,
    capture,
    "session-state-rollback",
    {},
    {
      useCanonicalPipeline: true,
    },
  );
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

  handleRuntimeEvent(
    "session-state-rollback",
    {
      type: "status",
      status: "running",
    },
    context,
  );

  assert.equal(capture.sessionUpdates?.length, 0);
  assert.equal(
    capture.detailBroadcasts.some(
      (item: any) => item.method === "session/update" && item.params?.update?.kind === "live_state",
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
  const context = createTestContext(
    [],
    capture,
    "session-conversation-rollback",
    {},
    {
      useCanonicalPipeline: true,
    },
  );
  if (!context.sessionTimelineStore?.commitBatch) {
    throw new Error("test requires atomic timeline store");
  }
  context.sessionTimelineStore.commitBatch = () => {
    throw new Error("conversation update failed");
  };

  assert.throws(() => {
    handleRuntimeEvent(
      "session-conversation-rollback",
      {
        type: "message",
        message: {
          id: "assistant-failed",
          role: "assistant",
          text: "must not publish",
          timestamp: "2026-07-11T15:30:00.000Z",
          streaming: false,
        },
      },
      context,
    );
  }, /conversation update failed/u);

  assert.deepEqual(capture.timelineEntries, []);
  assert.equal(
    capture.detailBroadcasts.some(
      (item: any) =>
        item.method === "session/update" && item.params?.update?.kind === "timeline_batch",
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
  const context = createTestContext(
    logs,
    capture,
    "session-canonical-command-output",
    {},
    {
      useCanonicalPipeline: true,
    },
  );
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

  const timelineBatchUpdate = capture.detailBroadcasts.find(
    (item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "timeline_batch",
  );
  const legacyCommandOutputUpdate = capture.detailBroadcasts.find(
    (item: any) =>
      item.method === "session/update" && item.params?.update?.kind === "command_output",
  );

  assert.ok(timelineBatchUpdate);
  assert.equal(legacyCommandOutputUpdate, undefined);
  assert.deepEqual(
    capture.sessionUpdates?.map((update) => update.updateType),
    ["command-output"],
  );
  assert.equal(appendedOutputs.length, 0);
});

test("runtime compaction completed exposes summary details for codex providers", () => {
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
      summaryText:
        "This session is being continued from a previous conversation that ran out of context.",
      timestamp: "2026-06-28T00:00:02.000Z",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const compactionEntry = capture.timelineEntries?.find(
    (entry) => entry.kind === "context_compaction",
  );

  assert.equal(
    compactionEntry?.kind === "context_compaction" ? compactionEntry.detailsVisibility : undefined,
    "expandable",
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
      messageId: "compaction-summary",
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
      summaryText:
        "This session is being continued from a previous conversation that ran out of context.",
    } satisfies SessionRuntimeEvent,
    context,
  );

  const compactionEntries =
    capture.timelineEntries?.filter((entry) => entry.kind === "context_compaction") ?? [];
  assert.equal(compactionEntries.length, 1);
  assert.equal(compactionEntries[0]?.id, "compaction:session-compaction-merge:compaction-summary");
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction"
      ? compactionEntries[0].summaryText
      : undefined,
    "This session is being continued from a previous conversation that ran out of context.",
  );
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction"
      ? compactionEntries[0].detailsVisibility
      : undefined,
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
  const assistantEntries =
    capture.timelineEntries?.filter((entry) => entry.kind === "assistant_message") ?? [];
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
  const context = createTestContext(
    logs,
    capture,
    "session-compaction-boundary-canonical",
    {},
    {
      useCanonicalPipeline: true,
    },
  );

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
  const assistantEntries =
    capture.timelineEntries?.filter((entry) => entry.kind === "assistant_message") ?? [];
  assert.equal(assistantEntries.length, 2);
  assert.notEqual(assistantEntries[0]?.id, assistantEntries[1]?.id);
});
