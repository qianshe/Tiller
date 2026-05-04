import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readTillerConfig } from "@tiller/agent-registry";
import type { ProjectSummary } from "@tiller/shared";
import {
  persistProjectGitInfo,
  resolveProjectFileRoot,
  resolveProjectWorkspaceId,
  shouldPersistProjectGitInfo,
} from "./config.js";

test("resolveProjectWorkspaceId prefers current Git branch over project-scoped fallback", () => {
  assert.equal(resolveProjectWorkspaceId({ id: "project-1" }, "main"), "main");
  assert.equal(
    resolveProjectWorkspaceId({ id: "project-1", gitCurrentBranch: "develop" }),
    "develop",
  );
  assert.equal(resolveProjectWorkspaceId({ id: "project-1" }), "project-1-workspace");
});

test("resolveProjectFileRoot prefers project path for root branch workspace ids", () => {
  const project: ProjectSummary = {
    id: "project-1",
    name: "Project One",
    helmId: "local-helm",
    path: "D:/repo/project-one",
    workspaceIds: ["main"],
    defaultWorkspaceId: "main",
    gitCurrentBranch: "main",
  };

  assert.equal(
    resolveProjectFileRoot(
      project,
      [{ id: "main", name: "main", path: "D:/repo/project-two" }],
      "main",
    ),
    "D:/repo/project-one",
  );
});

test("resolveProjectFileRoot keeps explicit worktree workspace paths", () => {
  const project: ProjectSummary = {
    id: "project-1",
    name: "Project One",
    helmId: "local-helm",
    path: "D:/repo/project-one",
    workspaceIds: ["main", "project-1-worktree-feature"],
    defaultWorkspaceId: "main",
    gitCurrentBranch: "main",
  };

  assert.equal(
    resolveProjectFileRoot(
      project,
      [
        {
          id: "project-1-worktree-feature",
          name: "feature",
          path: "D:/repo/project-one/.tiller/worktrees/feature",
        },
      ],
      "project-1-worktree-feature",
    ),
    "D:/repo/project-one/.tiller/worktrees/feature",
  );
});

test("shouldPersistProjectGitInfo detects legacy project workspace ids even when branches are unchanged", () => {
  const project: ProjectSummary = {
    id: "project-1",
    name: "Project",
    helmId: "local-helm",
    path: "D:/repo/project",
    workspaceIds: ["project-1-workspace"],
    defaultWorkspaceId: "project-1-workspace",
    gitCurrentBranch: "main",
    gitBranches: ["main"],
  };

  assert.equal(
    shouldPersistProjectGitInfo(project, { branches: ["main"], currentBranch: "main" }),
    true,
  );
  assert.equal(
    shouldPersistProjectGitInfo(
      { ...project, workspaceIds: ["main"], defaultWorkspaceId: "main" },
      { branches: ["main"], currentBranch: "main" },
    ),
    false,
  );
});

test("persistProjectGitInfo uses branch name as root workspace id and removes obsolete project workspace", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-config-workspace-"));
  try {
    const configPath = join(tempRoot, "config.json");
    const project: ProjectSummary = {
      id: "project-1",
      name: "Project",
      helmId: "local-helm",
      path: "D:/repo/project",
      workspaceIds: ["project-1-workspace", "project-1-worktree-feature"],
      defaultWorkspaceId: "project-1-workspace",
      gitCurrentBranch: "old-main",
      gitBranches: ["old-main"],
    };
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          helms: [],
          projects: [project],
          workspaces: [
            { id: "project-1-workspace", name: "Project", path: "D:/repo/project" },
            { id: "old-main", name: "old-main", path: "D:/repo/project" },
            {
              id: "project-1-worktree-feature",
              name: "feature",
              path: "D:/repo/project/.tiller/worktrees/feature",
            },
          ],
          agents: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    persistProjectGitInfo(
      project,
      { branches: ["main", "feature"], currentBranch: "main" },
      "D:/repo/project",
      configPath,
    );

    const config = readTillerConfig(configPath);
    const savedProject = config.projects?.find((item) => item.id === "project-1");
    assert.equal(savedProject?.defaultWorkspaceId, "main");
    assert.deepEqual(savedProject?.workspaceIds, ["main", "project-1-worktree-feature"]);
    assert.equal(savedProject?.gitCurrentBranch, "main");
    assert.deepEqual(savedProject?.gitBranches, ["main", "feature"]);
    assert.deepEqual(config.workspaces?.map((item) => item.id).sort(), [
      "main",
      "project-1-worktree-feature",
    ]);
    assert.deepEqual(
      config.workspaces?.find((item) => item.id === "main"),
      { id: "main", name: "main", path: "D:/repo/project" },
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
