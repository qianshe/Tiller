import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("repairSessionToolCalls upgrades OpenCode persisted task outputs to subagent", () => {
  const sessionId = "session-opencode-subagent-history";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-opencode-subagent-history",
      kind: "tool",
      title: "Simple subagent test",
      status: "completed",
      output: JSON.stringify({
        output: [
          "Task completed in 7s.",
          "",
          "Agent: Sisyphus-Junior (category: quick)",
          "",
          "<task_metadata>",
          "session_id: ses_0c2674e30ffeB0TeYbrg38472O",
          "task_id: ses_0c2674e30ffeB0TeYbrg38472O",
          "subagent: Sisyphus-Junior",
          "category: quick",
          "</task_metadata>",
          "",
          "to continue: task(task_id=\"ses_0c2674e30ffeB0TeYbrg38472O\", load_skills=[], run_in_background=false, prompt=\"...\")",
        ].join("\n"),
        metadata: {
          prompt: "回一句 hello from subagent 就行，不要做其他事情。",
          agent: "Sisyphus-Junior",
          category: "quick",
          requested_subagent_type: "sisyphus-junior",
          description: "Simple subagent test",
          taskId: "ses_0c2674e30ffeB0TeYbrg38472O",
          sessionId: "ses_0c2674e30ffeB0TeYbrg38472O",
          spawnDepth: 1,
        },
      }),
      timestamp: "2026-07-08T04:20:52.593Z",
      updatedAt: "2026-07-08T04:20:52.593Z",
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
  assert.equal(repaired.toolCalls[0]?.kind, "subagent");
  assert.ok(typeof repaired.toolCalls[0]?.input === "string");
  assert.match(repaired.toolCalls[0]?.input ?? "", /"agent":"Sisyphus-Junior"/);
});

test("repairSessionToolCalls upgrades OpenCode generic search outputs from persisted history", () => {
  const sessionId = "session-opencode-search-history";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-opencode-search-history",
      kind: "tool",
      title: "Tool call call_00_s…",
      status: "completed",
      output: JSON.stringify({
        output: [
          "Morph Fast Context subagent performed search on repository:",
          "- Grepped 'AgentToolCall' in `D:/myProject/tools/Tiller/packages/shared/src`",
        ].join("\n"),
      }),
      timestamp: "2026-07-08T04:20:52.593Z",
      updatedAt: "2026-07-08T04:20:52.593Z",
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
  assert.equal(repaired.toolCalls[0]?.kind, "search");
  assert.equal(repaired.toolCalls[0]?.title, "Search");
});

test("repairSessionToolCalls upgrades OpenCode generic skill outputs from persisted history", () => {
  const sessionId = "session-opencode-skill-history";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-opencode-skill-history",
      kind: "tool",
      title: "Tool call call_00_k…",
      status: "completed",
      output: "## Skill: debugging-strategies\n\nBase directory: C:/Users/qjq/.claude/skills/debugging-strategies",
      timestamp: "2026-07-08T04:20:52.593Z",
      updatedAt: "2026-07-08T04:20:52.593Z",
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
  assert.equal(repaired.toolCalls[0]?.kind, "skill");
  assert.equal(repaired.toolCalls[0]?.title, "Skill: debugging-strategies");
});

