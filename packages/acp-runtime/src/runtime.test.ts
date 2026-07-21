import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOpenCodeConfigOverride,
  CLAUDE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  normalizeAcpAgentSessionListResult,
  normalizeProviderCleanupResult,
  DEFAULT_ACP_PROMPT_TIMEOUT_MS,
  DEFAULT_ACP_REQUEST_TIMEOUT_MS,
  OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  resolveAcpRequestTimeout,
  resolveAcpAgentAdapter,
  resolveAcpLaunchConfig,
  resolveAdapterCleanupPlan,
  resolveAdapterCompactionDetailsVisibility,
  resolveAdapterRequestTimeout,
  resolveAdapterPluginManifest,
  extractAdapterPlanFromToolCall,
  isAdapterPlanToolCall,
  resolvePreferredAgentId,
  resolveRuntimeSessionId,
  resolveSessionCapabilities,
} from "./runtime";
import { resolveLaunchSpec } from "./process";

test("default ACP request timeout allows slow session/new responses", () => {
  assert.equal(DEFAULT_ACP_REQUEST_TIMEOUT_MS, 30_000);
});

test("default ACP prompt timeout allows long-running agent turns", () => {
  assert.equal(DEFAULT_ACP_PROMPT_TIMEOUT_MS, 30 * 60_000);
  assert.equal(
    resolveAcpRequestTimeout(
      { id: "codex", name: "Codex", command: "codex-acp", transport: "stdio", protocol: "acp" },
      "session/prompt",
    ),
    DEFAULT_ACP_PROMPT_TIMEOUT_MS,
  );
  assert.equal(
    resolveAcpRequestTimeout(
      {
        id: "custom",
        name: "Custom",
        command: "custom-acp",
        transport: "stdio",
        protocol: "acp",
        initializeTimeoutMs: 5_000,
        promptTimeoutMs: 45_000,
      },
      "session/prompt",
    ),
    45_000,
  );
});

test("adapter request timeout resolver keeps OpenCode session requests behind provider adapter", () => {
  assert.equal(OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS, 120_000);
  assert.equal(
    resolveAdapterRequestTimeout(
      { id: "opencode", name: "OpenCode", command: "opencode", args: ["acp"], transport: "stdio", protocol: "acp" },
      "session/new",
    ),
    OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  );
  assert.equal(
    resolveAdapterRequestTimeout(
      { id: "custom", name: "Custom", command: "custom-acp", transport: "stdio", protocol: "acp" },
      "session/new",
    ),
    undefined,
  );
});

