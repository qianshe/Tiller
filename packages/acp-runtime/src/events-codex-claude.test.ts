import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotificationBatch } from "./runtime";
import { attachTrackedRuntimeEventOrigin, clearRuntimeEventOriginTrackerSession, createRuntimeEventOriginTracker, mapSessionUpdateNotification } from "./events";

test("mapSessionUpdateNotification maps Claude synthetic authentication errors to ACP errors", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const payload = {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-claude-auth-error",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "synthetic-error",
        content: {
          type: "text",
          text: "Failed to authenticate. API Error: 403 \u9884\u6263\u8d39\u989d\u5ea6\u5931\u8d25 (request id: abc123)",
        },
      },
    },
  };

  assert.deepEqual(
    mapSessionUpdateNotificationBatch(payload, { provider, providerId: provider.id }),
    {
      sessionId: "session-claude-auth-error",
      events: [{
        type: "error",
        code: "ACP_AGENT_API_ERROR",
        message: "Failed to authenticate. API Error: 403 \u9884\u6263\u8d39\u989d\u5ea6\u5931\u8d25 (request id: abc123)",
      }],
    },
  );
  const generic = mapSessionUpdateNotificationBatch(payload, { providerId: "generic" });
  assert.equal(generic?.events[0]?.type, "message");
});

test("mapSessionUpdateNotification maps Claude subagent update metadata to runtime origins", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-code-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const updates = [
    {
      sessionUpdate: "tool_call",
      toolCallId: "call-subagent-read",
      title: "Read",
      kind: "read",
      status: "pending",
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "call-subagent-read",
      title: "Read",
      kind: "read",
      status: "completed",
    },
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "child output" },
    },
    {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "child thinking" },
    },
  ];

  for (const [index, update] of updates.entries()) {
    const mapped = mapSessionUpdateNotificationBatch(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: `session-claude-subagent-origin-${index}`,
          update: {
            ...update,
            _meta: {
              claudeCode: {
                parentToolUseId: "call-parent-subagent",
              },
            },
          },
        },
      },
      { provider, providerId: provider.id },
    );

    assert.equal(mapped?.events.length, 1);
    const event = mapped?.events[0];
    assert.ok(event?.type === "message" || event?.type === "tool-call");
    assert.deepEqual(event.origin, {
      scope: "subagent",
      parentToolCallId: "call-parent-subagent",
    });
  }
});

test("Claude failed Think tool calls stay tools instead of becoming reasoning", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-code-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const payload = {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-claude-failed-think-tool",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-failed-think",
        title: "Think",
        status: "failed",
        rawOutput: "[]<tool_use_error>Error: No such tool available: Think</tool_use_error>",
        _meta: {
          claudeCode: {
            parentToolUseId: "call-parent-subagent",
          },
        },
      },
    },
  };
  const mapped = mapSessionUpdateNotification(payload, {
    provider,
    providerId: provider.id,
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "tool");
  assert.equal(mapped.event.toolCall.title, "Think");
  assert.equal(mapped.event.toolCall.status, "failed");
  assert.deepEqual(mapped.event.origin, {
    scope: "subagent",
    parentToolCallId: "call-parent-subagent",
  });

  const generic = mapSessionUpdateNotification(payload, { providerId: "generic" });
  assert.equal(generic?.event.type, "tool-call");
  assert.equal(
    generic?.event.type === "tool-call" ? generic.event.toolCall.kind : undefined,
    "think",
  );
});

