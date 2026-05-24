import assert from "node:assert/strict";
import test from "node:test";
import { broadcastSessionUpdate } from "./notifications.js";
import { createSessionEventPublisher } from "../runtime/session-event-publisher";

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
    kind: "command_output",
    chunk: {
      id: "cmd-1",
      stream: "stdout",
      text: "ok",
      timestamp: "2026-05-23T00:00:00.000Z",
    },
  },
  {
    kind: "diff_update",
    diff: { path: "src/file.ts", status: "modified", additions: 1, deletions: 0 },
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

test("session event publisher preserves notification payloads", () => {
  const update = { kind: "status_change", status: "running" } as const;
  const calls: Array<{ method: string; params: unknown }> = [];
  const publisher = createSessionEventPublisher({
    broadcastNotification: (method: string, params: unknown) => {
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
