import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentPromptImageContent, AgentToolCall } from "./types";
import { isTranscriptEventEntry } from "./session-transcript";
import type { SessionTimelineBatch, SessionTimelineEntry } from "./session-timeline";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
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

test("appendMessageToSessionTimeline keeps the final full assistant message instead of duplicating prior streaming fragments", () => {
  const entries = appendMessageToSessionTimeline([], {
    id: "assistant-1",
    role: "assistant",
    text: "Line 2\nLine 3",
    timestamp: at(1),
    sequence: 1,
    streaming: true,
  });

  appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "Line 4",
    timestamp: at(2),
    sequence: 2,
    streaming: true,
  });

  appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "Line 1\nLine 2\nLine 3\nLine 4",
    timestamp: at(3),
    sequence: 3,
    streaming: false,
  });

  assert.equal(entries[0]?.kind, "assistant_message");
  assert.equal(
    entries[0]?.kind === "assistant_message"
      ? entries[0].chunks[0]?.text
      : undefined,
    "Line 1\nLine 2\nLine 3\nLine 4",
  );
});

test("appendToolCallToSessionTimeline never promotes tool calls to assistant Thinking", () => {
  const entries = appendToolCallToSessionTimeline([], {
    id: "thinking-1",
    commandId: "thinking-1",
    kind: "tool",
    title: "Thinking",
    status: "running",
    output: "Line 1\nLine 2\nLine 3",
    timestamp: at(1),
    updatedAt: at(1),
    sequence: 1,
  });

  appendToolCallToSessionTimeline(entries, {
    id: "thinking-1",
    commandId: "thinking-1",
    kind: "tool",
    title: "Thinking",
    status: "completed",
    output: "Line 2\nLine 3\nLine 4",
    timestamp: at(2),
    updatedAt: at(2),
    sequence: 2,
  });

  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(entries[0]?.kind === "tool_call" ? entries[0].toolCall.kind : undefined, "tool");
  assert.equal(entries[0]?.kind === "tool_call" ? entries[0].toolCall.status : undefined, "completed");
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

test("isTranscriptEventEntry only accepts compaction and history-gap transcript entities", () => {
  const legacyResumedKind = ["session", "resumed"].join("_");
  assert.equal(isTranscriptEventEntry({ kind: "context_compaction" }), true);
  assert.equal(isTranscriptEventEntry({ kind: "history_gap" }), true);
  assert.equal(isTranscriptEventEntry({ kind: legacyResumedKind }), false);
});

test("sortSessionTimelineEntries keeps a compaction-only boundary in stored order", () => {
  const entries: SessionTimelineEntry[] = [
    {
      kind: "context_compaction",
      id: "compaction-1",
      phase: "completed",
      source: "provider",
      timestamp: "2026-07-02T10:00:00.000Z",
      updatedAt: "2026-07-02T10:00:00.000Z",
      replayCompleteness: "compacted",
      summaryText: "Earlier context compacted.",
    },
    {
      kind: "assistant_message",
      id: "assistant-after",
      chunks: [{
        id: "assistant-after:content",
        kind: "content",
        text: "继续处理",
        timestamp: "2026-07-02T10:00:01.000Z",
      }],
      timestamp: "2026-07-02T10:00:01.000Z",
      updatedAt: "2026-07-02T10:00:01.000Z",
    },
  ];

  assert.deepEqual(
    sortSessionTimelineEntries(entries).map((entry) => entry.kind),
    ["context_compaction", "assistant_message"],
  );
});

test("sortSessionTimelineEntries leaves compaction-only boundaries untouched", () => {
  const entries: SessionTimelineEntry[] = [
    {
      kind: "context_compaction",
      id: "compaction-1",
      phase: "completed",
      source: "provider",
      summaryMessageId: "compaction-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      timestamp: "2026-06-22T10:01:11.000Z",
      updatedAt: "2026-06-22T10:01:11.000Z",
      replayCompleteness: "compacted",
    },
    {
      kind: "assistant_message",
      id: "assistant-after",
      chunks: [{
        kind: "content",
        id: "assistant-after:content",
        text: "好的，继续。",
        timestamp: "2026-06-22T10:01:12.000Z",
        sequence: 12,
      }],
      timestamp: "2026-06-22T10:01:12.000Z",
      updatedAt: "2026-06-22T10:01:12.000Z",
      sequence: 12,
    },
  ];

  assert.deepEqual(sortSessionTimelineEntries(entries).map((entry) => [entry.kind, entry.id]), [
    ["context_compaction", "compaction-1"],
    ["assistant_message", "assistant-after"],
  ]);
});

test("sortSessionTimelineEntries relies on sequence rather than timestamps", () => {
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
      ["user_message", "new-user"],
      ["assistant_message", "new-assistant"],
      ["tool_call", "live-tool"],
      ["assistant_message", "old-assistant"],
    ],
  );
});

