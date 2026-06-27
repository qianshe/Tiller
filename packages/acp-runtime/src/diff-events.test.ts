import assert from "node:assert/strict";
import test from "node:test";
import { extractDiffFiles } from "./diff-events";

test("extractDiffFiles maps diff file summaries and counts patch lines", () => {
  const files = extractDiffFiles("diff_update", {
    files: [
      {
        path: "src/app.ts",
        patch: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+next",
      },
    ],
  });

  assert.deepEqual(files, [
    {
      path: "src/app.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      patch: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+next",
    },
  ]);
});

test("extractDiffFiles reads nested diff files and hunk objects", () => {
  const files = extractDiffFiles("session_diff", {
    diff: {
      files: [
        {
          file: "src/created.ts",
          status: "added",
          hunks: [{ text: "+export const value = 1;" }],
        },
      ],
    },
  });

  assert.deepEqual(files, [
    {
      path: "src/created.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      patch: "+export const value = 1;",
    },
  ]);
});
