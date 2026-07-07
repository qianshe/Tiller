import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall, SessionSummary, SessionTimelineEntry } from "@tiller/shared";
import { repairSessionToolCalls, repairSessionUpdateToolCalls, repairTimelineToolCalls } from "./tool-call-repair.js";

function summary(sessionId: string, agentId = "claudecode", agentName = "ClaudeCode"): SessionSummary {
  return {
    id: sessionId,
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    cwd: "D:/repo",
    worktreeName: "main",
    agentId,
    agentName,
    status: "running",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    messageCount: 0,
  };
}

test("repairSessionToolCalls keeps explicit Claude shell tools stable when titles contain rg commands", () => {
  const sessionId = "session-claude-shell-rg";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-1",
      kind: "shell",
      title: "rg \"tool_call\" apps/helm/src",
      status: "completed",
      input: JSON.stringify({ command: "rg \"tool_call\" apps/helm/src" }),
      timestamp: "2026-07-07T00:34:40.000Z",
      updatedAt: "2026-07-07T00:34:40.000Z",
    },
  ];

  const repaired = repairSessionToolCalls(
    {
      sessionId,
      providerId: "claudecode",
      summary: summary(sessionId),
    },
    toolCalls,
  );

  assert.equal(repaired.changedCount, 0);
  assert.equal(repaired.toolCalls[0]?.kind, "shell");
  assert.equal(repaired.toolCalls[0]?.title, "rg \"tool_call\" apps/helm/src");
});

test("repairSessionToolCalls upgrades OpenCode title-only MCP history to mcp", () => {
  const sessionId = "session-opencode-mcp-history";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-1",
      kind: "search",
      title: "mcp-router_codebase_search: ACP tool registration, tool definitions exposed via ACP",
      status: "completed",
      input: JSON.stringify({
        search_string: "ACP tool registration, tool definitions exposed via ACP",
      }),
      timestamp: "2026-07-07T00:34:40.000Z",
      updatedAt: "2026-07-07T00:34:40.000Z",
    },
  ];

  const repaired = repairSessionToolCalls(
    {
      sessionId,
      providerId: "opencode",
      summary: summary(sessionId, "opencode", "OpenCode"),
    },
    toolCalls,
  );

  assert.equal(repaired.changedCount, 1);
  assert.equal(repaired.toolCalls[0]?.kind, "mcp");
  assert.equal(repaired.toolCalls[0]?.title, "Tool: mcp_router/codebase_search");
  assert.deepEqual(repaired.toolCalls[0]?.mcp, {
    serverName: "mcp_router",
    toolName: "codebase_search",
    source: "provider-title",
    rawTitle: "mcp-router_codebase_search: ACP tool registration, tool definitions exposed via ACP",
  });
});

test("repairSessionToolCalls repairs Codex shell history stored as tool or write", () => {
  const sessionId = "session-codex-shell-history";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-rg",
      kind: "tool",
      title: "rg -n \"typecheck\" AGENTS.md",
      status: "failed",
      input: JSON.stringify({
        command: [
          "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\\pwsh.exe",
          "-Command",
          "rg -n \"typecheck\" AGENTS.md",
        ],
        parsed_cmd: [{ type: "unknown", cmd: "rg -n \"typecheck\" AGENTS.md" }],
      }),
      timestamp: "2026-07-07T12:12:02.005Z",
      updatedAt: "2026-07-07T12:12:03.135Z",
    },
    {
      id: "call-get-content",
      kind: "write",
      title: "Get-Content 'D:\\myProject\\tools\\Tiller\\apps\\helm\\tool-write-test.txt'",
      status: "completed",
      input: JSON.stringify({
        command: [
          "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\\pwsh.exe",
          "-Command",
          "Get-Content 'D:\\myProject\\tools\\Tiller\\apps\\helm\\tool-write-test.txt'",
        ],
        parsed_cmd: [{
          type: "unknown",
          cmd: "Get-Content 'D:\\myProject\\tools\\Tiller\\apps\\helm\\tool-write-test.txt'",
        }],
      }),
      timestamp: "2026-07-07T12:12:51.996Z",
      updatedAt: "2026-07-07T12:12:52.806Z",
    },
  ];

  const repaired = repairSessionToolCalls(
    {
      sessionId,
      providerId: "codex",
      summary: summary(sessionId, "codex", "Codex"),
    },
    toolCalls,
  );

  assert.equal(repaired.changedCount, 2);
  assert.deepEqual(
    repaired.toolCalls.map((item) => item.kind),
    ["shell", "shell"],
  );
});

