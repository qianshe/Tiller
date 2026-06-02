import assert from "node:assert/strict";
import test from "node:test";
import {
  mapSessionUpdateNotification,
  sanitizeProtocolLogPayload,
  summarizeSessionUpdateNotification,
} from "./runtime";
import { hasSessionConfigOptionIdValue } from "./events";

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
  assert.equal(mapped.event.toolCall.input, JSON.stringify({
    server: "mcp_router",
    tool: "activate_project",
    arguments: { project: "D:\\myProject\\tools\\Tiller" },
  }));
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
});

test("mapSessionUpdateNotification classifies agent tool calls as subagent", () => {
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
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Agent");
});

test("mapSessionUpdateNotification classifies Claude task tools in the Claude adapter", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-task-tool",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-task-tool",
          toolName: "Task",
          title: "Task",
          status: "in_progress",
          rawInput: { prompt: "Inspect session flow" },
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

test("mapSessionUpdateNotification applies OpenCode provider live tool classification", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-live",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-read",
            title: "apps\\deck\\src\\features\\logbook\\message-history.ts",
            status: "completed",
            tool: "read",
            state: {
              input: { filePath: "apps/deck/src/features/logbook/message-history.ts" },
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "read");
  assert.equal(mapped.event.toolCall.title, "apps\\deck\\src\\features\\logbook\\message-history.ts");
});

test("mapSessionUpdateNotification repairs OpenCode path-only tool call history", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-path",
            kind: "tool",
            title: "apps\\helm\\src\\runtime\\events.ts",
            status: "completed",
            timestamp: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:01.000Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "read");
  assert.equal(mapped.event.toolCall.title, "apps\\helm\\src\\runtime\\events.ts");
});

test("mapSessionUpdateNotification classifies OpenCode todo tools as generic todo", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-todo",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-todo",
            title: "0 todos",
            status: "completed",
            tool: "todowrite",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "todo");
  assert.equal(mapped.event.toolCall.title, "0 todos");
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
