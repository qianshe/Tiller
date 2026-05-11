import assert from "node:assert/strict";
import test from "node:test";
import {
  mapSessionUpdateNotification,
  sanitizeProtocolLogPayload,
  summarizeSessionUpdateNotification,
} from "./runtime";

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
    })),
    [
      { name: "ralph-loop", kind: "builtin", rawKind: undefined },
      { name: "frontend-design", kind: "skill", rawKind: "skill" },
      { name: "review", kind: "command", rawKind: undefined },
    ],
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
  assert.equal(mapped.event.toolCall.kind, "terminal");
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