test("appendMessageToSessionTimeline preserves assistant thought messages as thinking chunks", () => {
  const entries = appendMessageToSessionTimeline([], {
    id: "thought-1",
    role: "assistant",
    contentKind: "thought",
    text: "先检查调用链",
    timestamp: at(1),
    sequence: 1,
    streaming: true,
  });

  assert.equal(entries[0]?.kind, "assistant_message");
  assert.equal(
    entries[0]?.kind === "assistant_message" ? entries[0].streaming : undefined,
    true,
  );
  assert.deepEqual(
    entries[0]?.kind === "assistant_message" ? entries[0].chunks[0] : undefined,
    {
      id: "thought-1:thinking",
      kind: "thinking",
      text: "先检查调用链",
      title: "Thinking",
      status: "running",
      timestamp: at(1),
      updatedAt: at(1),
      sequence: 1,
    },
  );
});

test("appendMessageToSessionTimeline clears streaming after a thinking chunk completes", () => {
  const entries = appendMessageToSessionTimeline([], {
    id: "thought-terminal-1",
    role: "assistant",
    contentKind: "thought",
    text: "先分析，再完成",
    timestamp: at(1),
    sequence: 1,
    streaming: true,
  });

  appendMessageToSessionTimeline(entries, {
    id: "thought-terminal-1",
    role: "assistant",
    contentKind: "thought",
    text: "先分析，再完成",
    timestamp: at(2),
    sequence: 2,
    streaming: false,
    streamMode: "snapshot",
  });

  assert.equal(
    entries[0]?.kind === "assistant_message" ? entries[0].streaming : undefined,
    false,
  );
  assert.equal(
    entries[0]?.kind === "assistant_message" && entries[0].chunks[0]?.kind === "thinking"
      ? entries[0].chunks[0].status
      : undefined,
    "completed",
  );
});

test("appendMessageToSessionTimeline replaces ACP v2 thought snapshots", () => {
  const entries = appendMessageToSessionTimeline([], {
    id: "thought-upsert-1",
    role: "assistant",
    contentKind: "thought",
    text: "第一份较长的完整思考",
    timestamp: at(1),
    sequence: 1,
    streaming: true,
    streamMode: "snapshot",
  });

  appendMessageToSessionTimeline(entries, {
    id: "thought-upsert-1",
    role: "assistant",
    contentKind: "thought",
    text: "替换稿",
    timestamp: at(2),
    sequence: 2,
    streaming: true,
    streamMode: "snapshot",
  });

  assert.equal(entries[0]?.kind, "assistant_message");
  assert.equal(
    entries[0]?.kind === "assistant_message" ? entries[0].chunks[0]?.text : undefined,
    "替换稿",
  );
});

test("sortSessionTimelineEntries preserves stored order when any sequence is missing", () => {
  const timeline = sortSessionTimelineEntries([
    {
      id: "arrived-first",
      kind: "user_message",
      message: {
        id: "arrived-first",
        role: "user",
        text: "first",
        timestamp: at(3),
        sequence: 3,
      },
      timestamp: at(3),
      updatedAt: at(3),
      sequence: 3,
    },
    {
      id: "arrived-second",
      kind: "user_message",
      message: {
        id: "arrived-second",
        role: "user",
        text: "second",
        timestamp: at(2),
        sequence: 2,
      },
      timestamp: at(2),
      updatedAt: at(2),
      sequence: 2,
    },
    {
      id: "legacy",
      kind: "user_message",
      message: {
        id: "legacy",
        role: "user",
        text: "legacy",
        timestamp: at(1),
      },
      timestamp: at(1),
      updatedAt: at(1),
    },
  ]);

  assert.deepEqual(timeline.map((entry) => entry.id), [
    "arrived-first",
    "arrived-second",
    "legacy",
  ]);
});

