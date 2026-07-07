import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentMessage,
  AgentToolCall,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import { applyTranscriptToolCallRepair } from "./tool-call-repair";

test("applyTranscriptToolCallRepair upgrades generic replay tool calls from Claude transcript metadata", () => {
  const sessionId = "session-claude-tool-repair";
  let toolCalls: AgentToolCall[] = [
    toolCall("tool-read", "tool", "Tool call toolu_rea…", 2, "1\t# Plan"),
    toolCall("tool-bash", "tool", "Tool call toolu_bas…", 4, "=== form.tsx mobile variants ==="),
    toolCall("tool-mcp", "tool", "Tool call toolu_mcp…", 6, "match"),
  ];
  let timeline: SessionTimelineEntry[] = [];
  const appendedUpdates: SessionUpdateRecord[] = [];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: createSummary(sessionId),
    agent: createClaudeAgent(),
    transcriptToolCalls: [
      {
        id: "tool-read",
        kind: "read",
        title: "Read",
        status: "completed",
        input: JSON.stringify({
          file_path:
            "D:\\myProject\\tools\\Tiller\\docs\\superpowers\\plans\\2026-07-07-mobile-composer-density-and-commit-button.md",
        }),
        timestamp: "2026-07-07T07:10:00.276Z",
        updatedAt: "2026-07-07T07:10:00.540Z",
        sequence: 2,
      },
      {
        id: "tool-bash",
        kind: "shell",
        title: "Bash",
        status: "completed",
        input: JSON.stringify({
          command:
            "echo \"=== form.tsx mobile variants ===\"; grep -nE 'isMobile|py-1' apps/deck/src/features/mission/composer/form.tsx 2>/dev/null | head -30",
          description: "检查实现内容是否存在",
        }),
        timestamp: "2026-07-07T07:10:24.270Z",
        updatedAt: "2026-07-07T07:10:24.960Z",
        sequence: 4,
      },
      {
        id: "tool-mcp",
        kind: "mcp",
        title: "mcpServers_search_context",
        status: "completed",
        input: JSON.stringify({
          project_root_path: "D:\\myProject\\tools\\Tiller",
          query: "session creation flow",
        }),
        timestamp: "2026-05-14T07:44:04.680Z",
        updatedAt: "2026-05-14T07:44:05.166Z",
        sequence: 6,
      },
    ],
    sessionMessageStore: {
      list: () => [message("user-1", "查看计划", 1)],
    },
    sessionArtifactStore: {
      get: () => ({
        outputs: [],
        diffs: [],
        toolCalls,
      }),
      replaceToolCalls: (_sessionId, nextToolCalls) => {
        toolCalls = nextToolCalls;
      },
    },
    sessionTimelineStore: {
      replace: (_sessionId, entries) => {
        timeline = entries;
        return entries;
      },
    },
    sessionUpdateStore: {
      listPage: () => ({
        updates: [
          {
            sessionId,
            runtimeSessionId: "runtime-1",
            providerId: "claudecode",
            sequence: 9,
            source: "acp_load_replay",
            updateType: "tool-call",
            receivedAt: "2026-07-07T07:10:37.000Z",
            payloadJson: "{}",
          },
        ],
        hasMore: false,
      }),
      append: (record) => {
        appendedUpdates.push(record);
      },
    },
  });

  assert.equal(repaired, true);
  assert.deepEqual(
    toolCalls.map((toolCall) => [toolCall.id, toolCall.kind, toolCall.title]),
    [
      ["tool-read", "read", "Read"],
      ["tool-bash", "shell", "Bash"],
      ["tool-mcp", "mcp", "mcpServers_search_context"],
    ],
  );
  assert.equal(appendedUpdates.length, 3);
  assert.deepEqual(
    appendedUpdates.map((record) => [record.source, record.updateType]),
    [
      ["agent_transcript_repair", "tool-call"],
      ["agent_transcript_repair", "tool-call"],
      ["agent_transcript_repair", "tool-call"],
    ],
  );
  assert.equal(
    timeline.filter((entry) => entry.kind === "tool_call").length,
    3,
  );
});

