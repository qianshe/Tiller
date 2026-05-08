import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "./runtime-types.js";
import { createRestoreReplayEventSink } from "./restore-replay.js";

const assistantReplayEvent: SessionRuntimeEvent = {
  type: "message",
  message: {
    id: "runtime-session-msg-replayed",
    role: "assistant",
    text: "旧会话里已经持久化过的 assistant 内容",
    timestamp: "2026-05-08T08:00:00.000Z",
  },
};

const userReplayEvent: SessionRuntimeEvent = {
  type: "message",
  message: {
    id: "runtime-session-msg-user",
    role: "user",
    text: "用户历史消息",
    timestamp: "2026-05-08T08:00:01.000Z",
  },
};

const unknownAssistantEvent: SessionRuntimeEvent = {
  type: "message",
  message: {
    id: "runtime-session-msg-new",
    role: "assistant",
    text: "恢复后真正新增的 assistant 内容",
    timestamp: "2026-05-08T08:00:02.000Z",
  },
};

const statusEvent: SessionRuntimeEvent = {
  type: "status",
  status: "idle",
  message: "ready",
};

test("restore replay sink suppresses assistant replay until the restored session receives a new prompt", () => {
  const forwarded: SessionRuntimeEvent[] = [];
  const suppressed: SessionRuntimeEvent[] = [];
  const sink = createRestoreReplayEventSink(
    (event) => forwarded.push(event),
    (event) => suppressed.push(event),
    [assistantReplayEvent.message],
  );

  sink.setSuppressing(true);
  sink.onEvent(assistantReplayEvent);
  sink.onEvent(userReplayEvent);
  sink.onEvent(statusEvent);
  sink.onEvent(assistantReplayEvent);
  sink.onEvent(unknownAssistantEvent);

  sink.setSuppressing(false);
  sink.onEvent(assistantReplayEvent);

  assert.deepEqual(forwarded, [userReplayEvent, statusEvent, unknownAssistantEvent, assistantReplayEvent]);
  assert.deepEqual(suppressed, [assistantReplayEvent, assistantReplayEvent]);
});
