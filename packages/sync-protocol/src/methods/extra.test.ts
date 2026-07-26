import assert from "node:assert/strict";
import test from "node:test";
import * as projectListDirectories from "./project/list-directories";
import * as projectListFiles from "./project/list-files";
import * as projectGitListBranches from "./project/git-list-branches";
import * as projectGitCreateWorktree from "./project/git-create-worktree";
import * as projectGitStatus from "./project/git-status";
import * as projectGitCommit from "./project/git-commit";
import * as projectGitDiscard from "./project/git-discard";
import * as projectGitPush from "./project/git-push";
import * as projectGitPull from "./project/git-pull";
import * as projectGitGraph from "./project/git-graph";
import * as projectGitCommitDetail from "./project/git-commit-detail";
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

test("project/git/status accepts refreshRemote and returns tracking snapshot", () => {
  assert.equal(projectGitStatus.method, "project/git/status");

  assert.deepEqual(
    projectGitStatus.ParamsSchema.parse({ projectId: "p1", cwd: "/repo" }),
    { projectId: "p1", cwd: "/repo" },
  );
  assert.deepEqual(
    projectGitStatus.ParamsSchema.parse({ projectId: "p1", cwd: "/repo", refreshRemote: true }),
    { projectId: "p1", cwd: "/repo", refreshRemote: true },
  );
  assert.deepEqual(
    projectGitStatus.ParamsSchema.parse({ projectId: "p1" }),
    { projectId: "p1" },
  );

  const result = projectGitStatus.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    upstreamBranch: "origin/main",
    ahead: 2,
    behind: 1,
    pushTarget: "origin/main",
    trackingStale: false,
    clean: false,
    files: [
      { path: "file.ts", indexStatus: "M", worktreeStatus: " " },
      { path: "new.ts", indexStatus: "A", worktreeStatus: " " },
    ],
    message: "2 files changed",
  });
  assert.equal(result.files.length, 2);
  assert.equal(result.clean, false);
  assert.equal(result.detached, false);
  assert.equal(result.upstreamBranch, "origin/main");
  assert.equal(result.ahead, 2);
  assert.equal(result.behind, 1);
  assert.equal(result.pushTarget, "origin/main");
  assert.equal(result.trackingStale, false);
});

test("project/git/status tolerates detached / no-upstream snapshot", () => {
  const detached = projectGitStatus.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    branch: "abc1234",
    detached: true,
    ahead: 0,
    behind: 0,
    trackingStale: false,
    clean: true,
    files: [],
    message: "detached HEAD",
  });
  assert.equal(detached.detached, true);
  assert.equal(detached.upstreamBranch, undefined);
  assert.equal(detached.pushTarget, undefined);
  assert.equal(detached.ahead, 0);
  assert.equal(detached.behind, 0);
});

test("project/git/status ok:false still validates against the full snapshot schema", () => {
  const failed = projectGitStatus.ResultSchema.parse({
    ok: false,
    projectId: "p1",
    cwd: "/repo",
    branch: "",
    detached: false,
    ahead: 0,
    behind: 0,
    trackingStale: false,
    clean: false,
    files: [],
    message: "not a git repo",
  });
  assert.equal(failed.ok, false);
});

test("project/git/status snapshot carries remoteRefreshError when stale", () => {
  const stale = projectGitStatus.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    upstreamBranch: "origin/main",
    ahead: 0,
    behind: 0,
    pushTarget: "origin/main",
    trackingStale: true,
    remoteRefreshError: "network unreachable",
    clean: true,
    files: [],
    message: "",
  });
  assert.equal(stale.trackingStale, true);
  assert.equal(stale.remoteRefreshError, "network unreachable");
});

test("project/git/commit flattens snapshot fields and reuses shared schema", () => {
  assert.equal(projectGitCommit.method, "project/git/commit");

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

  assert.throws(() =>
    projectGitCommit.ParamsSchema.parse({
      projectId: "p1",
      cwd: "/repo",
      message: "commit",
      paths: [],
    }),
  );

  const result = projectGitCommit.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    commitHash: "abc1234",
    branch: "main",
    detached: false,
    upstreamBranch: "origin/main",
    ahead: 1,
    behind: 0,
    pushTarget: "origin/main",
    trackingStale: true,
    clean: true,
    files: [],
    message: "Committed 1 file",
  });
  assert.equal(result.commitHash, "abc1234");
  assert.equal(result.clean, true);
  assert.equal(result.branch, "main");
  assert.equal(result.upstreamBranch, "origin/main");
  assert.equal(result.trackingStale, true);
});

