import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import {
  createToolObservation,
  disposeToolRecognitionSession,
  recognizeToolObservation,
  type SubagentAction,
  type ToolEvidence,
} from "./index";

function toolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: "call-1",
    kind: "unknown",
    title: "Tool call",
    status: "completed",
    timestamp: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

function subagentEvidence(args: {
  action: SubagentAction;
  entityIds?: string[];
  batch?: boolean;
  terminal?: boolean;
  background?: boolean;
  title?: string;
}): ToolEvidence[] {
  return [{
    source: "provider-structured",
    strength: 500,
    kind: "subagent",
    title: args.title ?? "Delegate task",
    status: args.terminal ? "completed" : "running",
    subagent: {
      action: args.action,
      entityIds: args.entityIds ?? [],
      batch: args.batch ?? false,
      terminal: args.terminal ?? false,
      background: args.background ?? false,
    },
  }];
}

test("common lifecycle keeps spawned entities running and reuses their identity", () => {
  const sessionId = "recognition-lifecycle";
  const spawn = createToolObservation({
    providerId: "codex",
    sessionId,
    toolCall: toolCall({ id: "spawn-call", output: '{"agent_id":"agent-1"}' }),
    update: { rawOutput: { agent_id: "agent-1" } },
  });
  const [spawned] = recognizeToolObservation(spawn, subagentEvidence({
    action: "spawn",
    entityIds: ["agent-1"],
  })).toolCalls;
  assert.equal(spawned?.status, "running");
  assert.equal(spawned?.commandId, "subagent:agent-1");

  const message = createToolObservation({
    providerId: "codex",
    sessionId,
    toolCall: toolCall({ id: "message-call", status: "completed" }),
    update: { rawInput: { agent_id: "agent-1", message: "continue" } },
  });
  const [continued] = recognizeToolObservation(message, subagentEvidence({
    action: "message",
    entityIds: ["agent-1"],
  })).toolCalls;
  assert.equal(continued?.id, "spawn-call");
  assert.equal(continued?.status, "running");

  const wait = createToolObservation({
    providerId: "codex",
    sessionId,
    toolCall: toolCall({ id: "wait-call", output: "timed out; agent still running" }),
    update: { rawInput: { agent_id: "agent-1" }, rawOutput: "timed out; agent still running" },
  });
  const [waiting] = recognizeToolObservation(wait, subagentEvidence({
    action: "wait",
    entityIds: ["agent-1"],
  })).toolCalls;
  assert.equal(waiting?.id, "spawn-call");
  assert.equal(waiting?.status, "running");

  const result = createToolObservation({
    providerId: "codex",
    sessionId,
    toolCall: toolCall({ id: "result-call", output: "done" }),
    update: { rawInput: { agent_id: "agent-1" }, rawOutput: "done" },
  });
  const [completed] = recognizeToolObservation(result, subagentEvidence({
    action: "result",
    entityIds: ["agent-1"],
    terminal: true,
  })).toolCalls;
  assert.equal(completed?.id, "spawn-call");
  assert.equal(completed?.status, "completed");
  const [replayedCompletion] = recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({ id: "result-call-replay", output: "done" }),
      update: { rawInput: { agent_id: "agent-1" }, rawOutput: "done" },
    }),
    subagentEvidence({
      action: "result",
      entityIds: ["agent-1"],
      terminal: true,
    }),
  ).toolCalls;
  assert.equal(replayedCompletion?.id, "spawn-call");
  assert.equal(replayedCompletion?.status, "completed");
  disposeToolRecognitionSession("codex", sessionId);
});

test("common lifecycle expands batch delegation with stable entity ids", () => {
  const observation = createToolObservation({
    providerId: "codex",
    sessionId: "recognition-batch",
    toolCall: toolCall({ id: "batch-root" }),
  });
  const calls = recognizeToolObservation(observation, subagentEvidence({
    action: "spawn",
    entityIds: ["agent-a", "agent-b"],
    batch: true,
  })).toolCalls;
  assert.deepEqual(calls.map((call) => call.id), ["batch-root::agent-a", "batch-root::agent-b"]);
  assert.deepEqual(calls.map((call) => call.commandId), ["subagent:agent-a", "subagent:agent-b"]);
  disposeToolRecognitionSession("codex", "recognition-batch");
});

test("common lifecycle keeps multiple aliases on one spawned entity", () => {
  const sessionId = "recognition-aliases";
  const observation = createToolObservation({
    providerId: "opencode",
    sessionId,
    toolCall: toolCall({ id: "alias-root" }),
  });
  const calls = recognizeToolObservation(observation, subagentEvidence({
    action: "spawn",
    entityIds: ["ses_child", "bg_task"],
  })).toolCalls;

  assert.deepEqual(calls.map((call) => call.id), ["alias-root"]);
  assert.deepEqual(calls.map((call) => call.commandId), ["subagent:ses_child"]);

  const [completed] = recognizeToolObservation(
    createToolObservation({
      providerId: "opencode",
      sessionId,
      toolCall: toolCall({ id: "result-call", output: "done" }),
    }),
    subagentEvidence({
      action: "result",
      entityIds: ["bg_task"],
      terminal: true,
    }),
  ).toolCalls;
  assert.equal(completed?.id, "alias-root");
  assert.equal(completed?.status, "completed");
  disposeToolRecognitionSession("opencode", sessionId);
});