test("OpenCode ACP session creation uses a longer request timeout", () => {
  assert.equal(OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS, 120_000);
  assert.equal(
    resolveAcpRequestTimeout(
      { id: "opencode", name: "OpenCode", command: "opencode", args: ["acp"], transport: "stdio", protocol: "acp" },
      "session/new",
    ),
    OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  );
  assert.equal(
    resolveAcpRequestTimeout(
      { id: "custom", name: "Custom", command: "custom-acp", transport: "stdio", protocol: "acp" },
      "session/new",
    ),
    DEFAULT_ACP_REQUEST_TIMEOUT_MS,
  );
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

test("Codex adapter exposes bounded prompt observation for missing multi-agent notifications", () => {
  const adapter = resolveAcpAgentAdapter({
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio",
    protocol: "acp",
  });
  assert.equal(typeof adapter.beginPromptObservation, "function");
  assert.equal(typeof adapter.pollPromptToolObservations, "function");
});

test("Claude ACP session restore uses a longer request timeout", () => {
  assert.equal(CLAUDE_ACP_SESSION_REQUEST_TIMEOUT_MS, 120_000);
  const provider = {
    id: "claudecode",
    name: "Claude Code",
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };

  assert.equal(
    resolveAdapterRequestTimeout(provider, "session/load"),
    CLAUDE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  );
  assert.equal(
    resolveAdapterRequestTimeout(provider, "session/resume"),
    CLAUDE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  );
  assert.equal(resolveAdapterRequestTimeout(provider, "session/prompt"), undefined);
  assert.equal(
    resolveAcpRequestTimeout(provider, "session/load"),
    CLAUDE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  );
});

test("tool-call plan repair stays behind provider adapters", () => {
  assert.deepEqual(
    extractAdapterPlanFromToolCall("opencode", {
      id: "call-opencode-todo",
      kind: "write",
      title: "2 todos",
      status: "completed",
      input: JSON.stringify({
        todos: [
          { content: "读文件", status: "completed" },
          { content: "写总结", status: "pending" },
        ],
      }),
      timestamp: "2026-07-07T14:55:12.252Z",
      updatedAt: "2026-07-07T14:55:12.518Z",
    }),
    {
      updatedAt: "2026-07-07T14:55:12.518Z",
      entries: [
        { content: "读文件", priority: "medium", status: "completed" },
        { content: "写总结", priority: "medium", status: "pending" },
      ],
    },
  );
  assert.equal(
    extractAdapterPlanFromToolCall("custom", {
      id: "call-custom",
      kind: "write",
      title: "2 todos",
      status: "completed",
      input: JSON.stringify({ todos: [{ content: "不会被恢复", status: "pending" }] }),
      timestamp: "2026-07-07T14:55:12.252Z",
      updatedAt: "2026-07-07T14:55:12.518Z",
    }),
    null,
  );
  assert.equal(
    isAdapterPlanToolCall("opencode", {
      id: "call-opencode-todo",
      kind: "write",
      title: "2 todos",
      status: "completed",
      input: JSON.stringify({ todos: [{ content: "读文件", status: "completed" }] }),
      timestamp: "2026-07-07T14:55:12.252Z",
      updatedAt: "2026-07-07T14:55:12.518Z",
    }),
    true,
  );
  assert.equal(
    isAdapterPlanToolCall("custom", {
      id: "call-custom",
      kind: "write",
      title: "2 todos",
      status: "completed",
      input: JSON.stringify({ todos: [{ content: "不会被恢复", status: "pending" }] }),
      timestamp: "2026-07-07T14:55:12.252Z",
      updatedAt: "2026-07-07T14:55:12.518Z",
    }),
    false,
  );
  assert.equal(
    isAdapterPlanToolCall("codex", {
      id: "call-codex-plan-generic",
      kind: "tool",
      title: "Tool call call_oDqR…",
      status: "completed",
      output: "Plan updated",
      timestamp: "2026-07-07T16:35:26.089Z",
      updatedAt: "2026-07-07T16:35:26.089Z",
    }),
    true,
  );
});

test("resolveAdapterPluginManifest exposes a disabled placeholder without loading plugins", () => {
  const manifest = resolveAdapterPluginManifest();

  assert.equal(manifest.enabled, false);
  assert.equal(manifest.kind, "provider-adapter-plugin-placeholder");
  assert.deepEqual(manifest.adapters, []);
});

test("resolveAcpLaunchConfig keeps provider-specific command and env handling behind adapters", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-acp-adapter-"));
  try {
    const openCode = resolveAcpLaunchConfig(
      {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        args: ["acp", "--pure"],
        env: {
          EXISTING: "1",
          OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { mcpServers: { enabled: false } } }),
        },
        transport: "stdio",
        protocol: "acp",
      },
      { fallbackCwd: tempDir, sessionConfig: { model: "openai/gpt-5.4", reasoningEffort: "high" } },
    );
    assert.deepEqual(openCode.args, ["acp", "--pure", "--port", "0"]);
    assert.equal(openCode.cwd, tempDir);
    assert.equal(openCode.env.EXISTING, "1");
    assert.equal(typeof openCode.env.OPENCODE_CONFIG_CONTENT, "string");
    assert.deepEqual(JSON.parse(openCode.env.OPENCODE_CONFIG_CONTENT as string), {
      mcp: { mcpServers: { enabled: false } },
      model: "openai/gpt-5.4",
      provider: {
        openai: {
          models: {
            "gpt-5.4": {
              options: { reasoningEffort: "high" },
            },
          },
        },
      },
    });

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

test("resolveAdapterCompactionDetailsVisibility keeps provider-specific compaction UI policy behind adapters", () => {
  assert.equal(resolveAdapterCompactionDetailsVisibility("codex"), undefined);
  assert.equal(resolveAdapterCompactionDetailsVisibility("claude-acp"), undefined);
  assert.equal(resolveAdapterCompactionDetailsVisibility(undefined), undefined);
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

test("resolveLaunchSpec does not apply session config a second time", () => {
  const launch = resolveLaunchSpec("codex-acp", ["-c", 'model="gpt-5.4-mini"']);

  assert.equal(launch.args.filter((arg) => arg.includes("model=")).length, 1);
  assert.equal(launch.args.some((arg) => arg.includes("model_reasoning_effort")), false);
});

test("resolveLaunchSpec unwraps npm cmd shims that forward directly to packaged executables", () => {
  if (process.platform !== "win32") {
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "tiller-opencode-cmd-"));
  const commandPath = join(tempDir, "opencode.cmd");
  const executablePath = join(tempDir, "node_modules", "opencode-ai", "bin", "opencode.exe");

  try {
    writeFileSync(
      commandPath,
      [
        "@ECHO off",
        "GOTO start",
        ":find_dp0",
        "SET dp0=%~dp0",
        "EXIT /b",
        ":start",
        "SETLOCAL",
        "CALL :find_dp0",
        "\"%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe\"   %*",
        "",
      ].join("\r\n"),
      "utf8",
    );

    const launch = resolveLaunchSpec(commandPath, ["acp", "--port", "0"]);

    assert.deepEqual(launch, {
      command: executablePath,
      args: ["acp", "--port", "0"],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Codex adapter appends model and reasoning config flags", () => {
  const launch = resolveAcpLaunchConfig(
    { id: "codex", name: "Codex", command: "codex-acp", args: ["-c", 'model="gpt-5.4"'], transport: "stdio", protocol: "acp" },
    { fallbackCwd: process.cwd(), sessionConfig: { model: "gpt-5.4-mini", reasoningEffort: "high" } },
  );

  assert.deepEqual(launch.args, ["-c", 'model="gpt-5.4"', "-c", 'model="gpt-5.4-mini"', "-c", 'model_reasoning_effort="high"']);
});

test("OpenCode adapter strips stale model flags and injects ACP port through launch config", () => {
  const launch = resolveAcpLaunchConfig(
    { id: "opencode", name: "OpenCode", command: "opencode", args: ["-m", "anthropic/claude-sonnet-4", "acp", "--pure"], transport: "stdio", protocol: "acp" },
    { fallbackCwd: process.cwd(), sessionConfig: { model: "openai/gpt-5.4-mini" } },
  );

  assert.deepEqual(launch.args, ["acp", "--pure", "--port", "0"]);
});

test("OpenCode adapter preserves explicit ACP port args", () => {
  const launch = resolveAcpLaunchConfig(
    { id: "opencode", name: "OpenCode", command: "opencode", args: ["acp", "--port", "4097"], transport: "stdio", protocol: "acp" },
    { fallbackCwd: process.cwd(), sessionConfig: { model: "openai/gpt-5.4" } },
  );

  assert.deepEqual(launch.args, ["acp", "--port", "4097"]);
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

test("OpenCode adapter emits OPENCODE_CONFIG_CONTENT for OpenCode sessions", () => {
  const launch = resolveAcpLaunchConfig(
    { id: "opencode", name: "OpenCode", command: "opencode", args: ["acp"], transport: "stdio", protocol: "acp" },
    { fallbackCwd: process.cwd(), sessionConfig: { model: "openai/gpt-5.4", reasoningEffort: "high" } },
  );

  assert.deepEqual(JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT as string), {
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
