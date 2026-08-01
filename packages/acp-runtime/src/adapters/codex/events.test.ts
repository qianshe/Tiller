import assert from "node:assert/strict";
import test from "node:test";
import {
  mapSessionUpdateNotification,
  mapSessionUpdateNotificationBatch,
} from "../../events";

const codexProvider = {
  id: "codex",
  name: "Codex",
  command: "codex-acp",
  transport: "stdio" as const,
  protocol: "acp" as const,
};

test("Codex App Server spawnAgent notifications are titled Subagent", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-spawn-agent-source",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "codex-spawn-agent-source",
          title: "spawnAgent",
          status: "in_progress",
          rawInput: {
            prompt: "在共享工作区执行只读检查",
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread-uuid"],
            agentsStates: {
              "child-thread-uuid": { status: "pendingInit", message: null },
            },
          },
        },
      },
    },
    { provider: codexProvider, providerId: codexProvider.id },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected a live Codex subagent tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Subagent");
  assert.equal(mapped.event.toolCall.commandId, "codex-spawn-agent-source");
  assert.deepEqual(mapped.event.toolCall.subagentOperation, {
    action: "spawn",
    targets: [{ id: "child-thread-uuid" }],
  });
  assert.notEqual(mapped.event.toolCall.title, "child-thread-uuid");
});

test("Codex App Server wait notifications keep the same Subagent category", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-wait-source",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "codex-wait-source",
          title: "wait",
          status: "completed",
          rawInput: {
            senderThreadId: "parent-thread",
            receiverThreadIds: ["child-thread-uuid"],
            agentsStates: {
              "child-thread-uuid": { status: "completed", message: "done" },
            },
          },
        },
      },
    },
    { provider: codexProvider, providerId: codexProvider.id },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected a live Codex wait tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Subagent");
  assert.equal(mapped.event.toolCall.commandId, "codex-wait-source");
  assert.deepEqual(mapped.event.toolCall.subagentOperation, {
    action: "wait",
    targets: [{ id: "child-thread-uuid" }],
  });
});

test("Codex App Server wait notifications recognize ids-shaped targets", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-wait-ids",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "codex-wait-ids",
          title: "wait",
          status: "completed",
          rawInput: {
            receiverThreadIds: [],
            ids: ["child-thread-uuid"],
            agentsStates: {
              "child-thread-uuid": { status: "completed", message: "done" },
            },
          },
        },
      },
    },
    { provider: codexProvider, providerId: codexProvider.id },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected a live Codex wait tool-call event");
  }
  assert.equal(mapped.event.toolCall.commandId, "codex-wait-ids");
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.deepEqual(mapped.event.toolCall.subagentOperation, {
    action: "wait",
    targets: [{ id: "child-thread-uuid" }],
  });
});

test("Codex completed wait finalizes its running spawn operation", () => {
  const sessionId = "session-codex-operation-lifecycle";
  const spawn = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "codex-spawn-lifecycle",
          title: "spawnAgent",
          status: "in_progress",
          rawInput: {
            receiverThreadIds: ["child-thread-lifecycle"],
            agentsStates: {
              "child-thread-lifecycle": { status: "running", message: null },
            },
          },
        },
      },
    },
    { provider: codexProvider, providerId: codexProvider.id },
  );
  assert.deepEqual(
    spawn?.events.map((event) => event.type === "tool-call"
      ? [event.toolCall.id, event.toolCall.status, event.toolCall.subagentOperation?.action]
      : [event.type]),
    [["codex-spawn-lifecycle", "running", "spawn"]],
  );

  const timedOutWait = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "codex-wait-timeout",
          title: "wait",
          status: "completed",
          rawInput: {
            ids: ["child-thread-lifecycle"],
            agentsStates: {
              "child-thread-lifecycle": { status: "running", message: null },
            },
          },
          rawOutput: "timed out; agent still running",
        },
      },
    },
    { provider: codexProvider, providerId: codexProvider.id },
  );
  assert.deepEqual(
    timedOutWait?.events.map((event) => event.type === "tool-call"
      ? [event.toolCall.id, event.toolCall.status, event.toolCall.subagentOperation?.action]
      : [event.type]),
    [["codex-wait-timeout", "completed", "wait"]],
  );

  const wait = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "codex-wait-lifecycle",
          title: "wait",
          status: "completed",
          rawInput: {
            ids: ["child-thread-lifecycle"],
            agentsStates: {
              "child-thread-lifecycle": { status: "completed", message: "done" },
            },
          },
        },
      },
    },
    { provider: codexProvider, providerId: codexProvider.id },
  );
  assert.deepEqual(
    wait?.events.map((event) => event.type === "tool-call"
      ? [event.toolCall.id, event.toolCall.status, event.toolCall.subagentOperation?.action]
      : [event.type]),
    [
      ["codex-spawn-lifecycle", "completed", "spawn"],
      ["codex-wait-lifecycle", "completed", "wait"],
    ],
  );
});
