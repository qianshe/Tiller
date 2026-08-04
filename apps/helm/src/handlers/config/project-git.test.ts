import assert from "node:assert/strict";
import test from "node:test";
import { mergeGitStatusFilesWithDiffStats } from "./project-git";

test("mergeGitStatusFilesWithDiffStats drops status-only paths", () => {
  const result = mergeGitStatusFilesWithDiffStats(
    [
      { path: "stale.ts", indexStatus: " ", worktreeStatus: "M" },
      { path: "src/app.ts", indexStatus: " ", worktreeStatus: "M" },
    ],
    [{ path: "src/app.ts", additions: 2, deletions: 1 }],
  );

  assert.deepEqual(result, [{
    path: "src/app.ts",
    indexStatus: " ",
    worktreeStatus: "M",
    additions: 2,
    deletions: 1,
  }]);
});

test("mergeGitStatusFilesWithDiffStats keeps real zero-line changes", () => {
  const result = mergeGitStatusFilesWithDiffStats(
    [{ path: "empty.txt", indexStatus: "?", worktreeStatus: "?" }],
    [{ path: "empty.txt", additions: 0, deletions: 0 }],
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.additions, 0);
  assert.equal(result[0]?.deletions, 0);
});
