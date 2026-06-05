import assert from "node:assert/strict";
import test from "node:test";
import { addChatSessionIdToFront } from "./chat-window-actions";

test("addChatSessionIdToFront prepends new chat windows", () => {
  assert.deepEqual(addChatSessionIdToFront(["a", "b"], "c"), ["c", "a", "b"]);
});

test("addChatSessionIdToFront keeps existing chat windows in place", () => {
  assert.deepEqual(addChatSessionIdToFront(["a", "b", "c"], "b"), ["a", "b", "c"]);
});