test("sortSessionTimelineEntries keeps a cumulative assistant reply intact across subagent boundaries", () => {
  const entries: SessionTimelineEntry[] = [];
  appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "我",
    timestamp: "2026-06-10T10:19:40.000Z",
    sequence: 1,
    streaming: true,
  });
  appendToolCallToSessionTimeline(entries, {
    id: "call-subagent",
    kind: "subagent",
    title: "spawn_agent",
    status: "running",
    input: JSON.stringify({ message: "只回一句 simple subagent ok" }),
    timestamp: "2026-06-10T10:19:41.000Z",
    updatedAt: "2026-06-10T10:19:41.000Z",
    sequence: 2,
  });
  const timeline = sortSessionTimelineEntries(appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "我会重新做一次最小 subagent 调用测试。",
    timestamp: "2026-06-10T10:19:42.000Z",
    sequence: 3,
    streaming: false,
  }));

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:call-subagent"],
    ],
  );
  assert.equal(timeline[0]?.kind, "assistant_message");
  if (timeline[0]?.kind !== "assistant_message") {
    throw new Error("Expected assistant_message");
  }
  assert.equal(timeline[0].chunks.length, 1);
  assert.equal(
    timeline[0].chunks[0]?.text,
    "我会重新做一次最小 subagent 调用测试。",
  );
});

test("sortSessionTimelineEntries does not split assistant content at command output", () => {
  const entries: SessionTimelineEntry[] = [];
  appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "先说明",
    timestamp: at(1),
    sequence: 1,
    streaming: true,
    streamMode: "snapshot",
  });
  entries.push({
    id: "output:call-shell:2",
    kind: "command_output",
    commandId: "call-shell",
    output: {
      id: "output-1",
      commandId: "call-shell",
      stream: "stdout",
      text: "工具输出",
      timestamp: at(2),
      sequence: 2,
    },
    timestamp: at(2),
    updatedAt: at(2),
    sequence: 2,
  });
  appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "先说明再继续",
    timestamp: at(3),
    sequence: 3,
    streaming: false,
    streamMode: "snapshot",
  });

  const timeline = sortSessionTimelineEntries(entries);

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["command_output", "output:call-shell:2"],
    ],
  );
  assert.equal(timeline[0]?.kind, "assistant_message");
  if (timeline[0]?.kind !== "assistant_message") {
    throw new Error("Expected assistant_message");
  }
  assert.equal(timeline[0].chunks.length, 1);
  assert.equal(timeline[0].chunks[0]?.text, "先说明再继续");
});

test("sortSessionTimelineEntries still splits assistant content at a new tool call", () => {
  const entries: SessionTimelineEntry[] = [];
  appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "先说明",
    timestamp: at(1),
    sequence: 1,
    streaming: true,
    streamMode: "snapshot",
  });
  appendToolCallToSessionTimeline(entries, {
    id: "call-shell",
    kind: "shell",
    title: "Shell",
    status: "running",
    timestamp: at(2),
    updatedAt: at(2),
    sequence: 2,
  });
  appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "先说明再继续",
    timestamp: at(3),
    sequence: 3,
    streaming: false,
    streamMode: "snapshot",
  });

  const timeline = sortSessionTimelineEntries(entries);

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:call-shell"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
  const assistantEntries = timeline.filter((entry) => entry.kind === "assistant_message");
  assert.equal(assistantEntries[0]?.chunks[0]?.text, "先说明");
  assert.equal(assistantEntries[1]?.chunks[0]?.text, "再继续");
});

test("sortSessionTimelineEntries keeps compacted transcript boundaries ahead of the first post-compaction assistant", () => {
  const timeline = sortSessionTimelineEntries([
    {
      id: "compaction-1",
      kind: "context_compaction",
      phase: "completed",
      source: "heuristic",
      summaryMessageId: "runtime-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      timestamp: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
      replayCompleteness: "compacted",
    },
    {
      id: "assistant-after-compaction",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-after-compaction:content",
          kind: "content",
          text: "压缩后的第一条回复",
          timestamp: "2026-06-10T10:00:01.000Z",
          sequence: 10,
        },
      ],
      timestamp: "2026-06-10T10:00:01.000Z",
      updatedAt: "2026-06-10T10:00:01.000Z",
      sequence: 10,
    },
    {
      id: "assistant-latest",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-latest:content",
          kind: "content",
          text: "更新回复",
          timestamp: "2026-06-10T10:00:10.000Z",
          sequence: 11,
        },
      ],
      timestamp: "2026-06-10T10:00:10.000Z",
      updatedAt: "2026-06-10T10:00:10.000Z",
      sequence: 11,
    },
  ]);

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["context_compaction", "compaction-1"],
      ["assistant_message", "assistant-after-compaction"],
      ["assistant_message", "assistant-latest"],
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