test("dispose removes lifecycle aliases before a session id is reused", () => {
  const sessionId = "recognition-dispose";
  const spawn = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({ id: "old-root" }),
  });
  recognizeToolObservation(spawn, subagentEvidence({ action: "spawn", entityIds: ["task-1"] }));
  disposeToolRecognitionSession("claude", sessionId);

  const update = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({ id: "new-call" }),
  });
  const [call] = recognizeToolObservation(update, subagentEvidence({ action: "message", entityIds: ["task-1"] })).toolCalls;
  assert.equal(call?.id, "new-call");
  disposeToolRecognitionSession("claude", sessionId);
});

test("generic recognition does not infer subagents from bare provider words", () => {
  for (const title of ["Task", "Agent", "SendMessage", "list_agents"]) {
    const observation = createToolObservation({
      sessionId: `generic-${title}`,
      toolCall: toolCall({ id: title, title }),
    });
    const [recognized] = recognizeToolObservation(observation).toolCalls;
    assert.notEqual(recognized?.kind, "subagent");
    if (title === "list_agents") assert.notEqual(recognized?.kind, "read");
  }
});

test("text heuristics cannot override an explicit ACP kind", () => {
  const observation = createToolObservation({
    sessionId: "explicit-kind",
    toolCall: toolCall({ kind: "shell", title: "grep source" }),
  });
  const [recognized] = recognizeToolObservation(observation).toolCalls;
  assert.equal(recognized?.kind, "shell");
});

test("provider-neutral structured observations classify common tool semantics consistently", () => {
  const fixtures: Array<{
    expected: AgentToolCall["kind"];
    title: string;
    update: unknown;
  }> = [
    { expected: "shell", title: "run", update: { rawInput: { command: "pnpm test" } } },
    { expected: "search", title: "find", update: { rawInput: { search_string: "tool lifecycle" } } },
    { expected: "read", title: "file", update: { rawInput: { path: "src/index.ts" } } },
    { expected: "write", title: "file", update: { rawInput: { path: "src/index.ts", content: "next" } } },
    { expected: "skill", title: "skill", update: { rawInput: { skillName: "review" } } },
    {
      expected: "mcp",
      title: "call",
      update: { rawInput: { server: "repo", tool: "inspect", arguments: { path: "." } } },
    },
  ];
  for (const providerId of ["codex", "claude", "opencode", "generic"]) {
    for (const [index, fixture] of fixtures.entries()) {
      const observation = createToolObservation({
        providerId,
        sessionId: `matrix-${providerId}-${index}`,
        toolCall: toolCall({ id: `${providerId}-${index}`, title: fixture.title }),
        update: fixture.update,
      });
      const [recognized] = recognizeToolObservation(observation).toolCalls;
      assert.equal(recognized?.kind, fixture.expected, `${providerId}:${fixture.expected}`);
      disposeToolRecognitionSession(providerId, `matrix-${providerId}-${index}`);
    }
  }
});

test("MCP descriptors take precedence over generic query and path fields", () => {
  const observation = createToolObservation({
    sessionId: "mcp-precedence",
    toolCall: toolCall({ title: "inspect" }),
    update: {
      rawInput: {
        server: "repository",
        tool: "inspect",
        arguments: { query: "symbols", path: "src" },
      },
    },
  });
  const [recognized] = recognizeToolObservation(observation).toolCalls;
  assert.equal(recognized?.kind, "mcp");
  assert.equal(recognized?.mcp?.serverName, "repository");
});

test("temporary subagent identity keeps its historical id when a later update supplies an entity id", () => {
  const sessionId = "recognition-temporary-identity";
  const spawn = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({ id: "temporary-root", status: "running" }),
  });
  const [temporary] = recognizeToolObservation(
    spawn,
    subagentEvidence({ action: "spawn" }),
  ).toolCalls;
  assert.equal(temporary?.id, "temporary-root");
  assert.equal(temporary?.commandId, undefined);

  const message = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({ id: "message-call" }),
    update: { rawInput: { agent_id: "agent-later", message: "continue" } },
  });
  const [linked] = recognizeToolObservation(
    message,
    subagentEvidence({ action: "message", entityIds: ["agent-later"] }),
  ).toolCalls;
  assert.equal(linked?.id, "temporary-root");
  assert.equal(linked?.commandId, "subagent:agent-later");
  disposeToolRecognitionSession("claude", sessionId);
});
