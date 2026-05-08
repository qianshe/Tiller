import assert from "node:assert/strict";
import test from "node:test";
import { resolveNewSessionIdentity } from "./session-identity.js";

test("new ACP session identity requires project, workspace, and agent", () => {
  assert.equal(
    resolveNewSessionIdentity({ projects: [], workspaces: [], agents: [] }),
    null,
  );
  assert.equal(
    resolveNewSessionIdentity({
      projects: [{ id: "project-1" }],
      workspaces: [{ id: "workspace-1" }],
      agents: [{ id: "codex" }],
    }),
    null,
  );
  assert.deepEqual(
    resolveNewSessionIdentity({
      projects: [{ id: "project-1" }],
      workspaces: [{ id: "workspace-1" }],
      selectedAgentId: "codex",
      agents: [{ id: "codex" }],
    }),
    { projectId: "project-1", workspaceId: "workspace-1", agentId: "codex" },
  );
});

test("new ACP session identity prefers explicit draft selections", () => {
  assert.deepEqual(
    resolveNewSessionIdentity({
      selectedProjectId: "project-selected",
      projects: [{ id: "project-1" }],
      selectedWorkspace: { id: "workspace-selected" },
      workspaces: [{ id: "workspace-1" }],
      selectedAgentId: "opencode",
      agents: [{ id: "codex" }],
    }),
    {
      projectId: "project-selected",
      workspaceId: "workspace-selected",
      agentId: "opencode",
    },
  );
});
