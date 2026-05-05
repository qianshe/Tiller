import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary, SessionSummary } from "@tiller/shared";
import { alignSessionProjectBinding } from "./binding.js";

function buildSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-alpha",
    projectName: "Alpha",
    helmId: "helm-1",
    workspaceId: "workspace-shared",
    workspaceName: "Shared Workspace",
    agentId: "agent-1",
    agentName: "OpenCode",
    status: "idle",
    createdAt: "2026-04-27T10:00:00.000Z",
    updatedAt: "2026-04-27T10:00:00.000Z",
    messageCount: 0,
    ...overrides,
  };
}

const projects: ProjectSummary[] = [
  { id: "project-alpha", name: "Alpha", helmId: "helm-1", workspaceIds: ["workspace-alpha"] },
  { id: "project-beta", name: "Beta", helmId: "helm-1", workspaceIds: ["workspace-shared"] },
];

test("alignSessionProjectBinding preserves a known stored project id over workspace fallbacks", () => {
  const aligned = alignSessionProjectBinding(buildSession(), projects);

  assert.equal(aligned.projectId, "project-alpha");
  assert.equal(aligned.projectName, "Alpha");
  assert.equal(aligned.helmId, "helm-1");
  assert.equal(aligned.workspaceId, "workspace-shared");
});

test("alignSessionProjectBinding recovers legacy sessions by project name before workspace", () => {
  const aligned = alignSessionProjectBinding(
    buildSession({
      projectId: "legacy-project",
      projectName: "Beta",
      workspaceId: "workspace-shared",
    }),
    projects,
  );

  assert.equal(aligned.projectId, "project-beta");
  assert.equal(aligned.projectName, "Beta");
  assert.equal(aligned.helmId, "helm-1");
});