test("appendToolCallToSessionTimeline keeps the first kind and terminal status", () => {
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
    "completed",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.kind : undefined,
    "tool",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.input : undefined,
    JSON.stringify({
      file_path: "apps/deck/src/features/mission/conversation/plain-message-items.tsx",
    }),
  );
});

test("appendToolCallToSessionTimeline upgrades a generic placeholder to subagent", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "claude-task-call",
    commandId: "claude-task-call",
    kind: "tool",
    title: "Tool call claude-task-call",
    status: "running",
    sequence: 1,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "claude-task-call",
    commandId: "claude-task-call",
    kind: "subagent",
    title: "Subagent",
    status: "completed",
    output: "child result",
    sequence: 1,
  }));

  assert.equal(entries.length, 1);
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.kind : undefined,
    "subagent",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.status : undefined,
    "completed",
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

test("appendToolCallToSessionTimeline keeps a specialized tool kind and descriptive title when completion falls back to generic metadata", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-2",
    commandId: "call-2",
    kind: "read",
    title: "Read package.json",
    status: "running",
    sequence: 2,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-2",
    commandId: "call-2",
    kind: "tool",
    title: "File",
    status: "completed",
    output: "{}",
    sequence: 2,
  }));

  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.kind : undefined,
    "read",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.title : undefined,
    "Read package.json",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.status : undefined,
    "completed",
  );
});

test("appendToolCallToSessionTimeline replaces repeated tool input snapshots instead of concatenating JSON", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-input",
    commandId: "call-input",
    kind: "shell",
    title: "Terminal",
    status: "running",
    input: "{}",
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-input",
    commandId: "call-input",
    kind: "shell",
    title: "grep -n \"tool_call\" apps/helm/src/runtime/events.ts",
    status: "completed",
    input: JSON.stringify({
      command: "grep -n \"tool_call\" apps/helm/src/runtime/events.ts",
    }),
    sequence: 3,
  }));

  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.input : undefined,
    JSON.stringify({
      command: "grep -n \"tool_call\" apps/helm/src/runtime/events.ts",
    }),
  );
});

test("appendToolCallToSessionTimeline keeps subagent classification when a later update downgrades to a generic tool kind", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-3",
    commandId: "call-3",
    kind: "subagent",
    title: "Planner agent",
    status: "running",
    input: JSON.stringify({ agent: "planner" }),
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "call-3",
    commandId: "call-3",
    kind: "tool",
    title: "Tool call call-3",
    status: "completed",
    output: "done",
    sequence: 3,
  }));

  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.kind : undefined,
    "subagent",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.title : undefined,
    "Planner agent",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.status : undefined,
    "completed",
  );
});

test("sortSessionTimelineEntries preserves an independent assistant suffix after a subagent boundary", () => {
  const entries: SessionTimelineEntry[] = [];
  appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "检查完成",
    timestamp: "2026-06-10T10:19:40.000Z",
    sequence: 1,
  });
  appendToolCallToSessionTimeline(entries, {
    id: "call-subagent",
    kind: "subagent",
    title: "spawn_agent",
    status: "running",
    timestamp: "2026-06-10T10:19:41.000Z",
    updatedAt: "2026-06-10T10:19:41.000Z",
    sequence: 2,
  });
  const timeline = sortSessionTimelineEntries(appendMessageToSessionTimeline(entries, {
    id: "assistant-1",
    role: "assistant",
    text: "完成",
    timestamp: "2026-06-10T10:19:42.000Z",
    sequence: 3,
  }));

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:call-subagent"],
      ["assistant_message", "assistant-1#p1"],
    ],
  );
  const assistantEntries = timeline.filter((entry) => entry.kind === "assistant_message");
  assert.equal(assistantEntries[1]?.chunks[0]?.text, "完成");
});

