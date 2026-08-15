import assert from "node:assert/strict";
import test from "node:test";
import {
  broadcastPromptTrace,
  broadcastNotificationCleared,
  broadcastNotificationRaised,
  broadcastSessionActivitySummary,
  broadcastSessionUpdate,
} from "./notifications.js";
import { createSessionEventPublisher } from "../runtime/session/event/publisher";

const detailUpdates = [
  {
    kind: "agent_message",
    message: {
      id: "msg-1",
      role: "assistant",
      text: "hello",
      timestamp: "2026-05-23T00:00:00.000Z",
    },
  },
  {
    kind: "tool_call",
    toolCall: {
      id: "tool-1",
      kind: "tool",
      title: "Thinking",
      status: "running",
      timestamp: "2026-05-23T00:00:00.000Z",
    },
  },
  {
    kind: "timeline_batch",
    batch: { replace: false, deliverySequence: 1, lastSequence: 1, entries: [] },
  },
  {
    kind: "live_state",
    snapshot: { sequence: 1, effectiveStatus: "running" },
  },
];

test("session detail updates are sent through the session topic broadcaster", () => {
  for (const update of detailUpdates) {
    const calls: Array<{ sessionId: string; method: string; params: unknown }> = [];

    broadcastSessionUpdate(
      {
        broadcastSessionTopic: (sessionId: string, method: string, params: unknown) => {
          calls.push({ sessionId, method, params });
        },
        broadcastNotification: () => {
          throw new Error(`${update.kind} detail updates must not use global broadcasts`);
        },
      } as any,
      "session-1",
      update,
    );

    assert.deepEqual(calls, [
      {
        sessionId: "session-1",
        method: "session/update",
        params: { sessionId: "session-1", update },
      },
    ]);
  }
});

test("prompt trace debug events use global notification broadcast", () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const event = {
    traceId: "trace-1",
    sessionId: "session-1",
    phase: "helm.prompt.ack",
    timestamp: "2026-05-24T00:00:00.000Z",
    source: "helm",
  } as const;

  broadcastPromptTrace(
    {
      broadcastNotification: (method: string, params: unknown) => {
        calls.push({ method, params });
      },
    },
    event,
  );

  assert.deepEqual(calls, [
    {
      method: "debug/prompt_trace",
      params: event,
    },
  ]);
});

test("activity summary updates use the global dashboard notification", () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const summary = {
    generatedAt: "2026-08-12T00:00:00.000Z",
    promptCount: 1,
    recentToolCallCount: 2,
    toolCallCount: 2,
    activityTrend: [],
    activityTrendHourly: [],
  };

  broadcastSessionActivitySummary(
    { broadcastNotification: (method, params) => calls.push({ method, params }) },
    summary,
  );

  assert.deepEqual(calls, [{ method: "dashboard/activity_summary", params: summary }]);
});

test("notification broadcasts remain live when history persistence fails", () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const warnings: string[] = [];

  broadcastNotificationRaised({
    broadcastNotification: (method, params) => calls.push({ method, params }),
    notificationStore: {
      append: () => {
        throw new Error("disk unavailable");
      },
      list: () => [],
    },
    logWarn: (message) => warnings.push(message),
  }, {
    kind: "warning",
    source: "storage",
    message: "Storage is temporarily unavailable.",
  });

  assert.equal(calls[0]?.method, "notification/raised");
  assert.equal(warnings.length, 1);
});

test("notification broadcasts use the stable id returned by persistence", () => {
  const calls: Array<{ method: string; params: unknown }> = [];

  broadcastNotificationRaised({
    broadcastNotification: (method, params) => calls.push({ method, params }),
    notificationStore: {
      append: (notification) => ({ ...notification, id: "notification-1" }),
      list: () => [],
    },
  }, {
    kind: "info",
    source: "runtime",
    message: "Session restored.",
    occurredAt: "2026-08-15T00:00:00.000Z",
  });

  assert.deepEqual(calls, [{
    method: "notification/raised",
    params: {
      id: "notification-1",
      kind: "info",
      source: "runtime",
      message: "Session restored.",
      occurredAt: "2026-08-15T00:00:00.000Z",
    },
  }]);
});

test("notification clear broadcasts the server-authoritative watermark", () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  broadcastNotificationCleared({
    broadcastNotification: (method, params) => calls.push({ method, params }),
  }, "2026-08-15T00:00:00.000Z");

  assert.deepEqual(calls, [{
    method: "notification/cleared",
    params: { clearedAt: "2026-08-15T00:00:00.000Z" },
  }]);
});

test("session event publisher preserves notification payloads", () => {
  const update = { kind: "live_state", snapshot: { sequence: 1, effectiveStatus: "running" } } as const;
  const calls: Array<{ method: string; params: unknown }> = [];
  const publisher = createSessionEventPublisher({
    broadcastNotification: (method: string, params: unknown) => {
      calls.push({ method, params });
    },
    broadcastSessionTopic: (_sessionId: string, method: string, params: unknown) => {
      calls.push({ method, params });
    },
  } as any);

  publisher.sessionUpdate("session-1", update);
  publisher.errorRaised({ sessionId: "session-1", message: "failed" });

  assert.deepEqual(calls[0], {
    method: "session/update",
    params: { sessionId: "session-1", update },
  });
  assert.equal(calls[1]?.method, "notification/raised");
  assert.deepEqual(calls[1]?.params && typeof calls[1].params === "object"
    ? { ...(calls[1].params as Record<string, unknown>), occurredAt: undefined }
    : calls[1]?.params, {
    sessionId: "session-1",
    message: "failed",
    kind: "error",
    source: "runtime",
    occurredAt: undefined,
  });
  assert.match(String((calls[1]?.params as Record<string, unknown>)?.occurredAt), /^20/);
});
