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
  operationEvent?: AgentToolCall["subagentOperation"];
}): ToolEvidence[] {
  return [{
    source: "provider-structured",
    strength: 500,
    kind: "subagent",
    title: args.title ?? "Delegate task",
    status: args.terminal ? "completed" : "running",
    subagentOperation: args.operationEvent,
    subagent: {
      action: args.action,
      entityIds: args.entityIds ?? [],
      batch: args.batch ?? false,
      terminal: args.terminal ?? false,
      background: args.background ?? false,
    },
  }];
}

test("Codex wait updates reuse the spawned entity identity", () => {
  const sessionId = "recognition-codex-operations";
  const spawn = recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({ id: "spawn-call", status: "completed" }),
    }),
    subagentEvidence({
      action: "spawn",
      entityIds: ["spawn-call"],
      terminal: true,
      operationEvent: {
        action: "spawn",
        targets: [{ id: "spawn-call", label: "Cicero" }],
      },
    }),
  ).toolCalls;
  const spawnUpdate = recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({
        id: "spawn-call",
        status: "completed",
        input: JSON.stringify({ prompt: "Inspect the adapter" }),
      }),
    }),
    subagentEvidence({
      action: "spawn",
      entityIds: ["agent-1"],
      terminal: true,
      operationEvent: {
        action: "spawn",
        targets: [{ id: "agent-1", label: "Cicero" }],
      },
    }),
  ).toolCalls;
  const wait = recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({ id: "wait-call", status: "completed", output: "done" }),
    }),
    subagentEvidence({
      action: "wait",
      entityIds: ["agent-1"],
      terminal: true,
      operationEvent: {
        action: "wait",
        targets: [{ id: "agent-1", label: "Cicero" }],
      },
    }),
  ).toolCalls;

  assert.deepEqual(
    [...spawn, ...spawnUpdate, ...wait].map((call) => [
      call.id,
      call.status,
      call.subagentOperation?.action,
    ]),
    [
      ["spawn-call", "running", "spawn"],
      ["spawn-call", "running", "spawn"],
      ["spawn-call", "completed", "wait"],
    ],
  );
  assert.equal(wait[0]?.output, "done");
  disposeToolRecognitionSession("codex", sessionId);
});

test("Codex close updates reuse a running spawned entity", () => {
  const sessionId = "recognition-codex-close";
  recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({ id: "spawn-call", status: "completed" }),
    }),
    subagentEvidence({
      action: "spawn",
      entityIds: ["agent-1"],
      terminal: true,
      operationEvent: { action: "spawn", targets: [{ id: "agent-1" }] },
    }),
  );
  const [closed] = recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({
        id: "close-call",
        status: "completed",
        output: JSON.stringify({ previous_status: { running: "still active" } }),
      }),
    }),
    subagentEvidence({
      action: "cancel",
      entityIds: ["agent-1"],
      terminal: true,
      operationEvent: { action: "close", targets: [{ id: "agent-1" }] },
    }),
  ).toolCalls;
  assert.equal(closed?.id, "spawn-call");
  assert.equal(closed?.status, "cancelled");
  assert.equal(closed?.subagentOperation?.action, "close");
  disposeToolRecognitionSession("codex", sessionId);
});

test("Codex close reuses a completed entity after wait", () => {
  const sessionId = "recognition-codex-close-after-wait";
  const operation = (action: "spawn" | "wait" | "close", id: string) => ({
    action,
    targets: [{ id }],
  });
  recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({ id: "spawn-call", status: "completed" }),
    }),
    subagentEvidence({
      action: "spawn",
      entityIds: ["agent-1"],
      terminal: true,
      operationEvent: operation("spawn", "agent-1"),
    }),
  );
  const [wait] = recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({ id: "wait-call", status: "completed", output: "done" }),
    }),
    subagentEvidence({
      action: "wait",
      entityIds: ["agent-1"],
      terminal: true,
      operationEvent: operation("wait", "agent-1"),
    }),
  ).toolCalls;
  assert.equal(wait?.id, "spawn-call");
  assert.equal(wait?.status, "completed");

  const [closed] = recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({ id: "close-call", status: "completed" }),
    }),
    subagentEvidence({
      action: "cancel",
      entityIds: ["agent-1"],
      terminal: true,
      operationEvent: operation("close", "agent-1"),
    }),
  ).toolCalls;
  assert.equal(closed?.id, "spawn-call");
  assert.equal(closed?.status, "cancelled");
  disposeToolRecognitionSession("codex", sessionId);
});

