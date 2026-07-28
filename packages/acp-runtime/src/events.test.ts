import assert from "node:assert/strict";
import test from "node:test";
import {
  mapSessionUpdateNotificationBatch,
  sanitizeProtocolLogPayload,
  summarizeSessionUpdateNotification,
} from "./runtime";
import { hasSessionConfigOptionIdValue, mapSessionUpdateNotification } from "./events";

test("summarizeSessionUpdateNotification reports update shape without text content", () => {
  const summary = summarizeSessionUpdateNotification(
    {
      sessionId: "sess_123",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "敏感正文" },
        messageId: "msg_1",
      },
    },
    "message",
  );

  assert.deepEqual(summary, {
    sessionId: "sess_123",
    updateType: "agent_message_chunk",
    updateKeys: ["content", "messageId", "sessionUpdate"],
    contentShape: { kind: "object", type: "text", keys: ["text", "type"] },
    mappedEventType: "message",
  });
  assert.doesNotMatch(JSON.stringify(summary), /敏感正文/);
});
test("summarizeSessionUpdateNotification reports Codex compaction prefix diagnostics without text content", () => {
  const mixedText = "Context compacted 我先做个完成度确认，再直接给你推荐方案落地后的预期效果喵~";
  const summary = summarizeSessionUpdateNotification(
    {
      sessionId: "sess_codex_compaction",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_compaction_mixed",
        content: { type: "text", text: mixedText },
      },
    },
    "message",
    { providerId: "codex" },
  );

  assert.deepEqual(summary, {
    sessionId: "sess_codex_compaction",
    updateType: "agent_message_chunk",
    updateKeys: ["content", "messageId", "sessionUpdate"],
    contentShape: { kind: "object", type: "text", keys: ["text", "type"] },
    mappedEventType: "message",
    compactionProbe: {
      textChars: mixedText.length,
      updateTypeCompactionRelated: false,
      matchedLifecyclePhase: null,
      matchedContinuationSummary: false,
      providerSignal: {
        kind: "codex_context_compacted_prefix",
        exactMatch: false,
        hasTrailingText: true,
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(summary), /Context compacted|完成度确认|预期效果/);
});

test("mapSessionUpdateNotification maps agent text chunks into Tiller message events", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_123",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_1",
        content: { type: "text", text: "你好，我正在分析这个项目。" },
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.sessionId, "sess_123");
  assert.equal(mapped?.event.type, "message");
  if (mapped?.event.type !== "message") {
    throw new Error("Expected message event");
  }
  assert.equal(mapped.event.message.id, "msg_1");
  assert.equal(mapped.event.message.role, "assistant");
  assert.equal(mapped.event.message.text, "你好，我正在分析这个项目。");
  assert.match(mapped.event.message.timestamp, /\d{4}-\d{2}-\d{2}T/);
});

test("mapSessionUpdateNotification preserves boundaries between multiple text blocks", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_text_blocks",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_text_blocks",
        content: [
          { type: "text", text: "1. 列出当前项目文件" },
          { type: "text", text: "2. 调用 MCP 工具" },
        ],
      },
    },
  });

  assert.equal(mapped?.event.type, "message");
  if (mapped?.event.type !== "message") {
    throw new Error("Expected message event");
  }
  assert.equal(
    mapped.event.message.text,
    "1. 列出当前项目文件\n\n2. 调用 MCP 工具",
  );
  assert.equal(mapped.event.message.streamMode, "delta");
});

test("mapSessionUpdateNotification maps snake_case user text chunks into Tiller message events", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      session_id: "sess_123",
      update: {
        session_update: "user_message_chunk",
        message_id: "msg_user_snake_1",
        content: { type: "text", text: "蛇形字段用户消息" },
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.sessionId, "sess_123");
  assert.equal(mapped?.event.type, "message");
  if (mapped?.event.type !== "message") {
    throw new Error("Expected message event");
  }
  assert.equal(mapped.event.message.id, "msg_user_snake_1");
  assert.equal(mapped.event.message.role, "user");
  assert.equal(mapped.event.message.text, "蛇形字段用户消息");
});

test("mapSessionUpdateNotification maps user text chunks into Tiller message events", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_123",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "msg_user_1",
        content: { type: "text", text: "中午好" },
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.sessionId, "sess_123");
  assert.equal(mapped?.event.type, "message");
  if (mapped?.event.type !== "message") {
    throw new Error("Expected message event");
  }
  assert.equal(mapped.event.message.id, "msg_user_1");
  assert.equal(mapped.event.message.role, "user");
  assert.equal(mapped.event.message.text, "中午好");
});

test("mapSessionUpdateNotification maps explicit compaction progress chunks into live compaction events", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_compaction_live",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_compaction_started",
        content: { type: "text", text: "Compacting..." },
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.sessionId, "sess_compaction_live");
  assert.equal(mapped?.event.type, "compaction");
  if (mapped?.event.type !== "compaction") {
    throw new Error("Expected compaction event");
  }
  assert.equal(mapped.event.phase, "started");
  assert.equal(mapped.event.source, "provider");
});

