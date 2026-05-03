import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySessionLaunchOverrides,
  buildOpenCodeConfigOverride,
  resolveSessionEnvOverrides,
  mapSessionUpdateNotification,
  normalizeAcpAgentSessionListResult,
  normalizeProviderCleanupResult,
  DEFAULT_ACP_PROMPT_TIMEOUT_MS,
  DEFAULT_ACP_REQUEST_TIMEOUT_MS,
  resolveAcpAgentAdapter,
  resolveAcpLaunchConfig,
  resolveAdapterCleanupPlan,
  resolvePreferredAgentId,
  resolveRuntimeSessionId,
  resolveSessionCapabilities,
  sanitizeProtocolLogPayload,
} from "./runtime";

test("default ACP request timeout allows slow session/new responses", () => {
  assert.equal(DEFAULT_ACP_REQUEST_TIMEOUT_MS, 30_000);
});

test("default ACP prompt timeout allows long-running agent turns", () => {
  assert.equal(DEFAULT_ACP_PROMPT_TIMEOUT_MS, 30 * 60_000);
});

test("normalizeAcpAgentSessionListResult accepts camelCase and snake_case ACP session entries", () => {
  assert.deepEqual(normalizeAcpAgentSessionListResult({
    sessions: [
      { session_id: "sess_1", cwd: "D:/repo", title: "Fix bug", updated_at: "2026-04-30T00:00:00Z", meta: { source: "agent" } },
      { sessionId: "sess_2", updatedAt: "2026-04-30T01:00:00Z" },
      { title: "missing id" },
    ],
    next_cursor: "next-page",
    meta: { total: 2 },
  }), {
    sessions: [
      { sessionId: "sess_1", cwd: "D:/repo", title: "Fix bug", updatedAt: "2026-04-30T00:00:00Z", meta: { source: "agent" } },
      { sessionId: "sess_2", cwd: undefined, title: undefined, updatedAt: "2026-04-30T01:00:00Z", meta: undefined },
    ],
    nextCursor: "next-page",
    meta: { total: 2 },
  });
});

test("resolveSessionCapabilities reads initialize and provider capability hints", () => {
  assert.deepEqual(
    resolveSessionCapabilities({ capabilities: { session: { load: true, resume: true, list: true } } }),
    { sessionLoad: true, sessionResume: true, sessionList: true, sessionClose: false, sessionDelete: false, imageInput: false },
  );
  assert.deepEqual(
    resolveSessionCapabilities({}, { id: "agent", name: "Agent", command: "agent", transport: "stdio", protocol: "acp", capabilities: { sessionResume: true } }),
    { sessionLoad: false, sessionResume: true, sessionList: false, sessionClose: false, sessionDelete: false, imageInput: false },
  );
  assert.deepEqual(
    resolveSessionCapabilities({ capabilities: { session: { close: true, delete: true } } }),
    { sessionLoad: false, sessionResume: false, sessionList: false, sessionClose: true, sessionDelete: true, imageInput: false },
  );
  assert.deepEqual(
    resolveSessionCapabilities({ promptCapabilities: { image: true } }),
    { sessionLoad: false, sessionResume: false, sessionList: false, sessionClose: false, sessionDelete: false, imageInput: true },
  );
});

test("resolveAcpAgentAdapter chooses provider-specific adapters before generic fallback", () => {
  assert.equal(resolveAcpAgentAdapter({ id: "opencode", name: "OpenCode", command: "opencode", args: ["acp"], transport: "stdio", protocol: "acp" }).id, "opencode");
  assert.equal(resolveAcpAgentAdapter({ id: "codex", name: "Codex", command: "codex-acp", transport: "stdio", protocol: "acp" }).id, "codex");
  assert.equal(resolveAcpAgentAdapter({ id: "claude-acp", name: "Claude Agent", command: "claude-acp", transport: "stdio", protocol: "acp" }).id, "claude");
  assert.equal(resolveAcpAgentAdapter({ id: "openclaw", name: "OpenClaw", command: "openclaw", transport: "stdio", protocol: "acp" }).id, "openclaw");
  assert.equal(resolveAcpAgentAdapter({ id: "custom", name: "Custom", command: "custom-acp", transport: "stdio", protocol: "acp" }).id, "generic");
});