test("Codex wait keeps an unrecognized target as an independent operation", () => {
  const sessionId = "recognition-codex-unmatched-wait";
  const [waiting] = recognizeToolObservation(
    createToolObservation({
      providerId: "codex",
      sessionId,
      toolCall: toolCall({ id: "wait-call", status: "completed", output: "done" }),
    }),
    subagentEvidence({
      action: "wait",
      entityIds: ["unknown-agent"],
      terminal: true,
      operationEvent: { action: "wait", targets: [{ id: "unknown-agent" }] },
    }),
  ).toolCalls;
  assert.equal(waiting?.id, "wait-call");
  assert.equal(waiting?.subagentOperation?.action, "wait");
  disposeToolRecognitionSession("codex", sessionId);
});

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

test("common lifecycle returns a completed entity to the running set when messaged", () => {
  const sessionId = "recognition-resumed-lifecycle";
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "spawn-call" }),
    }),
    subagentEvidence({ action: "spawn", entityIds: ["agent-1"], background: true }),
  );
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "spawn-call", status: "completed" }),
    }),
    subagentEvidence({ action: "result", entityIds: ["agent-1"], terminal: true }),
  );

  const [continued] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "message-call", status: "completed" }),
    }),
    subagentEvidence({ action: "message", entityIds: ["agent-1"] }),
  ).toolCalls;
  assert.equal(continued?.id, "spawn-call");
  assert.equal(continued?.status, "running");

  const [anonymousWait] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "wait-call" }),
    }),
    subagentEvidence({ action: "wait" }),
  ).toolCalls;
  assert.equal(anonymousWait?.id, "spawn-call");

  const [completedViaMessageAlias] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "message-call", status: "completed" }),
    }),
    subagentEvidence({ action: "result", terminal: true }),
  ).toolCalls;
  assert.equal(completedViaMessageAlias?.id, "spawn-call");
  assert.equal(completedViaMessageAlias?.status, "completed");
  disposeToolRecognitionSession("claude", sessionId);
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
    { expected: "read", title: "file", update: { rawInput: { relativePath: "src/index.ts" } } },
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

test("a reused subagent task id does not update the completed prior invocation", () => {
  const sessionId = "recognition-reused-subagent-task-id";
  const spawn = (
    id: string,
    title: string,
    status: AgentToolCall["status"],
    commandId?: string,
  ) =>
    recognizeToolObservation(
      createToolObservation({
        providerId: "opencode",
        sessionId,
        toolCall: toolCall({
          id,
          title,
          status,
          ...(commandId ? { commandId } : {}),
        }),
      }),
      subagentEvidence({
        action: "spawn",
        entityIds: ["reused-task"],
        terminal: false,
        title,
      }),
    ).toolCalls[0];

  const first = spawn(
    "first-invocation",
    "Sisyphus-Junior",
    "running",
    "subagent:reused-task",
  );
  assert.equal(first?.id, "first-invocation");

  const firstResult = recognizeToolObservation(
    createToolObservation({
      providerId: "opencode",
      sessionId,
      toolCall: toolCall({
        id: "first-result",
        title: "Sisyphus-Junior",
        status: "completed",
        commandId: "subagent:reused-task",
      }),
    }),
    subagentEvidence({
      action: "result",
      entityIds: ["reused-task"],
      terminal: true,
      title: "Sisyphus-Junior",
    }),
  ).toolCalls[0];
  assert.equal(firstResult?.id, "first-invocation");
  assert.equal(firstResult?.status, "completed");

  const current = spawn("current-invocation", "task", "running");
  assert.equal(current?.id, "current-invocation");
  assert.equal(current?.title, "task");

  const currentResult = recognizeToolObservation(
    createToolObservation({
      providerId: "opencode",
      sessionId,
      toolCall: toolCall({
        id: "current-result",
        title: "Sisyphus-Junior",
        status: "completed",
        commandId: "subagent:reused-task",
      }),
    }),
    subagentEvidence({
      action: "result",
      entityIds: ["reused-task"],
      terminal: true,
      title: "Sisyphus-Junior",
    }),
  ).toolCalls[0];

  assert.equal(currentResult?.id, "current-invocation");
  assert.equal(currentResult?.title, "Sisyphus-Junior");
  assert.equal(currentResult?.status, "completed");
  disposeToolRecognitionSession("opencode", sessionId);
});

