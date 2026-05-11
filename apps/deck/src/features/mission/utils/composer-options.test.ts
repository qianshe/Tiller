import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionConfigSupport, type SessionSummary } from "@tiller/shared";
import { formatAgentModeLabel, resolveCurrentAgentMode, resolveDraftConfigOptions } from "./composer-options";

function session(id: string, agentId: string) {
  return {
    id,
    agentId,
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace",
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

test("resolveSessionConfigSupport does not infer support from command names without capabilities", () => {
  assert.deepEqual(
    resolveSessionConfigSupport({ command: "opencode" }),
    { model: "none", reasoningEffort: "none" },
  );
});