test("Claude command output inherits only an explicitly tracked subagent origin", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-code-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const originTracker = createRuntimeEventOriginTracker();
  const explicit = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-command-origin",
      update: {
        type: "command_output",
        commandId: "command-child-1",
        output: "first",
        stream: "stdout",
        _meta: { claudeCode: { parentToolUseId: "root-subagent-1" } },
      },
    },
  }, { provider, providerId: provider.id, originTracker });
  assert.deepEqual(explicit?.events.map((event) => event.type), ["tool-call", "command-output"]);
  assert.ok(explicit?.events.every((event) =>
    (event.type === "tool-call" || event.type === "command-output") &&
    event.origin?.parentToolCallId === "root-subagent-1"
  ));

  const inherited = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-command-origin",
      update: {
        type: "command_output",
        commandId: "command-child-1",
        output: "second",
        stream: "stdout",
      },
    },
  }, { provider, providerId: provider.id, originTracker });
  assert.ok(inherited?.events.every((event) =>
    (event.type === "tool-call" || event.type === "command-output") &&
    event.origin?.parentToolCallId === "root-subagent-1"
  ));

  const unrelated = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-command-origin",
      update: {
        type: "command_output",
        commandId: "command-unrelated",
        output: "main",
        stream: "stdout",
      },
    },
  }, { provider, providerId: provider.id, originTracker });
  assert.ok(unrelated?.events.every((event) =>
    event.type !== "tool-call" && event.type !== "command-output" || event.origin === undefined
  ));

  const otherSession = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-command-origin-other",
      update: {
        type: "command_output",
        commandId: "command-child-1",
        output: "main in another session",
        stream: "stdout",
      },
    },
  }, { provider, providerId: provider.id, originTracker });
  assert.ok(otherSession?.events.every((event) =>
    event.type !== "tool-call" && event.type !== "command-output" || event.origin === undefined
  ));

  clearRuntimeEventOriginTrackerSession(originTracker, "session-command-origin");
  const cleared = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-command-origin",
      update: {
        type: "command_output",
        commandId: "command-child-1",
        output: "after close",
        stream: "stdout",
      },
    },
  }, { provider, providerId: provider.id, originTracker });
  assert.ok(cleared?.events.every((event) =>
    event.type !== "tool-call" && event.type !== "command-output" || event.origin === undefined
  ));
});

test("transcript observer events inherit the exact origin tracked by the ACP tool ID", () => {
  const tracker = createRuntimeEventOriginTracker();
  const mapped = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-transcript-origin",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-child-shell",
        title: "Tool call call-child-shell",
        kind: "shell",
        status: "running",
        _meta: { claudeCode: { parentToolUseId: "call-root-subagent" } },
      },
    },
  }, {
    provider: {
      id: "claudecode",
      name: "ClaudeCode",
      command: "claude-code-acp",
      transport: "stdio",
      protocol: "acp",
    },
    providerId: "claudecode",
    originTracker: tracker,
  });
  assert.equal(mapped?.events[0]?.type, "tool-call");

  const restored = attachTrackedRuntimeEventOrigin(
    "session-transcript-origin",
    {
      type: "tool-call",
      toolCall: {
        id: "call-child-shell",
        kind: "shell",
        title: "git status --short",
        status: "completed",
        timestamp: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:01.000Z",
      },
    },
    tracker,
  );
  assert.ok(restored.type === "tool-call");
  assert.deepEqual(restored.origin, {
    scope: "subagent",
    parentToolCallId: "call-root-subagent",
  });
  assert.equal(
    restored.type === "tool-call" ? restored.toolCall.title : "",
    "git status --short",
  );

  const unrelated = attachTrackedRuntimeEventOrigin(
    "session-transcript-origin",
    {
      type: "tool-call",
      toolCall: {
        id: "call-main-shell",
        kind: "shell",
        title: "git status --short",
        status: "completed",
        timestamp: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:01.000Z",
      },
    },
    tracker,
  );
  assert.ok(unrelated.type === "tool-call");
  assert.equal(unrelated.origin, undefined);
});

test("Claude tool updates inherit origin when commandId appears after the initial tool id", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-code-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const originTracker = createRuntimeEventOriginTracker();
  mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-late-command-id",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-child-1",
        title: "Read",
        kind: "read",
        status: "pending",
        _meta: { claudeCode: { parentToolUseId: "root-subagent-1" } },
      },
    },
  }, { provider, providerId: provider.id, originTracker });

  const inherited = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-late-command-id",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-child-1",
        title: "Read",
        kind: "read",
        status: "completed",
        details: { commandId: "command-child-1" },
      },
    },
  }, { provider, providerId: provider.id, originTracker });

  const inheritedEvent = inherited?.events[0];
  assert.equal(
    inheritedEvent && (inheritedEvent.type === "tool-call" || inheritedEvent.type === "command-output")
      ? inheritedEvent.origin?.parentToolCallId
      : undefined,
    "root-subagent-1",
  );
});

