import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { createCodexPromptToolCallObserver } from "./prompt-tool-calls";

const context = {
  runtimeSessionId: "runtime-codex-1",
  cwd: "D:/repo",
};

function call(
  id: string,
  title: string,
  status: AgentToolCall["status"],
  input: Record<string, unknown>,
  output?: Record<string, unknown>,
): AgentToolCall {
  return {
    id,
    kind: "subagent",
    title,
    status,
    input: JSON.stringify(input),
    ...(output ? { output: JSON.stringify(output) } : {}),
    timestamp: "2026-07-14T11:17:27.959Z",
    updatedAt: status === "running"
      ? "2026-07-14T11:17:27.959Z"
      : "2026-07-14T11:17:53.962Z",
    sequence: 99,
  };
}

test("Codex prompt observer keeps spawn and wait as independent operations", () => {
  let snapshot: AgentToolCall[] = [];
  const observer = createCodexPromptToolCallObserver(() => snapshot);

  observer.begin(context);
  snapshot = [
    call("call-spawn", "spawn_agent", "running", {
      message: "Inspect the adapter and return CHILD_OK",
      fork_context: false,
    }),
  ];

  const launched = observer.poll(context);
  assert.equal(launched.length, 1);
  assert.deepEqual(launched[0], {
    type: "tool-call",
    toolCall: {
      id: "call-spawn",
      kind: "subagent",
      title: "Inspect the adapter and return CHILD_OK",
      status: "running",
      commandId: "call-spawn",
      input: JSON.stringify({
        message: "Inspect the adapter and return CHILD_OK",
        fork_context: false,
      }),
      subagentOperation: {
        action: "spawn",
      targets: [{ id: "call-spawn", label: "Inspect the adapter and return CHILD_OK" }],
      },
      timestamp: "2026-07-14T11:17:27.959Z",
      updatedAt: "2026-07-14T11:17:27.959Z",
    },
  });

  snapshot = [
    call(
      "call-spawn",
      "spawn_agent",
      "completed",
      { message: "Inspect the adapter and return CHILD_OK", fork_context: false },
      { agent_id: "agent-1", nickname: "Sagan" },
    ),
    call(
      "call-wait",
      "wait_agent",
      "completed",
      { targets: ["agent-1"], timeout_ms: 30_000 },
      { status: { "agent-1": { completed: "CHILD_OK" } }, timed_out: false },
    ),
  ];

  const completed = observer.poll(context);
  assert.equal(completed.length, 2);
  assert.deepEqual(completed[0], {
    type: "tool-call",
    toolCall: {
      id: "call-spawn",
      commandId: "call-spawn",
      kind: "subagent",
      title: "Inspect the adapter and return CHILD_OK",
      status: "completed",
      input: JSON.stringify({
        message: "Inspect the adapter and return CHILD_OK",
        fork_context: false,
      }),
      output: JSON.stringify({ agent_id: "agent-1", nickname: "Sagan" }),
      subagentOperation: {
        action: "spawn",
      targets: [{ id: "agent-1", label: "Inspect the adapter and return CHILD_OK" }],
      },
      timestamp: "2026-07-14T11:17:27.959Z",
      updatedAt: "2026-07-14T11:17:53.962Z",
    },
  });
  assert.deepEqual(completed[1], {
    type: "tool-call",
    toolCall: {
      id: "call-wait",
      commandId: "call-wait",
      kind: "subagent",
      title: "Inspect the adapter and return CHILD_OK",
      status: "completed",
      input: JSON.stringify({
        targets: ["agent-1"],
        timeout_ms: 30_000,
      }),
      output: "CHILD_OK",
      subagentOperation: {
        action: "wait",
      targets: [{ id: "agent-1", label: "Inspect the adapter and return CHILD_OK" }],
      },
      timestamp: "2026-07-14T11:17:27.959Z",
      updatedAt: "2026-07-14T11:17:53.962Z",
    },
  });
});

test("Codex prompt observer baselines history and keeps concurrent launches independent", () => {
  let snapshot: AgentToolCall[] = [
    call("old-spawn", "spawn_agent", "completed", { message: "old" }, { agent_id: "old-agent" }),
  ];
  const observer = createCodexPromptToolCallObserver(() => snapshot);
  observer.begin(context);
  assert.deepEqual(observer.poll(context), []);

  snapshot = [
    ...snapshot,
    call("spawn-a", "spawn_agent", "running", { task_name: "alpha", message: "purpose A" }),
    call("spawn-b", "spawn_agent", "running", { task_name: "beta", message: "purpose B" }),
  ];

  const events = observer.poll(context);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => event.type === "tool-call"
      ? [
          event.toolCall.id,
          event.toolCall.title,
          event.toolCall.status,
          event.toolCall.subagentOperation?.action,
        ]
      : []),
    [
      ["spawn-a", "purpose A", "running", "spawn"],
      ["spawn-b", "purpose B", "running", "spawn"],
    ],
  );
});

