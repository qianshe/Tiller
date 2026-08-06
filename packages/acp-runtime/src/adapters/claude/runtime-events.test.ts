import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotificationBatch } from "../../runtime";
import { attachTrackedRuntimeEventOrigin, clearRuntimeEventOriginTrackerSession, createRuntimeEventOriginTracker, mapSessionUpdateNotification } from "../../events";

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
    "tool",
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

test("Claude resolver origin takes precedence over the tracker reverse map", () => {
  const claudeProvider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-code-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const tracker = createRuntimeEventOriginTracker();
  // Seed the reverse map with a root launch so the child would otherwise
  // inherit "call-root-launch" as its parent.
  mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-claude-precedence",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-root-launch",
        title: "Task",
        kind: "subagent",
        status: "completed",
        commandId: "subagent:child_alpha",
      },
    },
  }, { provider: claudeProvider, providerId: claudeProvider.id, originTracker: tracker });

  const child = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-claude-precedence",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-child-shell",
        title: "Read",
        kind: "read",
        status: "pending",
        commandId: "subagent:child_alpha",
        _meta: { claudeCode: { parentToolUseId: "call-claude-parent" } },
      },
    },
  }, { provider: claudeProvider, providerId: claudeProvider.id, originTracker: tracker });
  const childEvent = child?.events[0];
  assert.equal(childEvent?.type, "tool-call");
  assert.deepEqual(
    childEvent?.type === "tool-call" ? childEvent.origin : undefined,
    { scope: "subagent", parentToolCallId: "call-claude-parent" },
  );
});

test("tracker does not synthesize an origin for an orphan child tool-call", () => {
  const provider = {
    id: "opencode",
    name: "OpenCode",
    command: "opencode-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const tracker = createRuntimeEventOriginTracker();
  const orphan = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-opencode-orphan",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-opencode-orphan-read",
        title: "Read",
        kind: "read",
        status: "completed",
        commandId: "subagent:ses_never_launched",
      },
    },
  }, { provider, providerId: provider.id, originTracker: tracker });
  const event = orphan?.events[0];
  assert.equal(event?.type, "tool-call");
  assert.equal(event?.type === "tool-call" ? event.origin : undefined, undefined);
});

test("clearRuntimeEventOriginTrackerSession drops the reverse map for that session", () => {
  const provider = {
    id: "opencode",
    name: "OpenCode",
    command: "opencode-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const tracker = createRuntimeEventOriginTracker();
  mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-opencode-clear",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-clear-root",
        title: "explore",
        kind: "subagent",
        status: "completed",
        commandId: "subagent:ses_clear_child",
      },
    },
  }, { provider, providerId: provider.id, originTracker: tracker });
  clearRuntimeEventOriginTrackerSession(tracker, "session-opencode-clear");

  const child = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-opencode-clear",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-clear-child-read",
        title: "Read",
        kind: "read",
        status: "completed",
        commandId: "subagent:ses_clear_child",
      },
    },
  }, { provider, providerId: provider.id, originTracker: tracker });
  const event = child?.events[0];
  assert.equal(event?.type, "tool-call");
  assert.equal(event?.type === "tool-call" ? event.origin : undefined, undefined);
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

test("mapSessionUpdateNotification classifies a Claude Task before raw input arrives", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-task-title-only",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-task-title-only",
          toolName: "Task",
          title: "读取并简单回复",
          status: "in_progress",
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
  assert.equal(mapped.event.toolCall.title, "读取并简单回复");
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