test("mapSessionUpdateNotification does not infer subagent origins without valid Claude metadata", () => {
  const claudeProvider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-code-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const payload = (meta: unknown) => ({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-invalid-subagent-origin",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-read-without-origin",
        title: "Read",
        kind: "read",
        status: "pending",
        ...(meta === undefined ? {} : { _meta: meta }),
      },
    },
  });

  for (const meta of [
    undefined,
    {},
    { claudeCode: {} },
    { claudeCode: { parentToolUseId: "" } },
    { claudeCode: { parentToolUseId: 42 } },
  ]) {
    const mapped = mapSessionUpdateNotificationBatch(payload(meta), {
      provider: claudeProvider,
      providerId: claudeProvider.id,
    });
    const event = mapped?.events[0];
    assert.equal(event?.type, "tool-call");
    assert.equal(event?.type === "tool-call" ? event.origin : undefined, undefined);
  }

  const generic = mapSessionUpdateNotificationBatch(
    payload({ claudeCode: { parentToolUseId: "call-parent-subagent" } }),
    { providerId: "generic" },
  );
  const genericEvent = generic?.events[0];
  assert.equal(genericEvent?.type, "tool-call");
  assert.equal(genericEvent?.type === "tool-call" ? genericEvent.origin : undefined, undefined);
});

test("non-Claude adapters ignore Claude subagent origin metadata", () => {
  const providers = [
    {
      id: "codex",
      name: "Codex",
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    {
      id: "opencode",
      name: "OpenCode",
      command: "opencode-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    {
      id: "generic",
      name: "Generic ACP",
      command: "generic-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
  ];

  for (const provider of providers) {
    const mapped = mapSessionUpdateNotificationBatch(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: `session-${provider.id}-claude-origin-metadata`,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: `call-${provider.id}-read`,
            title: "Read",
            kind: "read",
            status: "pending",
            _meta: {
              claudeCode: {
                parentToolUseId: "call-parent-subagent",
              },
            },
          },
        },
      },
      { provider, providerId: provider.id },
    );

    const event = mapped?.events[0];
    assert.equal(event?.type, "tool-call");
    assert.equal(event?.type === "tool-call" ? event.origin : undefined, undefined);
  }
});

test("mapSessionUpdateNotification classifies Claude Task tool with subagent_type as subagent", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-task-tool",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-task-tool",
          toolName: "Task",
          title: "Task",
          status: "in_progress",
          rawInput: { prompt: "Inspect session flow", subagent_type: "Explore" },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Task");
});

test("mapSessionUpdateNotification classifies Claude ACP Task tool with provider config as subagent", () => {
  const provider = {
    id: "claude-acp",
    name: "Claude Agent",
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-acp-task-tool",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-claude-acp-task-tool",
          toolName: "Task",
          title: "Task",
          status: "in_progress",
          rawInput: { prompt: "Inspect session flow", subagent_type: "Explore" },
        },
      },
    },
    { provider, providerId: provider.id },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Task");
});

test("mapSessionUpdateNotification classifies Claude ACP history repair tool calls from provider id", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-acp-history-task-tool",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-acp-history-task-tool",
            kind: "tool",
            title: "Task",
            input: JSON.stringify({ prompt: "Inspect session flow" }),
            status: "completed",
            timestamp: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:01.000Z",
          },
          rawInput: { prompt: "Inspect session flow", subagent_type: "Explore" },
        },
      },
    },
    { providerId: "claude-acp" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Task");
});

test("mapSessionUpdateNotification classifies Claude Agent tool as subagent", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-agent",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-agent",
          title: "Agent",
          status: "in_progress",
          rawInput: {
            prompt: "Find all API endpoints",
            description: "Find API endpoints",
            subagent_type: "Explore",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Agent");
});

