import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AgentMessage,
  CanonicalSessionState,
  PromptTraceEvent,
  SessionSummary,
  SessionTimelineBatch,
  SessionTimelineEntry,
  SessionTimelineMessageEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../../handlers/context";
import { sendPromptToSession, drainPromptQueue } from "./router";
import { createSessionPromptQueueManager } from "./prompt-queue";
import { createLiveMessageBuffer } from "../live-message-buffer";
import { flushLiveAssistantMessage, handleRuntimeEvent } from "../events";
import { createSessionTimelineFlushScheduler } from "../session-timeline/flush-scheduler";
import { createSessionTimelineWorker } from "../session-timeline/worker";
import { createSessionLiveStateStore } from "../session-timeline/live-state-store";
import { createSessionRuntimeEventState } from "./event/runtime-state";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function flushPromises() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitForPromptSettled(context: HelmHandlerContext, sessionId: string) {
  for (let attempt = 0; attempt < 10 && context.promptQueue.hasInFlight(sessionId); attempt += 1) {
    await flushPromises();
  }
}

function createSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Project One",
    helmId: "helm-1",
    cwd: "worktree-1",
    worktreeName: "Worktree One",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    messageCount: 0,
    runtimeSessionId: "runtime-1",
    ...overrides,
  };
}

function createContext(options: {
  sessionId?: string;
  activeRuntime?: {
    prompt: (text: string, content?: any[]) => Promise<void>;
    sessionCapabilities?: { imageInput?: boolean };
  };
  restoreRuntime?: {
    prompt: (text: string, content?: any[]) => Promise<void>;
    sessionCapabilities?: { imageInput?: boolean };
  };
  canonicalTimeline?: boolean;
  restoreOk?: boolean;
  summary?: Partial<SessionSummary>;
} = {}) {
  const sessionId = options.sessionId ?? "session-1";
  const summary = createSummary({ id: sessionId, ...options.summary });
  const persisted: AgentMessage[] = [];
  const sessionUpdates: SessionUpdateRecord[] = [];
  const timelineEntries: SessionTimelineEntry[] = [];
  const canonicalBatches: SessionTimelineBatch[] = [];
  const broadcasts: Array<{ method: string; params: any }> = [];
  const traceEvents: PromptTraceEvent[] = [];
  const subscriptions: string[] = [];
  const sessionStates = new Map<string, CanonicalSessionState>();
  let currentSummary = summary;
  const sessions = new Map<string, any>();
  if (options.activeRuntime) {
    sessions.set(sessionId, {
      summary,
      agent: { id: "codex" },
      worktree: { id: "worktree-1", path: "D:/repo" },
      runtime: options.activeRuntime,
    });
  }
  const timelineWorker = options.canonicalTimeline !== false
    ? createSessionTimelineWorker({ sessionId })
    : null;
  const sessionTimelineDispatcher = timelineWorker
    ? {
        dispatch: (
          _sessionId: string,
          batch: SessionTimelineBatch,
          updates: SessionUpdateRecord[] = [],
        ) => {
          canonicalBatches.push(batch);
          sessionUpdates.push(...updates);
          if (batch.replace) {
            timelineEntries.splice(0, timelineEntries.length, ...batch.entries);
            return;
          }
          for (const entry of batch.entries) {
            const index = timelineEntries.findIndex((candidate) => candidate.id === entry.id);
            if (index === -1) {
              timelineEntries.push(entry);
            } else {
              timelineEntries[index] = entry;
            }
          }
        },
      }
    : null;
  const sessionTimelineFlushScheduler = timelineWorker && sessionTimelineDispatcher
    ? createSessionTimelineFlushScheduler({
        workers: {
          forSession: () => timelineWorker,
          has: () => true,
          remove: () => undefined,
          evictIdle: () => [],
          size: () => 1,
        },
        dispatcher: sessionTimelineDispatcher,
        windowMs: 0,
      })
    : null;
  const sessionLiveStateStore = createSessionLiveStateStore({
    get: (targetSessionId) => sessionStates.get(targetSessionId),
    getAppliedSequence: (targetSessionId) => sessionStates.get(targetSessionId)?.sequence ?? 0,
    replace: (targetSessionId, state) => {
      sessionStates.set(targetSessionId, state);
      return state;
    },
    commitUpdate: (update, state) => {
      sessionUpdates.push(update);
      sessionStates.set(update.sessionId, state);
      return state;
    },
    remove: (targetSessionId) => {
      sessionStates.delete(targetSessionId);
    },
    close: async () => undefined,
  });
  const context = {
    socketId: "socket-1",
    sessions,
    promptQueue: createSessionPromptQueueManager(),
    sessionRuntimeEventState: createSessionRuntimeEventState(),
    liveMessageBuffer: createLiveMessageBuffer(),
    drainPromptQueue: async (sessionId: string) => {
      await drainPromptQueue(sessionId, context as unknown as HelmHandlerContext);
    },
    logInfo: () => undefined,
    logError: () => undefined,
    promptTrace: { emit: (event: PromptTraceEvent) => traceEvents.push(event) },
    persistSessionMessage: (_sessionId: string, message: AgentMessage) => persisted.push(message),
    sessionUpdateStore: {
      append: (update: SessionUpdateRecord) => {
        sessionUpdates.push(update);
      },
      getMaxSequence: (targetSessionId: string) => Math.max(
        sessionStates.get(targetSessionId)?.sequence ?? 0,
        ...sessionUpdates
          .filter((update) => update.sessionId === targetSessionId)
          .map((update) => update.sequence),
      ),
      compactTail: () => 0,
    },
    sessionTimelineStore: {
      append: (_sessionId: string, entry: SessionTimelineEntry) => {
        const index = timelineEntries.findIndex((candidate) => candidate.id === entry.id);
        if (index === -1) {
          timelineEntries.push(entry);
        } else {
          timelineEntries[index] = entry;
        }
        return timelineEntries;
      },
      replace: (_sessionId: string, entries: SessionTimelineEntry[]) => {
        timelineEntries.splice(0, timelineEntries.length, ...entries);
        return timelineEntries;
      },
      list: () => timelineEntries,
      listPage: () => ({ entries: timelineEntries, hasMore: false }),
      remove: () => timelineEntries.splice(0, timelineEntries.length),
    },
    ...(timelineWorker
      ? {
          sessionTimelineWorkers: {
            forSession: () => timelineWorker,
            has: () => true,
            remove: () => undefined,
          },
          sessionTimelineDispatcher,
          sessionTimelineFlushScheduler,
          sessionLiveStateStore,
        }
      : {}),
    updateSessionSummary: (_sessionId: string, mutate: (current: SessionSummary) => SessionSummary) => {
      currentSummary = mutate(currentSummary);
      const record = sessions.get(_sessionId);
      if (record) {
        record.summary = currentSummary;
      }
      return currentSummary;
    },
    hydrateSessionSummary: (next: SessionSummary) => next,
    sessionStore: {
      get: (targetSessionId: string) => targetSessionId === sessionId ? currentSummary : undefined,
      list: () => [currentSummary],
    },
    broadcastNotification: (method: string, params: any) => broadcasts.push({ method, params }),
    broadcastSessionTopic: (_sessionId: string, method: string, params: any) => {
      broadcasts.push({ method, params });
    },
    subscribeSessionTopic: (socketId: string, sessionId: string) => {
      subscriptions.push(`${socketId}:${sessionId}`);
    },
    unsubscribeSessionTopic: () => undefined,
    removeSocketSessionTopics: () => undefined,
    startSessionResume: async () => {
      if (!options.restoreOk || !options.restoreRuntime) {
        return {
          ok: false,
          resume: { restoreMethod: "ui-history" },
          message: "restore unavailable",
        };
      }
      sessions.set(sessionId, {
        summary,
        agent: { id: "codex" },
        worktree: { id: "worktree-1", path: "D:/repo" },
        runtime: options.restoreRuntime,
      });
      return {
        ok: true,
        resume: { restoreMethod: "session/load" },
        message: "restored",
      };
    },
  } as unknown as HelmHandlerContext;
  return {
    context,
    persisted,
    sessionUpdates,
    timelineEntries,
    canonicalBatches,
    broadcasts,
    sessions,
    traceEvents,
    subscriptions,
  };
}

