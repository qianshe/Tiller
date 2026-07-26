import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { GitGraphState, GitStatusState } from "../../store/facade";
import { applyGitGraphResult, applyGitOperationResult } from "./inventory-events";

const currentDir = dirname(fileURLToPath(import.meta.url));
const inventoryEventsSource = readFileSync(resolve(currentDir, "inventory-events.ts"), "utf8");

test("inventory events clear git status and graph loading state even when RPC returns failure", () => {
  assert.match(
    inventoryEventsSource,
    /case "project\/git\/status":[\s\S]*if \(payload\.cwd\) \{[\s\S]*loading: false,[\s\S]*message: payload\.message,/s,
  );
  assert.match(
    inventoryEventsSource,
    /case "project\/git\/graph":[\s\S]*applyGitGraphResult\(current, payload, payload\.cwd\)/s,
  );
  assert.match(
    inventoryEventsSource,
    /case "project\/git\/discard":[\s\S]*applyGitOperationResult\(current, payload, payload\.cwd, "discarding"\)/s,
  );
  assert.match(
    inventoryEventsSource,
    /case "project\/git\/commit_detail":[\s\S]*commitDetails:[\s\S]*payload\.commitHash/s,
  );
});

const baseGraphCommit = {
  hash: "abc",
  parents: [],
  refs: [],
  subject: "first",
  authorName: "author",
  authoredAt: "2026-01-01T00:00:00.000Z",
};

test("git graph unchanged results keep cached commits and adopt the signature", () => {
  const cwd = "/repo";
  const current: Record<string, GitGraphState> = {
    [cwd]: {
      projectId: "p1",
      cwd,
      head: "abc",
      signature: "sig-1",
      commits: [baseGraphCommit],
      commitDetails: { abc: { commitHash: "abc", files: [] } },
      loading: true,
    },
  };

  const next = applyGitGraphResult(current, {
    ok: true,
    projectId: "p1",
    cwd,
    head: "abc",
    commits: [],
    signature: "sig-1",
    unchanged: true,
    message: "Graph unchanged",
  }, cwd);

  const entry = next[cwd];
  assert.equal(entry?.commits.length, 1);
  assert.equal(entry?.head, "abc");
  assert.equal(entry?.signature, "sig-1");
  assert.equal(entry?.loading, false);
  assert.equal(entry?.commitDetails?.abc?.commitHash, "abc");
  assert.equal(entry?.error, undefined);
});

test("git graph full results replace commits and store the new signature", () => {
  const cwd = "/repo";
  const current: Record<string, GitGraphState> = {
    [cwd]: {
      projectId: "p1",
      cwd,
      head: "abc",
      signature: "sig-1",
      commits: [baseGraphCommit],
      loading: true,
    },
  };

  const next = applyGitGraphResult(current, {
    ok: true,
    projectId: "p1",
    cwd,
    head: "def",
    commits: [{ ...baseGraphCommit, hash: "def", subject: "second" }],
    signature: "sig-2",
    message: "Fetched 1 commit(s)",
  }, cwd);

  const entry = next[cwd];
  assert.equal(entry?.commits[0]?.hash, "def");
  assert.equal(entry?.head, "def");
  assert.equal(entry?.signature, "sig-2");
  assert.equal(entry?.loading, false);
});

test("git graph failures keep the cached commits and surface the error", () => {
  const cwd = "/repo";
  const current: Record<string, GitGraphState> = {
    [cwd]: {
      projectId: "p1",
      cwd,
      head: "abc",
      signature: "sig-1",
      commits: [baseGraphCommit],
      loading: true,
    },
  };

  const next = applyGitGraphResult(current, {
    ok: false,
    projectId: "p1",
    cwd,
    commits: [],
    message: "git failed",
  }, cwd);

  const entry = next[cwd];
  assert.equal(entry?.commits[0]?.hash, "abc");
  assert.equal(entry?.signature, "sig-1");
  assert.equal(entry?.loading, false);
  assert.equal(entry?.error, "git failed");
});

test("git operation failures preserve the previous tracking snapshot", () => {
  const cwd = "/repo";
  const previous: GitStatusState = {
    projectId: "p1",
    cwd,
    branch: "main",
    detached: false,
    upstreamBranch: "origin/main",
    ahead: 2,
    behind: 1,
    pushTarget: "origin/main",
    trackingStale: false,
    clean: false,
    files: [{ path: "README.md", indexStatus: "M", worktreeStatus: " " }],
    loading: true,
    message: "正在刷新 Git...",
  };

  const next = applyGitOperationResult(
    { [cwd]: previous },
    {
      ok: false,
      projectId: "p1",
      cwd,
      message: "Git status failed",
      branch: "",
      detached: false,
      ahead: 0,
      behind: 0,
      trackingStale: false,
      clean: false,
      files: [],
    },
    cwd,
    "loading",
  );

  assert.equal(next[cwd]?.branch, "main");
  assert.equal(next[cwd]?.upstreamBranch, "origin/main");
  assert.equal(next[cwd]?.ahead, 2);
  assert.equal(next[cwd]?.behind, 1);
  assert.deepEqual(next[cwd]?.files, previous.files);
  assert.equal(next[cwd]?.loading, false);
  assert.equal(next[cwd]?.message, "Git status failed");
  assert.equal(next[cwd]?.error, "Git status failed");
});

test("successful git operations clear stale errors but preserve fetch failures", () => {
  const cwd = "/repo";
  const previous = {
    projectId: "p1",
    cwd,
    branch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    trackingStale: false,
    clean: true,
    files: [],
    error: "old failure",
  } satisfies GitStatusState;

  const success = applyGitOperationResult(
    { [cwd]: previous },
    {
      ok: true,
      projectId: "p1",
      cwd,
      branch: "main",
      detached: false,
      ahead: 0,
      behind: 0,
      trackingStale: false,
      clean: true,
      files: [],
      message: "Refreshed",
    },
    cwd,
    "loading",
  );
  assert.equal(success[cwd]?.error, undefined);

  const fetchFailure = applyGitOperationResult(
    success,
    {
      ok: true,
      projectId: "p1",
      cwd,
      branch: "main",
      detached: false,
      ahead: 0,
      behind: 0,
      trackingStale: true,
      remoteRefreshError: "origin unavailable",
      clean: true,
      files: [],
      message: "Refreshed with stale tracking",
    },
    cwd,
    "loading",
  );
  assert.equal(fetchFailure[cwd]?.error, "origin unavailable");
});
