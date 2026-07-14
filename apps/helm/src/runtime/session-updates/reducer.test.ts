import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, AgentToolCall, CommandChunk, SessionUpdateRecord } from "@tiller/shared";
import {
  applySessionUpdateRecordToState,
  applySessionRuntimeEventToState,
  createEmptySessionUpdateReducerState,
} from "./reducer";

const BASE_TIME = Date.parse("2026-06-08T00:00:00.000Z");

test("conversation reducer does not perform a full timeline sort per entity update", () => {
  const source = readFileSync(new URL("./reducer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /sortSessionTimelineEntries/u);
});

function at(sequence: number) {
  return new Date(BASE_TIME + sequence * 1000).toISOString();
}

function assistant(id: string, text: string, sequence: number): AgentMessage {
  return {
    id,
    role: "assistant",
    text,
    timestamp: at(sequence),
    sequence,
  };
}

function thought(id: string, text: string, sequence: number): AgentMessage {
  return {
    id,
    role: "assistant",
    contentKind: "thought",
    text,
    timestamp: at(sequence),
    sequence,
  };
}

function user(id: string, text: string, sequence: number): AgentMessage {
  return {
    id,
    role: "user",
    text,
    timestamp: at(sequence),
    sequence,
  };
}

function toolCall(
  id: string,
  status: AgentToolCall["status"],
  sequence: number,
  output?: string,
): AgentToolCall {
  return {
    id,
    kind: "shell",
    title: "Shell",
    status,
    output,
    timestamp: at(sequence),
    updatedAt: at(sequence + (status === "completed" ? 10 : 0)),
    sequence,
  };
}

function output(id: string, text: string, sequence: number): CommandChunk {
  return {
    id,
    commandId: "command-1",
    stream: "stdout",
    text,
    timestamp: at(sequence),
    sequence,
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

test("session update reducer backfills missing tool-call sequences from update records", () => {
  const records: SessionUpdateRecord[] = [
    {
      sessionId: "session-sequence-backfill",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 1,
      source: "acp_load_replay",
      updateType: "message",
      receivedAt: at(1),
      payloadJson: JSON.stringify({
        type: "message",
        message: {
          id: "assistant-before",
          role: "assistant",
          text: "先开始。",
          timestamp: at(1),
        },
      }),
    },
    {
      sessionId: "session-sequence-backfill",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 2,
      source: "acp_load_replay",
      updateType: "tool-call",
      receivedAt: at(2),
      payloadJson: JSON.stringify({
        type: "tool-call",
        toolCall: {
          id: "call-subagent-sequence-backfill",
          kind: "subagent",
          title: "spawn_agent",
          status: "completed",
          timestamp: "2026-07-08T13:51:51.737Z",
          updatedAt: "2026-07-08T11:27:53.590Z",
        },
      }),
    },
    {
      sessionId: "session-sequence-backfill",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 3,
      source: "acp_load_replay",
      updateType: "message",
      receivedAt: at(3),
      payloadJson: JSON.stringify({
        type: "message",
        message: {
          id: "assistant-after",
          role: "assistant",
          text: "再继续。",
          timestamp: at(3),
        },
      }),
    },
  ];

  const finalState = records.reduce(
    applySessionUpdateRecordToState,
    createEmptySessionUpdateReducerState(),
  );

  assert.deepEqual(finalState.entries.map((entry) => entry.id), [
    "assistant-before",
    "tool:call-subagent-sequence-backfill",
    "assistant-after",
  ]);
  assert.equal(finalState.toolCalls[0]?.sequence, 2);
  assert.equal(
    finalState.entries[1]?.kind === "tool_call"
      ? finalState.entries[1].toolCall.sequence
      : undefined,
    2,
  );
});

test("session update reducer keeps thought and content messages distinct with a shared provider id", () => {
  const finalState = [
    { type: "message" as const, message: thought("assistant-turn-1", "checking", 1) },
    { type: "message" as const, message: assistant("assistant-turn-1", "answer", 2) },
    { type: "message" as const, message: thought("assistant-turn-1", "checking files", 3) },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.deepEqual(
    finalState.messages.map((message) => ({
      id: message.id,
      kind: message.contentKind ?? "content",
      sequence: message.sequence,
      text: message.text,
    })),
    [
      {
        id: "assistant-turn-1",
        kind: "thought",
        sequence: 1,
        text: "checking files",
      },
      {
        id: "assistant-turn-1:content",
        kind: "content",
        sequence: 2,
        text: "answer",
      },
    ],
  );
});

test("session update reducer preserves the first output sequence on later body updates", () => {
  const events: SessionRuntimeEvent[] = [
    { type: "command-output" as const, chunk: output("output-1", "preview", 4) },
    {
      type: "command-output" as const,
      chunk: {
        ...output("output-1", "preview", 8),
        contentRef: {
          id: "body-1",
          uri: "tiller://session-output/body-1",
          mimeType: "text/plain; charset=utf-8",
          byteSize: 4096,
          sha256: "abc123",
        },
      },
    },
  ];
  const finalState = events.reduce(
    applySessionRuntimeEventToState,
    createEmptySessionUpdateReducerState(),
  );

  assert.equal(finalState.outputs[0]?.sequence, 4);
  assert.equal(finalState.outputs[0]?.timestamp, at(4));
  assert.equal(finalState.outputs[0]?.contentRef?.id, "body-1");
});

test("session update reducer does not downgrade terminal tool calls", () => {
  const finalState = [
    { type: "tool-call" as const, toolCall: toolCall("tool-terminal", "completed", 2, "ok") },
    { type: "tool-call" as const, toolCall: toolCall("tool-terminal", "running", 9) },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.equal(finalState.toolCalls[0]?.status, "completed");
  assert.equal(finalState.toolCalls[0]?.sequence, 2);
  assert.equal(finalState.toolCalls[0]?.output, "ok");
});

test("session update reducer does not let legacy repair records overwrite canonical message timestamps", () => {
  const sessionId = "session-canonical-timestamp";
  const canonicalTimestamp = "2026-07-08T04:45:06.316Z";
  const legacyRepairTimestamp = "2026-07-07T17:12:51.998Z";
  const records: SessionUpdateRecord[] = [
    {
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 1,
      source: "acp_load_replay",
      updateType: "message",
      receivedAt: canonicalTimestamp,
      payloadJson: JSON.stringify({
        type: "message",
        message: {
          id: "user-1",
          role: "user",
          text: "保持原始时间线",
          timestamp: canonicalTimestamp,
          sequence: 1,
        },
      }),
    },
    {
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 2,
      source: "agent_transcript_repair",
      updateType: "message",
      receivedAt: legacyRepairTimestamp,
      payloadJson: JSON.stringify({
        type: "message",
        message: {
          id: "user-1",
          role: "user",
          text: "保持原始时间线",
          timestamp: legacyRepairTimestamp,
          sequence: 1,
        },
      }),
    },
  ];

  const finalState = records.reduce(
    applySessionUpdateRecordToState,
    createEmptySessionUpdateReducerState(),
  );

  assert.equal(finalState.messages[0]?.timestamp, canonicalTimestamp);
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
  assert.deepEqual(finalState.entries.map((entry) => [entry.kind, entry.id, (entry as any).sequence]), [
    ["user_message", "msg-1", 1],
    ["assistant_message", "msg-1:assistant", 2],
  ]);
});

test("session update reducer replaces accumulated streaming assistant fragments with the final full assistant message", () => {
  const finalState = [
    {
      type: "message" as const,
      message: {
        id: "assistant-final",
        role: "assistant" as const,
        text: "Line 2\nLine 3",
        timestamp: at(1),
        sequence: 1,
        streaming: true,
      },
    },
    {
      type: "message" as const,
      message: {
        id: "assistant-final",
        role: "assistant" as const,
        text: "Line 4",
        timestamp: at(2),
        sequence: 2,
        streaming: true,
      },
    },
    {
      type: "message" as const,
      message: {
        id: "assistant-final",
        role: "assistant" as const,
        text: "Line 1\nLine 2\nLine 3\nLine 4",
        timestamp: at(3),
        sequence: 3,
        streaming: false,
      },
    },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.equal(finalState.messages[0]?.text, "Line 1\nLine 2\nLine 3\nLine 4");
  assert.equal(
    finalState.entries[0]?.kind === "assistant_message"
      ? finalState.entries[0].chunks[0]?.text
      : undefined,
    "Line 1\nLine 2\nLine 3\nLine 4",
  );
});

test("session update reducer keeps stronger tool classification when sparse patches arrive later", () => {
  const finalState = [
    {
      type: "tool-call" as const,
      toolCall: {
        id: "toolu_01Strong",
        kind: "mcp" as const,
        title: "Tool: mcp_router/find_symbol",
        status: "running" as const,
        input: JSON.stringify({
          server_name: "mcp_router",
          request: { name: "find_symbol" },
          arguments: { relative_path: "apps/deck/src/features/server-events/session-events.ts" },
        }),
        timestamp: at(1),
        updatedAt: at(1),
        sequence: 1,
      },
    },
    {
      type: "tool-call" as const,
      toolCall: {
        id: "toolu_01Strong",
        kind: "tool" as const,
        title: "Tool call toolu_01S…",
        status: "completed" as const,
        output: "ok",
        timestamp: at(1),
        updatedAt: at(2),
        sequence: 1,
      },
    },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.equal(finalState.toolCalls[0]?.kind, "mcp");
  assert.equal(finalState.toolCalls[0]?.title, "Tool: mcp_router/find_symbol");
  assert.equal(finalState.toolCalls[0]?.status, "completed");
  assert.equal(finalState.toolCalls[0]?.output, "ok");
});

test("session update reducer deduplicates overlapping thinking tool snapshots", () => {
  const finalState = [
    {
      type: "tool-call" as const,
      toolCall: {
        id: "thinking-1",
        kind: "think" as const,
        title: "Thinking",
        status: "running" as const,
        output: "Line 1\nLine 2\nLine 3",
        timestamp: at(1),
        updatedAt: at(1),
        sequence: 1,
      },
    },
    {
      type: "tool-call" as const,
      toolCall: {
        id: "thinking-1",
        kind: "think" as const,
        title: "Thinking",
        status: "completed" as const,
        output: "Line 2\nLine 3\nLine 4",
        timestamp: at(2),
        updatedAt: at(2),
        sequence: 2,
      },
    },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.equal(finalState.toolCalls[0]?.output, "Line 1\nLine 2\nLine 3\nLine 4");
  assert.equal(finalState.entries[0]?.kind, "assistant_message");
  assert.equal(
    finalState.entries[0]?.kind === "assistant_message"
      ? finalState.entries[0].chunks[0]?.text
      : undefined,
    "Line 1\nLine 2\nLine 3\nLine 4",
  );
});

test("session update reducer replaces repeated tool input snapshots instead of concatenating JSON strings", () => {
  const finalState = [
    {
      type: "tool-call" as const,
      toolCall: {
        id: "toolu_input_merge",
        kind: "shell" as const,
        title: "Terminal",
        status: "running" as const,
        input: "{}",
        timestamp: at(1),
        updatedAt: at(1),
        sequence: 1,
      },
    },
    {
      type: "tool-call" as const,
      toolCall: {
        id: "toolu_input_merge",
        kind: "shell" as const,
        title: "grep -n \"tool_call\" apps/helm/src/runtime/events.ts",
        status: "completed" as const,
        input: JSON.stringify({
          command: "grep -n \"tool_call\" apps/helm/src/runtime/events.ts",
          description: "查找 runtime tool call",
        }),
        timestamp: at(1),
        updatedAt: at(2),
        sequence: 1,
      },
    },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.equal(
    finalState.toolCalls[0]?.input,
    JSON.stringify({
      command: "grep -n \"tool_call\" apps/helm/src/runtime/events.ts",
      description: "查找 runtime tool call",
    }),
  );
});

test("session update reducer preserves the first mapper-assigned ToolCall kind", () => {
  const finalState = [
    {
      type: "tool-call" as const,
      toolCall: {
        id: "toolu_search_repair",
        kind: "shell" as const,
        title: "grep -l \"tool-call-repair\"",
        status: "completed" as const,
        input: "{\"output_mode\":\"files_with_matches\",\"pattern\":\"tool-call-repair\"}",
        timestamp: at(1),
        updatedAt: at(1),
        sequence: 1,
      },
    },
    {
      type: "tool-call" as const,
      toolCall: {
        id: "toolu_search_repair",
        kind: "search" as const,
        title: "Grep",
        status: "completed" as const,
        input: "{\"output_mode\":\"files_with_matches\",\"pattern\":\"tool-call-repair\"}",
        timestamp: at(1),
        updatedAt: at(2),
        sequence: 1,
      },
    },
  ].reduce(applySessionRuntimeEventToState, createEmptySessionUpdateReducerState());

  assert.equal(finalState.toolCalls[0]?.kind, "shell");
  assert.equal(finalState.toolCalls[0]?.title, "Grep");
});

test("session update reducer rebuilds one merged compaction row from started lifecycle plus summary enrichment", () => {
  const records: SessionUpdateRecord[] = [
    {
      sessionId: "session-compaction",
      runtimeSessionId: "runtime-1",
      providerId: "claude",
      sequence: 1,
      source: "acp_live",
      updateType: "compaction",
      receivedAt: at(1),
      payloadJson: JSON.stringify({
        type: "compaction",
        phase: "started",
        source: "provider",
        timestamp: at(1),
      }),
    },
    {
      sessionId: "session-compaction",
      runtimeSessionId: "runtime-1",
      providerId: "claude",
      sequence: 2,
      source: "acp_live",
      updateType: "compaction",
      receivedAt: at(2),
      payloadJson: JSON.stringify({
        type: "compaction",
        phase: "completed",
        source: "provider",
        timestamp: at(2),
        messageId: "compaction-completed",
      }),
    },
    {
      sessionId: "session-compaction",
      runtimeSessionId: "runtime-1",
      providerId: "claude",
      sequence: 3,
      source: "acp_live",
      updateType: "compaction",
      receivedAt: at(3),
      payloadJson: JSON.stringify({
        type: "compaction",
        phase: "completed",
        source: "heuristic",
        timestamp: at(3),
        messageId: "compaction-summary",
        summaryText: "This session is being continued from a previous conversation that ran out of context.",
      }),
    },
  ];
  const finalState = records.reduce(applySessionUpdateRecordToState, createEmptySessionUpdateReducerState());

  const compactionEntries = finalState.entries.filter((entry) => entry.kind === "context_compaction");
  assert.equal(compactionEntries.length, 1);
  assert.equal(compactionEntries[0]?.id, `compaction:session-compaction:compaction:${at(1)}`);
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction" ? compactionEntries[0].phase : undefined,
    "completed",
  );
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction" ? compactionEntries[0].summaryText : undefined,
    "This session is being continued from a previous conversation that ran out of context.",
  );
  assert.equal(
    compactionEntries[0]?.kind === "context_compaction" ? compactionEntries[0].detailsVisibility : undefined,
    "expandable",
  );
});
