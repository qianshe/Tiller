import assert from "node:assert/strict";
import test from "node:test";
import * as projectListFiles from "./project/list-files";
import * as projectGitListBranches from "./project/git-list-branches";
import * as projectGitCreateWorktree from "./project/git-create-worktree";
import * as sessionDraft from "./session/draft";
import * as agentSave from "./agent/save";
import * as projectDelete from "./project/delete";
import * as agentDelete from "./agent/delete";
import * as permissionRespond from "./permission/respond";

test("project/list_files validates required projectId", () => {
  assert.equal(projectListFiles.method, "project/list_files");
  assert.deepEqual(
    projectListFiles.ParamsSchema.parse({ projectId: "p1" }),
    { projectId: "p1" },
  );
  assert.throws(() => projectListFiles.ParamsSchema.parse({}));
});

test("project/git/list_branches result matches expected shape", () => {
  assert.equal(projectGitListBranches.method, "project/git/list_branches");
  const ok = projectGitListBranches.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    branches: ["main"],
    worktrees: [],
    message: "",
  });
  assert.equal(ok.ok, true);
});

test("project/git/create_worktree shares the list_branches result schema", () => {
  assert.equal(projectGitCreateWorktree.method, "project/git/create_worktree");
  projectGitCreateWorktree.ResultSchema.parse({
    ok: false,
    projectId: "p1",
    branches: [],
    worktrees: [],
    message: "no git repo",
  });
});

test("session/draft enforces deck and selected agent scope", () => {
  assert.equal(sessionDraft.method, "session/draft");
  assert.deepEqual(
    sessionDraft.ParamsSchema.parse({
      deckClientId: "deck-1",
      projectId: "p1",
      cwd: "D:/repo",
      agentId: "a1",
    }),
    { deckClientId: "deck-1", projectId: "p1", cwd: "D:/repo", agentId: "a1" },
  );
});

test("agent/save expects provider and reports providerId", () => {
  assert.equal(agentSave.method, "agent/save");
  agentSave.ParamsSchema.parse({ provider: { id: "x" } });
  assert.deepEqual(
    agentSave.ResultSchema.parse({ ok: true, providerId: "x", message: "saved" }),
    { ok: true, providerId: "x", message: "saved" },
  );
});

test("project/delete validates projectId and reports deletion", () => {
  assert.equal(projectDelete.method, "project/delete");
  assert.deepEqual(projectDelete.ParamsSchema.parse({ projectId: "p1" }), {
    projectId: "p1",
  });
  assert.deepEqual(
    projectDelete.ResultSchema.parse({ ok: true, projectId: "p1", message: "deleted" }),
    { ok: true, projectId: "p1", message: "deleted" },
  );
});

test("agent/delete validates providerId and reports deletion", () => {
  assert.equal(agentDelete.method, "agent/delete");
  assert.deepEqual(agentDelete.ParamsSchema.parse({ providerId: "codex" }), {
    providerId: "codex",
  });
  assert.deepEqual(
    agentDelete.ResultSchema.parse({ ok: true, providerId: "codex", message: "deleted" }),
    { ok: true, providerId: "codex", message: "deleted" },
  );
});

test("permission/respond echoes id and decision", () => {
  assert.equal(permissionRespond.method, "permission/respond");
  assert.deepEqual(
    permissionRespond.ResultSchema.parse({
      ok: true,
      permissionRequestId: "pr1",
      decision: { kind: "allow" },
    }),
    { ok: true, permissionRequestId: "pr1", decision: { kind: "allow" } },
  );
});