test("repairSessionToolCalls prunes stale OpenCode running writes when target file is missing", () => {
  const sessionId = "session-opencode-stale-write-history";
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-opencode-stale-write-"));
  const missingPath = join(tempDir, "__todolist-test-done.txt");
  const toolCalls: AgentToolCall[] = [
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
    },
  ];

  const repaired = repairSessionToolCalls(
    {
      sessionId,
      providerId: "opencode",
      summary: { ...summary(sessionId, "opencode", "OpenCode"), status: "idle" },
    },
    toolCalls,
  );

  assert.equal(repaired.changedCount, 1);
  assert.deepEqual(repaired.toolCalls, []);
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

test("repairSessionToolCalls upgrades Codex multi_agent wait history from tool to subagent", () => {
  const sessionId = "session-codex-subagent-history";
  const toolCalls: AgentToolCall[] = [
    {
      id: "call-codex-subagent-history",
      kind: "tool",
      title: "wait_agent",
      status: "completed",
      input: JSON.stringify({
        targets: ["019f418b-c549-7200-8ff1-8d2dd4ef002e"],
        timeout_ms: 120000,
      }),
      output: JSON.stringify({ status: {}, timed_out: true }),
      timestamp: "2026-07-08T11:45:25.514Z",
      updatedAt: "2026-07-08T11:47:25.533Z",
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
  assert.equal(repaired.toolCalls[0]?.kind, "subagent");
  assert.equal(repaired.toolCalls[0]?.title, "wait_agent");
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

test("repairTimelineToolCalls upgrades OpenCode persisted task timeline rows to subagent", () => {
  const sessionId = "session-opencode-subagent-timeline";
  const timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-opencode-subagent-timeline",
      kind: "tool_call",
      toolCall: {
        id: "call-opencode-subagent-timeline",
        kind: "tool",
        title: "Simple subagent test",
        status: "completed",
        output: JSON.stringify({
          output: [
            "Task completed in 7s.",
            "",
            "<task_metadata>",
            "session_id: ses_0c2674e30ffeB0TeYbrg38472O",
            "task_id: ses_0c2674e30ffeB0TeYbrg38472O",
            "</task_metadata>",
            "",
            "to continue: task(task_id=\"ses_0c2674e30ffeB0TeYbrg38472O\", load_skills=[], run_in_background=false, prompt=\"...\")",
          ].join("\n"),
          metadata: {
            prompt: "回一句 hello from subagent 就行，不要做其他事情。",
            agent: "Sisyphus-Junior",
            description: "Simple subagent test",
            taskId: "ses_0c2674e30ffeB0TeYbrg38472O",
            sessionId: "ses_0c2674e30ffeB0TeYbrg38472O",
            spawnDepth: 1,
          },
        }),
        timestamp: "2026-07-08T04:20:52.593Z",
        updatedAt: "2026-07-08T04:20:52.593Z",
      },
      timestamp: "2026-07-08T04:20:52.593Z",
      updatedAt: "2026-07-08T04:20:52.593Z",
      sequence: 1,
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
  const repairedEntry = repaired.timeline[0];
  assert.equal(repairedEntry?.kind, "tool_call");
  assert.equal(
    repairedEntry?.kind === "tool_call" ? repairedEntry.toolCall.kind : undefined,
    "subagent",
  );
});

test("repairTimelineToolCalls prunes duplicate Codex web_search entries when ws fetch exists", () => {
  const sessionId = "session-codex-web-dedupe-timeline";
  const timeline: SessionTimelineEntry[] = [
    {
      id: "tool:ws_1",
      kind: "tool_call",
      toolCall: {
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
        timestamp: "2026-07-07T15:52:59.600Z",
        updatedAt: "2026-07-07T15:52:59.600Z",
      },
      timestamp: "2026-07-07T15:52:59.600Z",
      updatedAt: "2026-07-07T15:52:59.600Z",
      sequence: 1,
    },
    {
      id: "tool:web_search_1",
      kind: "tool_call",
      toolCall: {
        id: "web_search_1",
        kind: "fetch",
        title: "OpenAI developer docs Responses API official",
        status: "completed",
        timestamp: "2026-07-07T15:52:59.645Z",
        updatedAt: "2026-07-07T15:52:59.645Z",
      },
      timestamp: "2026-07-07T15:52:59.645Z",
      updatedAt: "2026-07-07T15:52:59.645Z",
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

  assert.equal(repaired.changedCount, 1);
  assert.deepEqual(
    repaired.timeline.filter((entry) => entry.kind === "tool_call").map((entry) => entry.toolCall.id),
    ["ws_1"],
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

test("repairTimelineToolCalls prunes generic Codex plan-updated tool calls", () => {
  const sessionId = "session-codex-generic-plan-history";
  const timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-plan",
      kind: "tool_call",
      toolCall: {
        id: "call-plan",
        kind: "tool",
        title: "Tool call call_plan…",
        status: "completed",
        output: "Plan updated",
        timestamp: "2026-07-07T16:35:26.089Z",
        updatedAt: "2026-07-07T16:35:26.089Z",
      },
      timestamp: "2026-07-07T16:35:26.089Z",
      updatedAt: "2026-07-07T16:35:26.089Z",
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
          command: ["pwsh.exe", "-Command", "Get-Location"],
          parsed_cmd: [{ type: "unknown", cmd: "Get-Location" }],
        }),
        timestamp: "2026-07-07T16:35:26.100Z",
        updatedAt: "2026-07-07T16:35:26.100Z",
      },
      timestamp: "2026-07-07T16:35:26.100Z",
      updatedAt: "2026-07-07T16:35:26.100Z",
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

test("repairTimelineToolCalls prunes stale OpenCode running writes when target file is missing", () => {
  const sessionId = "session-opencode-stale-write-timeline";
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-opencode-stale-write-"));
  const missingPath = join(tempDir, "__todolist-test-done.txt");
  const timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-stale-write",
      kind: "tool_call",
      toolCall: {
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
      },
      timestamp: "2026-07-08T00:58:00.000Z",
      updatedAt: "2026-07-08T00:58:00.000Z",
      sequence: 1,
    },
  ];

  const repaired = repairTimelineToolCalls(
    {
      sessionId,
      providerId: "opencode",
      summary: { ...summary(sessionId, "opencode", "OpenCode"), status: "idle" },
    },
    timeline,
  );

  assert.equal(repaired.changedCount, 1);
  assert.deepEqual(repaired.timeline, []);
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

test("repairSessionUpdateToolCalls prunes duplicate Codex web_search updates when ws fetch exists", () => {
  const sessionId = "session-codex-web-dedupe-updates";
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
        receivedAt: "2026-07-07T15:55:57.700Z",
        payloadJson: JSON.stringify({
          type: "tool-call",
          toolCall: {
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
            timestamp: "2026-07-07T15:55:57.700Z",
            updatedAt: "2026-07-07T15:55:57.700Z",
          },
        }),
      },
      {
        sessionId,
        runtimeSessionId: "runtime-1",
        providerId: "codex",
        sequence: 2,
        source: "acp_load_replay",
        updateType: "tool-call",
        receivedAt: "2026-07-07T15:55:57.848Z",
        payloadJson: JSON.stringify({
          type: "tool-call",
          toolCall: {
            id: "web_search_1",
            kind: "fetch",
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
  assert.deepEqual(
    repaired.updates.map((update) => update.sequence),
    [1],
  );
});

test("repairSessionUpdateToolCalls prunes generic Codex plan-updated tool calls", () => {
  const sessionId = "session-codex-generic-plan-updates";
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
        receivedAt: "2026-07-07T16:35:26.089Z",
        payloadJson: JSON.stringify({
          type: "tool-call",
          toolCall: {
            id: "call-plan",
            kind: "tool",
            title: "Tool call call_plan…",
            status: "completed",
            output: "Plan updated",
            timestamp: "2026-07-07T16:35:26.089Z",
            updatedAt: "2026-07-07T16:35:26.089Z",
          },
        }),
      },
      {
        sessionId,
        runtimeSessionId: "runtime-1",
        providerId: "codex",
        sequence: 2,
        source: "acp_load_replay",
        updateType: "tool-call",
        receivedAt: "2026-07-07T16:35:26.100Z",
        payloadJson: JSON.stringify({
          type: "tool-call",
          toolCall: {
            id: "call-shell",
            kind: "shell",
            title: "Get-Location",
            status: "completed",
            timestamp: "2026-07-07T16:35:26.100Z",
            updatedAt: "2026-07-07T16:35:26.100Z",
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