test("repairSessionToolCalls rewrites Codex web search history from search to fetch", () => {
  const sessionId = "session-codex-web-history";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-web",
      kind: "search",
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
    },
  ];

  const repaired = repairSessionToolCalls(
    {
      sessionId,
      providerId: "codex",
      summary: summary(sessionId, "codex", "Codex"),
    },
    toolCalls,
  );

  assert.equal(repaired.changedCount, 1);
  assert.equal(repaired.toolCalls[0]?.kind, "fetch");
  assert.equal(
    repaired.toolCalls[0]?.title,
    "Searching for: OpenAI developer docs Responses API official",
  );
});

test("repairTimelineToolCalls rewrites Codex web_search timeline history to fetch", () => {
  const sessionId = "session-codex-web-timeline";
  const timeline: SessionTimelineEntry[] = [
    {
      id: "tool:web_search_1",
      kind: "tool_call",
      toolCall: {
        id: "web_search_1",
        kind: "search",
        title: "OpenAI developer docs Responses API official",
        status: "completed",
        timestamp: "2026-07-07T15:52:59.645Z",
        updatedAt: "2026-07-07T15:52:59.645Z",
      },
      timestamp: "2026-07-07T15:52:59.645Z",
      updatedAt: "2026-07-07T15:52:59.645Z",
      sequence: 1,
    },
  ];

  const repaired = repairTimelineToolCalls(
    {
      sessionId,
      providerId: "codex",
      summary: summary(sessionId, "codex", "Codex"),
    },
    timeline,
  );

  assert.equal(repaired.changedCount, 1);
  const repairedEntry = repaired.timeline[0];
  assert.equal(repairedEntry?.kind, "tool_call");
  assert.equal(
    repairedEntry?.kind === "tool_call" ? repairedEntry.toolCall.kind : undefined,
    "fetch",
  );
});

test("repairTimelineToolCalls prunes Codex update_plan history for old sessions", () => {
  const sessionId = "session-codex-plan-history";
  const timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-plan",
      kind: "tool_call",
      toolCall: {
        id: "call-plan",
        kind: "todo",
        title: "update_plan",
        status: "completed",
        timestamp: "2026-07-07T12:12:00.000Z",
        updatedAt: "2026-07-07T12:12:01.000Z",
      },
      timestamp: "2026-07-07T12:12:00.000Z",
      updatedAt: "2026-07-07T12:12:01.000Z",
      sequence: 1,
    },
    {
      id: "tool:call-shell",
      kind: "tool_call",
      toolCall: {
        id: "call-shell",
        kind: "tool",
        title: "Get-Location",
        status: "completed",
        input: JSON.stringify({
          command: [
            "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\\pwsh.exe",
            "-Command",
            "Get-Location",
          ],
          parsed_cmd: [{ type: "unknown", cmd: "Get-Location" }],
        }),
        timestamp: "2026-07-07T12:12:02.000Z",
        updatedAt: "2026-07-07T12:12:03.000Z",
      },
      timestamp: "2026-07-07T12:12:02.000Z",
      updatedAt: "2026-07-07T12:12:03.000Z",
      sequence: 2,
    },
  ];

  const repaired = repairTimelineToolCalls(
    {
      sessionId,
      providerId: "codex",
      summary: summary(sessionId, "codex", "Codex"),
    },
    timeline,
  );

  assert.equal(repaired.changedCount, 2);
  assert.deepEqual(
    repaired.timeline.filter((entry) => entry.kind === "tool_call").map((entry) => entry.toolCall.id),
    ["call-shell"],
  );
  assert.equal(
    repaired.timeline.find((entry) => entry.kind === "tool_call")?.kind === "tool_call"
      ? repaired.timeline.find((entry) => entry.kind === "tool_call")?.toolCall.kind
      : undefined,
    "shell",
  );
});

