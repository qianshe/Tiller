import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";
import { resolveProjectWorktrees } from "./fleet-helpers.js";

function createProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    path: "D:/myProject/tools/Tiller",
    worktrees: [
      {
        name: "codex/debug-stream-tool-logs",
        path: "D:/myProject/tools/Tiller/.worktrees/debug-stream-tool-logs",
      },
    ],
    gitCurrentBranch: "main",
    ...overrides,
  };
}

test("fleet project worktrees include managed worktree paths only", () => {
  const worktrees: WorktreeSummary[] = [
    {
      name: "codex/debug-stream-tool-logs",
      path: "D:/myProject/tools/Tiller",
    },
    {
      name: "codex/debug-stream-tool-logs",
      path: "D:/myProject/tools/Tiller/.worktrees/debug-stream-tool-logs",
    },
  ];

  assert.deepEqual(resolveProjectWorktrees(createProject(), worktrees), [
    {
      name: "codex/debug-stream-tool-logs",
      path: "D:/myProject/tools/Tiller/.worktrees/debug-stream-tool-logs",
    },
  ]);
});

test("fleet project worktrees do not fall back to git branch", () => {
  assert.deepEqual(resolveProjectWorktrees(createProject({ worktrees: [] }), []), []);
});
