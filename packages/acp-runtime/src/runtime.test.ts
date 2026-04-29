import test from "node:test";
import assert from "node:assert/strict";
import {
  applySessionLaunchOverrides,
  buildOpenCodeConfigOverride,
  buildSessionLoadRequest,
  buildSessionNewRequest,
  buildSessionPromptRequest,
  buildSessionResumeRequest,
  buildSessionSetModelRequest,
  resolveSessionEnvOverrides,
  mapSessionUpdateNotification,
  normalizeProviderCleanupResult,
  resolvePreferredAgentId,
  resolveRuntimeSessionId,
  resolveSessionCapabilities,
} from "./runtime";

test("buildSessionNewRequest uses ACP session/new shape", () => {
  assert.deepEqual(buildSessionNewRequest("req-1", "D:/myProject/tools/Tiller"), {
    jsonrpc: "2.0",
    id: "req-1",
    method: "session/new",
    params: {
      cwd: "D:/myProject/tools/Tiller",
      mcpServers: [],
    },
  });
});

test("buildSessionSetModelRequest uses ACP session/set_model shape", () => {
  assert.deepEqual(buildSessionSetModelRequest("req-model", "sess-1", "openai/gpt-5.4"), {
    jsonrpc: "2.0",
    id: "req-model",
    method: "session/set_model",
    params: {
      sessionId: "sess-1",
      modelId: "openai/gpt-5.4",
    },
  });
});

test("buildSessionLoadRequest uses ACP session/load shape", () => {
  assert.deepEqual(buildSessionLoadRequest("req-load", "sess_123", "D:/myProject/tools/Tiller"), {
    jsonrpc: "2.0",
    id: "req-load",
    method: "session/load",
    params: {
      sessionId: "sess_123",
      cwd: "D:/myProject/tools/Tiller",
      mcpServers: [],
    },
  });
});

test("buildSessionResumeRequest uses ACP session/resume shape", () => {
  assert.deepEqual(buildSessionResumeRequest("req-resume", "sess_123", "D:/myProject/tools/Tiller"), {
    jsonrpc: "2.0",
    id: "req-resume",
    method: "session/resume",
    params: {
      sessionId: "sess_123",
      cwd: "D:/myProject/tools/Tiller",
      mcpServers: [],
    },
  });
});

test("resolveSessionCapabilities reads initialize and provider capability hints", () => {
  assert.deepEqual(
    resolveSessionCapabilities({ capabilities: { session: { load: true, resume: true, list: true } } }),
    { sessionLoad: true, sessionResume: true, sessionList: true },
  );
  assert.deepEqual(
    resolveSessionCapabilities({}, { id: "agent", name: "Agent", command: "agent", transport: "stdio", protocol: "acp", capabilities: { sessionResume: true } }),
    { sessionLoad: false, sessionResume: true, sessionList: false },
  );
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

test("buildSessionPromptRequest wraps text as ACP prompt content", () => {
  assert.deepEqual(buildSessionPromptRequest("req-2", "sess_123", "你好"), {
    jsonrpc: "2.0",
    id: "req-2",
    method: "session/prompt",
    params: {
      sessionId: "sess_123",
      prompt: [{ type: "text", text: "你好" }],
    },
  });
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