test("mapSessionUpdateNotification maps standalone ACP compaction completion notifications", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_compaction_notification",
      update: {
        sessionUpdate: "compaction_completed",
        messageId: "msg_compaction_notification",
        timestamp: "2026-07-20T09:00:00.000Z",
        status: "completed",
        compaction: {
          summary: "Automatically compacted context.",
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "compaction");
  if (mapped?.event.type !== "compaction") {
    throw new Error("Expected compaction event");
  }
  assert.deepEqual(mapped.event, {
    type: "compaction",
    phase: "completed",
    source: "provider",
    messageId: "msg_compaction_notification",
    summaryText: "Automatically compacted context.",
    timestamp: "2026-07-20T09:00:00.000Z",
  });
});

test("mapSessionUpdateNotification maps continuation summaries into completed compaction events", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_compaction_completed",
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "msg_compaction_completed",
        content: {
          type: "text",
          text: "This session is being continued from a previous conversation that ran out of context.",
        },
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "compaction");
  if (mapped?.event.type !== "compaction") {
    throw new Error("Expected compaction event");
  }
  assert.equal(mapped.event.phase, "completed");
  assert.equal(mapped.event.source, "heuristic");
  assert.equal(
    mapped.event.summaryText,
    "This session is being continued from a previous conversation that ran out of context.",
  );
});

test("mapSessionUpdateNotification maps Codex context compacted chunks into completed compaction events", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_codex_compaction_chunk",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_codex_compaction_chunk",
          timestamp: "2026-07-06T17:30:00.000Z",
          content: { type: "text", text: "Context compacted" },
        },
      },
    },
    {
      provider: {
        id: "codex",
        name: "Codex",
        command: "codex-acp",
        transport: "stdio",
        protocol: "acp",
      },
      providerId: "codex",
    },
  );

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "compaction");
  if (mapped?.event.type !== "compaction") {
    throw new Error("Expected compaction event");
  }
  assert.equal(mapped.event.phase, "completed");
  assert.equal(mapped.event.source, "provider");
  assert.equal(mapped.event.timestamp, "2026-07-06T17:30:00.000Z");
  assert.equal(mapped.event.messageId, "msg_codex_compaction_chunk");
});

test("mapSessionUpdateNotification maps Codex context compacting chunks into started compaction events", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_codex_compaction_start",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "msg_codex_compaction_start",
          timestamp: "2026-07-27T09:00:00.000Z",
          content: { type: "text", text: "Context compacting" },
        },
      },
    },
    {
      provider: {
        id: "codex",
        name: "Codex",
        command: "codex-acp",
        transport: "stdio",
        protocol: "acp",
      },
      providerId: "codex",
    },
  );

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "compaction");
  if (mapped?.event.type !== "compaction") {
    throw new Error("Expected compaction event");
  }
  assert.equal(mapped.event.phase, "started");
  assert.equal(mapped.event.messageId, "msg_codex_compaction_start");
});

test("mapSessionUpdateNotification maps Codex context compacted tool markers into compaction events", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_codex_compaction_tool",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_codex_compaction",
          kind: "other",
          title: "Context compacted",
          status: "completed",
          timestamp: "2026-07-26T09:00:00.000Z",
        },
      },
    },
    {
      provider: {
        id: "codex",
        name: "Codex",
        command: "codex-acp",
        transport: "stdio",
        protocol: "acp",
      },
      providerId: "codex",
    },
  );

  assert.ok(mapped);
  assert.deepEqual(mapped.event, {
    type: "compaction",
    phase: "completed",
    source: "provider",
    timestamp: "2026-07-26T09:00:00.000Z",
    messageId: "call_codex_compaction",
  });
});

test("mapSessionUpdateNotification keeps a real Codex tool named Context compacted as a tool", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_codex_context_compacted_mcp",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_codex_context_compacted_mcp",
          kind: "mcp",
          title: "Context compacted",
          status: "completed",
          rawInput: {
            server: "example",
            tool: "context_compacted",
            arguments: {},
          },
        },
      },
    },
    {
      provider: {
        id: "codex",
        name: "Codex",
        command: "codex-acp",
        transport: "stdio",
        protocol: "acp",
      },
      providerId: "codex",
    },
  );

  assert.equal(mapped?.event.type, "tool-call");
  assert.equal(
    mapped?.event.type === "tool-call" ? mapped.event.toolCall.kind : undefined,
    "mcp",
  );
});

test("mapSessionUpdateNotification keeps an MCP tool named Context compacted as a tool from raw input", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_codex_context_compacted_raw_mcp",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_codex_context_compacted_raw_mcp",
          kind: "tool",
          title: "Context compacted",
          status: "completed",
          rawInput: {
            server: "example",
            tool: "context_compacted",
            arguments: {},
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  assert.equal(
    mapped?.event.type === "tool-call" ? mapped.event.toolCall.kind : undefined,
    "mcp",
  );
});

