import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary, SessionSummary, WorktreeSummary } from "@tiller/shared";
import { normalizeWorktreePath, resolveStoredSessionWorktree } from "./worktree-resolution.js";

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

test("normalizeWorktreePath normalizes slashes, casing, and trailing separators", () => {
  assert.equal(normalizeWorktreePath("D:\\Repo\\"), "d:/repo");
});

test("resolveStoredSessionWorktree preserves stored cwd when it matches a known worktree", () => {
  const worktrees: WorktreeSummary[] = [{ name: "main", path: "d:/repo" }];
  const projects: ProjectSummary[] = [];

  assert.deepEqual(
    resolveStoredSessionWorktree({
      summary: sessionSummary({ cwd: "D:/Repo" }),
      projects,
      worktrees,
    }),
    { name: "main", path: "D:/Repo" },
  );
});

test("resolveStoredSessionWorktree falls back to project path for legacy summaries", () => {
  const projects: ProjectSummary[] = [{ id: "project-1", name: "Project", helmId: "helm-1", path: "D:/project" }];

  assert.deepEqual(
    resolveStoredSessionWorktree({
      summary: sessionSummary({ cwd: undefined, worktreeName: "legacy" }),
      projects,
      worktrees: [],
    }),
    { name: "legacy", path: "D:/project" },
  );
});
