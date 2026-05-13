import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionConfigSupport, type SessionSummary } from "@tiller/shared";
import {
  formatAgentModeLabel,
  resolveAgentModeOptions,
  resolveCurrentAgentMode,
  resolveDraftConfigOptions,
  resolveRenderableSessionConfigOptions,
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