test("a reused subagent task id keeps a running prior invocation separate", () => {
  const sessionId = "recognition-reused-running-subagent-task-id";
  const spawn = (id: string, title: string) =>
    recognizeToolObservation(
      createToolObservation({
        providerId: "opencode",
        sessionId,
        toolCall: toolCall({
          id,
          title,
          status: "running",
          commandId: "subagent:reused-task",
        }),
      }),
      subagentEvidence({
        action: "spawn",
        entityIds: ["reused-task"],
        title,
      }),
    ).toolCalls[0];

  const first = spawn("first-running-invocation", "Sisyphus-Junior");
  const second = spawn("second-running-invocation", "task");
  assert.equal(first?.id, "first-running-invocation");
  assert.equal(second?.id, "second-running-invocation");

  const firstUpdate = recognizeToolObservation(
    createToolObservation({
      providerId: "opencode",
      sessionId,
      toolCall: toolCall({
        id: "first-running-invocation",
        title: "Sisyphus-Junior",
        status: "running",
        commandId: "subagent:reused-task",
      }),
    }),
    subagentEvidence({
      action: "message",
      entityIds: ["reused-task"],
      title: "Sisyphus-Junior",
    }),
  ).toolCalls[0];
  assert.equal(firstUpdate?.id, "first-running-invocation");
  assert.equal(firstUpdate?.status, "running");

  const secondResult = recognizeToolObservation(
    createToolObservation({
      providerId: "opencode",
      sessionId,
      toolCall: toolCall({
        id: "second-running-invocation",
        title: "Sisyphus-Junior",
        status: "completed",
        commandId: "subagent:reused-task",
      }),
    }),
    subagentEvidence({
      action: "result",
      entityIds: ["reused-task"],
      terminal: true,
      title: "Sisyphus-Junior",
    }),
  ).toolCalls[0];
  assert.equal(secondResult?.id, "second-running-invocation");
  assert.equal(secondResult?.status, "completed");
  disposeToolRecognitionSession("opencode", sessionId);
});

test("concurrent OpenCode results with new provider ids reuse matching prompts", () => {
  const sessionId = "recognition-opencode-concurrent-results";
  const spawn = (id: string, prompt: string) =>
    recognizeToolObservation(
      createToolObservation({
        providerId: "opencode",
        sessionId,
        toolCall: toolCall({
          id,
          title: "explore",
          status: "running",
          input: JSON.stringify({
            category: "explore",
            description: prompt,
            run_in_background: true,
          }),
        }),
      }),
      subagentEvidence({
        action: "spawn",
        background: true,
        title: "explore",
      }),
    ).toolCalls[0];

  const first = spawn("first-root", "Find topic subscription setup");
  const second = spawn("second-root", "Trace session status update flow");

  const complete = (id: string, prompt: string, taskId: string) =>
    recognizeToolObservation(
      createToolObservation({
        providerId: "opencode",
        sessionId,
        toolCall: toolCall({
          id,
          title: "explore",
          status: "completed",
          commandId: `subagent:${taskId}`,
          input: JSON.stringify({
            category: "explore",
            prompt,
          }),
        }),
      }),
      subagentEvidence({
        action: "result",
        entityIds: [taskId],
        terminal: true,
        title: "explore",
      }),
    ).toolCalls[0];

  const firstResult = complete(
    "first-result",
    "Find topic subscription setup",
    "first-child",
  );
  const secondResult = complete(
    "second-result",
    "Trace session status update flow",
    "second-child",
  );

  assert.equal(first?.id, "first-root");
  assert.equal(second?.id, "second-root");
  assert.equal(firstResult?.id, "first-root");
  assert.equal(secondResult?.id, "second-root");
  assert.equal(firstResult?.status, "completed");
  assert.equal(secondResult?.status, "completed");
  disposeToolRecognitionSession("opencode", sessionId);
});

test("concurrent OpenCode spawn updates with new provider ids reuse matching prompts", () => {
  const sessionId = "recognition-opencode-concurrent-spawn-updates";
  const spawn = (id: string, prompt: string) =>
    recognizeToolObservation(
      createToolObservation({
        providerId: "opencode",
        sessionId,
        toolCall: toolCall({
          id,
          title: "explore",
          status: "running",
          input: JSON.stringify({
            category: "explore",
            description: prompt,
            run_in_background: true,
          }),
        }),
      }),
      subagentEvidence({
        action: "spawn",
        background: true,
        title: "explore",
      }),
    ).toolCalls[0];

  const first = spawn("first-root", "Find topic subscription setup");
  const second = spawn("second-root", "Trace session status update flow");

  const update = (id: string, prompt: string, taskId: string) =>
    recognizeToolObservation(
      createToolObservation({
        providerId: "opencode",
        sessionId,
        toolCall: toolCall({
          id,
          title: "explore",
          status: "running",
          commandId: `subagent:${taskId}`,
          input: JSON.stringify({
            category: "explore",
            prompt,
          }),
        }),
      }),
      subagentEvidence({
        action: "spawn",
        entityIds: [taskId],
        background: true,
        title: "explore",
      }),
    ).toolCalls[0];

  const firstUpdate = update(
    "first-update",
    "Find topic subscription setup",
    "first-child",
  );
  const secondUpdate = update(
    "second-update",
    "Trace session status update flow",
    "second-child",
  );

  assert.equal(first?.id, "first-root");
  assert.equal(second?.id, "second-root");
  assert.equal(firstUpdate?.id, "first-root");
  assert.equal(secondUpdate?.id, "second-root");
  assert.equal(firstUpdate?.status, "running");
  assert.equal(secondUpdate?.status, "running");
  disposeToolRecognitionSession("opencode", sessionId);
});