test("repairTimelineToolCalls prunes OpenCode todo-count history for old sessions", () => {
  const sessionId = "session-opencode-plan-history";
  const timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-plan",
      kind: "tool_call",
      toolCall: {
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
        timestamp: "2026-07-07T12:12:00.000Z",
        updatedAt: "2026-07-07T12:12:01.000Z",
      },
      timestamp: "2026-07-07T12:12:00.000Z",
      updatedAt: "2026-07-07T12:12:01.000Z",
      sequence: 1,
    },
    {
      id: "tool:call-search",
      kind: "tool_call",
      toolCall: {
        id: "call-search",
        kind: "search",
        title: "Search",
        status: "completed",
        timestamp: "2026-07-07T12:12:02.000Z",
        updatedAt: "2026-07-07T12:12:03.000Z",
      },
      timestamp: "2026-07-07T12:12:02.000Z",
      updatedAt: "2026-07-07T12:12:03.000Z",
      sequence: 2,
    },
  ];

  const repaired = repairTimelineToolCalls(
    {
      sessionId,
      providerId: "opencode",
      summary: summary(sessionId, "opencode", "OpenCode"),
    },
    timeline,
  );

  assert.equal(repaired.changedCount, 1);
  assert.deepEqual(
    repaired.timeline.filter((entry) => entry.kind === "tool_call").map((entry) => entry.toolCall.id),
    ["call-search"],
  );
});

test("repairSessionUpdateToolCalls prunes OpenCode todo-count updates", () => {
  const sessionId = "session-opencode-plan-updates";
  const repaired = repairSessionUpdateToolCalls(
    {
      sessionId,
      providerId: "opencode",
      summary: summary(sessionId, "opencode", "OpenCode"),
    },
    [
      {
        sessionId,
        runtimeSessionId: "runtime-1",
        providerId: "opencode",
        sequence: 1,
        source: "acp_load_replay",
        updateType: "tool-call",
        receivedAt: "2026-07-07T15:05:41.190Z",
        payloadJson: JSON.stringify({
          type: "tool-call",
          toolCall: {
            id: "call-plan",
            kind: "write",
            title: "2 todos",
            input: JSON.stringify({
              todos: [
                { content: "读文件", status: "completed" },
                { content: "写总结", status: "pending" },
              ],
            }),
            status: "completed",
            timestamp: "2026-07-07T14:55:12.252Z",
            updatedAt: "2026-07-07T14:55:12.518Z",
          },
        }),
      },
      {
        sessionId,
        runtimeSessionId: "runtime-1",
        providerId: "opencode",
        sequence: 2,
        source: "acp_load_replay",
        updateType: "tool-call",
        receivedAt: "2026-07-07T15:05:42.190Z",
        payloadJson: JSON.stringify({
          type: "tool-call",
          toolCall: {
            id: "call-search",
            kind: "search",
            title: "Search",
            status: "completed",
            timestamp: "2026-07-07T14:55:13.252Z",
            updatedAt: "2026-07-07T14:55:13.518Z",
          },
        }),
      },
    ],
  );

  assert.equal(repaired.changedCount, 1);
  assert.deepEqual(
    repaired.updates.map((update) => update.sequence),
    [2],
  );
});

test("repairSessionUpdateToolCalls rewrites Codex web_search updates to fetch", () => {
  const sessionId = "session-codex-web-updates";
  const repaired = repairSessionUpdateToolCalls(
    {
      sessionId,
      providerId: "codex",
      summary: summary(sessionId, "codex", "Codex"),
    },
    [
      {
        sessionId,
        runtimeSessionId: "runtime-1",
        providerId: "codex",
        sequence: 1,
        source: "acp_load_replay",
        updateType: "tool-call",
        receivedAt: "2026-07-07T15:55:57.848Z",
        payloadJson: JSON.stringify({
          type: "tool-call",
          toolCall: {
            id: "web_search_1",
            kind: "search",
            title: "OpenAI developer docs Responses API official",
            status: "completed",
            timestamp: "2026-07-07T15:55:57.846Z",
            updatedAt: "2026-07-07T15:55:57.846Z",
          },
        }),
      },
    ],
  );

  assert.equal(repaired.changedCount, 1);
  const payload = JSON.parse(repaired.updates[0]!.payloadJson) as {
    toolCall: AgentToolCall;
  };
  assert.equal(payload.toolCall.kind, "fetch");
  assert.equal(payload.toolCall.title, "OpenAI developer docs Responses API official");
});