test("resolveAcpLaunchConfig keeps provider-specific command and env handling behind adapters", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-adapter-"));
  try {
    const openCode = resolveAcpLaunchConfig(
      { id: "opencode", name: "OpenCode", command: "opencode", args: ["acp", "--pure"], env: { EXISTING: "1" }, transport: "stdio", protocol: "acp" },
      { fallbackCwd: tempDir, sessionConfig: { model: "openai/gpt-5.4", reasoningEffort: "high" } },
    );
    assert.deepEqual(openCode.args, ["acp", "--pure", "--port", "0"]);
    assert.equal(openCode.cwd, tempDir);
    assert.equal(openCode.env.EXISTING, "1");
    assert.equal(typeof openCode.env.OPENCODE_CONFIG_CONTENT, "string");

    const codex = resolveAcpLaunchConfig(
      { id: "codex", name: "Codex", command: "codex-acp", args: [], transport: "stdio", protocol: "acp" },
      { fallbackCwd: tempDir, sessionConfig: { model: "gpt-5.4-mini", reasoningEffort: "high" } },
    );
    assert.deepEqual(codex.args, ["-c", 'model="gpt-5.4-mini"', "-c", 'model_reasoning_effort="high"']);
    assert.deepEqual(codex.env, {});

    const claude = resolveAcpLaunchConfig(
      { id: "claude-acp", name: "Claude Agent", command: "claude-acp", args: [], env: { CLAUDE_CODE_ENTRYPOINT: "sdk" }, transport: "stdio", protocol: "acp" },
      { fallbackCwd: tempDir },
    );
    assert.deepEqual(claude.args, []);
    assert.equal(claude.env.ANTHROPIC_API_KEY, "");
    assert.equal(claude.env.CLAUDE_CODE_ENTRYPOINT, "sdk");

    const openClaw = resolveAcpLaunchConfig(
      { id: "openclaw", name: "OpenClaw", command: "openclaw", args: ["acp"], transport: "stdio", protocol: "acp" },
      { fallbackCwd: tempDir },
    );
    assert.deepEqual(openClaw.args, ["acp"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveAdapterCleanupPlan delegates provider-native cleanup to adapters", () => {
  assert.deepEqual(resolveAdapterCleanupPlan({ id: "opencode", name: "OpenCode", command: "opencode", args: ["acp", "--pure"], transport: "stdio", protocol: "acp" }, "ses_1"), {
    kind: "remote-delete",
    providerId: "opencode",
    runtimeSessionId: "ses_1",
    command: "opencode",
    args: ["session", "delete", "ses_1", "--pure"],
  });
  assert.deepEqual(resolveAdapterCleanupPlan({ id: "codex", name: "Codex", command: "codex-acp", transport: "stdio", protocol: "acp" }, "runtime-1"), {
    kind: "unsupported",
    providerId: "codex",
    message: "Codex ACP does not expose remote session deletion yet.",
  });
  assert.deepEqual(resolveAdapterCleanupPlan({ id: "claude-acp", name: "Claude Agent", command: "claude-acp", transport: "stdio", protocol: "acp" }, "runtime-1"), {
    kind: "unsupported",
    providerId: "claude-acp",
    message: "Claude Agent does not expose remote session deletion yet.",
  });
  assert.deepEqual(resolveAdapterCleanupPlan({ id: "openclaw", name: "OpenClaw", command: "openclaw", transport: "stdio", protocol: "acp" }, "runtime-1"), {
    kind: "unsupported",
    providerId: "openclaw",
    message: "OpenClaw does not expose remote session deletion yet.",
  });
  assert.equal(resolveAdapterCleanupPlan({ id: "custom", name: "Custom", command: "custom-acp", transport: "stdio", protocol: "acp" }, "runtime-1").kind, "unsupported");
});

test("resolvePreferredAgentId normalizes configured display agents", () => {
  assert.equal(resolvePreferredAgentId({ defaultAgent: "Sisyphus - Ultraworker" }), "sisyphus");
  assert.equal(resolvePreferredAgentId({ defaultAgent: undefined }), undefined);
});

test("resolveRuntimeSessionId prefers ACP native ids before fallback", () => {
  assert.equal(resolveRuntimeSessionId({ sessionId: "acp-session-1", id: "legacy-id" }, "tiller-session"), "acp-session-1");
  assert.equal(resolveRuntimeSessionId({ id: "legacy-id" }, "tiller-session"), "legacy-id");
  assert.equal(resolveRuntimeSessionId({}, "tiller-session"), "tiller-session");
});

test("applySessionLaunchOverrides appends codex model and reasoning config flags", () => {
  assert.deepEqual(
    applySessionLaunchOverrides("codex-acp", ["-c", 'model="gpt-5.4"'], { model: "gpt-5.4-mini", reasoningEffort: "high" }),
    ["-c", 'model="gpt-5.4"', "-c", 'model="gpt-5.4-mini"', "-c", 'model_reasoning_effort="high"'],
  );
});

test("applySessionLaunchOverrides leaves OpenCode ACP args unchanged because model config is passed through env", () => {
  assert.deepEqual(
    applySessionLaunchOverrides("opencode", ["acp", "--pure"], { model: "openai/gpt-5.4", reasoningEffort: "high" }),
    ["acp", "--pure", "--port", "0"],
  );
});

test("applySessionLaunchOverrides strips stale OpenCode model flags from ACP args", () => {
  assert.deepEqual(
    applySessionLaunchOverrides("opencode", ["-m", "anthropic/claude-sonnet-4", "acp", "--pure"], { model: "openai/gpt-5.4-mini" }),
    ["acp", "--pure", "--port", "0"],
  );
});

test("applySessionLaunchOverrides preserves explicit OpenCode ACP port args", () => {
  assert.deepEqual(applySessionLaunchOverrides("opencode", ["acp", "--port", "4097"], { model: "openai/gpt-5.4" }), ["acp", "--port", "4097"]);
});

test("applySessionLaunchOverrides leaves unsupported providers unchanged", () => {
  assert.deepEqual(applySessionLaunchOverrides("custom-agent", ["serve"], { model: "gpt-5.4", reasoningEffort: "high" }), ["serve"]);
});

test("buildOpenCodeConfigOverride emits inline config content for model and reasoning", () => {
  assert.deepEqual(buildOpenCodeConfigOverride({ model: "openai/gpt-5.4", reasoningEffort: "high" }), {
    model: "openai/gpt-5.4",
    provider: {
      openai: {
        models: {
          "gpt-5.4": {
            options: {
              reasoningEffort: "high",
            },
          },
        },
      },
    },
  });
});

test("resolveSessionEnvOverrides emits OPENCODE_CONFIG_CONTENT for OpenCode sessions", () => {
  assert.deepEqual(resolveSessionEnvOverrides("opencode", { model: "openai/gpt-5.4", reasoningEffort: "high" }), {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: "openai/gpt-5.4",
      provider: {
        openai: {
          models: {
            "gpt-5.4": {
              options: {
                reasoningEffort: "high",
              },
            },
          },
        },
      },
    }),
  });
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

test("normalizeProviderCleanupResult preserves unsupported provider responses", () => {
  assert.deepEqual(
    normalizeProviderCleanupResult({
      kind: "unsupported",
      providerId: "codex",
      message: "Codex ACP does not expose remote session deletion yet.",
    }),
    {
      remoteDeleted: false,
      remoteDeletionAttempted: false,
      providerId: "codex",
      message: "Codex ACP does not expose remote session deletion yet.",
    },
  );
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