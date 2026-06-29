import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentPromptImageContent, AgentToolCall } from "./types";
import { injectTranscriptBoundaryEvents } from "./session-transcript";
import type { SessionTimelineBatch, SessionTimelineEntry } from "./session-timeline";
import {
  appendToolCallToSessionTimeline,
  buildSessionTimelineFromLegacy,
  resolveTimelineRepresentedUserMessageIds,
  sortSessionTimelineEntries,
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

function message(overrides: Partial<AgentMessage> & Pick<AgentMessage, "id" | "role" | "text" | "sequence">): AgentMessage {
  return {
    timestamp: at(overrides.sequence ?? 0),
    ...overrides,
  };
}

function toolCall(
  overrides: Partial<AgentToolCall> & Pick<AgentToolCall, "id" | "kind" | "status" | "title" | "sequence">,
): AgentToolCall {
  return {
    timestamp: at(overrides.sequence ?? 0),
    updatedAt: at(overrides.sequence ?? 0),
    ...overrides,
  };
}

test("session timeline keeps context compaction and resumed tail as explicit ordered events", () => {
  const entries: SessionTimelineEntry[] = [
    {
      kind: "user_message",
      id: "user-1",
      message: message({ id: "user-1", role: "user", text: "旧上下文里的最后一个问题", sequence: 10 }),
      timestamp: "2026-06-22T10:00:00.000Z",
      updatedAt: "2026-06-22T10:00:00.000Z",
      sequence: 10,
    },
    {
      kind: "context_compaction",
      id: "compaction-1",
      summaryMessageId: "compaction-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      timestamp: "2026-06-22T10:01:00.000Z",
      updatedAt: "2026-06-22T10:01:00.000Z",
      replayCompleteness: "compacted",
    },
    {
      kind: "session_resumed",
      id: "resume-1",
      restoreMethod: "session/load",
      timestamp: "2026-06-22T10:01:05.000Z",
      updatedAt: "2026-06-22T10:01:05.000Z",
      replayCompleteness: "compacted",
    },
    {
      kind: "assistant_message",
      id: "assistant-1",
      chunks: [{
        kind: "content",
        id: "assistant-1:content",
        text: "好的，我会继续处理剩余工作。",
        timestamp: "2026-06-22T10:01:06.000Z",
        sequence: 20,
      }],
      timestamp: "2026-06-22T10:01:06.000Z",
      updatedAt: "2026-06-22T10:01:06.000Z",
      sequence: 20,
    },
  ] as SessionTimelineEntry[];

  assert.deepEqual(entries.map((entry) => entry.kind), [
    "user_message",
    "context_compaction",
    "session_resumed",
    "assistant_message",
  ]);
});

test("injectTranscriptBoundaryEvents inserts transcript markers before the resumed message", () => {
  const entries: SessionTimelineEntry[] = [
    {
      kind: "assistant_message",
      id: "older-assistant",
      chunks: [{
        kind: "content",
        id: "older-assistant:content",
        text: "压缩前最后一条可见回复",
        timestamp: "2026-06-22T10:00:59.000Z",
        sequence: 10,
      }],
      timestamp: "2026-06-22T10:00:59.000Z",
      updatedAt: "2026-06-22T10:00:59.000Z",
      sequence: 10,
    },
    {
      kind: "user_message",
      id: "current-user",
      message: {
        id: "provider-current-user",
        role: "user",
        text: "继续处理",
        timestamp: "2026-06-22T10:01:11.000Z",
        sequence: 11,
      },
      timestamp: "2026-06-22T10:01:11.000Z",
      updatedAt: "2026-06-22T10:01:11.000Z",
      sequence: 11,
    },
    {
      kind: "assistant_message",
      id: "current-assistant",
      chunks: [{
        kind: "content",
        id: "current-assistant:content",
        text: "好的，继续。",
        timestamp: "2026-06-22T10:01:12.000Z",
        sequence: 12,
      }],
      timestamp: "2026-06-22T10:01:12.000Z",
      updatedAt: "2026-06-22T10:01:12.000Z",
      sequence: 12,
    },
  ];

  const nextEntries = injectTranscriptBoundaryEvents(
    entries,
    {
      kind: "context_compaction",
      id: "compaction-1",
      summaryMessageId: "compaction-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      timestamp: "2026-06-22T10:01:11.000Z",
      updatedAt: "2026-06-22T10:01:11.000Z",
      replayCompleteness: "compacted",
    },
    {
      kind: "session_resumed",
      id: "resume-1",
      restoreMethod: "session/load",
      timestamp: "2026-06-22T10:01:11.000Z",
      updatedAt: "2026-06-22T10:01:11.000Z",
      replayCompleteness: "compacted",
    },
  );

  assert.deepEqual(
    nextEntries.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "older-assistant"],
      ["context_compaction", "compaction-1"],
      ["session_resumed", "resume-1"],
      ["user_message", "current-user"],
      ["assistant_message", "current-assistant"],
    ],
  );
});

