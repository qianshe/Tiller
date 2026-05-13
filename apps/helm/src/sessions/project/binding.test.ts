import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary, SessionSummary, WorktreeSummary } from "@tiller/shared";
import { alignSessionProjectBinding, alignSessionWorktreeBinding } from "./binding.js";

function buildSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-alpha",
    projectName: "Alpha",
    helmId: "helm-1",
    cwd: "worktree-shared",
    worktreeName: "Shared Worktree",
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
  { id: "project-alpha", name: "Alpha", helmId: "helm-1", path: "worktree-alpha", worktrees: [{ name: "alpha", path: "worktree-alpha" }] },
  { id: "project-beta", name: "Beta", helmId: "helm-1", worktrees: [{ name: "shared", path: "worktree-shared" }] },
];

test("alignSessionProjectBinding preserves a known stored project id over worktree fallbacks", () => {
  const aligned = alignSessionProjectBinding(buildSession(), projects);

  assert.equal(aligned.projectId, "project-alpha");
  assert.equal(aligned.projectName, "Alpha");
  assert.equal(aligned.helmId, "helm-1");
  assert.equal(aligned.cwd, "worktree-shared");
});

test("alignSessionProjectBinding fills missing cwd from the project path", () => {
  const aligned = alignSessionProjectBinding(
    buildSession({ cwd: undefined as unknown as string }),
    projects,
  );

  assert.equal(aligned.projectId, "project-alpha");
  assert.equal(aligned.cwd, "worktree-alpha");
});

test("alignSessionProjectBinding recovers legacy sessions by project name before worktree", () => {
  const aligned = alignSessionProjectBinding(
    buildSession({
      projectId: "legacy-project",
      projectName: "Beta",
      cwd: "worktree-shared",
    }),
    projects,
  );

  assert.equal(aligned.projectId, "project-beta");
  assert.equal(aligned.projectName, "Beta");
  assert.equal(aligned.helmId, "helm-1");
});

test("alignSessionWorktreeBinding refreshes root worktree name from matching cwd", () => {
  const worktrees: WorktreeSummary[] = [
    {
      name: "codex/acp-session-performance-optimization",
      path: "D:/myProject/tools/Tiller",
    },
  ];

  const aligned = alignSessionWorktreeBinding(
    buildSession({
      cwd: "D:\\myProject\\tools\\Tiller",
      worktreeName: "main",
    }),
    worktrees,
  );

  assert.equal(aligned.cwd, "D:\\myProject\\tools\\Tiller");
  assert.equal(aligned.worktreeName, "codex/acp-session-performance-optimization");
});
