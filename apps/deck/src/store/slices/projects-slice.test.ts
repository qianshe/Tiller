import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";
import { createStore } from "zustand/vanilla";
import { createProjectsSlice, type ProjectsSlice } from "./projects-slice.js";

function createTestStore() {
  return createStore<ProjectsSlice>()((...args) => ({
    ...createProjectsSlice(...args),
  }));
}

const project = (id: string): ProjectSummary => ({
  id,
  name: `Project ${id}`,
  helmId: "helm-1",
  worktrees: [],
});

const worktree = (id: string): WorktreeSummary => ({
  name: `Worktree ${id}`,
  path: `D:/work/${id}`,
});

test("setProjects and setWorktrees support value and updater forms", () => {
  const store = createTestStore();

  store.getState().setProjects([project("p1")]);
  store.getState().setProjects((current) => [...current, project("p2")]);
  store.getState().setWorktrees([worktree("w1")]);
  store.getState().setWorktrees((current) => [...current, worktree("w2")]);

  assert.deepEqual(store.getState().projects.map((item) => item.id), ["p1", "p2"]);
  assert.deepEqual(store.getState().worktrees.map((item) => item.path), ["D:/work/w1", "D:/work/w2"]);
});

test("setWorktreeGitByProject merges updater results", () => {
  const store = createTestStore();

  store.getState().setWorktreeGitByProject({
    p1: { branches: ["main"], currentBranch: "main" },
  });
  store.getState().setWorktreeGitByProject((current) => ({
    ...current,
    p1: { ...current.p1, branches: ["main", "feature"] },
  }));

  assert.deepEqual(store.getState().worktreeGitByProject.p1?.branches, [
    "main",
    "feature",
  ]);
});