test("buildSessionTimelineFromLegacy interleaves a sequence-less tool call by timestamp instead of grouping it after messages", () => {
  // Real chronology: user(seq 1) -> tool(no sequence) -> assistant(seq 3).
  // Legacy history can carry tool calls without a sequence (e.g. pre-migration
  // records), and they must still land between the two messages by timestamp.
  const timeline = buildSessionTimelineFromLegacy({
    messages: [
      message({ id: "user-1", role: "user", text: "Start", sequence: 1 }),
      message({ id: "assistant-1", role: "assistant", text: "Answer", sequence: 3 }),
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
      message({ id: "assistant-1", role: "assistant", text: "先说明。", sequence: 1 }),
      message({ id: "assistant-1", role: "assistant", text: "先说明。工具后继续。", sequence: 3 }),
    ],
    toolCalls: [
      toolCall({
        id: "tool-1",
        commandId: "tool-1",
        kind: "search",
        output: "result",
        status: "completed",
        title: "Search",
        sequence: 2,
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
        ? entry.chunks.map((chunk) => [chunk.text, chunk.sequence])
        : entry.kind === "tool_call" || entry.kind === "user_message" || entry.kind === "system_message"
          ? [entry.id, entry.sequence]
          : [entry.id, entry.kind],
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
      message({ id: "user-1", role: "user", text: "Start", sequence: 1 }),
      message({ id: "assistant-1", role: "assistant", text: "Final answer", sequence: 3 }),
    ],
    toolCalls: [
      toolCall({
        id: "assistant-1:thinking",
        commandId: "assistant-1:thinking",
        kind: "think",
        output: "Plan first",
        status: "completed",
        title: "Thinking",
        sequence: 2,
      }),
      toolCall({
        id: "tool-1",
        commandId: "tool-1",
        kind: "search",
        output: "Search result",
        status: "completed",
        title: "Search",
        sequence: 4,
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

test("buildSessionTimelineFromLegacy keeps compacted chronology when sequence resets", () => {
  const timeline = buildSessionTimelineFromLegacy({
    messages: [
      {
        id: "old-assistant",
        role: "assistant",
        text: "旧回复结尾",
        timestamp: "2026-06-10T09:28:50.000Z",
        sequence: 87,
      },
      {
        id: "new-user",
        role: "user",
        text: "新的 prompt",
        timestamp: "2026-06-10T10:19:22.000Z",
        sequence: 2,
      },
      {
        id: "new-assistant",
        role: "assistant",
        text: "新回复开始",
        timestamp: "2026-06-10T10:19:40.000Z",
        sequence: 4,
      },
    ],
    toolCalls: [],
    outputs: [],
  });

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "old-assistant"],
      ["user_message", "new-user"],
      ["assistant_message", "new-assistant"],
    ],
  );
});

test("sortSessionTimelineEntries keeps earlier compacted history anchored when live sequenced entries arrive", () => {
  const timeline = sortSessionTimelineEntries([
    {
      id: "old-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "old-assistant:content",
          kind: "content",
          text: "旧回复结尾",
          timestamp: "2026-06-10T09:28:50.000Z",
          sequence: 87,
        },
      ],
      timestamp: "2026-06-10T09:28:50.000Z",
      updatedAt: "2026-06-10T09:28:50.000Z",
      sequence: 87,
    },
    {
      id: "new-user",
      kind: "user_message",
      message: {
        id: "new-user",
        role: "user",
        text: "新的 prompt",
        timestamp: "2026-06-10T10:19:22.000Z",
        sequence: 2,
      },
      timestamp: "2026-06-10T10:19:22.000Z",
      updatedAt: "2026-06-10T10:19:22.000Z",
      sequence: 2,
    },
    {
      id: "new-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "new-assistant:content",
          kind: "content",
          text: "新回复开始",
          timestamp: "2026-06-10T10:19:40.000Z",
          sequence: 4,
        },
      ],
      timestamp: "2026-06-10T10:19:40.000Z",
      updatedAt: "2026-06-10T10:19:40.000Z",
      sequence: 4,
    },
    {
      id: "live-tool",
      kind: "tool_call",
      toolCall: {
        id: "live-tool",
        commandId: "live-tool",
        kind: "search",
        title: "Search",
        status: "completed",
        output: "result",
        timestamp: "2026-06-10T10:19:45.000Z",
        updatedAt: "2026-06-10T10:19:45.000Z",
        sequence: 5,
      },
      timestamp: "2026-06-10T10:19:45.000Z",
      updatedAt: "2026-06-10T10:19:45.000Z",
      sequence: 5,
    },
  ]);

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "old-assistant"],
      ["user_message", "new-user"],
      ["assistant_message", "new-assistant"],
      ["tool_call", "live-tool"],
    ],
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
    sequence: 1,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "tool-command-1",
    commandId: "command-1",
    kind: "shell",
    output: "stdout",
    status: "running",
    title: "command-1",
    sequence: 1,
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(entries[0]?.kind === "tool_call" ? entries[0].id : undefined, "tool:call-1");
  assert.equal(entries[0]?.kind === "tool_call" ? entries[0].toolCall.id : undefined, "call-1");
  assert.equal(entries[0]?.kind === "tool_call" ? entries[0].toolCall.output : undefined, "stdout");
});

