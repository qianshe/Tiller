import assert from "node:assert/strict";
import test from "node:test";
import * as projectListDirectories from "./project/list-directories";
import * as projectListFiles from "./project/list-files";
import * as projectGitListBranches from "./project/git-list-branches";
import * as projectGitCreateWorktree from "./project/git-create-worktree";
import * as projectGitStatus from "./project/git-status";
import * as projectGitCommit from "./project/git-commit";
import * as projectGitGraph from "./project/git-graph";
import * as sessionDraft from "./session/draft";
import * as agentSave from "./agent/save";
import * as projectDelete from "./project/delete";
import * as agentDelete from "./agent/delete";
import * as permissionRespond from "./permission/respond";
import * as sessionListUpdates from "./session/list-updates";

test("project/list_files validates required projectId", () => {
  assert.equal(projectListFiles.method, "project/list_files");
  assert.deepEqual(
    projectListFiles.ParamsSchema.parse({ projectId: "p1" }),
    { projectId: "p1" },
  );
  assert.throws(() => projectListFiles.ParamsSchema.parse({}));
});

test("project/list_directories accepts an optional path and returns candidates", () => {
  assert.equal(projectListDirectories.method, "project/list_directories");
  assert.deepEqual(projectListDirectories.ParamsSchema.parse({ path: "D:/repo" }), {
    path: "D:/repo",
  });
  assert.deepEqual(projectListDirectories.ParamsSchema.parse({}), {});
  assert.deepEqual(
    projectListDirectories.ResultSchema.parse({
      ok: true,
      path: "D:/",
      directories: ["D:/repo"],
      message: "Loaded 1 directories",
    }),
    {
      ok: true,
      path: "D:/",
      directories: ["D:/repo"],
      message: "Loaded 1 directories",
    },
  );
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

test("project/git/status validates params and returns worktree status", () => {
  assert.equal(projectGitStatus.method, "project/git/status");

  // Params validation
  assert.deepEqual(
    projectGitStatus.ParamsSchema.parse({ projectId: "p1", cwd: "/repo" }),
    { projectId: "p1", cwd: "/repo" },
  );
  assert.deepEqual(
    projectGitStatus.ParamsSchema.parse({ projectId: "p1" }),
    { projectId: "p1" },
  );

  // Result validation
  const result = projectGitStatus.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    clean: false,
    files: [
      { path: "file.ts", indexStatus: "M", worktreeStatus: " " },
      { path: "new.ts", indexStatus: "A", worktreeStatus: " " },
    ],
    message: "2 files changed",
  });
  assert.equal(result.files.length, 2);
  assert.equal(result.clean, false);
});

test("project/git/commit requires non-empty paths and returns commit hash", () => {
  assert.equal(projectGitCommit.method, "project/git/commit");

  // Params validation
  assert.deepEqual(
    projectGitCommit.ParamsSchema.parse({
      projectId: "p1",
      cwd: "/repo",
      message: "feat: add feature",
      paths: ["file.ts"],
    }),
    {
      projectId: "p1",
      cwd: "/repo",
      message: "feat: add feature",
      paths: ["file.ts"],
    },
  );

  // Empty paths should fail
  assert.throws(() =>
    projectGitCommit.ParamsSchema.parse({
      projectId: "p1",
      cwd: "/repo",
      message: "commit",
      paths: [],
    }),
  );

  // Result validation
  const result = projectGitCommit.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    commitHash: "abc1234",
    status: {
      branch: "main",
      clean: true,
      files: [],
    },
    message: "Committed 1 file",
  });
  assert.equal(result.commitHash, "abc1234");
  assert.equal(result.status.clean, true);
});

test("project/git/graph validates params and returns commit graph", () => {
  assert.equal(projectGitGraph.method, "project/git/graph");

  // Params validation
  assert.deepEqual(
    projectGitGraph.ParamsSchema.parse({ projectId: "p1", cwd: "/repo" }),
    { projectId: "p1", cwd: "/repo" },
  );
  assert.deepEqual(
    projectGitGraph.ParamsSchema.parse({ projectId: "p1" }),
    { projectId: "p1" },
  );

  // Result validation with commits and refs
  const result = projectGitGraph.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    head: "abc1234567890abcdef",
    commits: [
      {
        hash: "abc1234567890abcdef",
        parents: [],
        refs: [
          { name: "HEAD", kind: "detached", isCurrent: true },
          { name: "main", kind: "branch", isCurrent: true },
        ],
        subject: "Initial commit",
        authorName: "Test User",
        authoredAt: "2026-01-01T00:00:00+00:00",
      },
      {
        hash: "def4567890abcdef1234",
        parents: ["abc1234567890abcdef"],
        refs: [
          { name: "v1.0.0", kind: "tag", isCurrent: false },
        ],
        subject: "Release v1.0.0",
        authorName: "Release Bot",
        authoredAt: "2026-02-01T12:00:00+00:00",
      },
    ],
    message: "Fetched 2 commit(s)",
  });
  assert.equal(result.head, "abc1234567890abcdef");
  assert.equal(result.commits.length, 2);
  assert.equal(result.commits[0]?.refs.length, 2);
  assert.equal(result.commits[0]?.refs[0]?.kind, "detached");
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

test("session/list_updates validates paged raw update queries", () => {
  assert.equal(sessionListUpdates.method, "session/list_updates");

  const params = sessionListUpdates.ParamsSchema.parse({
    sessionId: "session-1",
    limit: 50,
    before: "sequence\t100",
  });
  assert.deepEqual(params, {
    sessionId: "session-1",
    limit: 50,
    before: "sequence\t100",
  });

  assert.throws(
    () => sessionListUpdates.ParamsSchema.parse({ sessionId: "session-1", limit: 201 }),
    /Too big|less than or equal to 200/u,
  );

  const result = sessionListUpdates.ResultSchema.parse({
    ok: true,
    sessionId: "session-1",
    updates: [
      {
        sessionId: "session-1",
        runtimeSessionId: "runtime-1",
        providerId: "codex",
        sequence: 99,
        source: "acp_load_replay",
        updateType: "message",
        receivedAt: "2026-06-13T10:00:00.000Z",
        payloadJson: "{\"type\":\"message\"}",
      },
    ],
    nextCursor: "sequence\t98",
    hasMore: true,
  });
  assert.equal(result.updates[0]?.sequence, 99);
});