test("mapSessionUpdateNotification keeps an MCP tool named Context compacted from regular input", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_codex_context_compacted_input_mcp",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_codex_context_compacted_input_mcp",
          kind: "tool",
          title: "Context compacted",
          status: "completed",
          input: {
            server: "example",
            name: "context_compacted",
            arguments: {},
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  assert.equal(
    mapped?.event.type === "tool-call" ? mapped.event.toolCall.kind : undefined,
    "mcp",
  );
});

test("mapSessionUpdateNotification keeps sparse Codex spawn completion completed", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_codex_sparse_spawn",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_codex_sparse_spawn",
          title: "spawn_agent",
          status: "completed",
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
  assert.equal(mapped.event.toolCall.status, "completed");
  assert.deepEqual(mapped.event.toolCall.subagentOperation, {
    action: "spawn",
    targets: [{ id: "call_codex_sparse_spawn" }],
  });
});

for (const provider of [
  {
    id: "claude-acp",
    name: "Claude",
    command: "claude-acp",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
  },
]) {
  test(`mapSessionUpdateNotification keeps shared continuation-summary fallback for ${provider.id}`, () => {
    const mapped = mapSessionUpdateNotification(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: `sess_${provider.id}_compaction_summary`,
          update: {
            sessionUpdate: "agent_message_chunk",
            messageId: `msg_${provider.id}_compaction_summary`,
            content: {
              type: "text",
              text: "This session is being continued from a previous conversation that ran out of context.",
            },
          },
        },
      },
      {
        provider: {
          id: provider.id,
          name: provider.name,
          command: provider.command,
          transport: "stdio",
          protocol: "acp",
        },
        providerId: provider.id,
      },
    );

    assert.ok(mapped);
    assert.equal(mapped?.event.type, "compaction");
    if (mapped?.event.type !== "compaction") {
      throw new Error("Expected compaction event");
    }
    assert.equal(mapped.event.phase, "completed");
    assert.equal(mapped.event.source, "heuristic");
  });
}

test("mapSessionUpdateNotification does not classify tool output summaries as compaction events", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_tool_output_summary",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_read_1",
        title: "Read apps\\deck\\src\\features\\server-events\\event-handlers.test.ts",
        status: "completed",
        rawOutput:
          'This session is being continued from a previous conversation that ran out of context.\\n\\nimport assert from "node:assert/strict";',
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.id, "toolu_read_1");
  assert.equal(mapped.event.toolCall.status, "completed");
  assert.match(
    mapped.event.toolCall.output ?? "",
    /This session is being continued from a previous conversation that ran out of context\./,
  );
});

test("mapSessionUpdateNotification does not treat ordinary compacting text as a compaction lifecycle signal", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_compaction_plain_text",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_compaction_plain_text",
        content: { type: "text", text: "We are compacting the output format for readability." },
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "message");
});

test("mapSessionUpdateNotification preserves snake_case message ids", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_123",
      update: {
        sessionUpdate: "agent_message_chunk",
        message_id: "msg_snake_1",
        content: { type: "text", text: "继续处理" },
      },
    },
  });

  assert.equal(mapped?.event.type, "message");
  if (mapped?.event.type !== "message") {
    throw new Error("Expected message event");
  }
  assert.equal(mapped.event.message.id, "msg_snake_1");
});

test("mapSessionUpdateNotification preserves nested message ids", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_123",
      update: {
        sessionUpdate: "agent_message_chunk",
        message: { id: "msg_nested_1", content: { type: "text", text: "嵌套消息" } },
      },
    },
  });

  assert.equal(mapped?.event.type, "message");
  if (mapped?.event.type !== "message") {
    throw new Error("Expected message event");
  }
  assert.equal(mapped.event.message.id, "msg_nested_1");
  assert.equal(mapped.event.message.text, "嵌套消息");
});

test("mapSessionUpdateNotification generates stable ids for replayed chunks without message ids", () => {
  const updates = [
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "第一段" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "第二段" } },
  ];
  const originalDateNow = Date.now;

  try {
    Date.now = () => 1000;
    const firstPass = updates.map((update) =>
      mapSessionUpdateNotification({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "sess_replay", update },
      }),
    );

    Date.now = () => 2000;
    const secondPass = updates.map((update) =>
      mapSessionUpdateNotification({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "sess_replay", update },
      }),
    );

    assert.deepEqual(
      firstPass.map((mapped) => mapped?.event.type === "message" ? mapped.event.message.id : null),
      secondPass.map((mapped) => mapped?.event.type === "message" ? mapped.event.message.id : null),
    );
    assert.match(
      firstPass[0]?.event.type === "message" ? firstPass[0].event.message.id : "",
      /^sess_replay-msg-[a-z0-9]+$/u,
    );
  } finally {
    Date.now = originalDateNow;
  }
});