test("appendToolCallToSessionTimeline lets richer running updates reopen a terminal tool row", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-1",
    commandId: "call-1",
    kind: "tool",
    title: "Tool call call-1",
    status: "completed",
    sequence: 1,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-1",
    commandId: "call-1",
    kind: "write",
    title: "Write",
    status: "running",
    input: JSON.stringify({
      file_path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
    }),
    sequence: 1,
  }));

  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.status : undefined,
    "running",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.kind : undefined,
    "write",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.input : undefined,
    JSON.stringify({
      file_path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
    }),
  );
});

test("appendToolCallToSessionTimeline keeps terminal status for weak running fallback updates", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-1",
    commandId: "command-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    output: "done",
    sequence: 1,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "tool-command-1",
    commandId: "command-1",
    kind: "shell",
    title: "command-1",
    status: "running",
    output: "done\nstdout chunk",
    sequence: 1,
  }));

  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.status : undefined,
    "completed",
  );
});

test("SessionTimelineBatch is the only canonical write envelope", () => {
  const batch: SessionTimelineBatch = {
    replace: false,
    deliverySequence: 7,
    lastSequence: 3,
    entries: [
      {
        id: "assistant-1",
        kind: "assistant_message",
        chunks: [],
        timestamp: "2026-06-29T10:00:01.000Z",
        updatedAt: "2026-06-29T10:00:01.000Z",
        sequence: 1,
      },
      {
        id: "tool:tool-1",
        kind: "tool_call",
        toolCall: {
          id: "tool-1",
          kind: "read",
          title: "Read",
          status: "completed",
          timestamp: "2026-06-29T10:00:02.000Z",
          updatedAt: "2026-06-29T10:00:02.000Z",
          sequence: 2,
        },
        timestamp: "2026-06-29T10:00:02.000Z",
        updatedAt: "2026-06-29T10:00:02.000Z",
        sequence: 2,
      },
      {
        id: "assistant-1#p1",
        kind: "assistant_message",
        chunks: [],
        timestamp: "2026-06-29T10:00:03.000Z",
        updatedAt: "2026-06-29T10:00:03.000Z",
        sequence: 3,
      },
    ] satisfies SessionTimelineEntry[],
  };

  assert.equal(batch.entries[1]?.kind, "tool_call");
  assert.equal(batch.replace, false);
  assert.equal(batch.deliverySequence, 7);
  assert.equal(batch.lastSequence, 3);
});

test("SessionTimelineEntry uses sequence field (not sequence) as canonical sequence", () => {
  const entry: SessionTimelineEntry = {
    id: "assistant-1",
    kind: "assistant_message",
    chunks: [{
      id: "assistant-1:content",
      kind: "content",
      text: "hello",
      timestamp: "2026-06-29T10:00:01.000Z",
      sequence: 1,
    }],
    timestamp: "2026-06-29T10:00:01.000Z",
    updatedAt: "2026-06-29T10:00:01.000Z",
    sequence: 1,
  };

  assert.equal(entry.sequence, 1);
  assert.equal(entry.kind, "assistant_message");
});
