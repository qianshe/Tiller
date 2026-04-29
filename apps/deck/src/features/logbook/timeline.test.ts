import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";
import { buildConversationTimeline, commandChunkToToolCall, groupToolCalls, mergeToolCallHistory } from "./timeline.js";

const baseMessage: AgentMessage = {
  id: "msg-1",
  role: "assistant",
  text: "Done",
  timestamp: "2026-04-28T10:00:02.000Z",
};

test("buildConversationTimeline interleaves messages and tool calls by timestamp", () => {
  const toolCall: AgentToolCall = {
    id: "tool-1",
    kind: "terminal",
    title: "Run tests",
    status: "completed",
    commandId: "cmd-1",
    output: "PASS",
    stream: "stdout",
    timestamp: "2026-04-28T10:00:01.000Z",
    updatedAt: "2026-04-28T10:00:01.000Z",
  };

  const timeline = buildConversationTimeline([baseMessage], [], [toolCall]);

  assert.equal(timeline[0]?.kind, "tool");
  assert.equal(timeline[1]?.kind, "message");
});

test("groupToolCalls merges chunks for the same command id", () => {
  const calls: AgentToolCall[] = [
    { id: "tool-1", kind: "terminal", title: "cmd", status: "running", commandId: "cmd", output: "A", stream: "stdout", timestamp: "2026-04-28T10:00:01.000Z", updatedAt: "2026-04-28T10:00:01.000Z" },
    { id: "tool-1", kind: "terminal", title: "cmd", status: "completed", commandId: "cmd", output: "B", stream: "stderr", timestamp: "2026-04-28T10:00:02.000Z", updatedAt: "2026-04-28T10:00:02.000Z" },
  ];

  const grouped = groupToolCalls(calls);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.text, "AB");
  assert.equal(grouped[0]?.status, "completed");
  assert.deepEqual(grouped[0]?.streams, ["stdout", "stderr"]);
});

test("commandChunkToToolCall provides a terminal fallback for legacy command output", () => {
  const chunk: CommandChunk = {
    id: "chunk-1",
    commandId: "cmd-1",
    text: "ERR",
    stream: "stderr",
    timestamp: "2026-04-28T10:00:01.000Z",
  };

  const call = commandChunkToToolCall(chunk);

  assert.equal(call.kind, "terminal");
  assert.equal(call.status, "failed");
  assert.equal(call.output, "ERR");
});

test("mergeToolCallHistory appends output for existing tool calls", () => {
  const current: AgentToolCall[] = [{ id: "tool-1", kind: "terminal", title: "cmd", status: "running", commandId: "cmd", output: "A", timestamp: "2026-04-28T10:00:01.000Z", updatedAt: "2026-04-28T10:00:01.000Z" }];
  const incoming: AgentToolCall[] = [{ id: "tool-1", kind: "terminal", title: "cmd", status: "completed", commandId: "cmd", output: "B", timestamp: "2026-04-28T10:00:02.000Z", updatedAt: "2026-04-28T10:00:02.000Z" }];

  const merged = mergeToolCallHistory(current, incoming);

  assert.equal(merged[0]?.output, "AB");
  assert.equal(merged[0]?.status, "completed");
});
