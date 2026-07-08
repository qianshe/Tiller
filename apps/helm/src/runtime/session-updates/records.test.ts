import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall, FileDiffSummary } from "@tiller/shared";
import {
  buildSessionUpdateRecordsFromContent,
  reduceSessionUpdateRecords,
} from "./records";
import { createSessionUpdateRecord } from "./reducer";

const BASE_TIME = Date.parse("2026-06-08T00:00:00.000Z");

function at(sequence: number) {
  return new Date(BASE_TIME + sequence * 1000).toISOString();
}

function message(id: string, role: AgentMessage["role"], text: string, sequence: number): AgentMessage {
  return {
    id,
    role,
    text,
    timestamp: at(sequence),
    sequence,
  };
}

function toolCall(id: string, status: AgentToolCall["status"], sequence: number): AgentToolCall {
  return {
    id,
    kind: "shell",
    title: "Shell",
    status,
    timestamp: at(sequence),
    updatedAt: at(sequence),
    sequence,
  };
}

function diff(path: string): FileDiffSummary {
  return {
    path,
    additions: 1,
    deletions: 0,
    status: "modified",
  };
}

test("builds ACP replay update records and reduces them into one ordered timeline", () => {
  const records = buildSessionUpdateRecordsFromContent({
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    source: "acp_load_replay",
    messages: [
      message("assistant-before", "assistant", "before", 1),
      message("assistant-after", "assistant", "after", 3),
    ],
    toolCalls: [toolCall("tool-1", "completed", 2)],
    outputs: [],
    diffs: [],
  });

  assert.deepEqual(records.map((record) => [record.source, record.sequence, record.updateType]), [
    ["acp_load_replay", 1, "message"],
    ["acp_load_replay", 2, "tool-call"],
    ["acp_load_replay", 3, "message"],
  ]);

  const reduced = reduceSessionUpdateRecords(records);
  assert.deepEqual(reduced.entries.map((entry) => entry.id), [
    "assistant-before",
    "tool:tool-1",
    "assistant-after",
  ]);
});

test("builds one diff update record with all changed files", () => {
  const records = buildSessionUpdateRecordsFromContent({
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    source: "acp_load_replay",
    messages: [],
    toolCalls: [],
    outputs: [],
    diffs: [diff("one.ts"), diff("two.ts")],
  });

  assert.deepEqual(records.map((record) => [record.sequence, record.updateType]), [
    [1, "diff-update"],
  ]);

  const reduced = reduceSessionUpdateRecords(records);
  assert.deepEqual(reduced.diffs.map((file) => file.path), ["one.ts", "two.ts"]);
});

test("reduceSessionUpdateRecords reorders Codex transcript web fetch between transcript-repaired messages", () => {
  const records = [
    createSessionUpdateRecord({
      sessionId: "session-1",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 80,
      source: "acp_load_replay",
      event: {
        type: "message",
        message: {
          id: "user-1",
          role: "user",
          text: "再测试一下web搜索能力",
          timestamp: "2026-07-08T04:45:06.316Z",
          sequence: 80,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId: "session-1",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 81,
      source: "acp_load_replay",
      event: {
        type: "message",
        message: {
          id: "assistant-1",
          role: "assistant",
          text: "[🌳木] 目标是再做一轮 `web` 搜索测试，并给你一个可复核的结果。",
          timestamp: "2026-07-08T04:45:06.317Z",
          sequence: 81,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId: "session-1",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 83,
      source: "acp_load_replay",
      event: {
        type: "message",
        message: {
          id: "assistant-2",
          role: "assistant",
          text: "又做了一轮 `web` 搜索测试，能力正常，主人，喵~",
          timestamp: "2026-07-08T04:45:06.320Z",
          sequence: 83,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId: "session-1",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 84,
      source: "agent_transcript_repair",
      event: {
        type: "message",
        message: {
          id: "user-1",
          role: "user",
          text: "再测试一下web搜索能力",
          timestamp: "2026-07-07T17:12:51.998Z",
          sequence: 80,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId: "session-1",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 85,
      source: "agent_transcript_repair",
      event: {
        type: "message",
        message: {
          id: "assistant-1",
          role: "assistant",
          text: "[🌳木] 目标是再做一轮 `web` 搜索测试，并给你一个可复核的结果。",
          timestamp: "2026-07-07T17:12:52.100Z",
          sequence: 81,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId: "session-1",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 86,
      source: "agent_transcript_repair",
      event: {
        type: "tool-call",
        toolCall: {
          id: "ws_1",
          kind: "fetch",
          title: "Searching for: site:developers.openai.com Responses API OpenAI",
          status: "completed",
          timestamp: "2026-07-07T17:13:09.352Z",
          updatedAt: "2026-07-07T17:13:09.352Z",
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId: "session-1",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 87,
      source: "agent_transcript_repair",
      event: {
        type: "message",
        message: {
          id: "assistant-2",
          role: "assistant",
          text: "又做了一轮 `web` 搜索测试，能力正常，主人，喵~",
          timestamp: "2026-07-07T17:13:15.465Z",
          sequence: 83,
        },
      },
    }),
  ];

  const reduced = reduceSessionUpdateRecords(records);

  assert.deepEqual(
    reduced.entries.map((entry) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:ws_1"],
      ["assistant_message", "assistant-2"],
    ],
  );
});