test("mapSessionUpdateNotification keeps Claude TaskOutput timeouts running until explicit result", () => {
  const sessionId = "session-claude-task-output-lifecycle";
  mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-task-output-wait",
            kind: "tool",
            title: "TaskOutput",
            status: "completed",
            input: JSON.stringify({ task_id: "child-timeout", block: true }),
            output: "<task_id>child-timeout</task_id>\n<status>running</status>\nTimed out waiting for output",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );
  const completed = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-task-output-result",
            kind: "tool",
            title: "TaskOutput",
            status: "completed",
            input: JSON.stringify({ task_id: "child-timeout", block: true }),
            output: "<task_id>child-timeout</task_id>\n<status>completed</status>\n<output>done</output>",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );
  const waiting = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: `${sessionId}-wait-only`,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-task-output-wait-only",
            kind: "tool",
            title: "TaskOutput",
            status: "completed",
            input: JSON.stringify({ task_id: "child-timeout", block: true }),
            output: "<task_id>child-timeout</task_id>\n<status>running</status>\n<output>Still running</output>",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(waiting?.event.type, "tool-call");
  assert.equal(
    waiting?.event.type === "tool-call" ? waiting.event.toolCall.status : undefined,
    "running",
  );
  assert.equal(completed?.event.type, "tool-call");
  assert.equal(
    completed?.event.type === "tool-call" ? completed.event.toolCall.status : undefined,
    "completed",
  );
});

test("mapSessionUpdateNotificationBatch preserves Claude task tools before derived plans", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const sessionId = "session-claude-task-plan-live";

  const created = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "toolu_task_1",
          toolName: "TaskCreate",
          status: "in_progress",
          rawInput: { subject: "恢复实时 Claude plan" },
        },
      },
    },
    { provider, providerId: "claudecode" },
  );
  assert.deepEqual(created?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const createdPlan = created?.events[1];
  if (createdPlan?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(createdPlan.plan.entries, [
    { content: "恢复实时 Claude plan", priority: "medium", status: "pending" },
  ]);

  const createdOutput = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "toolu_task_1",
          rawOutput: "Task #1 created successfully: 恢复实时 Claude plan",
        },
      },
    },
    { provider, providerId: "claudecode" },
  );
  assert.deepEqual(createdOutput?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const createdOutputPlan = createdOutput?.events[1];
  if (createdOutputPlan?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(createdOutputPlan.plan.entries, [
    { content: "恢复实时 Claude plan", priority: "medium", status: "pending" },
  ]);

  const updated = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "toolu_update_1",
          toolName: "TaskUpdate",
          status: "completed",
          rawInput: { taskId: "1", status: "in_progress" },
        },
      },
    },
    { provider, providerId: "claudecode" },
  );
  assert.deepEqual(updated?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const updatedPlan = updated?.events[1];
  if (updatedPlan?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(updatedPlan.plan.entries, [
    { content: "恢复实时 Claude plan", priority: "medium", status: "in_progress" },
  ]);
});

test("mapSessionUpdateNotificationBatch preserves Claude TodoWrite before the derived plan", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const sessionId = "session-claude-todowrite-plan";

  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "toolu_todo_1",
          title: "TodoWrite",
          status: "completed",
          rawInput: {
            todos: [
              { content: "Fix plan display", status: "in_progress", activeForm: "Fixing plan display" },
              { content: "Run tests", status: "pending", activeForm: "Running tests" },
            ],
          },
        },
      },
    },
    { provider, providerId: "claudecode" },
  );

  assert.deepEqual(mapped?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const planEvent = mapped?.events[1];
  if (planEvent?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event from TodoWrite");
  }
  assert.equal(planEvent.plan.entries.length, 2);
  assert.deepEqual(planEvent.plan.entries, [
    { content: "Fix plan display", priority: "medium", status: "in_progress" },
    { content: "Run tests", priority: "medium", status: "pending" },
  ]);
});

test("mapSessionUpdateNotification classifies Codex spawned agents in the Codex adapter", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-subagent",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-subagent",
          toolName: "spawn_agents_on_csv",
          title: "spawn_agents_on_csv",
          status: "in_progress",
          rawInput: { path: "input.csv" },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "spawn_agents_on_csv");
});

test("mapSessionUpdateNotification classifies Codex multi_agent_v1 spawn_agent calls as subagents", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-subagent-v1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-codex-subagent-v1",
            kind: "tool",
            title: "spawn_agent",
            status: "in_progress",
            input: JSON.stringify({
              fork_context: true,
              message: "只修改 docs/tooling/subagent-todolist-demo.md",
            }),
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "spawn_agent");
});

