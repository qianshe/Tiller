import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolCallChangeStats } from "./tool-call-change-stats.js";

test("resolveToolCallChangeStats uses explicit per-call counts", () => {
  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({ path: "src/app.ts", additions: 3, deletions: 1 }),
      "",
    ),
    { additions: 3, deletions: 1 },
  );
});

test("resolveToolCallChangeStats counts a structured replacement", () => {
  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({
        path: "src/app.ts",
        old_string: "const value = 1;",
        new_string: "const value = 2;",
      }),
      "",
    ),
    { additions: 1, deletions: 1 },
  );
});

test("resolveToolCallChangeStats reads unified patches from nested provider metadata", () => {
  assert.deepEqual(
    resolveToolCallChangeStats(
      "write",
      "",
      JSON.stringify({
        metadata: {
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+next",
        },
      }),
    ),
    { additions: 2, deletions: 1 },
  );
});

test("resolveToolCallChangeStats does not guess from cumulative state or non-write calls", () => {
  assert.equal(
    resolveToolCallChangeStats(
      "write",
      JSON.stringify({ path: "src/app.ts", content: "full file body" }),
      "written",
    ),
    undefined,
  );
  assert.equal(
    resolveToolCallChangeStats(
      "read",
      JSON.stringify({ additions: 3, deletions: 1 }),
      "",
    ),
    undefined,
  );
});