test("mapSessionUpdateNotification maps realtime thinking content to think tool calls", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_thinking",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-thinking",
        content: [{ type: "thinking", thinking: "需要先定位实时链路" }],
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.id, "msg-thinking:thinking");
  assert.equal(mapped.event.toolCall.kind, "think");
  assert.equal(mapped.event.toolCall.title, "Thinking");
  assert.equal(mapped.event.toolCall.output, "需要先定位实时链路");
  assert.equal(mapped.event.toolCall.status, "running");
});

test("mapSessionUpdateNotification maps standard ACP thought chunks to think tool calls", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_acp_thought",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "先分析 ACP thought chunk" },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "think");
  assert.equal(mapped.event.toolCall.title, "Thinking");
  assert.equal(mapped.event.toolCall.output, "先分析 ACP thought chunk");
  assert.equal(mapped.event.toolCall.status, "running");
});

test("mapSessionUpdateNotification keeps generated thought chunk ids stable across deltas", () => {
  const first = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_acp_thought_stable",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "第一段思考" },
      },
    },
  });
  const second = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_acp_thought_stable",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "第二段思考" },
      },
    },
  });

  assert.equal(first?.event.type, "tool-call");
  assert.equal(second?.event.type, "tool-call");
  if (first?.event.type !== "tool-call" || second?.event.type !== "tool-call") {
    throw new Error("Expected tool-call events");
  }
  assert.equal(first.event.toolCall.id, second.event.toolCall.id);
  assert.equal(first.event.toolCall.commandId, second.event.toolCall.commandId);
});

test("mapSessionUpdateNotification maps config_option_update into config option state", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_cfg",
      update: {
        type: "config_option_update",
        configOptions: [
          { id: "model", category: "model", currentValue: "openai/gpt-5.4" },
          { id: "thought", category: "thought_level", currentValue: "high" },
        ],
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "config-options");
  if (mapped?.event.type !== "config-options") {
    throw new Error("Expected config-options event");
  }
  assert.equal(mapped.event.state.model, "openai/gpt-5.4");
  assert.equal(mapped.event.state.reasoningEffort, "high");
});

test("mapSessionUpdateNotification flattens grouped config option choices", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_grouped_cfg",
      update: {
        type: "config_option_update",
        configOptions: [
          {
            id: "model",
            name: "Model",
            type: "select",
            category: "model",
            currentValue: "claude-sonnet-4-5-20250929",
            options: [
              {
                group: "claude",
                name: "Claude",
                options: [
                  { value: "claude-opus-4-5-20251101", name: "Opus 4.5" },
                  { value: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5" },
                ],
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(mapped?.event.type, "config-options");
  if (mapped?.event.type !== "config-options") {
    throw new Error("Expected config-options event");
  }
  assert.deepEqual(mapped.event.options[0]?.options, [
    { value: "claude-opus-4-5-20251101", label: "Opus 4.5", name: "Opus 4.5" },
    { value: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5", name: "Sonnet 4.5" },
  ]);
});

test("mapSessionUpdateNotification maps inferred permission requests", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_perm",
      update: {
        type: "permission_request",
        permissionId: "perm_1",
        command: "pnpm test",
        reason: "Run project tests",
        cwd: "D:/myProject/tools/Tiller",
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "permission-request");
  if (mapped?.event.type !== "permission-request") {
    throw new Error("Expected permission-request event");
  }
  assert.equal(mapped.event.request.id, "perm_1");
  assert.equal(mapped.event.request.command, "pnpm test");
});

test("mapSessionUpdateNotification preserves available command kind metadata", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_commands",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "ralph-loop",
            description: "(builtin) Start self-referential loop.",
          },
          {
            name: "frontend-design",
            description: "Use this skill for polished UI.",
            type: "skill",
            input: { hint: "<brief>" },
            meta: { source: "global", scope: "skills" },
          },
          {
            name: "review",
            description: "Review current changes.",
          },
        ],
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "available-commands");
  if (mapped?.event.type !== "available-commands") {
    throw new Error("Expected available-commands event");
  }
  assert.deepEqual(
    mapped.event.commands.map((command) => ({
      name: command.name,
      kind: command.kind,
      rawKind: command.rawKind,
      input: command.input,
      source: command.source,
      scope: command.scope,
    })),
    [
      { name: "ralph-loop", kind: "builtin", rawKind: undefined, input: undefined, source: undefined, scope: undefined },
      {
        name: "frontend-design",
        kind: "skill",
        rawKind: "skill",
        input: { hint: "<brief>" },
        source: "global",
        scope: "skills",
      },
      { name: "review", kind: "command", rawKind: undefined, input: undefined, source: undefined, scope: undefined },
    ],
  );
});

test("mapSessionUpdateNotification infers ClaudeCode user skills from description suffix", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_claude_skills",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "frontend-design",
            description: "Create distinctive frontend interfaces. (user)",
          },
        ],
      },
    },
  });

  assert.equal(mapped?.event.type, "available-commands");
  if (mapped?.event.type !== "available-commands") {
    throw new Error("Expected available-commands event");
  }
  assert.deepEqual(mapped.event.commands[0], {
    name: "frontend-design",
    description: "Create distinctive frontend interfaces.",
    input: undefined,
    kind: "skill",
    rawKind: undefined,
    source: "user",
    scope: undefined,
  });
});

