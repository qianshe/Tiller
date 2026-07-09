import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      ["tool-mcp", "mcp", "Tool: search_context"],
    ],
  );
  assert.deepEqual(toolCalls[2]?.mcp, {
    toolName: "search_context",
    source: "provider-title",
    rawTitle: "mcpServers_search_context",
  });
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

test("applyTranscriptToolCallRepair upgrades generic replay tool calls from Codex transcript metadata", () => {
  const sessionId = "session-codex-tool-repair";
  let toolCalls: AgentToolCall[] = [
    toolCall("call-shell", "tool", "Tool call call_she…", 2, "D:\\myProject\\tools\\Tiller"),
    toolCall("call-mcp", "tool", "Tool call call_mcp…", 4, "{\"project\":\"Tiller\"}"),
    toolCall("call-write", "tool", "Tool call call_wri…", 6, "Success."),
    toolCall("call-subagent", "tool", "Tool call call_sub…", 8, "{\"agent_id\":\"agent-1\"}"),
  ];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: createSummary(sessionId),
    agent: {
      id: "codex",
      name: "Codex",
      kind: "custom" as const,
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptToolCalls: [
      {
        id: "call-shell",
        kind: "shell",
        title: "Get-Location",
        status: "completed",
        input: JSON.stringify({ command: "Get-Location" }),
        timestamp: "2026-07-07T11:05:55.558Z",
        updatedAt: "2026-07-07T11:06:03.385Z",
        sequence: 2,
      },
      {
        id: "call-mcp",
        kind: "mcp",
        title: "Tool: mcp_router/get_current_config",
        status: "completed",
        input: "{}",
        mcp: {
          serverName: "mcp_router",
          toolName: "get_current_config",
          source: "structured-tool-name",
          rawTitle: "mcp__mcp_router/get_current_config",
        },
        timestamp: "2026-07-07T11:09:21.692Z",
        updatedAt: "2026-07-07T11:09:21.845Z",
        sequence: 4,
      },
      {
        id: "call-write",
        kind: "write",
        title: "Edit D:/myProject/tools/Tiller/apps/helm/tool-write-test.txt",
        status: "completed",
        input:
          "*** Begin Patch\n*** Add File: D:/myProject/tools/Tiller/apps/helm/tool-write-test.txt\n+ok\n*** End Patch\n",
        timestamp: "2026-07-07T12:12:35.875Z",
        updatedAt: "2026-07-07T12:12:35.940Z",
        sequence: 6,
      },
      {
        id: "call-subagent",
        kind: "subagent",
        title: "spawn_agent",
        status: "completed",
        input: JSON.stringify({ fork_context: true, message: "只读测试" }),
        timestamp: "2026-07-07T12:39:49.467Z",
        updatedAt: "2026-07-07T12:39:59.696Z",
        sequence: 8,
      },
    ],
    sessionMessageStore: {
      list: () => [message("user-1", "修复 Codex 工具调用", 1)],
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
      replace: (_sessionId, entries) => entries,
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
    [
      ["call-shell", "shell", "Get-Location"],
      ["call-mcp", "mcp", "Tool: mcp_router/get_current_config"],
      ["call-write", "write", "Edit D:/myProject/tools/Tiller/apps/helm/tool-write-test.txt"],
      ["call-subagent", "subagent", "spawn_agent"],
    ],
  );
});

test("applyTranscriptToolCallRepair appends missing Codex subagent tool calls from transcript history", () => {
  const sessionId = "session-codex-tool-repair-missing-subagent";
  let toolCalls: AgentToolCall[] = [
    toolCall("call-shell", "shell", "Get-Location", 2, "D:\\myProject\\tools\\Tiller"),
  ];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "user:user-1",
      kind: "user_message",
      message: message("user-1", "测试子代理回放", 1),
      timestamp: "2026-06-05T14:08:01.000Z",
      updatedAt: "2026-06-05T14:08:01.000Z",
      sequence: 1,
    },
    {
      id: "tool:call-shell",
      kind: "tool_call",
      toolCall: toolCalls[0]!,
      timestamp: toolCalls[0]!.timestamp,
      updatedAt: toolCalls[0]!.updatedAt,
      sequence: 2,
    },
  ];
  const appendedUpdates: SessionUpdateRecord[] = [];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: {
      ...createSummary(sessionId),
      agentId: "codex",
      agentName: "Codex",
    },
    agent: {
      id: "codex",
      name: "Codex",
      kind: "custom" as const,
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptToolCalls: [
      {
        id: "call-subagent",
        kind: "subagent",
        title: "spawn_agent",
        status: "completed",
        input: JSON.stringify({
          fork_context: true,
          message: "只允许修改 docs/tooling/subagent-todolist-demo.md",
        }),
        timestamp: "2026-07-08T11:45:18.703Z",
        updatedAt: "2026-07-08T11:45:25.514Z",
        sequence: 4,
      },
    ],
    sessionMessageStore: {
      list: () => [message("user-1", "测试子代理回放", 1)],
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
      append: (record) => {
        appendedUpdates.push(record);
      },
    },
  });

  assert.equal(repaired, true);
  assert.deepEqual(
    toolCalls.map((toolCall) => [toolCall.id, toolCall.kind, toolCall.title]),
    [
      ["call-shell", "shell", "Get-Location"],
      ["call-subagent", "subagent", "spawn_agent"],
    ],
  );
  assert.deepEqual(
    timeline
      .filter((entry) => entry.kind === "tool_call")
      .map((entry) => [
        entry.toolCall.id,
        entry.toolCall.kind,
        entry.toolCall.title,
      ]),
    [
      ["call-shell", "shell", "Get-Location"],
      ["call-subagent", "subagent", "spawn_agent"],
    ],
  );
  assert.equal(appendedUpdates.length, 1);
  assert.equal(
    JSON.parse(appendedUpdates[0]!.payloadJson).toolCall.id,
    "call-subagent",
  );
});

