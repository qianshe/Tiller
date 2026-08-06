import assert from "node:assert/strict";
import test from "node:test";
import type { FileDiffSummary } from "@tiller/shared";
import { reconcileMissionDiffs, refreshGitStatusAndGraph, shouldPrimeGitGraphLoad } from "./git-sync.js";

test("reconcileMissionDiffs uses git status diff details when session diffs are missing", () => {
  const result = reconcileMissionDiffs([], [
    {
      path: "src/app.ts",
      indexStatus: " ",
      worktreeStatus: "M",
      additions: 3,
      deletions: 1,
      patch: "diff --git a/src/app.ts b/src/app.ts",
    },
  ]);

  assert.deepEqual(result, [{
    path: "src/app.ts",
    status: "modified",
    additions: 3,
    deletions: 1,
    patch: "diff --git a/src/app.ts b/src/app.ts",
  } satisfies FileDiffSummary]);
});

test("reconcileMissionDiffs backfills missing counts and patch from git status details", () => {
  const result = reconcileMissionDiffs([
    {
      path: "src/app.ts",
      status: "modified",
      additions: 0,
      deletions: 0,
    },
  ], [
    {
      path: "src/app.ts",
      indexStatus: " ",
      worktreeStatus: "M",
      additions: 8,
      deletions: 2,
      patch: "diff --git a/src/app.ts b/src/app.ts",
    },
  ]);

  assert.deepEqual(result, [{
    path: "src/app.ts",
    status: "modified",
    additions: 8,
    deletions: 2,
    patch: "diff --git a/src/app.ts b/src/app.ts",
  } satisfies FileDiffSummary]);
});

test("shouldPrimeGitGraphLoad only requests graph when no usable graph state exists", () => {
  assert.equal(shouldPrimeGitGraphLoad(undefined), true);
  assert.equal(shouldPrimeGitGraphLoad({ commits: [], loading: false }), true);
  assert.equal(shouldPrimeGitGraphLoad({ commits: [], loading: true }), false);
  assert.equal(shouldPrimeGitGraphLoad({ commits: [], lastUpdated: "2026-07-02T10:00:00.000Z" }), false);
  assert.equal(shouldPrimeGitGraphLoad({ commits: [{ hash: "abc" }] }), false);
});

test("refreshGitStatusAndGraph dispatches status then graph sequentially", async () => {
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];

  async function mockDispatch(method: string, params: Record<string, unknown>) {
    dispatched.push({ method, params });
    if (method === "project/git/status") {
      return { ok: true, branch: "main" };
    }
    return { ok: true };
  }

  await refreshGitStatusAndGraph(mockDispatch, {
    projectId: "p1",
    cwd: "/repo",
    hasGraph: true,
    refreshRemote: false,
  });

  assert.equal(dispatched.length, 2);
  assert.equal(dispatched[0]?.method, "project/git/status");
  assert.equal(dispatched[0]?.params.refreshRemote, false);
  assert.equal(dispatched[1]?.method, "project/git/graph");
});

test("refreshGitStatusAndGraph fetches remotes only when requested", async () => {
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];

  await refreshGitStatusAndGraph(async (method, params) => {
    dispatched.push({ method, params });
    return { ok: true };
  }, {
    projectId: "p1",
    cwd: "/repo",
    hasGraph: false,
    refreshRemote: true,
  });

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.method, "project/git/status");
  assert.equal(dispatched[0]?.params.refreshRemote, true);
});

test("refreshGitStatusAndGraph skips graph when hasGraph is false", async () => {
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];

  async function mockDispatch(method: string, params: Record<string, unknown>) {
    dispatched.push({ method, params });
    return { ok: true };
  }

  await refreshGitStatusAndGraph(mockDispatch, {
    projectId: "p1",
    cwd: "/repo",
    hasGraph: false,
  });

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.method, "project/git/status");
});

test("refreshGitStatusAndGraph forwards the known graph signature", async () => {
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];

  await refreshGitStatusAndGraph(async (method, params) => {
    dispatched.push({ method, params });
    return { ok: true };
  }, {
    projectId: "p1",
    cwd: "/repo",
    hasGraph: true,
    refreshRemote: false,
    graphSignature: "sig-1",
  });

  assert.equal(dispatched[1]?.method, "project/git/graph");
  assert.equal(dispatched[1]?.params.knownSignature, "sig-1");
});

test("refreshGitStatusAndGraph omits knownSignature when none is cached", async () => {
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];

  await refreshGitStatusAndGraph(async (method, params) => {
    dispatched.push({ method, params });
    return { ok: true };
  }, {
    projectId: "p1",
    cwd: "/repo",
    hasGraph: true,
  });

  assert.equal(dispatched[1]?.method, "project/git/graph");
  assert.equal("knownSignature" in (dispatched[1]?.params ?? {}), false);
});

test("refreshGitStatusAndGraph skips graph when status returns ok=false", async () => {
  const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];

  async function mockDispatch(method: string, params: Record<string, unknown>) {
    dispatched.push({ method, params });
    if (method === "project/git/status") {
      return { ok: false, message: "not a git repo" };
    }
    return { ok: true };
  }

  const result = await refreshGitStatusAndGraph(mockDispatch, {
    projectId: "p1",
    cwd: "/repo",
    hasGraph: true,
  });

  assert.equal(dispatched.length, 1);
  assert.equal(result.ok, false);
});