test("concurrent OpenCode results with the same prompt stay unmerged", () => {
  const sessionId = "recognition-opencode-ambiguous-prompt-results";
  const spawn = (id: string) =>
    recognizeToolObservation(
      createToolObservation({
        providerId: "opencode",
        sessionId,
        toolCall: toolCall({
          id,
          title: "explore",
          status: "running",
          input: JSON.stringify({
            category: "explore",
            description: "Inspect the current implementation",
            run_in_background: true,
          }),
        }),
      }),
      subagentEvidence({
        action: "spawn",
        background: true,
        title: "explore",
      }),
    ).toolCalls[0];

  spawn("first-root");
  spawn("second-root");

  const [result] = recognizeToolObservation(
    createToolObservation({
      providerId: "opencode",
      sessionId,
      toolCall: toolCall({
        id: "result-call",
        title: "explore",
        status: "completed",
        input: JSON.stringify({
          category: "explore",
          prompt: "Inspect the current implementation",
        }),
      }),
    }),
    subagentEvidence({
      action: "result",
      terminal: true,
      title: "explore",
    }),
  ).toolCalls;

  assert.equal(result?.id, "result-call");
  assert.equal(result?.status, "completed");
  disposeToolRecognitionSession("opencode", sessionId);
});

test("a background launch result with a different tool id reuses the only unidentified spawn", () => {
  const sessionId = "recognition-background-launch-result";
  const initial = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({ id: "call-agent", status: "running" }),
  });
  const [spawned] = recognizeToolObservation(
    initial,
    subagentEvidence({ action: "spawn", background: true }),
  ).toolCalls;

  const launchResult = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({
      id: "stale-provider-id",
      status: "running",
      output: "Async agent launched successfully.",
    }),
  });
  const [linked] = recognizeToolObservation(
    launchResult,
    subagentEvidence({
      action: "spawn",
      background: true,
      entityIds: ["agent-1"],
    }),
  ).toolCalls;

  assert.equal(spawned?.id, "call-agent");
  assert.equal(linked?.id, "call-agent");
  assert.equal(linked?.commandId, "subagent:agent-1");
  disposeToolRecognitionSession("claude", sessionId);
});

test("a stale provider id cannot replace an established subagent identity", () => {
  const sessionId = "recognition-stale-provider-identity";
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "stale-provider-id" }),
    }),
    subagentEvidence({ action: "spawn", entityIds: ["old-agent"], background: true }),
  );
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "stale-provider-id", status: "completed" }),
    }),
    subagentEvidence({ action: "result", entityIds: ["old-agent"], terminal: true }),
  );
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "current-call", status: "running" }),
    }),
    subagentEvidence({ action: "spawn", background: true }),
  );

  const [linked] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({
        id: "stale-provider-id",
        status: "running",
        output: "Async agent launched successfully.",
      }),
    }),
    subagentEvidence({
      action: "spawn",
      background: true,
      entityIds: ["current-agent"],
    }),
  ).toolCalls;
  assert.equal(linked?.id, "current-call");
  assert.equal(linked?.commandId, "subagent:current-agent");

  const [oldCompletion] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "stale-provider-id", status: "completed" }),
    }),
    subagentEvidence({ action: "result", entityIds: ["old-agent"], terminal: true }),
  ).toolCalls;
  assert.equal(oldCompletion?.id, "stale-provider-id");
  assert.equal(oldCompletion?.commandId, "subagent:old-agent");
  disposeToolRecognitionSession("claude", sessionId);
});