test("applyTranscriptToolCallRepair prefers transcript timestamps for skewed Codex subagent history without sequence", () => {
  const sessionId = "session-codex-tool-repair-subagent-timestamp";
  let toolCalls: AgentToolCall[] = [
    {
      id: "call-subagent-skew",
      kind: "subagent",
      title: "spawn_agent",
      status: "completed",
      timestamp: "2026-07-08T13:51:51.737Z",
      updatedAt: "2026-07-08T13:51:51.737Z",
    },
  ];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: {
      ...createSummary(sessionId),
      agentId: "codex",
      agentName: "Codex",
    },
    agent: {
      id: "codex",
      name: "Codex",
      kind: "custom" as const,
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptToolCalls: [
      {
        id: "call-subagent-skew",
        kind: "subagent",
        title: "spawn_agent",
        status: "completed",
        timestamp: "2026-07-08T11:27:43.373Z",
        updatedAt: "2026-07-08T11:27:53.590Z",
        sequence: 25,
      },
    ],
    sessionMessageStore: {
      list: () => [],
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
      list: () => [],
      replace: (_sessionId, entries) => entries,
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
  assert.equal(toolCalls[0]?.timestamp, "2026-07-08T11:27:43.373Z");
  assert.equal(toolCalls[0]?.sequence, 25);
});

test("applyTranscriptToolCallRepair rewrites Codex web search transcript history to fetch", () => {
  const sessionId = "session-codex-web-tool-repair";
  let toolCalls: AgentToolCall[] = [
    toolCall("call-web", "tool", "Tool call call_web…", 2, "{\"query\":\"OpenAI developer docs Responses API official\"}"),
  ];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: {
      ...createSummary(sessionId),
      agentId: "codex",
      agentName: "Codex",
    },
    agent: {
      id: "codex",
      name: "Codex",
      kind: "custom" as const,
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptToolCalls: [
      {
        id: "call-web",
        kind: "fetch",
        title: "Searching for: OpenAI developer docs Responses API official",
        status: "completed",
        input: JSON.stringify({
          query: "OpenAI developer docs Responses API official",
          action: {
            type: "search",
            query: "OpenAI developer docs Responses API official",
          },
        }),
        timestamp: "2026-07-07T14:25:37.376Z",
        updatedAt: "2026-07-07T14:25:37.376Z",
        sequence: 2,
      },
    ],
    sessionMessageStore: {
      list: () => [message("user-1", "测试 web 搜索", 1)],
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
      replace: (_sessionId, entries) => entries,
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
    [["call-web", "fetch", "Searching for: OpenAI developer docs Responses API official"]],
  );
});

test("applyTranscriptToolCallRepair prunes duplicate Codex web_search replay entries when ws fetch already exists", () => {
  const sessionId = "session-codex-web-tool-dedupe";
  let toolCalls: AgentToolCall[] = [
    {
      id: "ws_1",
      kind: "fetch",
      title: "Searching for: OpenAI developer docs Responses API official",
      status: "completed",
      input: JSON.stringify({
        query: "OpenAI developer docs Responses API official",
        action: {
          type: "search",
          query: "OpenAI developer docs Responses API official",
        },
      }),
      timestamp: "2026-07-07T14:25:37.376Z",
      updatedAt: "2026-07-07T14:25:37.376Z",
      sequence: 2,
    },
    {
      id: "web_search_1",
      kind: "fetch",
      title: "OpenAI developer docs Responses API official",
      status: "completed",
      timestamp: "2026-07-07T14:25:38.376Z",
      updatedAt: "2026-07-07T14:25:38.376Z",
      sequence: 3,
    },
  ];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "tool:ws_1",
      kind: "tool_call",
      toolCall: toolCalls[0]!,
      timestamp: toolCalls[0]!.timestamp,
      updatedAt: toolCalls[0]!.updatedAt,
      sequence: 2,
    },
    {
      id: "tool:web_search_1",
      kind: "tool_call",
      toolCall: toolCalls[1]!,
      timestamp: toolCalls[1]!.timestamp,
      updatedAt: toolCalls[1]!.updatedAt,
      sequence: 3,
    },
  ];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: {
      ...createSummary(sessionId),
      agentId: "codex",
      agentName: "Codex",
    },
    agent: {
      id: "codex",
      name: "Codex",
      kind: "custom" as const,
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptToolCalls: [toolCalls[0]!],
    sessionMessageStore: {
      list: () => [message("user-1", "修复 Codex web 重复", 1)],
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
    [["ws_1", "fetch", "Searching for: OpenAI developer docs Responses API official"]],
  );
  assert.deepEqual(
    timeline.filter((entry) => entry.kind === "tool_call").map((entry) => entry.toolCall.id),
    ["ws_1"],
  );
});

test("applyTranscriptToolCallRepair prunes Codex update_plan tool-call history", () => {
  const sessionId = "session-codex-plan-tool-repair";
  let toolCalls: AgentToolCall[] = [
    toolCall("call-plan", "todo", "update_plan", 2, "{\"ok\":true}"),
    toolCall("call-shell", "tool", "Tool call call_she…", 4, "D:\\myProject\\tools\\Tiller"),
  ];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-plan",
      kind: "tool_call",
      toolCall: toolCalls[0]!,
      timestamp: toolCalls[0]!.timestamp,
      updatedAt: toolCalls[0]!.updatedAt,
      sequence: 2,
    },
    {
      id: "tool:call-shell",
      kind: "tool_call",
      toolCall: toolCalls[1]!,
      timestamp: toolCalls[1]!.timestamp,
      updatedAt: toolCalls[1]!.updatedAt,
      sequence: 4,
    },
  ];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: {
      ...createSummary(sessionId),
      agentId: "codex",
      agentName: "Codex",
    },
    agent: {
      id: "codex",
      name: "Codex",
      kind: "custom" as const,
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptToolCalls: [
      {
        id: "call-shell",
        kind: "shell",
        title: "Get-Location",
        status: "completed",
        input: JSON.stringify({ command: "Get-Location" }),
        timestamp: "2026-07-07T11:05:55.558Z",
        updatedAt: "2026-07-07T11:06:03.385Z",
        sequence: 4,
      },
    ],
    sessionMessageStore: {
      list: () => [message("user-1", "修复 Codex 计划工具", 1)],
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
    [["call-shell", "shell", "Get-Location"]],
  );
  assert.deepEqual(
    timeline.filter((entry) => entry.kind === "tool_call").map((entry) => entry.toolCall.id),
    ["call-shell"],
  );
});

test("applyTranscriptToolCallRepair prunes OpenCode todo-count tool-call history", () => {
  const sessionId = "session-opencode-plan-tool-repair";
  let toolCalls: AgentToolCall[] = [
    {
      id: "call-plan",
      kind: "write",
      title: "2 todos",
      status: "completed",
      input: JSON.stringify({
        todos: [
          { content: "读文件", status: "completed" },
          { content: "写总结", status: "pending" },
        ],
      }),
      timestamp: "2026-07-07T11:05:54.558Z",
      updatedAt: "2026-07-07T11:05:55.385Z",
      sequence: 2,
    },
    {
      id: "call-search",
      kind: "search",
      title: "Search",
      status: "completed",
      timestamp: "2026-07-07T11:05:55.558Z",
      updatedAt: "2026-07-07T11:06:03.385Z",
      sequence: 4,
    },
  ];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-plan",
      kind: "tool_call",
      toolCall: toolCalls[0]!,
      timestamp: toolCalls[0]!.timestamp,
      updatedAt: toolCalls[0]!.updatedAt,
      sequence: 2,
    },
    {
      id: "tool:call-search",
      kind: "tool_call",
      toolCall: toolCalls[1]!,
      timestamp: toolCalls[1]!.timestamp,
      updatedAt: toolCalls[1]!.updatedAt,
      sequence: 4,
    },
  ];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: {
      ...createSummary(sessionId),
      agentId: "opencode",
      agentName: "OpenCode",
    },
    agent: {
      id: "opencode",
      name: "OpenCode",
      kind: "custom" as const,
      command: "opencode",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptToolCalls: [toolCalls[1]!],
    sessionMessageStore: {
      list: () => [message("user-1", "修复 OpenCode 计划工具", 1)],
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
    [["call-search", "search", "Search"]],
  );
  assert.deepEqual(
    timeline.filter((entry) => entry.kind === "tool_call").map((entry) => entry.toolCall.id),
    ["call-search"],
  );
});

