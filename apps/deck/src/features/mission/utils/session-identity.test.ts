import assert from "node:assert/strict";
import test from "node:test";
import { resolveNewSessionIdentity } from "./session-identity.js";

test("new ACP session identity requires project cwd and agent", () => {
  assert.equal(
    resolveNewSessionIdentity({ projects: [], workspaces: [], agents: [] }),
    null,
  );
  assert.equal(
    resolveNewSessionIdentity({
      projects: [{ id: "project-1" }],
      workspaces: [{ id: "workspace-1", path: "D:/repo" }],
      agents: [{ id: "codex" }],
    }),
    null,
  );
  assert.deepEqual(
    resolveNewSessionIdentity({
      projects: [{ id: "project-1", path: "D:/repo" }],
      workspaces: [],
      selectedAgentId: "codex",
      agents: [{ id: "codex" }],
    }),
    { projectId: "project-1", cwd: "D:/repo", agentId: "codex" },
  );
});

test("new ACP session identity prefers explicit draft selections", () => {
  assert.deepEqual(
    resolveNewSessionIdentity({
      selectedProjectId: "project-selected",
      projects: [{ id: "project-selected", path: "D:/project" }],
      selectedWorkspace: { id: "workspace-selected", path: "D:/worktree" },
      workspaces: [{ id: "workspace-1", path: "D:/repo" }],
      selectedAgentId: "opencode",
      agents: [{ id: "codex" }],
    }),
    {
      projectId: "project-selected",
      cwd: "D:/worktree",
      agentId: "opencode",
    },
  );
});
