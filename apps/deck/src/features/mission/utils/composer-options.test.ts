import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";
import { resolveSessionConfigSupport, type SessionSummary } from "@tiller/shared";
import {
  formatAgentModeLabel,
  resolveAgentModeOptions,
  resolveCurrentAgentMode,
  resolveDraftConfigOptions,
  resolveRenderableSessionConfigOptions,
  summarizeSessionContext,
  toSessionConfigPreferencePatch,
} from "./composer-options";

function session(id: string, agentId: string) {
  return {
    id,
    agentId,
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    cwd: "D:/workspace/project-1",
    worktreeName: "Worktree",
    agentName: agentId,
    status: "idle",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    messageCount: 0,
  } satisfies SessionSummary;
}

test("resolveDraftConfigOptions falls back to same-agent cached options for active sessions", () => {
  const active = session("session-active", "opencode");
  const cached = session("session-cached", "opencode");
  const other = session("session-other", "codex");
  const cachedOptions = [
    {
      id: "agent",
      category: "mode",
      options: [{ value: "Sisyphus", label: "Sisyphus" }],
    },
  ];

  assert.deepEqual(
    resolveDraftConfigOptions(active, [active, other, cached], {
      [other.id]: [{ id: "model", category: "model", options: [] }],
      [cached.id]: cachedOptions,
    }),
    cachedOptions,
  );
});

test("resolveDraftConfigOptions prefers active session options when present", () => {
  const active = session("session-active", "opencode");
  const cached = session("session-cached", "opencode");
  const activeOptions = [{ id: "model", category: "model", options: [] }];
  const cachedOptions = [{ id: "agent", category: "mode", options: [] }];

  assert.deepEqual(
    resolveDraftConfigOptions(active, [active, cached], {
      [active.id]: activeOptions,
      [cached.id]: cachedOptions,
    }),
    activeOptions,
  );
});

test("resolveDraftConfigOptions uses the active session config when the cache is empty", () => {
  const activeOptions = [{
    id: "model",
    category: "model",
    options: [{ value: "cpa-claude/deepseek-v4-flash", label: "DeepSeek" }],
    currentValue: "cpa-claude/deepseek-v4-flash",
  }];
  const active = {
    ...session("session-active", "opencode"),
    configOptions: activeOptions,
  } satisfies SessionSummary;

  assert.deepEqual(
    resolveDraftConfigOptions(active, [active], {}),
    activeOptions,
  );
});

test("resolveCurrentAgentMode keeps current agent mode when no mode options are available", () => {
  assert.equal(
    resolveCurrentAgentMode("bypassPermissions", [
      { id: "model", category: "model", currentValue: "claude-opus-4-7[1m]" },
    ]),
    "bypassPermissions",
  );
});

test("formatAgentModeLabel converts provider values to readable labels", () => {
  assert.equal(formatAgentModeLabel("bypassPermissions"), "Bypass Permissions");
  assert.equal(formatAgentModeLabel("sisyphus-ultraworker"), "Sisyphus Ultraworker");
  assert.equal(formatAgentModeLabel("Sisyphus - Ultraworker"), "Sisyphus - Ultraworker");
});

test("resolveAgentModeOptions preserves ACP-provided permission mode choices", () => {
  assert.deepEqual(
    resolveAgentModeOptions([
      {
        id: "permission-mode",
        name: "Permission Mode",
        category: "mode",
        currentValue: "bypassPermissions",
        options: [
          { value: "default", label: "Default" },
          { value: "bypassPermissions", label: "Bypass Permissions" },
        ],
      },
    ]),
    [
      { value: "default", label: "Default" },
      { value: "bypassPermissions", label: "Bypass Permissions" },
    ],
  );
});

test("resolveRenderableSessionConfigOptions keeps ACP config choices as UI-ready controls", () => {
  const controls = resolveRenderableSessionConfigOptions([
    {
      id: "permission-mode",
      name: "Permission Mode",
      category: "mode",
      currentValue: "bypassPermissions",
      options: [
        { value: "default", label: "Default" },
        { value: "bypassPermissions", label: "Bypass Permissions" },
      ],
    },
    {
      id: "web-search",
      name: "Web Search",
      category: "toggle",
      currentValue: true,
    },
    {
      id: "empty",
      name: "Empty",
      category: "other",
    },
  ]);

  assert.deepEqual(
    controls.map((control) => ({
      pickerId: control.pickerId,
      currentLabel: control.currentLabel,
      values: control.values,
    })),
    [
      {
        pickerId: "config:permission-mode",
        currentLabel: "Bypass Permissions",
        values: [
          { value: "default", label: "Default" },
          { value: "bypassPermissions", label: "Bypass Permissions" },
        ],
      },
      {
        pickerId: "config:web-search",
        currentLabel: "true",
        values: [
          { value: true, label: "True" },
          { value: false, label: "False" },
        ],
      },
    ],
  );
});

test("toSessionConfigPreferencePatch uses direct config id and derives legacy state only for local UI", () => {
  assert.deepEqual(
    toSessionConfigPreferencePatch(
      { id: "permission-mode", category: "mode" },
      "bypassPermissions",
    ),
    {
      configId: "permission-mode",
      value: "bypassPermissions",
      agentMode: "bypassPermissions",
    },
  );
  assert.deepEqual(
    toSessionConfigPreferencePatch({ id: "web-search" }, true),
    { configId: "web-search", value: true },
  );
  assert.deepEqual(
    toSessionConfigPreferencePatch(
      { id: "effort", category: "reasoning_effort" },
      "high",
    ),
    { configId: "effort", value: "high", reasoningEffort: "high" },
  );
});

test("resolveSessionConfigSupport does not infer support from command names without capabilities", () => {
  assert.deepEqual(
    resolveSessionConfigSupport({ command: "opencode" }),
    { model: "none", reasoningEffort: "none" },
  );
});

test("summarizeSessionContext focuses on recent dialogue instead of runtime metadata", () => {
  const active = { ...session("session-active", "opencode"), messageCount: 14 };
  const messages: AgentMessage[] = [
    {
      id: "u1",
      role: "user",
      text: "请检查会话恢复时重复 user 消息的问题。",
      timestamp: "2026-05-15T00:00:00.000Z",
    },
    {
      id: "a1",
      role: "assistant",
      text: "结论：重复来自 provider exportHistory 返回额外重组 prompt，应该在同步阶段过滤。",
      timestamp: "2026-05-15T00:00:01.000Z",
    },
  ];

  const summary = summarizeSessionContext(active, messages);

  assert.match(summary, /最近问答与结论/);
  assert.match(summary, /用户：请检查会话恢复/);
  assert.match(summary, /助手结论：结论：重复来自/);
  assert.doesNotMatch(summary, /Session session-active is idle/);
  assert.doesNotMatch(summary, /messages: 14/);
});

test("summarizeSessionContext compresses long code and mermaid blocks", () => {
  const active = session("session-active", "opencode");
  const messages: AgentMessage[] = [
    {
      id: "a1",
      role: "assistant",
      text: "```mermaid\nsequenceDiagram\nA->>B: very long diagram\n```\n结论：保留关键判断。",
      timestamp: "2026-05-15T00:00:01.000Z",
    },
    {
      id: "a2",
      role: "assistant",
      text: `长回复：${"x".repeat(500)}`,
      timestamp: "2026-05-15T00:00:02.000Z",
    },
  ];

  const summary = summarizeSessionContext(active, messages);

  assert.match(summary, /\[Mermaid 图已省略\]/);
  assert.match(summary, /长回复：x+/);
  assert.match(summary, /…/);
  assert.ok(summary.length < 1800);
});
