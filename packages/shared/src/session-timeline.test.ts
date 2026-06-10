import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentPromptImageContent, AgentToolCall } from "./types";
import type { SessionTimelineEntry } from "./session-timeline";
import {
  appendToolCallToSessionTimeline,
  buildSessionTimelineFromLegacy,
  resolveTimelineRepresentedUserMessageIds,
} from "./session-timeline";

const BASE_TIME = "2026-05-30T10:00:00.000Z";

test("reference-only prompt images satisfy the shared prompt image contract", () => {
  const image = {
    type: "image",
    uri: "/api/sessions/session-1/attachments/att-1",
    mimeType: "image/png",
    attachmentId: "att-1",
    sha256: "a".repeat(64),
    byteSize: 12,
  } satisfies AgentPromptImageContent;

  assert.equal(image.uri, "/api/sessions/session-1/attachments/att-1");
});

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

test("buildSessionTimelineFromLegacy interleaves a sequence-less tool call by timestamp instead of grouping it after messages", () => {
  // Real chronology: user(seq 1) -> tool(no sequence) -> assistant(seq 3).
  // Legacy history can carry tool calls without a timelineSequence (e.g. pre-migration
  // records), and they must still land between the two messages by timestamp.
  const timeline = buildSessionTimelineFromLegacy({
    messages: [
      message({ id: "user-1", role: "user", text: "Start", timelineSequence: 1 }),
      message({ id: "assistant-1", role: "assistant", text: "Answer", timelineSequence: 3 }),
    ],
    toolCalls: [
      {
        id: "tool-1",
        commandId: "tool-1",
        kind: "search",
        title: "Search",
        status: "completed",
        output: "result",
        timestamp: at(2),
        updatedAt: at(2),
      } as AgentToolCall,
    ],
    outputs: [],
  });

  assert.deepEqual(
    timeline.map((entry) => entry.kind),
    ["user_message", "tool_call", "assistant_message"],
  );
});

test("buildSessionTimelineFromLegacy splits cumulative assistant text around tool boundaries", () => {
  const timeline = buildSessionTimelineFromLegacy({
    messages: [
      message({ id: "assistant-1", role: "assistant", text: "先说明。", timelineSequence: 1 }),
      message({ id: "assistant-1", role: "assistant", text: "先说明。工具后继续。", timelineSequence: 3 }),
    ],
    toolCalls: [
      toolCall({
        id: "tool-1",
        commandId: "tool-1",
        kind: "search",
        output: "result",
        status: "completed",
        title: "Search",
        timelineSequence: 2,
      }),
    ],
    outputs: [],
  });

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:tool-1"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
  assert.deepEqual(
    timeline.map((entry) =>
      entry.kind === "assistant_message"
        ? entry.chunks.map((chunk) => [chunk.text, chunk.timelineSequence])
        : [entry.id, entry.timelineSequence],
    ),
    [
      [["先说明。", 1]],
      ["tool:tool-1", 2],
      [["工具后继续。", 3]],
    ],
  );
});

test("resolveTimelineRepresentedUserMessageIds consumes repeated user prompt anchors one-to-one", () => {
  const localUsers = [
    {
      id: "local-user-1",
      role: "user" as const,
      text: "继续",
      timestamp: at(1),
    },
    {
      id: "local-user-2",
      role: "user" as const,
      text: "继续",
      timestamp: at(4),
    },
  ];
  const timeline: SessionTimelineEntry[] = [
    {
      id: "provider-user-2",
      kind: "user_message",
      message: {
        id: "provider-user-2",
        role: "user",
        text: "继续",
        timestamp: at(4),
      },
      timestamp: at(4),
      updatedAt: at(4),
    },
  ];

  assert.deepEqual(
    [...resolveTimelineRepresentedUserMessageIds(timeline, localUsers)],
    ["local-user-2"],
  );
});

test("buildSessionTimelineFromLegacy nests assistant content and thinking chunks in sequence order while keeping tool calls independent", () => {
  const timeline = buildSessionTimelineFromLegacy({
    messages: [
      message({ id: "user-1", role: "user", text: "Start", timelineSequence: 1 }),
      message({ id: "assistant-1", role: "assistant", text: "Final answer", timelineSequence: 3 }),
    ],
    toolCalls: [
      toolCall({
        id: "assistant-1:thinking",
        commandId: "assistant-1:thinking",
        kind: "think",
        output: "Plan first",
        status: "completed",
        title: "Thinking",
        timelineSequence: 2,
      }),
      toolCall({
        id: "tool-1",
        commandId: "tool-1",
        kind: "search",
        output: "Search result",
        status: "completed",
        title: "Search",
        timelineSequence: 4,
      }),
    ],
    outputs: [],
  });

  assert.deepEqual(
    timeline.map((entry) => entry.kind),
    ["user_message", "assistant_message", "tool_call"],
  );
  assert.equal(timeline[1]?.id, "assistant-1");
  assert.deepEqual(
    timeline[1]?.kind === "assistant_message"
      ? timeline[1].chunks.map((chunk) => chunk.kind)
      : [],
    ["thinking", "content"],
  );
  assert.equal(
    timeline[2]?.kind === "tool_call" ? timeline[2].toolCall.kind : undefined,
    "search",
  );
});

test("appendToolCallToSessionTimeline merges tool output updates by command id", () => {
  const entries: SessionTimelineEntry[] = [];
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-1",
    commandId: "command-1",
    kind: "shell",
    status: "running",
    title: "Shell",
    timelineSequence: 1,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "tool-command-1",
    commandId: "command-1",
    kind: "shell",
    output: "stdout",
    status: "running",
    title: "command-1",
    timelineSequence: 1,
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(entries[0]?.kind === "tool_call" ? entries[0].id : undefined, "tool:call-1");
  assert.equal(entries[0]?.kind === "tool_call" ? entries[0].toolCall.id : undefined, "call-1");
  assert.equal(entries[0]?.kind === "tool_call" ? entries[0].toolCall.output : undefined, "stdout");
});