test("project/git/commit ok:false validates against flattened snapshot", () => {
  const failed = projectGitCommit.ResultSchema.parse({
    ok: false,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    trackingStale: false,
    clean: false,
    files: [{ path: "file.ts", indexStatus: "M", worktreeStatus: " " }],
    message: "nothing staged",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.files.length, 1);
});

test("project/git/discard only supports selected paths", () => {
  assert.equal(projectGitDiscard.method, "project/git/discard");
  assert.deepEqual(
    projectGitDiscard.ParamsSchema.parse({
      projectId: "p1",
      cwd: "/repo",
      paths: ["file.ts"],
    }),
    { projectId: "p1", cwd: "/repo", paths: ["file.ts"] },
  );
  assert.throws(() =>
    projectGitDiscard.ParamsSchema.parse({ projectId: "p1", cwd: "/repo" }),
  );
  assert.throws(() =>
    projectGitDiscard.ParamsSchema.parse({
      projectId: "p1",
      cwd: "/repo",
      all: true,
    }),
  );

  const result = projectGitDiscard.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    trackingStale: true,
    clean: true,
    files: [],
    message: "Discarded selected changes",
  });
  assert.equal(result.ok, true);
  assert.equal(result.clean, true);
});

test("project/git/push exposes flattened snapshot at top level", () => {
  assert.equal(projectGitPush.method, "project/git/push");

  assert.deepEqual(
    projectGitPush.ParamsSchema.parse({ projectId: "p1", cwd: "/repo" }),
    { projectId: "p1", cwd: "/repo" },
  );

  const ok = projectGitPush.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    upstreamBranch: "origin/main",
    ahead: 0,
    behind: 0,
    pushTarget: "origin/main",
    trackingStale: false,
    clean: true,
    files: [],
    message: "pushed",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.pushTarget, "origin/main");
  assert.equal(ok.upstreamBranch, "origin/main");

  const failed = projectGitPush.ResultSchema.parse({
    ok: false,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    ahead: 1,
    behind: 0,
    pushTarget: "origin/main",
    trackingStale: false,
    clean: false,
    files: [],
    message: "no upstream",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.ahead, 1);
});

test("project/git/pull exposes flattened snapshot at top level", () => {
  assert.equal(projectGitPull.method, "project/git/pull");

  assert.deepEqual(
    projectGitPull.ParamsSchema.parse({ projectId: "p1", cwd: "/repo" }),
    { projectId: "p1", cwd: "/repo" },
  );

  const ok = projectGitPull.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    upstreamBranch: "origin/main",
    ahead: 0,
    behind: 0,
    pushTarget: "origin/main",
    trackingStale: false,
    clean: true,
    files: [],
    message: "fast-forwarded",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.behind, 0);

  const failed = projectGitPull.ResultSchema.parse({
    ok: false,
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    ahead: 0,
    behind: 1,
    pushTarget: "origin/main",
    trackingStale: false,
    clean: false,
    files: [{ path: "file.ts", indexStatus: "M", worktreeStatus: " " }],
    message: "dirty worktree",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.behind, 1);
});

test("project/git/graph validates params and returns commit graph", () => {
  assert.equal(projectGitGraph.method, "project/git/graph");

  assert.deepEqual(
    projectGitGraph.ParamsSchema.parse({ projectId: "p1", cwd: "/repo" }),
    { projectId: "p1", cwd: "/repo" },
  );
  assert.deepEqual(
    projectGitGraph.ParamsSchema.parse({ projectId: "p1" }),
    { projectId: "p1" },
  );

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

test("project/git/commit_detail validates commit hashes and file diffs", () => {
  assert.equal(projectGitCommitDetail.method, "project/git/commit_detail");
  assert.deepEqual(
    projectGitCommitDetail.ParamsSchema.parse({
      projectId: "p1",
      cwd: "/repo",
      commitHash: "abc1234",
    }),
    { projectId: "p1", cwd: "/repo", commitHash: "abc1234" },
  );
  assert.throws(() =>
    projectGitCommitDetail.ParamsSchema.parse({
      projectId: "p1",
      cwd: "/repo",
      commitHash: "HEAD~1",
    }),
  );

  const result = projectGitCommitDetail.ResultSchema.parse({
    ok: true,
    projectId: "p1",
    cwd: "/repo",
    commitHash: "abc1234567890",
    files: [
      {
        path: "src/index.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        patch: "@@ -1 +1,2 @@\n-old\n+new\n+line",
      },
    ],
    message: "Fetched 1 file(s)",
  });
  assert.equal(result.files[0]?.additions, 2);
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
