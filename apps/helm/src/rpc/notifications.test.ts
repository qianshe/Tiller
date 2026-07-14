import assert from "node:assert/strict";
import test from "node:test";
import { broadcastPromptTrace, broadcastSessionUpdate } from "./notifications.js";
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
      kind: "think",
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

  assert.deepEqual(calls, [
    {
      method: "session/update",
      params: { sessionId: "session-1", update },
    },
    {
      method: "error/raised",
      params: { sessionId: "session-1", message: "failed" },
    },
  ]);
});
