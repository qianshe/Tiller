import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";
import { createProjectId, resolveProjectWorktrees } from "./fleet-helpers.js";

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

test("createProjectId uses the real project name for config directory ids", () => {
  assert.equal(createProjectId([], "Tiller"), "Tiller");
  assert.equal(
    createProjectId([{ id: "Tiller", name: "Tiller", helmId: "local-helm" }], "Tiller"),
    "Tiller-2",
  );
});

test("createProjectId falls back to numeric project ids when project name is empty", () => {
  assert.equal(createProjectId([], ""), "project-1");
});

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