test("mapSessionUpdateNotification infers top-level user source commands as skills", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_user_source_skills",
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          {
            name: "frontend-design",
            description: "Create distinctive frontend interfaces.",
            source: "user",
          },
        ],
      },
    },
  });

  assert.equal(mapped?.event.type, "available-commands");
  if (mapped?.event.type !== "available-commands") {
    throw new Error("Expected available-commands event");
  }
  assert.deepEqual(mapped.event.commands[0], {
    name: "frontend-design",
    description: "Create distinctive frontend interfaces.",
    input: undefined,
    kind: "skill",
    rawKind: undefined,
    source: "user",
    scope: undefined,
  });
});

test("mapSessionUpdateNotification accepts snake_case available commands", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_commands_snake",
      update: {
        sessionUpdate: "available_commands_update",
        available_commands: [{ name: "help", description: "Show help" }],
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "available-commands");
  if (mapped?.event.type !== "available-commands") {
    throw new Error("Expected available-commands event");
  }
  assert.deepEqual(mapped.event.commands.map((command) => command.name), ["help"]);
});

test("hasSessionConfigOptionIdValue allows provider-owned string values for known option ids", () => {
  assert.equal(
    hasSessionConfigOptionIdValue(
      [
        {
          id: "model",
          name: "Model",
          category: "model",
          value: "claude-sonnet-4-5",
          options: [{ value: "claude-sonnet-4-5", label: "Sonnet" }],
        },
      ],
      "model",
      "claude-opus-4-7",
    ),
    true,
  );
  assert.equal(
    hasSessionConfigOptionIdValue([{ id: "web-search", name: "Web Search", value: false }], "web-search", true),
    true,
  );
  assert.equal(
    hasSessionConfigOptionIdValue([{ id: "web-search", name: "Web Search", value: false }], "web-search", "yes"),
    false,
  );
});

test("mapSessionUpdateNotification maps inferred command output", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_cmd",
      update: {
        type: "command_output",
        commandId: "cmd_1",
        stream: "stdout",
        output: "PASS src/index.test.ts",
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "command-output");
  if (mapped?.event.type !== "command-output") {
    throw new Error("Expected command-output event");
  }
  assert.equal(mapped.event.chunk.commandId, "cmd_1");
  assert.equal(mapped.event.chunk.text, "PASS src/index.test.ts");
});

test("mapSessionUpdateNotificationBatch splits inferred command output once in canonical order", () => {
  const mapped = mapSessionUpdateNotificationBatch({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_cmd_batch",
      update: {
        type: "command_output",
        commandId: "cmd_batch_1",
        stream: "stdout",
        output: "PASS src/batch.test.ts",
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped.sessionId, "sess_cmd_batch");
  assert.deepEqual(mapped.events.map((event) => event.type), [
    "tool-call",
    "command-output",
  ]);
  assert.equal(mapped.events[0]?.type, "tool-call");
  assert.equal(mapped.events[1]?.type, "command-output");
});

test("mapSessionUpdateNotificationBatch preserves thought chunks as thinking tool calls", () => {
  const mapped = mapSessionUpdateNotificationBatch({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_thought_batch",
      update: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought-1",
        content: { type: "text", text: "checking the repository" },
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped.events.length, 1);
  assert.equal(mapped.events[0]?.type, "tool-call");
  if (mapped.events[0]?.type !== "tool-call") {
    throw new Error("Expected thinking tool call");
  }
  assert.equal(mapped.events[0].toolCall.kind, "think");
  assert.equal(mapped.events[0].toolCall.id, "thought-1:thinking");
  assert.equal(mapped.events[0].toolCall.output, "checking the repository");
});

test("mapSessionUpdateNotificationBatch covers ACP session state variants without loss", () => {
  const fixtures = [
    {
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: "architect",
      },
      expected: {
        type: "mode-update",
        agentMode: "architect",
      },
    },
    {
      update: {
        sessionUpdate: "session_info_update",
        title: null,
        updatedAt: "2026-07-11T12:00:00.000Z",
      },
      expected: {
        type: "session-info",
        title: null,
        updatedAt: "2026-07-11T12:00:00.000Z",
      },
    },
    {
      update: {
        sessionUpdate: "usage_update",
        used: 123,
        size: 200_000,
        cost: { amount: 0.02, currency: "USD" },
      },
      expected: {
        type: "usage-update",
        usage: {
          used: 123,
          size: 200_000,
          cost: { amount: 0.02, currency: "USD" },
        },
      },
    },
  ] as const;

  for (const fixture of fixtures) {
    const mapped = mapSessionUpdateNotificationBatch({
      method: "session/update",
      params: {
        sessionId: "session-state-variants",
        update: fixture.update,
      },
    });
    assert.ok(mapped);
    assert.deepEqual(mapped.events, [fixture.expected]);
  }
});

test("mapSessionUpdateNotification maps inferred diff summaries", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_diff",
      update: {
        type: "session_diff",
        files: [
          {
            path: "apps/web/src/App.tsx",
            status: "modified",
            patch: "@@ -1,2 +1,3 @@\n import React from 'react';\n+export const ok = true;",
          },
        ],
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "diff-update");
  if (mapped?.event.type !== "diff-update") {
    throw new Error("Expected diff-update event");
  }
  assert.equal(mapped.event.files[0]?.path, "apps/web/src/App.tsx");
  assert.equal(mapped.event.files[0]?.additions, 1);
  assert.match(mapped.event.files[0]?.patch ?? "", /@@ -1,2 \+1,3 @@/u);
});

test("mapSessionUpdateNotification derives generic tool names from nested tool fields", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_tool_name",
      update: {
        type: "tool_call_update",
        toolCall: {
          id: "call_generic",
          title: "call_generic",
          input: { toolName: "mcp_router/find_symbol", arguments: { name: "App" } },
          output: "found",
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/find_symbol");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "mcp_router",
    toolName: "find_symbol",
    source: "structured-tool-name",
  });
});

