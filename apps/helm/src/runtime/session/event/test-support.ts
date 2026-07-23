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
import type { HelmHandlerContext } from "../../../handlers/context";
import type { LogLevel, TillerLogger } from "../../../logging/logger";
import { createLiveMessageBuffer } from "../../live-message-buffer.js";
import { createSessionTimelineDispatcher } from "../../session-timeline/dispatcher.js";
import { createSessionTimelineFlushScheduler } from "../../session-timeline/flush-scheduler.js";
import { createSessionLiveStateStore } from "../../session-timeline/live-state-store.js";
import { createSessionTimelineWorkerRegistry } from "../../session-timeline/worker-registry.js";
import { createSessionRuntimeEventState } from "./runtime-state.js";
import { createSessionApprovalStateStore } from "./approval-store.js";

export type TestContextCapture = {
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

export type CapturedLog = {
  level: "fatal" | "trace" | "info" | "debug" | "warn" | "error";
  event: string;
  fields?: Record<string, unknown>;
};

export type ManualTimerHarness = ReturnType<typeof createManualTimerHarness>;


export function createManualTimerHarness() {
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

export function structuredLogs(capture: TestContextCapture) {
  return capture.structuredLogs?.filter((log) => log.event !== "legacy.log") ?? [];
}

export function findStructuredLog(capture: TestContextCapture, event: string) {
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

export function createTestContext(
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
