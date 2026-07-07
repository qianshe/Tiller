import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall, SessionUpdateRecord } from "@tiller/shared";
import {
  applySessionUpdateRecordToState,
  applySessionRuntimeEventToState,
  createEmptySessionUpdateReducerState,
} from "./reducer";

const BASE_TIME = Date.parse("2026-06-08T00:00:00.000Z");

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
  assert.deepEqual(finalState.entries.map((entry) => [entry.kind, entry.id, (entry as any).sequence]), [
    ["user_message", "msg-1", 1],
    ["assistant_message", "msg-1:assistant", 2],
  ]);
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

test("session update reducer lets later search repairs override stale shell classifications", () => {
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

  assert.equal(finalState.toolCalls[0]?.kind, "search");
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