test("mapSessionUpdateNotification derives Codex mcp tool names from rawInput server and tool", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_codex_tool",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_codex_mcp",
        title: "call_codex_mcp",
        status: "in_progress",
        rawInput: {
          server: "mcp_router",
          tool: "activate_project",
          arguments: { project: "D:\\myProject\\tools\\Tiller" },
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/activate_project");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "mcp_router",
    toolName: "activate_project",
    source: "structured-input",
  });
  assert.equal(mapped.event.toolCall.input, JSON.stringify({
    server: "mcp_router",
    tool: "activate_project",
    arguments: { project: "D:\\myProject\\tools\\Tiller" },
  }));
});

test("mapSessionUpdateNotification derives Codex write titles from diff content paths", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_codex_write",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call_codex_write",
          title: "Editing files",
          kind: "edit",
          status: "completed",
          content: [
            {
              type: "diff",
              path: "D:\\repo\\packages\\acp-runtime\\src\\events.ts",
              oldText: "old",
              newText: "new",
            },
          ],
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "write");
  assert.equal(mapped.event.toolCall.title, "packages\\acp-runtime\\src\\events.ts");
});

test("mapSessionUpdateNotification prefers Codex rawInput over an empty input placeholder", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_codex_raw_input_placeholder",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_codex_raw_input_placeholder",
        kind: "other",
        title: "call_codex_raw_input_placeholder",
        status: "in_progress",
        input: {},
        rawInput: {
          server: "mcp_router",
          tool: "find_symbol",
          arguments: { relative_path: "packages/shared/src/session-timeline.ts" },
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/find_symbol");
  assert.equal(mapped.event.toolCall.input, JSON.stringify({
    server: "mcp_router",
    tool: "find_symbol",
    arguments: { relative_path: "packages/shared/src/session-timeline.ts" },
  }));
});

test("mapSessionUpdateNotification keeps top-level rawInput when nested toolCall metadata is sparse", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_nested_codex_raw_input",
      update: {
        sessionUpdate: "tool_call_update",
        rawInput: {
          server: "mcp_router",
          tool: "find_referencing_symbols",
          arguments: { relative_path: "packages/shared/src/session-timeline.ts" },
        },
        toolCall: {
          id: "call_nested_codex_raw_input",
          kind: "other",
          title: "call_nested_codex_raw_input",
          status: "completed",
          input: {},
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/find_referencing_symbols");
  assert.equal(mapped.event.toolCall.input, JSON.stringify({
    server: "mcp_router",
    tool: "find_referencing_symbols",
    arguments: { relative_path: "packages/shared/src/session-timeline.ts" },
  }));
});

test("mapSessionUpdateNotification correlates nested Codex completions by the outer toolCallId", () => {
  const sessionId = "sess_nested_codex_completion";
  const createPayload = (update: Record<string, unknown>) => ({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  });
  const started = mapSessionUpdateNotification(
    createPayload({
      sessionUpdate: "tool_call",
      toolCallId: "call_codex_codebase_search",
      title: "Tool: mcp_router/codebase_search",
      status: "in_progress",
      rawInput: {
        server: "mcp_router",
        tool: "codebase_search",
        arguments: { repo_path: "D:\\repo", search_string: "tool lifecycle" },
      },
    }),
    { providerId: "codex" },
  );
  const completed = mapSessionUpdateNotification(
    createPayload({
      sessionUpdate: "tool_call_update",
      toolCallId: "call_codex_codebase_search",
      status: "completed",
      toolCall: {
        status: "in_progress",
        output: "result\n".repeat(2_048),
      },
    }),
    { providerId: "codex" },
  );

  assert.equal(started?.event.type, "tool-call");
  assert.equal(completed?.event.type, "tool-call");
  if (started?.event.type !== "tool-call" || completed?.event.type !== "tool-call") {
    throw new Error("Expected tool-call events");
  }
  assert.equal(started.event.toolCall.id, "call_codex_codebase_search");
  assert.equal(completed.event.toolCall.id, started.event.toolCall.id);
  assert.equal(completed.event.toolCall.status, "completed");
  assert.equal(completed.event.toolCall.output?.length, 7 * 2_048);
});

test("mapSessionUpdateNotification classifies MCP tools from rawInput server and tool", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-tools",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-mcp",
        title: "call-mcp",
        status: "in_progress",
        rawInput: { server: "sanshu", tool: "zhi", arguments: { message: "review" } },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: sanshu/zhi");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "sanshu",
    toolName: "zhi",
    source: "structured-input",
  });
});

