import assert from "node:assert/strict";
import test from "node:test";
import { buildSelectedSessionWorktreeItems, formatInspectorWorktreeSummaryLabel } from "./worktree-summary";

test("buildSelectedSessionWorktreeItems groups open sessions by cwd", () => {
  const items = buildSelectedSessionWorktreeItems({
    sessions: [
      { id: "s1", cwd: "D:/repo", worktreeName: "wt-a", projectName: "Repo" },
      { id: "s2", cwd: "D:/repo", worktreeName: "wt-a", projectName: "Repo" },
      { id: "s3", cwd: "D:/other", worktreeName: "wt-b", projectName: "Other" },
    ],
    activeSession: { id: "s1", cwd: "D:/repo" },
    currentGitBranch: "main",
    branchByCwd: {
      "d:/repo": "feature/a",
      "d:/other": "feature/b",
    },
  });

  assert.deepEqual(items, [
    {
      projectName: "Repo",
      branchName: "feature/a",
      cwd: "D:/repo",
      sessionCount: 2,
      sessionTitles: [],
    },
    {
      projectName: "Other",
      branchName: "feature/b",
      cwd: "D:/other",
      sessionCount: 1,
      sessionTitles: [],
    },
  ]);
});

test("buildSelectedSessionWorktreeItems falls back to active session and branch", () => {
  const items = buildSelectedSessionWorktreeItems({
    sessions: [],
    activeSession: { id: "active", cwd: "D:/repo", projectName: "Repo" },
    currentGitBranch: "main",
  });

  assert.deepEqual(items, [
    {
      projectName: "Repo",
      branchName: "main",
      cwd: "D:/repo",
      sessionCount: 1,
      sessionTitles: [],
    },
  ]);
});

test("formatInspectorWorktreeSummaryLabel shows selected project and branch", () => {
  assert.equal(
    formatInspectorWorktreeSummaryLabel(
      [
        { projectName: "Tiller", branchName: "test-worktree", cwd: "D:/wt", sessionCount: 1, sessionTitles: [] },
        { projectName: "Tiller", branchName: "feature/0.1.6", cwd: "D:/repo", sessionCount: 1, sessionTitles: [] },
      ],
      2,
      "D:/repo",
      "D:/wt",
    ),
    "Tiller / feature/0.1.6",
  );
  assert.equal(formatInspectorWorktreeSummaryLabel([], 3, null, null), "3 Worktrees");
});
