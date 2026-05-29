import assert from "node:assert/strict";
import test from "node:test";
import { buildSelectedSessionWorktreeItems, formatInspectorWorktreeSummaryLabel } from "./worktree-summary";

test("buildSelectedSessionWorktreeItems groups open sessions by cwd", () => {
  const items = buildSelectedSessionWorktreeItems({
    sessions: [
      { id: "s1", cwd: "D:/repo", worktreeName: "feature/a", projectName: "Repo" },
      { id: "s2", cwd: "D:/repo", worktreeName: "feature/a", projectName: "Repo" },
      { id: "s3", cwd: "D:/other", projectName: "Other" },
    ],
    activeSession: { id: "s1", cwd: "D:/repo" },
    currentGitBranch: "main",
  });

  assert.deepEqual(items, [
    { branchName: "feature/a", cwd: "D:/repo", sessionCount: 2, sessionTitles: [] },
    { branchName: "Other", cwd: "D:/other", sessionCount: 1, sessionTitles: [] },
  ]);
});

test("buildSelectedSessionWorktreeItems falls back to active session and branch", () => {
  const items = buildSelectedSessionWorktreeItems({
    sessions: [],
    activeSession: { id: "active", cwd: "D:/repo", projectName: "Repo" },
    currentGitBranch: "main",
  });

  assert.deepEqual(items, [
    { branchName: "main", cwd: "D:/repo", sessionCount: 1, sessionTitles: [] },
  ]);
});

test("formatInspectorWorktreeSummaryLabel summarizes selected session branches", () => {
  assert.equal(formatInspectorWorktreeSummaryLabel([
    { branchName: "a", cwd: "D:/a", sessionCount: 1, sessionTitles: [] },
    { branchName: "b", cwd: "D:/b", sessionCount: 1, sessionTitles: [] },
    { branchName: "c", cwd: "D:/c", sessionCount: 1, sessionTitles: [] },
  ], 5), "a / b +1");
  assert.equal(formatInspectorWorktreeSummaryLabel([], 3), "3 Worktrees");
});