test("mapSessionUpdateNotification derives MCP tools from server_name and request.name payloads", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-mcp-request-shape",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-mcp-request-shape",
        title: "call-mcp-request-shape",
        status: "in_progress",
        rawInput: {
          server_name: "mcp_router",
          request: { name: "find_symbol" },
          arguments: { relative_path: "apps/deck/src/features/server-events/session-events.ts" },
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/find_symbol");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "mcp_router",
    toolName: "find_symbol",
    source: "structured-input",
  });
  assert.equal(mapped.event.toolCall.input, JSON.stringify({
    server_name: "mcp_router",
    request: { name: "find_symbol" },
    arguments: { relative_path: "apps/deck/src/features/server-events/session-events.ts" },
  }));
});

test("mapSessionUpdateNotification maps ACP plan updates", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-plan",
      update: {
        sessionUpdate: "plan",
        entries: [
          { content: "Map plan update", priority: "high", status: "in_progress" },
        ],
      },
    },
  });

  assert.equal(mapped?.event.type, "plan-update");
  if (mapped?.event.type !== "plan-update") {
    throw new Error("Expected plan-update event");
  }
  assert.deepEqual(mapped.event.plan.entries, [
    { content: "Map plan update", priority: "high", status: "in_progress" },
  ]);
});

test("mapSessionUpdateNotification ignores empty ACP plan updates", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-empty-plan",
      update: {
        sessionUpdate: "plan",
        entries: [],
      },
    },
  });

  assert.equal(mapped, null);
});

test("mapSessionUpdateNotificationBatch preserves Codex update_plan tools before derived plans", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-plan",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-plan",
          title: "update_plan",
          status: "completed",
          rawInput: {
            plan: [
              { step: "检查同步链路", status: "completed" },
              { step: "修复 Codex plan 投影", status: "in_progress" },
              { step: "跑回归测试", status: "pending" },
            ],
          },
        },
      },
    },
    {
      provider: {
        id: "codex",
        name: "Codex",
        command: "codex-acp",
        transport: "stdio",
        protocol: "acp",
      },
      providerId: "codex",
    },
  );

  assert.deepEqual(mapped?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const planEvent = mapped?.events[1];
  if (planEvent?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(planEvent.plan.entries, [
    { content: "检查同步链路", priority: "medium", status: "completed" },
    { content: "修复 Codex plan 投影", priority: "medium", status: "in_progress" },
    { content: "跑回归测试", priority: "medium", status: "pending" },
  ]);
});

test("mapSessionUpdateNotification does not classify generic payload hints as subagent", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-subagent-tool",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-subagent",
        title: "Agent",
        status: "in_progress",
        rawInput: {
          prompt: "Find all API endpoints",
          description: "Find API endpoints",
          subagent_type: "Explore",
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "tool");
  assert.equal(mapped.event.toolCall.title, "Agent");
});

test("mapSessionUpdateNotification classifies explicit source subagent kinds", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-task-tool",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-task-tool",
          kind: "subagent",
          title: "delegate_task",
          status: "in_progress",
          rawInput: { prompt: "Inspect session flow" },
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
  assert.equal(mapped.event.toolCall.title, "delegate_task");
});

test("mapSessionUpdateNotification keeps mode-only config updates out of plan projection", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-plan-mode-config",
      update: {
        sessionUpdate: "config_option_update",
        configOptions: [
          { id: "mode", category: "mode", currentValue: "plan", selectedValue: "plan", value: "plan" },
        ],
      },
    },
  });

  assert.equal(mapped?.event.type, "config-options");
  if (mapped?.event.type !== "config-options") {
    throw new Error("Expected config-options event");
  }
  assert.equal(mapped.event.state.agentMode, "plan");
});

test("mapSessionUpdateNotification does not infer subagent from task text in normal titles", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-search-task-title",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-search-task-title",
        title: "Search task notes",
        status: "completed",
        rawInput: { query: "task notes" },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
  assert.equal(mapped.event.toolCall.title, "Search task notes");
});