test("mapSessionUpdateNotification classifies wrapped Codex multi-agent calls with opaque titles", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-subagent-wrapped",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-subagent-wrapped",
          title: "call-codex-subagent-wrapped",
          status: "in_progress",
          rawInput: {
            namespace: "multi_agent_v1",
            name: "spawn_agent",
            arguments: {
              message: "Inspect the session timeline",
              fork_context: true,
            },
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "spawn_agent");
});

test("mapSessionUpdateNotification classifies all wrapped Codex multi-agent actions", () => {
  const actions = [
    "send_message",
    "followup_task",
    "wait_agent",
    "interrupt_agent",
    "list_agents",
    "resume_agent",
  ];

  for (const action of actions) {
    const mapped = mapSessionUpdateNotification(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: `session-codex-${action}`,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: `call-codex-${action}`,
            title: `call-codex-${action}`,
            status: "in_progress",
            rawInput: {
              namespace: "multi_agent_v1",
              name: action,
              arguments: { agent_id: "agent-1" },
            },
          },
        },
      },
      { providerId: "codex" },
    );

    assert.equal(mapped?.event.type, "tool-call");
    if (mapped?.event.type !== "tool-call") {
      throw new Error("Expected tool-call event");
    }
    assert.equal(mapped.event.toolCall.kind, "subagent");
    assert.equal(mapped.event.toolCall.title, action);
  }
});

test("mapSessionUpdateNotification classifies wrapped Codex MCP calls from namespace and name", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-mcp-wrapped",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-mcp-wrapped",
          title: "call-codex-mcp-wrapped",
          status: "in_progress",
          rawInput: {
            namespace: "mcp__mcp_router",
            name: "find_symbol",
            arguments: { relative_path: "packages/shared/src/session-timeline.ts" },
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/find_symbol");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "mcp_router",
    toolName: "find_symbol",
    source: "structured-tool-name",
    rawTitle: "mcp__mcp_router.find_symbol",
  });
});

test("mapSessionUpdateNotification classifies wrapped Codex web calls as fetch", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-web-wrapped",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-web-wrapped",
          title: "call-codex-web-wrapped",
          status: "completed",
          rawInput: {
            namespace: "web",
            name: "run",
            arguments: { query: "Agent Client Protocol" },
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "fetch");
  assert.equal(mapped.event.toolCall.title, "Searching for: Agent Client Protocol");
});

test("mapSessionUpdateNotification classifies wrapped Codex skill shell calls as skills", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-skill-wrapped",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-skill-wrapped",
          title: "call-codex-skill-wrapped",
          status: "completed",
          rawInput: {
            name: "shell_command",
            arguments: {
              command: "Get-Content C:/Users/qjq/.codex/skills/frontend-design/SKILL.md",
            },
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "skill");
  assert.equal(mapped.event.toolCall.title, "Skill: frontend-design");
});

test("mapSessionUpdateNotification classifies Codex shell command arrays as shell", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-shell-array",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-shell-array",
          title: "rg -n \"typecheck\" AGENTS.md",
          status: "completed",
          input: JSON.stringify({
            command: [
              "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\\pwsh.exe",
              "-Command",
              "rg -n \"typecheck\" AGENTS.md",
            ],
            parsed_cmd: [{ type: "unknown", cmd: "rg -n \"typecheck\" AGENTS.md" }],
          }),
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification keeps Codex web search placeholders as fetch", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-web-search-placeholder",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "ws-placeholder",
          kind: "fetch",
          title: "Searching the Web",
          status: "running",
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "fetch");
  assert.equal(mapped.event.toolCall.title, "Searching the Web");
});

test("mapSessionUpdateNotification classifies Codex skill file shell reads as skill", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-skill-shell",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-skill-shell",
          title: "Get-Content 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/d6169bef/skills/using-superpowers/SKILL.md' -TotalCount 220",
          status: "completed",
          input: JSON.stringify({
            command: [
              "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\\pwsh.exe",
              "-Command",
              "Get-Content 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/d6169bef/skills/using-superpowers/SKILL.md' -TotalCount 220",
            ],
            parsed_cmd: [{
              type: "unknown",
              cmd: "Get-Content 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/d6169bef/skills/using-superpowers/SKILL.md' -TotalCount 220",
            }],
          }),
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "skill");
  assert.equal(
    mapped.event.toolCall.title,
    "Skill: superpowers:using-superpowers",
  );
});