test("appendToolCallToSessionTimeline merges reused subagent command ids", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-launch",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Subagent",
    status: "running",
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-result",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Subagent",
    status: "completed",
    output: "subagent reply",
    sequence: 7,
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.id : undefined,
    "subagent-launch",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.status : undefined,
    "completed",
  );
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.output : undefined,
    "subagent reply",
  );
  assert.equal(entries[0]?.id, "tool:subagent:task-42");
});

test("appendToolCallToSessionTimeline allows a reused subagent to become active again", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-first-call",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Subagent",
    status: "completed",
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-second-call",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Subagent",
    status: "running",
    sequence: 7,
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, "tool:subagent:task-42");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.status : undefined,
    "running",
  );
});

test("appendToolCallToSessionTimeline keeps an identified subagent title over a stale task update", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-call",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Sisyphus-Junior",
    status: "running",
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-call",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "task",
    status: "running",
    sequence: 4,
  }));

  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.title : undefined,
    "Sisyphus-Junior",
  );
});

test("appendToolCallToSessionTimeline keeps category over a completion agent title", () => {
  const entries: SessionTimelineEntry[] = [];
  const categoryInput = JSON.stringify({ category: "quick", prompt: "Run the check" });

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-call",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "quick",
    input: categoryInput,
    status: "running",
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-call",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Sisyphus-Junior",
    status: "completed",
    output: "done",
    sequence: 7,
  }));

  assert.equal(entries[0]?.kind, "tool_call");
  assert.equal(
    entries[0]?.kind === "tool_call" ? entries[0].toolCall.title : undefined,
    "quick",
  );
});

test("appendToolCallToSessionTimeline preserves prompt metadata across sparse subagent updates", () => {
  const entries: SessionTimelineEntry[] = [];

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-call",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "task",
    input: JSON.stringify({ prompt: "Run the check", model: { modelID: "model-a" } }),
    status: "running",
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-call",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "quick",
    input: JSON.stringify({ category: "quick", model: { variant: "low" } }),
    status: "completed",
    sequence: 7,
  }));

  assert.equal(entries[0]?.kind, "tool_call");
  if (entries[0]?.kind !== "tool_call") {
    return;
  }
  assert.deepEqual(JSON.parse(entries[0].toolCall.input ?? "{}"), {
    prompt: "Run the check",
    category: "quick",
    model: { modelID: "model-a", variant: "low" },
  });
});

test("appendToolCallToSessionTimeline merges updates by subagent tool-call id", () => {
  const entries: SessionTimelineEntry[] = [];
  const launchInput = JSON.stringify({ prompt: "Run the background check" });

  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-launch",
    kind: "subagent",
    title: "Claude background lifecycle",
    status: "running",
    input: launchInput,
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-launch",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Subagent",
    status: "running",
    input: launchInput,
    sequence: 5,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-launch",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Claude background lifecycle",
    status: "running",
    input: launchInput,
    sequence: 3,
  }));
  appendToolCallToSessionTimeline(entries, toolCall({
    id: "subagent-launch",
    commandId: "subagent:task-42",
    kind: "subagent",
    title: "Subagent",
    status: "completed",
    output: "CLAUDE_BACKGROUND_CHILD_OK",
    sequence: 7,
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "tool_call");
  if (entries[0]?.kind !== "tool_call") {
    return;
  }
  assert.equal(entries[0].toolCall.id, "subagent-launch");
  assert.equal(entries[0].toolCall.title, "Claude background lifecycle");
  assert.equal(entries[0].toolCall.input, launchInput);
  assert.equal(entries[0].toolCall.output, "CLAUDE_BACKGROUND_CHILD_OK");
  assert.equal(entries[0].toolCall.status, "completed");
  assert.equal(entries[0].sequence, 3);
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

test("timeline ToolCall updates repair shell placeholders with structured search evidence", () => {
  const entries = appendToolCallToSessionTimeline([], {
    id: "tool-1",
    kind: "shell",
    title: "Shell",
    status: "running",
    input: JSON.stringify({ pattern: "tool-title", glob: "**/*.ts" }),
    timestamp: at(1),
    updatedAt: at(1),
    sequence: 1,
  });
  appendToolCallToSessionTimeline(entries, {
    id: "tool-1",
    kind: "search",
    title: "Search",
    status: "completed",
    input: JSON.stringify({ pattern: "tool-title", glob: "**/*.ts" }),
    timestamp: at(1),
    updatedAt: at(2),
    sequence: 1,
  });

  const entry = entries[0];
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.kind : undefined, "search");
});