test("mapSessionUpdateNotification classifies MCP tools from stringified input", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-tools-input",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-mcp-input",
        title: "call-mcp-input",
        status: "in_progress",
        input: JSON.stringify({ server: "node_repl", tool: "js", arguments: { code: "1 + 1" } }),
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: node_repl/js");
});

test("mapSessionUpdateNotification classifies MCP tools from nested state input", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-tools-state-input",
      update: {
        sessionUpdate: "tool_call_update",
        toolCall: {
          id: "call-mcp-state-input",
          title: "call-mcp-state-input",
          status: "completed",
          state: {
            input: JSON.stringify({ server: "node_repl", tool: "js", arguments: { code: "1 + 1" } }),
          },
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: node_repl/js");
});

test("mapSessionUpdateNotification infers MCP tools from common structured payload shapes", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-tools-structured-input",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-structured-input",
        title: "call-structured-input",
        status: "completed",
        input: JSON.stringify({
          title: "执行 1+1",
          code: "nodeRepl.write(String(1 + 1));",
          timeout_ms: 10000,
        }),
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: node_repl/js");
});

test("mapSessionUpdateNotification classifies ACP tool kinds without provider special cases", () => {
  const cases = [
    { acpKind: "read", expected: "read" },
    { acpKind: "edit", expected: "write" },
    { acpKind: "delete", expected: "write" },
    { acpKind: "move", expected: "write" },
    { acpKind: "execute", expected: "shell" },
    { acpKind: "search", expected: "search" },
    { acpKind: "think", expected: "think" },
    { acpKind: "fetch", expected: "fetch" },
  ] as const;

  for (const item of cases) {
    const mapped = mapSessionUpdateNotification({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: `session-${item.acpKind}`,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: `call-${item.acpKind}`,
          title: `Tool ${item.acpKind}`,
          kind: item.acpKind,
          status: "in_progress",
        },
      },
    });
    assert.equal(mapped?.event.type, "tool-call");
    if (mapped?.event.type !== "tool-call") {
      throw new Error("Expected tool-call event");
    }
    assert.equal(mapped.event.toolCall.kind, item.expected);
  }
});

test("mapSessionUpdateNotification keeps explicit shell kind for grep-like terminal commands", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-shell-grep",
      update: {
        sessionUpdate: "tool_call_update",
        toolCall: {
          id: "call-shell-grep",
          kind: "shell",
          title: "grep -n \"tool_call\" apps/helm/src/runtime/events.ts",
          status: "completed",
          input: "{}",
          timestamp: "2026-07-07T00:34:41.000Z",
          updatedAt: "2026-07-07T00:34:41.000Z",
        },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification classifies skill-shaped rawInput before generic MCP", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-skill-tool",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-skill",
        title: "call-skill",
        status: "in_progress",
        rawInput: { server: "private-tooling", tool: "run", skillName: "frontend-design", arguments: { prompt: "polish UI" } },
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "skill");
  assert.equal(mapped.event.toolCall.title, "Tool: private-tooling/run");
});

test("mapSessionUpdateNotification does not expose opaque call ids as primary titles", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-opaque-title",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_RUs6aeyyj0Tgyfxal2obKoEU",
        title: "call_RUs6aeyyj0Tgyfxal2obKoEU",
        status: "in_progress",
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.title, "Tool call call_RUs6…");
});

test("mapSessionUpdateNotification maps sparse tool call updates as weak metadata patches", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-sparse-tool-update",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_01Sparse",
        status: "completed",
        rawOutput: "ok",
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.id, "toolu_01Sparse");
  assert.equal(mapped.event.toolCall.kind, "tool");
  assert.equal(mapped.event.toolCall.title, "Tool call toolu_01S…");
  assert.equal(mapped.event.toolCall.status, "completed");
  assert.equal(mapped.event.toolCall.output, "ok");
});

test("mapSessionUpdateNotification maps explicit tool call updates", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "sess_tool",
      update: {
        type: "tool_call_update",
        toolCall: {
          id: "tool_1",
          kind: "terminal",
          title: "Run tests",
          status: "completed",
          commandId: "cmd_1",
          output: "PASS src/index.test.ts",
          stream: "stdout",
        },
      },
    },
  });

  assert.ok(mapped);
  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.id, "tool_1");
  assert.equal(mapped.event.toolCall.kind, "shell");
  assert.equal(mapped.event.toolCall.status, "completed");
  assert.equal(mapped.event.toolCall.output, "PASS src/index.test.ts");
});

test("sanitizeProtocolLogPayload redacts streamed session update text", () => {
  const sanitized = sanitizeProtocolLogPayload({
    method: "session/update",
    params: {
      sessionId: "sess_123",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_1",
        content: { type: "text", text: "SECRET_STREAM_TEXT" },
      },
    },
  });
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(serialized, /SECRET_STREAM_TEXT/);
  assert.match(serialized, /agent_message_chunk/);
  assert.match(serialized, /msg_1/);
  assert.match(serialized, /chars=18/);
});
