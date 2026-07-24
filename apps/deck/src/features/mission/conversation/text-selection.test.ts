import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQuotedSelection } from "./text-selection";

test("normalizeQuotedSelection rejects whitespace-only selections", () => {
  assert.equal(normalizeQuotedSelection("   "), null);
  assert.equal(normalizeQuotedSelection(""), null);
});

test("normalizeQuotedSelection keeps meaningful quoted text", () => {
  const selection = normalizeQuotedSelection("  use MCP tools first  ");
  assert.equal(selection?.excerpt, "use MCP tools first");
});
