import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall, FileDiffSummary } from "@tiller/shared";
import {
  buildSessionUpdateRecordsFromContent,
  reduceSessionUpdateRecords,
} from "./records";

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
