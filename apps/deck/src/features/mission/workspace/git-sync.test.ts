import assert from "node:assert/strict";
import test from "node:test";
import type { FileDiffSummary } from "@tiller/shared";
import { reconcileMissionDiffs, shouldPrimeGitGraphLoad } from "./git-sync.js";

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