test("mapSessionUpdateNotification classifies Codex command arrays as shell before filename write heuristics", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-shell-path",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-shell-path",
          title: "Get-Content 'D:\\myProject\\tools\\Tiller\\apps\\helm\\tool-write-test.txt'",
          status: "completed",
          input: JSON.stringify({
            command: [
              "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\\pwsh.exe",
              "-Command",
              "Get-Content 'D:\\myProject\\tools\\Tiller\\apps\\helm\\tool-write-test.txt'",
            ],
            parsed_cmd: [{
              type: "unknown",
              cmd: "Get-Content 'D:\\myProject\\tools\\Tiller\\apps\\helm\\tool-write-test.txt'",
            }],
          }),
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification keeps Claude Bash grep commands as shell", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-shell-search",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-shell-search",
            kind: "shell",
            title: "echo \"=== form.tsx mobile variants ===\"; grep -nE 'isMobile|py-1' apps/deck/src/features/mission/composer/form.tsx 2>/dev/null | head -30",
            status: "completed",
            input: "{\"command\":\"echo \\\"=== form.tsx mobile variants ===\\\"; grep -nE 'isMobile|py-1' apps/deck/src/features/mission/composer/form.tsx 2>/dev/null | head -30\",\"description\":\"检查实现内容是否存在\"}",
            timestamp: "2026-07-07T00:34:41.000Z",
            updatedAt: "2026-07-07T00:34:41.000Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification repairs Claude non-search shell history that was previously mislabeled as search", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-history-shell",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-history-shell",
            kind: "search",
            title: "cd /d/myProject/tools/Tiller && pnpm --filter @tiller/deck lint 2>&1 | tail -15",
            status: "completed",
            input: "{}{\"command\":\"cd /d/myProject/tools/Tiller && pnpm --filter @tiller/deck lint 2>&1 | tail -15\"}",
            timestamp: "2026-07-07T00:34:41.000Z",
            updatedAt: "2026-07-07T00:34:41.000Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification repairs Claude Grep payloads that were mislabeled as shell", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-history-grep",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-history-grep",
            kind: "shell",
            title: "{\"pattern\":\"Tiller\",\"glob\":\"**/README.md\",\"output_mode\":\"files_with_matches\"}",
            status: "completed",
            input: "{\"pattern\":\"Tiller\",\"glob\":\"**/README.md\",\"output_mode\":\"files_with_matches\"}",
            timestamp: "2026-07-07T16:07:01.000Z",
            updatedAt: "2026-07-07T16:07:02.000Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
});

test("mapSessionUpdateNotification classifies shell-labeled Find payloads with structured patterns as search", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-structured-find-search",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-structured-find-search",
        kind: "shell",
        title: "Find `**/AGENTS.md`",
        rawInput: {
          pattern: "**/AGENTS.md",
        },
        status: "completed",
        timestamp: "2026-07-07T14:42:00.952Z",
        updatedAt: "2026-07-07T14:42:02.458Z",
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
  assert.equal(mapped.event.toolCall.title, "Find `**/AGENTS.md`");
});

test("mapSessionUpdateNotification classifies Claude native Grep command titles as search when input is structured search payload", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-native-grep",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-native-grep",
            kind: "shell",
            title: "grep -l \"tool-call-repair\"",
            status: "completed",
            input: "{\"output_mode\":\"files_with_matches\",\"pattern\":\"tool-call-repair\"}",
            timestamp: "2026-07-07T09:10:38.372Z",
            updatedAt: "2026-07-07T09:10:39.092Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
});

test("mapSessionUpdateNotification classifies Claude mcp__ prefixed tools as mcp", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-mcp-search",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-mcp-search",
            kind: "search",
            title: "mcp__mcp-router__codebase_search",
            status: "completed",
            input: "{\"repo_path\":\"D:\\\\myProject\\\\tools\\\\Tiller\",\"search_string\":\"会话历史恢复后如何重新导入工具调用元数据\"}",
            timestamp: "2026-07-07T09:08:58.265Z",
            updatedAt: "2026-07-07T09:09:36.321Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/codebase_search");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "mcp_router",
    toolName: "codebase_search",
    source: "provider-title",
    rawTitle: "mcp__mcp-router__codebase_search",
  });
});