test("a terminal result with a conflicting provider id stays separate", () => {
  const sessionId = "recognition-conflicting-terminal-id";
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "reused-call" }),
    }),
    subagentEvidence({ action: "spawn", entityIds: ["old-agent"], background: true }),
  );
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "reused-call", status: "completed" }),
    }),
    subagentEvidence({ action: "result", entityIds: ["old-agent"], terminal: true }),
  );

  const [conflictingResult] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "reused-call", status: "completed" }),
    }),
    subagentEvidence({ action: "result", entityIds: ["new-agent"], terminal: true }),
  ).toolCalls;
  assert.notEqual(conflictingResult?.id, "reused-call");
  assert.equal(conflictingResult?.commandId, "subagent:new-agent");
  assert.equal(conflictingResult?.status, "completed");
  disposeToolRecognitionSession("claude", sessionId);
});

test("an ambiguous launch result waits for a transcript identity instead of creating a duplicate", () => {
  const sessionId = "recognition-ambiguous-background-launch-result";
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "stale-provider-id" }),
    }),
    subagentEvidence({ action: "spawn", entityIds: ["old-agent"], background: true }),
  );
  recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "stale-provider-id", status: "completed" }),
    }),
    subagentEvidence({ action: "result", entityIds: ["old-agent"], terminal: true }),
  );
  for (const id of ["call-agent-1", "call-agent-2"]) {
    recognizeToolObservation(
      createToolObservation({
        providerId: "claude",
        sessionId,
        toolCall: toolCall({ id, status: "running" }),
      }),
      subagentEvidence({ action: "spawn", background: true }),
    );
  }

  const ambiguous = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({
        id: "stale-provider-id",
        status: "running",
        output: "Async agent launched successfully.",
      }),
    }),
    subagentEvidence({
      action: "spawn",
      background: true,
      entityIds: ["agent-1"],
    }),
  ).toolCalls;

  assert.equal(ambiguous.length, 0);

  const [completed] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({
        id: "call-agent-1",
        commandId: "subagent:agent-1",
        status: "completed",
      }),
    }),
    subagentEvidence({
      action: "result",
      entityIds: ["agent-1"],
      terminal: true,
    }),
  ).toolCalls;
  assert.equal(completed?.id, "call-agent-1");
  assert.equal(completed?.commandId, "subagent:agent-1");
  assert.equal(completed?.status, "completed");

  const [oldCompletion] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({ id: "stale-provider-id", status: "completed" }),
    }),
    subagentEvidence({ action: "result", entityIds: ["old-agent"], terminal: true }),
  ).toolCalls;
  assert.equal(oldCompletion?.id, "stale-provider-id");
  assert.equal(oldCompletion?.commandId, "subagent:old-agent");
  disposeToolRecognitionSession("claude", sessionId);
});

test("a streaming spawn whose input grows keeps a single entity identity", () => {
  const sessionId = "recognition-streaming-spawn-input";
  const [initial] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({
        id: "call-task",
        status: "running",
        input: '{"description":"Reuse review","subagent_type":"Explore"}',
      }),
    }),
    subagentEvidence({ action: "spawn" }),
  ).toolCalls;
  assert.equal(initial?.id, "call-task");

  const [streamed] = recognizeToolObservation(
    createToolObservation({
      providerId: "claude",
      sessionId,
      toolCall: toolCall({
        id: "call-task",
        status: "running",
        input: '{"description":"Reuse review","subagent_type":"Explore","prompt":"Review the diff"}',
      }),
    }),
    subagentEvidence({ action: "spawn" }),
  ).toolCalls;
  assert.equal(streamed?.id, "call-task");
  disposeToolRecognitionSession("claude", sessionId);
});

test("a Claude background spawn closes on its transcript task notification", () => {
  const sessionId = "recognition-claude-background-completion";
  const spawn = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({ id: "call-agent", status: "running" }),
  });
  recognizeToolObservation(
    spawn,
    subagentEvidence({ action: "spawn", background: true }),
  );

  const launchResult = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({
      id: "stale-provider-id",
      status: "running",
      output: "Async agent launched successfully.",
    }),
  });
  recognizeToolObservation(
    launchResult,
    subagentEvidence({
      action: "spawn",
      background: true,
      entityIds: ["agent-1"],
    }),
  );

  const completion = createToolObservation({
    providerId: "claude",
    sessionId,
    toolCall: toolCall({
      id: "call-agent",
      commandId: "subagent:agent-1",
      kind: "subagent",
      status: "completed",
      output: "SUBAGENT_DONE",
    }),
  });
  const [completed] = recognizeToolObservation(
    completion,
    subagentEvidence({
      action: "result",
      entityIds: ["agent-1"],
      terminal: true,
    }),
  ).toolCalls;

  assert.equal(completed?.id, "call-agent");
  assert.equal(completed?.commandId, "subagent:agent-1");
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output, "SUBAGENT_DONE");
  disposeToolRecognitionSession("claude", sessionId);
});