test("applyTranscriptToolCallRepair prunes stale OpenCode running writes when target file is missing", () => {
  const sessionId = "session-opencode-stale-write-tool-repair";
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-opencode-stale-write-"));
  const missingPath = join(tempDir, "__todolist-test-done.txt");
  let toolCalls: AgentToolCall[] = [
    {
      id: "call-stale-write",
      kind: "write",
      title: "write",
      status: "running",
      input: JSON.stringify({
        filePath: missingPath,
        content: "todolist 第三次测试通过\n",
      }),
      timestamp: "2026-07-08T00:58:00.000Z",
      updatedAt: "2026-07-08T00:58:00.000Z",
      sequence: 2,
    },
  ];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-stale-write",
      kind: "tool_call",
      toolCall: toolCalls[0]!,
      timestamp: toolCalls[0]!.timestamp,
      updatedAt: toolCalls[0]!.updatedAt,
      sequence: 2,
    },
  ];

  const repaired = applyTranscriptToolCallRepair({
    sessionId,
    summary: {
      ...createSummary(sessionId),
      agentId: "opencode",
      agentName: "OpenCode",
      status: "idle",
    },
    agent: {
      id: "opencode",
      name: "OpenCode",
      kind: "custom" as const,
      command: "opencode",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptToolCalls: [],
    sessionMessageStore: {
      list: () => [message("user-1", "修复 OpenCode 悬挂 write", 1)],
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
  assert.deepEqual(toolCalls, []);
  assert.deepEqual(timeline, []);
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
