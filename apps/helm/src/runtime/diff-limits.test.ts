import assert from "node:assert/strict";
import test from "node:test";
import { summarizeLargeDiffs } from "./diff-limits.js";

test("summarizeLargeDiffs marks oversized diff content as truncated", () => {
  const files = summarizeLargeDiffs([
    {
      path: "large.ts",
      status: "modified",
      additions: 10,
      deletions: 2,
      patch: "x".repeat(120_000),
    } as any,
  ]);

  assert.equal(files[0]?.truncated, true);
  assert.equal(files[0]?.patch, undefined);
  assert.match(files[0]?.summary ?? "", /内容太长/u);
});