test("applyTranscriptToolCallRepair repairs timeline-only tool calls when artifact cache is empty", () => {
  const sessionId = "session-claude-tool-repair-timeline-only";
  let toolCalls: AgentToolCall[] = [];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "user:user-1",
      kind: "user_message",
      message: message("user-1", "查看计划", 1),
      timestamp: "2026-06-05T14:08:01.000Z",
      updatedAt: "2026-06-05T14:08:01.000Z",
      sequence: 1,
    },
    {
      id: "tool:tool-grep",
      kind: "tool_call",
      toolCall: toolCall("tool-grep", "tool", "Tool call toolu_gre…", 2, "Found 2 files"),
      timestamp: "2026-06-05T14:08:02.000Z",
      updatedAt: "2026-06-05T14:08:03.000Z",
      sequence: 2,
    },
  ];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: createSummary(sessionId),
    agent: createClaudeAgent(),
    transcriptToolCalls: [
      {
        id: "tool-grep",
        kind: "search",
        title: "Grep",
        status: "completed",
        input: JSON.stringify({
          pattern: "Tiller",
          glob: "**/README.md",
          output_mode: "files_with_matches",
        }),
        timestamp: "2026-07-07T08:06:52.789Z",
        updatedAt: "2026-07-07T08:06:53.266Z",
        sequence: 2,
      },
    ],
    sessionMessageStore: {
      list: () => [message("user-1", "查看计划", 1)],
    },
    sessionArtifactStore: {
      get: () => ({
        outputs: [],
        diffs: [],
        toolCalls,
      }),
      replaceToolCalls: (_sessionId, nextToolCalls) => {
        toolCalls = nextToolCalls;
      },
    },
    sessionTimelineStore: {
      list: () => timeline,
      replace: (_sessionId, entries) => {
        timeline = entries;
        return entries;
      },
    },
    sessionUpdateStore: {
      listPage: () => ({
        updates: [],
        hasMore: false,
      }),
      append: () => undefined,
    },
  });

  assert.equal(repaired, true);
  assert.deepEqual(
    toolCalls.map((toolCall) => [toolCall.id, toolCall.kind, toolCall.title]),
    [["tool-grep", "search", "Grep"]],
  );
  const repairedToolEntry = timeline.find((entry) => entry.kind === "tool_call");
  assert.equal(repairedToolEntry?.kind, "tool_call");
  assert.equal(
    repairedToolEntry?.kind === "tool_call" ? repairedToolEntry.toolCall.kind : undefined,
    "search",
  );
  assert.equal(
    repairedToolEntry?.kind === "tool_call" ? repairedToolEntry.toolCall.title : undefined,
    "Grep",
  );
});

function createSummary(sessionId: string) {
  return {
    id: sessionId,
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    agentId: "claudecode",
    agentName: "ClaudeCode",
    cwd: "D:/repo",
    status: "idle" as const,
    createdAt: "2026-06-05T14:08:00.000Z",
    updatedAt: "2026-06-05T14:10:00.000Z",
    messageCount: 1,
    runtimeSessionId: "runtime-1",
  };
}

function createClaudeAgent() {
  return {
    id: "claudecode",
    name: "ClaudeCode",
    kind: "custom" as const,
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
}

function message(id: string, text: string, sequence: number): AgentMessage {
  return {
    id,
    role: "user",
    text,
    timestamp: `2026-06-05T14:08:${String(sequence).padStart(2, "0")}.000Z`,
    sequence,
  };
}

function toolCall(
  id: string,
  kind: AgentToolCall["kind"],
  title: string,
  sequence: number,
  output: string,
): AgentToolCall {
  return {
    id,
    kind,
    title,
    status: "completed",
    output,
    timestamp: `2026-06-05T14:08:${String(sequence).padStart(2, "0")}.000Z`,
    updatedAt: `2026-06-05T14:08:${String(sequence + 1).padStart(2, "0")}.000Z`,
    sequence,
  };
}
