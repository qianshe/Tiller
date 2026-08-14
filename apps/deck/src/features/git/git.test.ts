import assert from "node:assert/strict";
import test from "node:test";
import type { GitGraphState, GitStatusState } from "../../store/facade";
import {
  gitCwdKey,
  gitScopeKey,
  normalizeGitCwd,
  resolveGitGraph,
  resolveGitStatus,
  resolveGitTrackingNotice,
} from "./facade.js";
import {
  GIT_GRAPH_CACHE_TTL_MS,
  GIT_STATUS_CACHE_TTL_MS,
  isGitCacheFresh,
  mapGitStatusToDiffStatus,
  requestGitGraph,
  requestGitStatus,
  toGitFileDiff,
} from "./orchestration/status.js";

test("Git cache freshness uses the configured TTL and rejects invalid timestamps", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  assert.equal(
    isGitCacheFresh("2026-08-14T11:59:30.000Z", GIT_STATUS_CACHE_TTL_MS, now),
    true,
  );
  assert.equal(
    isGitCacheFresh("2026-08-14T11:58:59.999Z", GIT_STATUS_CACHE_TTL_MS, now),
    false,
  );
  assert.equal(
    isGitCacheFresh("2026-08-14T11:56:00.000Z", GIT_GRAPH_CACHE_TTL_MS, now),
    true,
  );
  assert.equal(isGitCacheFresh("not-a-date", GIT_STATUS_CACHE_TTL_MS, now), false);
});

test("Git status requests are deduplicated for the same scope", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let dispatchCount = 0;
  const dispatch = async () => {
    dispatchCount += 1;
    await gate;
    return { ok: true };
  };
  const options = {
    projectId: "p1",
    cwd: "/repo",
    scopeKey: "helm-a::p1::/repo",
  };

  const first = requestGitStatus(dispatch, options);
  const second = requestGitStatus(dispatch, options);
  assert.equal(first, second);
  assert.equal(dispatchCount, 1);

  release();
  await Promise.all([first, second]);
});

test("Git graph requests are deduplicated by scope and signature", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let dispatchCount = 0;
  const dispatch = async () => {
    dispatchCount += 1;
    await gate;
    return { ok: true };
  };
  const options = {
    projectId: "p1",
    cwd: "/repo",
    scopeKey: "helm-a::p1::/repo",
    knownSignature: "sig-1",
  };

  const first = requestGitGraph(dispatch, options);
  const second = requestGitGraph(dispatch, options);
  assert.equal(first, second);
  assert.equal(dispatchCount, 1);

  release();
  await Promise.all([first, second]);
});

test("normalizeGitCwd handles Windows, Unix, and root paths", () => {
  assert.equal(normalizeGitCwd(" C:\\repo\\worktree\\ "), "C:/repo/worktree");
  assert.equal(normalizeGitCwd("/repo/worktree///"), "/repo/worktree");
  assert.equal(normalizeGitCwd("/Repo/Worktree///"), "/Repo/Worktree");
  assert.equal(normalizeGitCwd("C:\\"), "C:/");
  assert.equal(normalizeGitCwd("/"), "/");
  assert.equal(gitCwdKey("C:\\Repo\\Worktree"), "c:/repo/worktree");
  assert.equal(gitCwdKey("/Repo/Worktree"), "/Repo/Worktree");
});

test("gitScopeKey isolates Helm, project, and normalized cwd", () => {
  const base = { helmKey: "127.0.0.1:47631", projectId: "p1", cwd: "C:\\Repo\\" };
  assert.equal(gitScopeKey(base), "127.0.0.1:47631::p1::c:/repo");
  assert.notEqual(gitScopeKey(base), gitScopeKey({ ...base, helmKey: "127.0.0.1:47632" }));
  assert.notEqual(gitScopeKey(base), gitScopeKey({ ...base, projectId: "p2" }));
  assert.equal(gitScopeKey(base), gitScopeKey({ ...base, cwd: "c:/repo" }));
  assert.notEqual(gitScopeKey({ ...base, cwd: "/Repo" }), gitScopeKey({ ...base, cwd: "/repo" }));
});

test("Git status maps added, deleted, and modified files", () => {
  assert.equal(mapGitStatusToDiffStatus("?", "?"), "added");
  assert.equal(mapGitStatusToDiffStatus("A", " "), "added");
  assert.equal(mapGitStatusToDiffStatus(" ", "D"), "deleted");
  assert.equal(mapGitStatusToDiffStatus("M", " "), "modified");
  assert.deepEqual(toGitFileDiff({
    path: "src/a.ts",
    indexStatus: " ",
    worktreeStatus: "M",
    additions: 2,
    deletions: 1,
    patchTruncated: true,
  }), {
    path: "src/a.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patchTruncated: true,
  });
});

test("scoped Git cache lookup does not cross Helm or project boundaries", () => {
  const scope = { helmKey: "helm-a", projectId: "p1", cwd: "/repo" };
  const status: GitStatusState = {
    scopeKey: gitScopeKey(scope),
    projectId: "p1",
    cwd: "/repo",
    branch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    trackingStale: false,
    clean: true,
    files: [],
  };
  const graph: GitGraphState = {
    scopeKey: gitScopeKey(scope),
    projectId: "p1",
    cwd: "/repo",
    commits: [],
  };
  const states = { [gitScopeKey(scope)]: status };
  const graphs = { [gitScopeKey(scope)]: graph };
  assert.equal(resolveGitStatus(states, scope), status);
  assert.equal(resolveGitGraph(graphs, scope), graph);
  assert.equal(resolveGitStatus(states, { ...scope, helmKey: "helm-b" }), undefined);
  assert.equal(resolveGitStatus(states, { ...scope, projectId: "p2" }), undefined);
});

test("scoped Git lookup ignores legacy cwd-only cache entries", () => {
  const legacy: GitStatusState = {
    projectId: "p1",
    cwd: "C:\\repo\\",
    branch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    trackingStale: false,
    clean: true,
    files: [],
  };
  const scope = { helmKey: "helm-a", projectId: "p1", cwd: "c:/repo" };
  assert.equal(resolveGitStatus({ [legacy.cwd]: legacy }, scope), undefined);
  assert.equal(resolveGitStatus({ [legacy.cwd]: legacy }, { ...scope, projectId: "p2" }), undefined);
});

test("resolveGitTrackingNotice distinguishes fresh, stale, and remote-error states", () => {
  assert.equal(resolveGitTrackingNotice(undefined), undefined);
  assert.equal(resolveGitTrackingNotice({ trackingStale: false } as GitStatusState), undefined);
  assert.equal(resolveGitTrackingNotice({ trackingStale: true } as GitStatusState), "远端状态可能已过期");
  assert.equal(
    resolveGitTrackingNotice({ remoteRefreshError: "origin unavailable" } as GitStatusState),
    "远端状态可能已过期：origin unavailable",
  );
});
