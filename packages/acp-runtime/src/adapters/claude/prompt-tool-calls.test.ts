import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { createClaudePromptToolCallObserver } from "./prompt-tool-calls";

const context = {
  runtimeSessionId: "runtime-claude-1",
  cwd: "D:/repo",
};

function shell(
  id: string,
  status: AgentToolCall["status"],
  output?: string,
): AgentToolCall {
  return {
    id,
    kind: "shell",
    title: "node -e \"console.log('CLAUDE_TITLE_OK')\"",
    status,
    input: JSON.stringify({ command: "node -e \"console.log('CLAUDE_TITLE_OK')\"" }),
    ...(output ? { output } : {}),
    timestamp: "2026-07-14T15:19:26.795Z",
    updatedAt: status === "running"
      ? "2026-07-14T15:19:26.795Z"
      : "2026-07-14T15:19:29.453Z",
    sequence: 77,
  };
}

test("Claude prompt observer baselines existing transcript tools without replaying them", () => {
  let snapshot: AgentToolCall[] = [
    shell("old-shell", "completed", "OLD"),
    {
      ...shell("old-subagent", "completed", "SCAN"),
      kind: "subagent",
      title: "Explore",
    },
  ];
  const observer = createClaudePromptToolCallObserver(() => snapshot);

  observer.begin(context);
  assert.deepEqual(observer.poll(context), []);

  snapshot = [...snapshot, shell("call-shell", "running")];
  assert.deepEqual(observer.poll(context), [
    {
      type: "tool-call",
      toolCall: {
        id: "call-shell",
        kind: "shell",
        title: "node -e \"console.log('CLAUDE_TITLE_OK')\"",
        status: "running",
        input: JSON.stringify({ command: "node -e \"console.log('CLAUDE_TITLE_OK')\"" }),
        timestamp: "2026-07-14T15:19:26.795Z",
        updatedAt: "2026-07-14T15:19:26.795Z",
      },
    },
  ]);

  snapshot = [
    snapshot[0]!,
    snapshot[1]!,
    shell("call-shell", "completed", "CLAUDE_TITLE_OK"),
  ];
  const completed = observer.poll(context);
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.type, "tool-call");
  assert.equal(
    completed[0]?.type === "tool-call" ? completed[0].toolCall.title : "",
    "node -e \"console.log('CLAUDE_TITLE_OK')\"",
  );
  assert.equal(
    completed[0]?.type === "tool-call" ? completed[0].toolCall.output : "",
    "CLAUDE_TITLE_OK",
  );
});

test("Claude prompt observer exposes running subagents and ignores opaque shell rows", () => {
  let snapshot: AgentToolCall[] = [];
  const observer = createClaudePromptToolCallObserver(() => snapshot);
  observer.begin(context);

  snapshot = [
    { ...shell("opaque", "completed"), title: "Tool call call_123" },
    {
      ...shell("subagent", "running"),
      kind: "subagent",
      title: "Claude lifecycle purpose",
      input: JSON.stringify({ description: "Claude lifecycle purpose" }),
      output: undefined,
    },
  ];
  assert.deepEqual(observer.poll(context), [
    {
      type: "tool-call",
      toolCall: {
        id: "subagent",
        kind: "subagent",
        title: "Claude lifecycle purpose",
        status: "running",
        input: JSON.stringify({ description: "Claude lifecycle purpose" }),
        output: undefined,
        timestamp: "2026-07-14T15:19:26.795Z",
        updatedAt: "2026-07-14T15:19:26.795Z",
      },
    },
  ]);
});

test("Claude prompt observer emits only the latest state for a repeated tool id", () => {
  let snapshot: AgentToolCall[] = [];
  const observer = createClaudePromptToolCallObserver(() => snapshot);
  observer.begin(context);

  snapshot = [
    {
      ...shell("subagent", "running"),
      kind: "subagent",
      title: "Delegate task",
    },
    {
      ...shell("subagent", "completed", "SUBAGENT_DONE"),
      commandId: "subagent:agent-1",
      kind: "subagent",
      title: "Subagent",
    },
  ];

  const events = observer.poll(context);
  assert.equal(events.length, 1);
  assert.equal(
    events[0]?.type === "tool-call" ? events[0].toolCall.status : undefined,
    "completed",
  );
  assert.deepEqual(observer.poll(context), []);
});

test("Claude prompt observer preserves a background completion that arrives between prompts", () => {
  let snapshot: AgentToolCall[] = [
    {
      ...shell("subagent", "running"),
      commandId: "subagent:agent-1",
      kind: "subagent",
      title: "Subagent",
    },
  ];
  const observer = createClaudePromptToolCallObserver(() => snapshot);
  observer.begin(context);

  snapshot = [
    {
      ...shell("subagent", "completed", "SUBAGENT_DONE"),
      commandId: "subagent:agent-1",
      kind: "subagent",
      title: "Subagent",
    },
  ];

  // The next prompt must not take a new baseline and hide this terminal state.
  observer.begin(context);
  const [event] = observer.poll(context);
  assert.equal(event?.type, "tool-call");
  assert.equal(event?.type === "tool-call" ? event.toolCall.status : undefined, "completed");
});