test("Codex prompt observer restores spawn identity before a later close operation", () => {
  let snapshot: AgentToolCall[] = [
    call(
      "old-spawn",
      "spawn_agent",
      "completed",
      { task_name: "Cicero", message: "Inspect the adapter" },
      { agent_id: "old-agent", nickname: "Cicero" },
    ),
  ];
  const observer = createCodexPromptToolCallObserver(() => snapshot);

  observer.begin(context);
  snapshot = [
    ...snapshot,
    call(
      "call-close",
      "close_agent",
      "completed",
      { target: "old-agent" },
      { previous_status: { completed: "Inspection complete" } },
    ),
  ];

  assert.deepEqual(observer.poll(context), [{
    type: "tool-call",
    toolCall: {
      id: "call-close",
      commandId: "call-close",
      kind: "subagent",
      title: "Inspect the adapter",
      status: "completed",
      input: JSON.stringify({ target: "old-agent" }),
      output: JSON.stringify({ previous_status: { completed: "Inspection complete" } }),
      subagentOperation: {
        action: "close",
        targets: [{ id: "old-agent", label: "Inspect the adapter" }],
      },
      timestamp: "2026-07-14T11:17:27.959Z",
      updatedAt: "2026-07-14T11:17:53.962Z",
    },
  }]);
});

test("Codex prompt observer keeps app-server ids targets linked to the launched subagent", () => {
  let snapshot: AgentToolCall[] = [
    call(
      "call-spawn",
      "spawn_agent",
      "completed",
      { message: "Inspect package.json" },
      { agent_id: "child-thread-uuid", nickname: "Package reader" },
    ),
  ];
  const observer = createCodexPromptToolCallObserver(() => snapshot);
  observer.begin(context);

  snapshot = [
    ...snapshot,
    call(
      "call-wait",
      "wait_agent",
      "completed",
      { ids: ["child-thread-uuid"], timeout_ms: 30_000 },
      { status: { "child-thread-uuid": { completed: "PACKAGE_OK" } } },
    ),
  ];

  assert.deepEqual(observer.poll(context), [{
    type: "tool-call",
    toolCall: {
      id: "call-wait",
      commandId: "call-wait",
      kind: "subagent",
      title: "Inspect package.json",
      status: "completed",
      input: JSON.stringify({ ids: ["child-thread-uuid"], timeout_ms: 30_000 }),
      output: "PACKAGE_OK",
      subagentOperation: {
        action: "wait",
        targets: [{ id: "child-thread-uuid", label: "Inspect package.json" }],
      },
      timestamp: "2026-07-14T11:17:27.959Z",
      updatedAt: "2026-07-14T11:17:53.962Z",
    },
  }]);
});

test("Codex prompt observer extracts object-shaped wait targets", () => {
  let snapshot: AgentToolCall[] = [
    call(
      "call-spawn-object-target",
      "spawn_agent",
      "completed",
      { message: "Inspect package.json" },
      { agent_id: "child-thread-object", nickname: "Package reader" },
    ),
  ];
  const observer = createCodexPromptToolCallObserver(() => snapshot);
  observer.begin(context);

  snapshot = [
    ...snapshot,
    call(
      "call-wait-object-target",
      "wait_agent",
      "completed",
      { ids: [{ id: "child-thread-object" }] },
      { status: { "child-thread-object": { completed: "PACKAGE_OK" } } },
    ),
  ];

  assert.deepEqual(observer.poll(context), [{
    type: "tool-call",
    toolCall: {
      id: "call-wait-object-target",
      commandId: "call-wait-object-target",
      kind: "subagent",
      title: "Inspect package.json",
      status: "completed",
      input: JSON.stringify({ ids: [{ id: "child-thread-object" }] }),
      output: "PACKAGE_OK",
      subagentOperation: {
        action: "wait",
        targets: [{ id: "child-thread-object", label: "Inspect package.json" }],
      },
      timestamp: "2026-07-14T11:17:27.959Z",
      updatedAt: "2026-07-14T11:17:53.962Z",
    },
  }]);
});
