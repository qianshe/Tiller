import assert from "node:assert/strict";
import test from "node:test";
import {
  removeDraftContextItem,
  upsertDraftContextItem,
  type DraftContextList,
} from "./prompt-context";

const QUOTE = {
  id: "ctx-q",
  kind: "quote" as const,
  label: "assistant 引用",
  comment: "保留这个回答",
  excerpt: "use MCP first",
  source: { kind: "quote" as const, messageId: "m1", role: "assistant" as const },
};

test("upsertDraftContextItem replaces an existing item with the same id", () => {
  const initial: DraftContextList = [QUOTE];
  const next = upsertDraftContextItem(initial, { ...QUOTE, comment: "更新后的备注" });
  assert.equal(next.length, 1);
  assert.equal(next[0]?.comment, "更新后的备注");
});

test("removeDraftContextItem removes only the target id", () => {
  const initial: DraftContextList = [
    QUOTE,
    {
      id: "ctx-d",
      kind: "diff" as const,
      label: "a.ts:10-12",
      comment: "看看这里",
      excerpt: "+ hello",
      source: { kind: "diff" as const, filePath: "a.ts", startLine: 10, endLine: 12 },
    },
  ];
  const next = removeDraftContextItem(initial, "ctx-q");
  assert.deepEqual(next.map((item) => item.id), ["ctx-d"]);
});