function timelineMessages(entries: SessionTimelineEntry[]) {
  return entries.flatMap((entry) => {
    if (entry.kind === "user_message") {
      return [[entry.message.role, entry.message.text] as const];
    }
    if (entry.kind !== "assistant_message") {
      return [];
    }
    return entry.chunks
      .filter((chunk) => chunk.kind === "content")
      .map((chunk) => ["assistant", chunk.text] as const);
  });
}

function findUserMessageEntry(entries: SessionTimelineEntry[]) {
  return entries.find((entry): entry is SessionTimelineMessageEntry =>
    entry.kind === "user_message"
  );
}

test("sendPromptToSession dispatches through an active runtime", async () => {
  const prompted: string[] = [];
  const { context, persisted, timelineEntries, traceEvents } = createContext({
    activeRuntime: {
      prompt: async (text) => {
        prompted.push(text);
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  const result = await sendPromptToSession(
    { sessionId: "session-1", text: "你好", clientMessageId: "client-1" },
    context,
  );

  await flushPromises();
  assert.deepEqual(prompted, ["你好"]);
  assert.equal(result.accepted, "sent");
  const userEntry = findUserMessageEntry(timelineEntries);
  assert.equal(userEntry?.id, "client-1");
  assert.equal(typeof userEntry?.sequence, "number");
  assert.deepEqual(persisted, []);
  assert.deepEqual(traceEvents.map((event) => event.phase).filter((phase) => phase.startsWith("helm.prompt.")), [
    "helm.prompt.ack",
    "helm.prompt.send_start",
    "helm.prompt.runtime_accepted",
  ]);
});

test("sendPromptToSession records the local user prompt as a timeline entry before runtime dispatch", async () => {
  const snapshotsDuringPrompt: string[][] = [];
  const { context, timelineEntries } = createContext({
    activeRuntime: {
      prompt: async () => {
        snapshotsDuringPrompt.push(timelineEntries.map((entry) => entry.kind));
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession(
    { sessionId: "session-1", text: "先记录我", clientMessageId: "client-timeline" },
    context,
  );
  await flushPromises();

  assert.deepEqual(snapshotsDuringPrompt, [["user_message"]]);
  assert.deepEqual(
    timelineEntries.map((entry) => entry.kind),
    ["user_message"],
  );
  assert.equal(timelineEntries[0]?.id, "client-timeline");
});

test("sendPromptToSession routes local user prompts through canonical timeline batches without legacy writes", async () => {
  const snapshotsDuringPrompt: Array<Array<[string, number | undefined]>> = [];
  const { context, canonicalBatches, broadcasts, persisted, timelineEntries } = createContext({
    canonicalTimeline: true,
    activeRuntime: {
      prompt: async () => {
        snapshotsDuringPrompt.push(
          timelineEntries.map((entry) => [entry.kind, "sequence" in entry ? entry.sequence : undefined]),
        );
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession(
    { sessionId: "session-1", text: "canonical prompt", clientMessageId: "client-canonical" },
    context,
  );
  await flushPromises();

  assert.equal(canonicalBatches.length, 1);
  assert.deepEqual(
    canonicalBatches[0]?.entries.map((entry) => entry.kind),
    ["user_message"],
  );
  assert.deepEqual(
    snapshotsDuringPrompt,
    [[[
      "user_message",
      canonicalBatches[0]?.entries[0] && "sequence" in canonicalBatches[0].entries[0]
        ? canonicalBatches[0].entries[0].sequence
        : undefined,
    ]]],
  );
  assert.equal(
    broadcasts.some(
      (item) => item.method === "session/update" && item.params.update.kind === "user_message",
    ),
    false,
  );
  assert.deepEqual(persisted, []);
});

test("sendPromptToSession appends prompts after restored timeline history", async () => {
  const prompted: string[] = [];
  const { context, timelineEntries } = createContext({
    sessionId: "session-seeded-prompt",
    activeRuntime: {
      prompt: async (text) => {
        prompted.push(text);
      },
      sessionCapabilities: { imageInput: true },
    },
  });
  timelineEntries.push({
    id: "old-final",
    kind: "assistant_message",
    chunks: [
      {
        id: "old-final:content",
        kind: "content",
        text: "旧回复结尾",
        timestamp: "2026-06-10T09:00:00.000Z",
        sequence: 237,
      },
    ],
    timestamp: "2026-06-10T09:00:00.000Z",
    updatedAt: "2026-06-10T09:00:00.000Z",
    sequence: 237,
  });
  context.sessionLiveStateStore?.apply(
    "session-seeded-prompt",
    { type: "status", status: "idle" },
    237,
  );

  await sendPromptToSession(
    {
      sessionId: "session-seeded-prompt",
      text: "新的审核 prompt",
      clientMessageId: "client-after-history",
    },
    context,
  );
  await flushPromises();

  assert.deepEqual(prompted, ["新的审核 prompt"]);
  assert.equal(
    findUserMessageEntry(timelineEntries)?.sequence,
    239,
  );
  assert.deepEqual(
    timelineEntries.map((entry) => [entry.kind, (entry as any).sequence]),
    [
      ["assistant_message", 237],
      ["user_message", 239],
    ],
  );
});

test("sendPromptToSession subscribes the prompting socket before runtime dispatch", async () => {
  const subscriptionsDuringPrompt: string[][] = [];
  const { context, subscriptions } = createContext({
    activeRuntime: {
      prompt: async () => {
        subscriptionsDuringPrompt.push([...subscriptions]);
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession(
    { sessionId: "session-1", text: "请实时展示", clientMessageId: "client-subscribe" },
    context,
  );
  await flushPromises();

  assert.deepEqual(subscriptionsDuringPrompt, [["socket-1:session-1"]]);
});

test("sendPromptToSession flushes buffered assistant text after prompt completion", async () => {
  const { context, timelineEntries } = createContext({
    activeRuntime: {
      prompt: async () => {
        context.liveMessageBuffer.append("session-1", {
          id: "session-1-msg-s0",
          role: "assistant",
          text: "延迟到 prompt 完成后 flush 的回复",
          timestamp: "2026-05-15T10:00:00.000Z",
        });
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession(
    { sessionId: "session-1", text: "请回复", clientMessageId: "client-flush" },
    context,
  );
  await flushPromises();

  assert.deepEqual(
    timelineMessages(timelineEntries),
    [
      ["user", "请回复"],
      ["assistant", "延迟到 prompt 完成后 flush 的回复"],
    ],
  );
});

test("sendPromptToSession does not duplicate assistant text already flushed by status handling", async () => {
  const { context, timelineEntries } = createContext({
    activeRuntime: {
      prompt: async () => {
        context.liveMessageBuffer.append("session-1", {
          id: "session-1-msg-s0",
          role: "assistant",
          text: "已由 status 路径 flush 的回复",
          timestamp: "2026-05-15T10:01:00.000Z",
        });
        flushLiveAssistantMessage("session-1", context);
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession(
    { sessionId: "session-1", text: "请回复一次", clientMessageId: "client-no-dup" },
    context,
  );
  await flushPromises();

  assert.deepEqual(
    timelineMessages(timelineEntries),
    [
      ["user", "请回复一次"],
      ["assistant", "已由 status 路径 flush 的回复"],
    ],
  );
});

test("sendPromptToSession acknowledges before a long ACP prompt completes", async () => {
  const gate = deferred<void>();
  const prompted: string[] = [];
  const { context } = createContext({
    activeRuntime: {
      prompt: async (text) => {
        prompted.push(text);
        await gate.promise;
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  const result = await sendPromptToSession(
    { sessionId: "session-1", text: "long prompt", clientMessageId: "client-long" },
    context,
  );

  await flushPromises();
  assert.equal(result.accepted, "sent");
  assert.deepEqual(prompted, ["long prompt"]);
  assert.equal(context.promptQueue.hasInFlight("session-1"), true);

  gate.resolve();
  await flushPromises();
  assert.equal(context.promptQueue.hasInFlight("session-1"), false);
});

test("sendPromptToSession accepts new runtime status after a previous error", async () => {
  const { context, sessions } = createContext({
    summary: { status: "error" },
    activeRuntime: {
      prompt: async () => {
        handleRuntimeEvent(
          "session-1",
          {
            type: "status",
            status: "running",
            message: "retry started",
          } satisfies SessionRuntimeEvent,
          context,
        );
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession(
    { sessionId: "session-1", text: "重新执行", clientMessageId: "client-retry" },
    context,
  );
  await waitForPromptSettled(context, "session-1");

  assert.equal(sessions.get("session-1")?.summary.status, "running");
});

test("sendPromptToSession evicts a failed runtime so the next prompt restores it", async () => {
  const restoredPrompts: string[] = [];
  const { context, sessions } = createContext({
    activeRuntime: {
      prompt: async () => {
        throw new Error("provider stalled");
      },
      sessionCapabilities: { imageInput: true },
    },
    restoreOk: true,
    restoreRuntime: {
      prompt: async (text) => {
        restoredPrompts.push(text);
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession(
    { sessionId: "session-1", text: "first", clientMessageId: "client-failed" },
    context,
  );
  await waitForPromptSettled(context, "session-1");
  assert.equal(sessions.has("session-1"), false);

  await sendPromptToSession(
    { sessionId: "session-1", text: "second", clientMessageId: "client-restored" },
    context,
  );
  await waitForPromptSettled(context, "session-1");

  assert.deepEqual(restoredPrompts, ["second"]);
  assert.equal(sessions.has("session-1"), true);
});

test("sendPromptToSession rejects unsupported slash commands before ACP prompt", async () => {
  const prompted: string[] = [];
  const { context, timelineEntries } = createContext({
    summary: { availableCommands: [{ name: "review" }] },
    activeRuntime: {
      prompt: async (text) => {
        prompted.push(text);
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await assert.rejects(
    sendPromptToSession({ sessionId: "session-1", text: "/unknown please" }, context),
    /command is not supported/u,
  );

  assert.deepEqual(prompted, []);
  assert.equal(timelineEntries.length, 0);
});

test("sendPromptToSession allows supported slash commands as ACP text prompts", async () => {
  const prompted: string[] = [];
  const { context } = createContext({
    summary: { availableCommands: [{ name: "review" }] },
    activeRuntime: {
      prompt: async (text) => {
        prompted.push(text);
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession({ sessionId: "session-1", text: "/review branch" }, context);

  await flushPromises();
  assert.deepEqual(prompted, ["/review branch"]);
});

test("sendPromptToSession allows scoped slash command invocations", async () => {
  const prompted: string[] = [];
  const { context } = createContext({
    summary: { availableCommands: [{ name: "frontend-design", scope: "skills" }] },
    activeRuntime: {
      prompt: async (text) => {
        prompted.push(text);
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession({ sessionId: "session-1", text: "/skills:frontend-design hero" }, context);

  await flushPromises();
  assert.deepEqual(prompted, ["/skills:frontend-design hero"]);
});

test("sendPromptToSession restores a stale session before dispatch", async () => {
  const prompted: string[] = [];
  const { context, timelineEntries } = createContext({
    restoreOk: true,
    restoreRuntime: {
      prompt: async (text) => {
        prompted.push(text);
      },
      sessionCapabilities: { imageInput: true },
    },
  });

  await sendPromptToSession(
    { sessionId: "session-1", text: "恢复后发送", clientMessageId: "client-restore" },
    context,
  );

  await flushPromises();
  assert.deepEqual(prompted, ["恢复后发送"]);
  assert.equal(
    findUserMessageEntry(timelineEntries)?.message.text,
    "恢复后发送",
  );
});

test("sendPromptToSession queues behind an active in-flight prompt", async () => {
  const { context, persisted, broadcasts } = createContext({
    activeRuntime: {
      prompt: async () => {
        throw new Error("should not send while in-flight");
      },
      sessionCapabilities: { imageInput: true },
    },
  });
  context.promptQueue.markInFlight({
    sessionId: "session-1",
    text: "first",
    clientMessageId: "client-1",
  });

  const result = await sendPromptToSession(
    { sessionId: "session-1", text: "second", clientMessageId: "client-2" },
    context,
  );

  assert.equal(result.accepted, "queued");
  assert.equal(persisted.length, 0);
  assert.equal(context.promptQueue.snapshot("session-1").queued[0]?.text, "second");
  assert.equal(broadcasts.at(-1)?.params.update.kind, "live_state");
});

test("drainPromptQueue sends queued prompts in FIFO order", async () => {
  const prompted: string[] = [];
  const { context, timelineEntries } = createContext({
    activeRuntime: {
      prompt: async (text) => {
        prompted.push(text);
      },
      sessionCapabilities: { imageInput: true },
    },
  });
  context.promptQueue.enqueue({ sessionId: "session-1", text: "second", clientMessageId: "client-2" });
  context.promptQueue.enqueue({ sessionId: "session-1", text: "third", clientMessageId: "client-3" });

  await drainPromptQueue("session-1", context);

  assert.deepEqual(prompted, ["second", "third"]);
  assert.deepEqual(
    timelineEntries
      .filter((entry): entry is SessionTimelineMessageEntry =>
        entry.kind === "user_message"
      )
      .map((entry) => entry.message.text),
    ["second", "third"],
  );
});

test("sendPromptToSession fails when no runtime can be restored", async () => {
  const { context, persisted } = createContext({ restoreOk: false });

  await assert.rejects(
    sendPromptToSession({ sessionId: "session-1", text: "失败" }, context),
    /Session runtime is not available/u,
  );
  assert.equal(persisted.length, 0);
});

test("configureSessionRuntime applies config through an active runtime", async () => {
  const configured: any[] = [];
  const { context, broadcasts } = createContext({
    activeRuntime: {
      prompt: async () => undefined,
      configure: async (next: any) => {
        configured.push(next);
        return {
          runtimeApplied: true,
          state: { model: next.model, reasoningEffort: next.reasoningEffort },
          modelState: { currentModelId: next.model, options: [{ id: next.model, name: next.model }] },
        };
      },
      sessionCapabilities: { imageInput: true },
    } as any,
  });

  const { configureSessionRuntime } = await import("./router");
  const result = await configureSessionRuntime(
    { sessionId: "session-1", model: "gpt-5.5", reasoningEffort: "high" },
    context,
  );

  assert.equal(configured[0]?.model, "gpt-5.5");
  assert.equal(configured[0]?.reasoningEffort, "high");
  assert.equal(configured[0]?.agentMode, undefined);
  assert.equal(result.message, "Session config updated.");
  assert.equal(result.state.model, "gpt-5.5");
  assert.equal(broadcasts.at(-1)?.params.update.kind, "live_state");
  assert.equal(broadcasts.at(-1)?.params.update.snapshot.config.model, "gpt-5.5");
});

test("configureSessionRuntime returns current model state and options for a no-op active-session configure", async () => {
  const configured: any[] = [];
  const currentOptions = [
    { id: "model", name: "Model", category: "model", currentValue: "gpt-5.5", options: [] },
  ];

  const { context } = createContext({
    summary: {
      model: "gpt-5.5",
      modelOptions: [{ id: "gpt-5.5", name: "gpt-5.5" }],
      configOptions: currentOptions as any,
    },
    activeRuntime: {
      prompt: async () => undefined,
      configure: async (next: any) => {
        configured.push(next);
        return {
          runtimeApplied: false,
          state: { model: "gpt-5.5", reasoningEffort: "medium" },
          modelState: {
            currentModelId: "gpt-5.5",
            options: [{ id: "gpt-5.5", name: "gpt-5.5" }, { id: "gpt-5.6", name: "gpt-5.6" }],
          },
          options: currentOptions as any,
        };
      },
      sessionCapabilities: { imageInput: true },
    } as any,
  });

  const { configureSessionRuntime } = await import("./router");
  const result = await configureSessionRuntime(
    { sessionId: "session-1", model: "gpt-5.5", reasoningEffort: "medium" },
    context,
  );

  assert.equal(configured.length, 1);
  assert.equal(result.state.model, "gpt-5.5");
  assert.deepEqual(result.options, currentOptions);
});

test("configureSessionRuntime persists explicit model over runtime default state", async () => {
  const { context, broadcasts } = createContext({
    activeRuntime: {
      prompt: async () => undefined,
      configure: async () => ({
        runtimeApplied: true,
        state: { model: "gpt-5.5", reasoningEffort: "medium" },
        modelState: {
          currentModelId: "gpt-5.5",
          options: [{ id: "gpt-5.4", name: "gpt-5.4" }, { id: "gpt-5.5", name: "gpt-5.5" }],
        },
      }),
      sessionCapabilities: { imageInput: true },
    } as any,
  });

  const { configureSessionRuntime } = await import("./router");
  const result = await configureSessionRuntime(
    { sessionId: "session-1", model: "gpt-5.4", reasoningEffort: "medium" },
    context,
  );

  assert.equal(result.state.model, "gpt-5.4");
  assert.equal(broadcasts.at(-1)?.params.update.snapshot.config.model, "gpt-5.4");
});

test("configureSessionRuntime applies arbitrary ACP config option to the session runtime", async () => {
  const configured: any[] = [];
  const runtimeOptions = [
    {
      id: "approval-mode",
      name: "Approval Mode",
      category: "approval",
      currentValue: "auto",
      options: [
        { value: "on-request", label: "On Request" },
        { value: "auto", label: "Auto" },
      ],
    },
  ];
  const { context, broadcasts } = createContext({
    activeRuntime: {
      prompt: async () => undefined,
      configure: async (next: any) => {
        configured.push(next);
        return {
          runtimeApplied: true,
          state: {},
          modelState: undefined,
          options: runtimeOptions,
        };
      },
    } as any,
  });

  const { configureSessionRuntime } = await import("./router");
  const result = await configureSessionRuntime(
    { sessionId: "session-1", configId: "approval-mode", value: "auto" },
    context,
  );

  assert.deepEqual(configured[0], {
    agentMode: undefined,
    model: undefined,
    reasoningEffort: undefined,
    configId: "approval-mode",
    value: "auto",
  });
  assert.deepEqual(result.options, runtimeOptions);
  assert.deepEqual(broadcasts.at(-1)?.params.update.snapshot.config.configOptions, runtimeOptions);
});

test("configureSessionRuntime omits reasoning when config options do not support it", async () => {
  const runtimeOptions = [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "claude-haiku-4-5",
      options: [{ value: "claude-haiku-4-5", label: "claude-haiku-4-5" }],
    },
  ];
  const { context, broadcasts } = createContext({
    summary: { reasoningEffort: "medium" },
    activeRuntime: {
      prompt: async () => undefined,
      configure: async () => ({
        runtimeApplied: true,
        state: { model: "claude-haiku-4-5", reasoningEffort: "medium" },
        options: runtimeOptions,
      }),
    } as any,
  });

  const { configureSessionRuntime } = await import("./router");
  const result = await configureSessionRuntime(
    { sessionId: "session-1", model: "claude-haiku-4-5" },
    context,
  );

  assert.equal(result.state.model, "claude-haiku-4-5");
  assert.equal(result.state.reasoningEffort, undefined);
  assert.equal(broadcasts.at(-1)?.params.update.snapshot.config.reasoningEffort, undefined);
});

test("configureSessionRuntime preserves reasoning for haiku when ACP exposes it", async () => {
  const runtimeOptions = [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "opencode/haiku",
      options: [{ value: "opencode/haiku", label: "opencode/haiku" }],
    },
    {
      id: "thought_level",
      name: "Reasoning",
      category: "thought_level",
      currentValue: "medium",
      options: [{ value: "medium", label: "Medium" }],
    },
  ];
  const { context, broadcasts } = createContext({
    activeRuntime: {
      prompt: async () => undefined,
      configure: async () => ({
        runtimeApplied: true,
        state: { model: "opencode/haiku", reasoningEffort: "medium" },
        options: runtimeOptions,
      }),
    } as any,
  });

  const { configureSessionRuntime } = await import("./router");
  const result = await configureSessionRuntime(
    { sessionId: "session-1", model: "opencode/haiku" },
    context,
  );

  assert.equal(result.state.model, "opencode/haiku");
  assert.equal(result.state.reasoningEffort, "medium");
  assert.equal(broadcasts.at(-1)?.params.update.snapshot.config.reasoningEffort, "medium");
  assert.equal(
    result.options.some((option: { category?: string }) => option.category === "thought_level"),
    true,
  );
});

test("configureSessionRuntime ignores stale default options for a different selected model", async () => {
  const runtimeOptions = [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "claude-opus-4-7",
      options: [
        { value: "claude-opus-4-7", label: "claude-opus-4-7" },
        { value: "claude-haiku-4-5", label: "claude-haiku-4-5" },
      ],
    },
    {
      id: "thought_level",
      name: "Reasoning",
      category: "thought_level",
      currentValue: "medium",
      options: [{ value: "medium", label: "Medium" }],
    },
  ];
  const previousOptions = [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "claude-haiku-4-5",
      options: [{ value: "claude-haiku-4-5", label: "claude-haiku-4-5" }],
    },
  ];
  const { context } = createContext({
    summary: { model: "claude-haiku-4-5", configOptions: previousOptions },
    activeRuntime: {
      prompt: async () => undefined,
      configure: async () => ({
        runtimeApplied: true,
        state: { model: "claude-opus-4-7", reasoningEffort: "medium" },
        options: runtimeOptions,
      }),
    } as any,
  });

  const { configureSessionRuntime } = await import("./router");
  const result = await configureSessionRuntime(
    { sessionId: "session-1", model: "claude-haiku-4-5" },
    context,
  );

  assert.equal(result.state.model, "claude-haiku-4-5");
  assert.equal(result.state.reasoningEffort, undefined);
  assert.deepEqual(result.options, previousOptions);
});

test("configureSessionRuntime saves config when no runtime is active", async () => {
  const { context } = createContext();
  const { configureSessionRuntime } = await import("./router");

  const result = await configureSessionRuntime(
    { sessionId: "session-1", agentMode: "bypass", model: "provider-default" },
    context,
  );

  assert.equal(result.message, "Session config saved.");
  assert.equal(result.state.agentMode, "bypass");
  assert.equal(result.state.model, "provider-default");
});

test("cancelSessionRuntime canonicalizes active tools before clearing the runtime", async () => {
  let cancelled = false;
  const { context, sessions, timelineEntries, broadcasts } = createContext({
    activeRuntime: {
      prompt: async () => undefined,
      cancel: () => {
        cancelled = true;
      },
      sessionCapabilities: { imageInput: true },
    } as any,
  });
  const { cancelSessionRuntime } = await import("./router");

  handleRuntimeEvent("session-1", {
    type: "status",
    status: "running",
  }, context);
  handleRuntimeEvent("session-1", {
    type: "tool-call",
    toolCall: {
      id: "subagent-running",
      kind: "subagent",
      title: "Read-only display check",
      status: "running",
      timestamp: "2026-07-13T00:00:01.000Z",
      updatedAt: "2026-07-13T00:00:01.000Z",
    },
  }, context);

  const handled = await cancelSessionRuntime("session-1", context);

  assert.equal(handled, true);
  assert.equal(cancelled, true);
  assert.equal(sessions.has("session-1"), false);
  const subagentEntry = timelineEntries.find((entry) =>
    entry.kind === "tool_call" && entry.toolCall.id === "subagent-running"
  );
  assert.equal(
    subagentEntry?.kind === "tool_call" ? subagentEntry.toolCall.status : undefined,
    "cancelled",
  );
  const liveStateUpdates = broadcasts.filter((item) =>
    item.method === "session/update" && item.params?.update?.kind === "live_state"
  );
  assert.equal(liveStateUpdates.at(-1)?.params.update.snapshot.status.effectiveStatus, "cancelled");
});

test("cancelSessionRuntime broadcasts an error when the runtime is missing", async () => {
  const { context, broadcasts } = createContext();
  const { cancelSessionRuntime } = await import("./router");

  const handled = await cancelSessionRuntime("missing-session", context);

  assert.equal(handled, true);
  assert.equal(broadcasts.at(-1)?.method, "error/raised");
  assert.equal(broadcasts.at(-1)?.params.message, "Session not found");
});
