import assert from "node:assert/strict";
import test from "node:test";
import {
  addChatSessionIdToFront,
  MAX_OPEN_CHAT_SESSION_WINDOWS,
} from "./chat-window-actions";

test("addChatSessionIdToFront prepends new chat windows", () => {
  assert.deepEqual(addChatSessionIdToFront(["a", "b"], "c"), ["c", "a", "b"]);
});

test("addChatSessionIdToFront keeps existing chat windows in place", () => {
  assert.deepEqual(addChatSessionIdToFront(["a", "b", "c"], "b"), ["a", "b", "c"]);
});

test("addChatSessionIdToFront caps persisted chat windows", () => {
  const current = Array.from({ length: MAX_OPEN_CHAT_SESSION_WINDOWS }, (_, index) => `s${index + 1}`);

  assert.deepEqual(
    addChatSessionIdToFront(current, "next"),
    ["next", ...current.slice(0, MAX_OPEN_CHAT_SESSION_WINDOWS - 1)],
  );
});
