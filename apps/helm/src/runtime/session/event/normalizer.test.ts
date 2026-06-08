import assert from "node:assert/strict";
import test from "node:test";
import {
  isRuntimeGeneratedMessageId,
  mergeAssistantStreamText,
} from "./normalizer";

test("Helm session event normalizer re-exports promoted core helpers", () => {
  assert.equal(mergeAssistantStreamText("hello", "hello world"), "hello world");
  assert.equal(isRuntimeGeneratedMessageId("session-abc-msg-s0"), true);
});
