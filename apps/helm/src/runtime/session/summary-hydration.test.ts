import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider, SessionSummary } from "@tiller/shared";
import { createSessionSummaryHydrationService } from "./summary-hydration.js";

function sessionSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "session-1",
    title: "Session",
    status: "idle",
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    messageCount: 0,
    ...overrides,
  };
}

const agent: AcpAgentProvider = {
  id: "codex",
  name: "Codex",
  command: "codex",
  transport: "stdio",
  protocol: "acp",
};

test("session summary hydration aligns project and worktree bindings", () => {
  const service = createSessionSummaryHydrationService({
    sessions: new Map(),
    getProjects: () => [{ id: "project-1", name: "Project", helmId: "helm-1", path: "D:/repo" }],
    getWorktrees: () => [{ name: "main", path: "D:/repo" }],
    getAgents: () => [agent],
    sessionRuntimeStore: { get: () => undefined },
  });

  const hydrated = service.hydrateSessionSummary(sessionSummary({ cwd: "D:/repo" }));
  assert.equal(hydrated.cwd, "D:/repo");
  assert.equal(hydrated.projectId, "project-1");
  assert.equal(hydrated.agentId, "codex");
});

test("session summary hydration preserves explicit model and reasoning when runtime state is absent", () => {
  const service = createSessionSummaryHydrationService({
    sessions: new Map(),
    getProjects: () => [{ id: "project-1", name: "Project", helmId: "helm-1", path: "D:/repo" }],
    getWorktrees: () => [{ name: "main", path: "D:/repo" }],
    getAgents: () => [agent],
    sessionRuntimeStore: { get: () => undefined },
  });

  const hydrated = service.hydrateSessionSummary(sessionSummary({ model: "gpt-5.5", reasoningEffort: "medium" }));
  assert.equal(hydrated.model, "gpt-5.5");
  assert.equal(hydrated.reasoningEffort, "medium");
});
