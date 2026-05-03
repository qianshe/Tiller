import test from "node:test";
import assert from "node:assert/strict";
import type { ProviderCleanupResult } from "@tiller/acp-runtime";
import type { ProjectSummary, WorkspaceSummary } from "@tiller/shared";
import { cleanupActiveRuntime, resolveProjectSessionWorkspace } from "./sessions";

test("cleanupActiveRuntime prefers ACP session/delete over close", async () => {
  const calls: string[] = [];
  const result = await cleanupActiveRuntime({
    sessionCapabilities: { sessionDelete: true, sessionClose: true },
    async deleteSession() {
      calls.push("delete");
      return { kind: "remote-deleted", providerId: "agent", message: "deleted" } satisfies ProviderCleanupResult;
    },
    async close() {
      calls.push("close");
      return { kind: "remote-closed", providerId: "agent", message: "closed" } satisfies ProviderCleanupResult;
    },
    cancel() {
      calls.push("cancel");
    },
  }, "agent");

  assert.equal(result.kind, "remote-deleted");
  assert.deepEqual(calls, ["delete", "cancel"]);
});

test("cleanupActiveRuntime still terminates local runtime when ACP delete throws", async () => {
  const calls: string[] = [];
  const result = await cleanupActiveRuntime({
    sessionCapabilities: { sessionDelete: true },
    async deleteSession() {
      calls.push("delete");
      throw new Error("Session not found: ses_missing");
    },
    cancel() {
      calls.push("cancel");
    },
  }, "opencode");

  assert.equal(result.kind, "remote-delete-failed");
  assert.equal(result.providerId, "opencode");
  assert.match(result.message, /Session not found: ses_missing/);
  assert.deepEqual(calls, ["delete", "cancel"]);
});

test("cleanupActiveRuntime falls back to ACP session/close when delete is unavailable", async () => {
  const calls: string[] = [];
  const result = await cleanupActiveRuntime({
    sessionCapabilities: { sessionClose: true },
    async close() {
      calls.push("close");
      return { kind: "remote-closed", providerId: "agent", message: "closed" } satisfies ProviderCleanupResult;
    },
    cancel() {
      calls.push("cancel");
    },
  }, "agent");

  assert.equal(result.kind, "remote-closed");
  assert.deepEqual(calls, ["close"]);
});

test("cleanupActiveRuntime terminates local runtime when ACP cleanup is unsupported", async () => {
  const calls: string[] = [];
  const result = await cleanupActiveRuntime({
    sessionCapabilities: {},
    cancel() {
      calls.push("cancel");
    },
  }, "agent");

  assert.equal(result.kind, "unsupported");
  assert.deepEqual(calls, ["cancel"]);
});

const project: ProjectSummary = {
  id: "project-1",
  name: "Project One",
  helmId: "local-helm",
  path: "D:/repo/project-one",
  workspaceIds: ["main", "project-1-worktree-feature"],
  defaultWorkspaceId: "main",
  gitCurrentBranch: "main",
};

const workspaces: WorkspaceSummary[] = [
  { id: "main", name: "main", path: "D:/repo/project-two" },
  { id: "project-1-worktree-feature", name: "feature", path: "D:/repo/project-one/.tiller/worktrees/feature" },
];

test("resolveProjectSessionWorkspace uses project path for root branch workspace", () => {
  assert.deepEqual(resolveProjectSessionWorkspace(project, workspaces, "main"), {
    id: "main",
    name: "main",
    path: "D:/repo/project-one",
  });
});

test("resolveProjectSessionWorkspace keeps explicit worktree path", () => {
  assert.deepEqual(resolveProjectSessionWorkspace(project, workspaces, "project-1-worktree-feature"), {
    id: "project-1-worktree-feature",
    name: "feature",
    path: "D:/repo/project-one/.tiller/worktrees/feature",
  });
});
