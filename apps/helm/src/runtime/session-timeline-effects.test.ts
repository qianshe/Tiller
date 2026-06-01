import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { persistTimelineMessage, persistTimelineToolCall } from "./session-timeline-effects";

const BASE_TIME = "2026-06-01T00:00:00.000Z";

function at(seconds: number) {
  return new Date(Date.parse(BASE_TIME) + seconds * 1000).toISOString();
}

function message(overrides: Partial<AgentMessage> & Pick<AgentMessage, "id" | "role" | "text" | "timelineSequence">): AgentMessage {
  return {
    timestamp: at(overrides.timelineSequence ?? 0),
    ...overrides,
  };
}

function toolCall(
  overrides: Partial<AgentToolCall> & Pick<AgentToolCall, "id" | "kind" | "status" | "title" | "timelineSequence">,
): AgentToolCall {
  return {
    timestamp: at(overrides.timelineSequence ?? 0),
    updatedAt: at(overrides.timelineSequence ?? 0),
    ...overrides,
  };
}

function contextWithTimelineStore(sessionTimelineStore: unknown): HelmHandlerContext {
  return { sessionTimelineStore } as HelmHandlerContext;
}

test("persistTimelineMessage uses bounded timeline message upsert when available", () => {
  const calls: string[] = [];
  const storedEntry: SessionTimelineEntry = {
    id: "assistant-1",
    kind: "assistant_message",
    chunks: [{ id: "assistant-1:content", kind: "content", text: "done", timestamp: at(1), timelineSequence: 1 }],
    timestamp: at(1),
    updatedAt: at(1),
    timelineSequence: 1,
  };
  const context = contextWithTimelineStore({
    upsertMessage(sessionId: string, item: AgentMessage) {
      calls.push(`upsertMessage:${sessionId}:${item.id}`);
      return storedEntry;
    },
    list() {
      calls.push("list");
      throw new Error("list should not be called for live timeline message writes");
    },
    replace() {
      calls.push("replace");
      throw new Error("replace should not be called for live timeline message writes");
    },
  });

  const result = persistTimelineMessage(
    context,
    "session-1",
    message({ id: "assistant-1", role: "assistant", text: "done", timelineSequence: 1 }),
  );

  assert.equal(result, storedEntry);
  assert.deepEqual(calls, ["upsertMessage:session-1:assistant-1"]);
});

test("persistTimelineToolCall uses bounded timeline tool-call upsert when available", () => {
  const calls: string[] = [];
  const storedEntry: SessionTimelineEntry = {
    id: "tool:read-1",
    kind: "tool_call",
    toolCall: toolCall({ id: "read-1", kind: "read", status: "completed", title: "Read", timelineSequence: 2 }),
    timestamp: at(2),
    updatedAt: at(2),
    timelineSequence: 2,
  };
  const context = contextWithTimelineStore({
    upsertToolCall(sessionId: string, item: AgentToolCall) {
      calls.push(`upsertToolCall:${sessionId}:${item.id}`);
      return storedEntry;
    },
    list() {
      calls.push("list");
      throw new Error("list should not be called for live timeline tool writes");
    },
    replace() {
      calls.push("replace");
      throw new Error("replace should not be called for live timeline tool writes");
    },
  });

  const result = persistTimelineToolCall(
    context,
    "session-1",
    toolCall({ id: "read-1", kind: "read", status: "completed", title: "Read", timelineSequence: 2 }),
  );

  assert.equal(result, storedEntry);
  assert.deepEqual(calls, ["upsertToolCall:session-1:read-1"]);
});
