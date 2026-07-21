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

const replayErrorEvent: SessionRuntimeEvent = {
  type: "error",
  code: "ACP_AGENT_API_ERROR",
  message: "Failed to authenticate. API Error: 403 预扣费额度失败",
};

const replayToolCallEvent: SessionRuntimeEvent = {
  type: "tool-call",
  toolCall: {
    id: "call-restore-1",
    kind: "shell",
    title: "pnpm test",
    status: "completed",
    timestamp: "2026-05-08T08:00:03.000Z",
    updatedAt: "2026-05-08T08:00:04.000Z",
  },
};

const replayCommandOutputEvent: SessionRuntimeEvent = {
  type: "command-output",
  chunk: {
    id: "output-restore-1",
    commandId: "cmd-restore-1",
    stream: "stdout",
    text: "historical output",
    timestamp: "2026-05-08T08:00:05.000Z",
  },
  toolCall: {
    id: "tool-cmd-restore-1",
    kind: "shell",
    title: "cmd-restore-1",
    status: "running",
    commandId: "cmd-restore-1",
    output: "historical output",
    stream: "stdout",
    timestamp: "2026-05-08T08:00:05.000Z",
    updatedAt: "2026-05-08T08:00:05.000Z",
  },
};

const replayDiffEvent: SessionRuntimeEvent = {
  type: "diff-update",
  files: [{ path: "src/index.ts", status: "modified", additions: 1, deletions: 0 }],
};

const replayPlanEvent: SessionRuntimeEvent = {
  type: "plan-update",
  plan: {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [{ content: "恢复历史 plan", priority: "high", status: "in_progress" }],
  },
};

const replayCompactionEvent: SessionRuntimeEvent = {
  type: "compaction",
  phase: "completed",
  source: "heuristic",
  timestamp: "2026-06-08T01:00:01.000Z",
  summaryText: "恢复时重放的历史压缩摘要",
  messageId: "compact-summary-1",
};

test("restore replay sink suppresses historical message replay until the restored session receives a new prompt", () => {
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
  sink.onEvent(replayErrorEvent);
  sink.onEvent(statusEvent);
  sink.onEvent(assistantReplayEvent);
  sink.onEvent(unknownAssistantEvent);

  sink.setSuppressing(false);
  sink.onEvent(assistantReplayEvent);
  sink.onEvent(replayErrorEvent);

  assert.deepEqual(forwarded, [
    statusEvent,
    unknownAssistantEvent,
    assistantReplayEvent,
    replayErrorEvent,
  ]);
  assert.deepEqual(suppressed, [
    assistantReplayEvent,
    userReplayEvent,
    replayErrorEvent,
    assistantReplayEvent,
  ]);
});

test("restore replay sink suppresses replay artifacts until prompt boundary", () => {
  const forwarded: SessionRuntimeEvent[] = [];
  const suppressed: SessionRuntimeEvent[] = [];
  const sink = createRestoreReplayEventSink(
    (event) => forwarded.push(event),
    (event) => suppressed.push(event),
    [assistantReplayEvent.message],
  );

  sink.setSuppressing(true);
  sink.onEvent(replayToolCallEvent);
  sink.onEvent(replayCommandOutputEvent);
  sink.onEvent(replayDiffEvent);
  sink.onEvent(replayPlanEvent);
  sink.onEvent(replayCompactionEvent);
  sink.onEvent(replayErrorEvent);

  assert.deepEqual(forwarded, []);
  assert.deepEqual(suppressed, [
    replayToolCallEvent,
    replayCommandOutputEvent,
    replayDiffEvent,
    replayPlanEvent,
    replayCompactionEvent,
    replayErrorEvent,
  ]);

  sink.setSuppressing(false);
  sink.onEvent(replayToolCallEvent);
  sink.onEvent(replayCompactionEvent);
  sink.onEvent(replayErrorEvent);
  assert.deepEqual(forwarded, [replayToolCallEvent, replayCompactionEvent, replayErrorEvent]);
});

