import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import {
  applySessionRuntimeEventToState,
  createEmptySessionUpdateReducerState,
} from "./reducer";

const BASE_TIME = Date.parse("2026-06-08T00:00:00.000Z");

function at(sequence: number) {
  return new Date(BASE_TIME + sequence * 1000).toISOString();
}

function assistant(id: string, text: string, timelineSequence: number): AgentMessage {
  return {
    id,
    role: "assistant",
    text,
    timestamp: at(timelineSequence),
    timelineSequence,
  };
}

function user(id: string, text: string, timelineSequence: number): AgentMessage {
  return {
    id,
    role: "user",
    text,
    timestamp: at(timelineSequence),
    timelineSequence,
  };
}

function toolCall(
  id: string,
  status: AgentToolCall["status"],
  timelineSequence: number,
  output?: string,
): AgentToolCall {
  return {
    id,
    kind: "shell",
    title: "Shell",
    status,
    output,
    timestamp: at(timelineSequence),
    updatedAt: at(timelineSequence + (status === "completed" ? 10 : 0)),
    timelineSequence,
  };
}

test("session update reducer updates a tool entry without moving it after later assistant messages", () => {
  const finalState = [
    { type: "message" as const, message: assistant("assistant-1", "before", 1) },
    { type: "tool-call" as const, toolCall: toolCall("tool-1", "running", 2) },
    { type: "message" as const, message: assistant("assistant-2", "after", 3) },
    { type: "tool-call" as const, toolCall: toolCall("tool-1", "completed", 2, "ok") },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.deepEqual(finalState.entries.map((entry) => entry.id), [
    "assistant-1",
    "tool:tool-1",
    "assistant-2",
  ]);
  const toolEntry = finalState.entries.find((entry) => entry.id === "tool:tool-1");
  assert.equal(toolEntry?.kind, "tool_call");
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.toolCall.status : undefined, "completed");
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.toolCall.output : undefined, "ok");
});

test("session update reducer keeps colliding user and assistant message ids distinct", () => {
  const finalState = [
    { type: "message" as const, message: user("msg-1", "prompt", 1) },
    { type: "message" as const, message: assistant("msg-1", "answer", 2) },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.deepEqual(finalState.messages.map((message) => [message.id, message.role, message.text]), [
    ["msg-1", "user", "prompt"],
    ["msg-1:assistant", "assistant", "answer"],
  ]);
  assert.deepEqual(finalState.entries.map((entry) => [entry.kind, entry.id, entry.timelineSequence]), [
    ["user_message", "msg-1", 1],
    ["assistant_message", "msg-1:assistant", 2],
  ]);
});
