import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotificationBatch } from "./runtime";
import { mapSessionUpdateNotification } from "./events";

test("mapSessionUpdateNotification preserves OpenCode pending tool starts", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-pending",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-opencode-pending",
          title: "bash",
          kind: "execute",
          status: "pending",
          locations: [],
          rawInput: {},
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.events[0]?.type, "tool-call");
  if (mapped?.events[0]?.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.events[0].toolCall.status, "pending");
});

test("mapSessionUpdateNotification applies OpenCode provider live tool classification", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-live",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-read",
            title: "apps\\deck\\src\\features\\logbook\\message-history.ts",
            status: "completed",
            tool: "read",
            state: {
              input: { filePath: "apps/deck/src/features/logbook/message-history.ts" },
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "read");
  assert.equal(mapped.event.toolCall.title, "apps\\deck\\src\\features\\logbook\\message-history.ts");
});

test("mapSessionUpdateNotification classifies OpenCode title-only MCP tools as mcp", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-mcp-live",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-mcp-search",
            kind: "search",
            title: "mcp-router_search_for_pattern: tool_call|toolCall|tool_name|toolName",
            status: "completed",
            input: "{\"pattern\":\"tool_call|toolCall|tool_name|toolName\"}",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/search_for_pattern");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "mcp_router",
    toolName: "search_for_pattern",
    source: "provider-title",
    rawTitle: "mcp-router_search_for_pattern: tool_call|toolCall|tool_name|toolName",
  });
});

test("mapSessionUpdateNotification exposes Context7 MCP identity on the initial running snapshot", () => {
  const fixtures = [
    {
      id: "call-opencode-context7-resolve",
      title: "context7_resolve-library-id",
      expectedTitle: "Tool: context7/resolve-library-id",
      expectedToolName: "resolve-library-id",
    },
    {
      id: "call-opencode-context7-query",
      title: "context7_query-docs",
      expectedTitle: "Tool: context7/query-docs",
      expectedToolName: "query-docs",
    },
  ];

  for (const fixture of fixtures) {
    const mapped = mapSessionUpdateNotification(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: `session-${fixture.id}`,
          update: {
            sessionUpdate: "tool_call_update",
            toolCall: {
              id: fixture.id,
              kind: "tool",
              title: fixture.title,
              status: "running",
              input: "{}",
            },
          },
        },
      },
      { providerId: "opencode" },
    );

    assert.equal(mapped?.event.type, "tool-call");
    if (mapped?.event.type !== "tool-call") {
      throw new Error("Expected tool-call event");
    }
    assert.equal(mapped.event.toolCall.kind, "mcp");
    assert.equal(mapped.event.toolCall.title, fixture.expectedTitle);
    assert.equal(mapped.event.toolCall.status, "running");
    assert.deepEqual(mapped.event.toolCall.mcp, {
      serverName: "context7",
      toolName: fixture.expectedToolName,
      source: "provider-title",
      rawTitle: fixture.title,
    });
  }
});

test("mapSessionUpdateNotification classifies OpenCode task calls as subagents from live input", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-subagent-live",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-subagent-live",
            kind: "tool",
            title: "task",
            status: "in_progress",
            input: JSON.stringify({
              description: "Simple subagent test",
              category: "quick",
              load_skills: [],
              prompt: "回一句 hello from subagent 就行，不要做其他事情。",
              run_in_background: false,
            }),
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Simple subagent test");
});

test("mapSessionUpdateNotification classifies OpenCode completed task outputs as subagents", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-subagent-complete",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-subagent-complete",
            kind: "tool",
            title: "Simple subagent test",
            status: "completed",
            output: JSON.stringify({
              output: [
                "Task completed in 7s.",
                "",
                "Agent: Sisyphus-Junior (category: quick)",
                "",
                "---",
                "",
                "hello from subagent",
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
                truncated: false,
                prompt: "回一句 hello from subagent 就行，不要做其他事情。",
                agent: "Sisyphus-Junior",
                category: "quick",
                requested_subagent_type: "sisyphus-junior",
                load_skills: [],
                description: "Simple subagent test",
                run_in_background: false,
                taskId: "ses_0c2674e30ffeB0TeYbrg38472O",
                sessionId: "ses_0c2674e30ffeB0TeYbrg38472O",
                sync: true,
                spawnDepth: 1,
              },
            }),
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Simple subagent test");
  assert.ok(typeof mapped.event.toolCall.input === "string");
  assert.match(mapped.event.toolCall.input ?? "", /"agent":"Sisyphus-Junior"/);
  assert.match(mapped.event.toolCall.input ?? "", /"description":"Simple subagent test"/);
});

test("mapSessionUpdateNotification keeps completed OpenCode background launch acknowledgements running", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-background-launch",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-background-launch",
            kind: "tool",
            title: "Background test",
            status: "completed",
            input: JSON.stringify({
              description: "Background test",
              prompt: "Run tests",
              run_in_background: true,
            }),
            output: JSON.stringify({
              output: "Background task launched successfully.\nTask ID: task-background-1",
              metadata: {
                taskId: "task-background-1",
                sessionId: "task-background-1",
                description: "Background test",
                run_in_background: true,
              },
            }),
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.status, "running");
  assert.equal(mapped.event.toolCall.commandId, "subagent:task-background-1");
});

test("OpenCode background session and task ids remain aliases of one subagent", () => {
  const sessionId = "session-opencode-background-aliases";
  const rootId = "call-opencode-background-aliases";
  const running = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: rootId,
            kind: "tool",
            title: "Run helm tests",
            status: "in_progress",
            input: JSON.stringify({
              description: "Run helm tests",
              prompt: "Run helm tests",
              run_in_background: true,
            }),
          },
        },
      },
    },
    { providerId: "opencode" },
  );
  assert.deepEqual(
    running?.events.filter((event) => event.type === "tool-call").map((event) => event.toolCall.id),
    [rootId],
  );

  const acknowledged = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: rootId,
            kind: "tool",
            title: "Run helm tests",
            status: "completed",
            input: JSON.stringify({
              description: "Run helm tests",
              prompt: "Run helm tests",
              run_in_background: true,
            }),
            output: JSON.stringify({
              output: "Background task launched successfully.\nTask ID: bg_helm",
              metadata: {
                taskId: "ses_helm",
                sessionId: "ses_helm",
                description: "Run helm tests",
                run_in_background: true,
              },
            }),
          },
        },
      },
    },
    { providerId: "opencode" },
  );
  const calls = acknowledged?.events.filter((event) => event.type === "tool-call") ?? [];
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.type === "tool-call" ? calls[0].toolCall.id : undefined, rootId);
  assert.equal(
    calls[0]?.type === "tool-call" ? calls[0].toolCall.commandId : undefined,
    "subagent:ses_helm",
  );
  assert.equal(calls[0]?.type === "tool-call" ? calls[0].toolCall.status : undefined, "running");
});

test("mapSessionUpdateNotification repairs OpenCode path-only tool call history", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-path",
            kind: "tool",
            title: "apps\\helm\\src\\runtime\\events.ts",
            status: "completed",
            timestamp: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:01.000Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "read");
  assert.equal(mapped.event.toolCall.title, "apps\\helm\\src\\runtime\\events.ts");
});

test("mapSessionUpdateNotification repairs OpenCode generic file-display history to read", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-read-output",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-read-output",
            kind: "tool",
            title: "Tool call call_00_r…",
            status: "completed",
            output: JSON.stringify({
              output: [
                "<path>D:/myProject/tools/Tiller/package.json</path>",
                "<type>file</type>",
                "<content>",
                "1: {",
              ].join("\n"),
            }),
            timestamp: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:01.000Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "read");
  assert.equal(mapped.event.toolCall.title, "D:/myProject/tools/Tiller/package.json");
});

test("mapSessionUpdateNotification repairs OpenCode generic search history from output text", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-search-output",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-search-output",
            kind: "tool",
            title: "Tool call call_00_s…",
            status: "completed",
            output: JSON.stringify({
              output: [
                "Morph Fast Context subagent performed search on repository:",
                "- Grepped 'AgentToolCall' in `D:/myProject/tools/Tiller/packages/shared/src`",
              ].join("\n"),
            }),
            timestamp: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:01.000Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
  assert.equal(mapped.event.toolCall.title, "Search");
});

test("mapSessionUpdateNotification repairs OpenCode generic structured search history", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-structured-search",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-structured-search",
            kind: "tool",
            title: "Tool call call_00_j…",
            status: "completed",
            output: JSON.stringify({
              output: JSON.stringify({
                "packages\\acp-runtime\\src\\events.test.ts": [
                  "  >  10: mapSessionUpdateNotification()",
                ],
              }),
            }),
            timestamp: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:01.000Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
  assert.equal(mapped.event.toolCall.title, "Search");
});

test("mapSessionUpdateNotification repairs OpenCode replayed session info outputs into read tool calls", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-session-info",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-session-info",
            kind: "tool",
            title: "Tool call call_01_q…",
            status: "completed",
            output: JSON.stringify({
              output: [
                "Session ID: ses_0c3a34996ffegLt3qYkUNaAbe8",
                "Messages: 82",
                "Date Range: 2026-07-07T11:35:37.006Z to 2026-07-08T11:04:56.544Z",
                "Agents Used: Sisyphus - Ultraworker",
              ].join("\n"),
            }),
            timestamp: "2026-07-08T16:15:15.160Z",
            updatedAt: "2026-07-08T16:15:15.160Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "read");
  assert.equal(mapped.event.toolCall.title, "Session info");
});

test("mapSessionUpdateNotification repairs OpenCode replayed session list outputs into read tool calls", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-session-list",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-session-list",
            kind: "tool",
            title: "Tool call call_03_5…",
            status: "completed",
            output: JSON.stringify({
              output: [
                "| Session ID | Messages | First | Last | Agents |",
                "|------------|----------|-------|------|--------|",
                "| ses_0c3a34996ffegLt3qYkUNaAbe8 | 81 | 2026-07-07 | 2026-07-08 | Sisyphus - Ultraworker |",
              ].join("\n"),
            }),
            timestamp: "2026-07-08T16:15:15.150Z",
            updatedAt: "2026-07-08T16:15:15.150Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "read");
  assert.equal(mapped.event.toolCall.title, "Session list");
});

test("mapSessionUpdateNotification repairs OpenCode replayed symbol listings into search tool calls", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-symbol-list",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-symbol-list",
            kind: "tool",
            title: "Tool call call_03_X…",
            status: "completed",
            output: JSON.stringify({
              output: [
                "ACP_IMAGE_INPUT_UNSUPPORTED_CODE (Constant) - line 496",
                "AcpAgentProvider (Variable) - line 55",
                "resolveSessionConfigSupport (Function) - line 244",
              ].join("\n"),
            }),
            timestamp: "2026-07-08T16:15:15.141Z",
            updatedAt: "2026-07-08T16:15:15.141Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
  assert.equal(mapped.event.toolCall.title, "Symbols");
});

test("mapSessionUpdateNotification repairs OpenCode replayed diagnostics summaries into diagnostics tool calls", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-diagnostics",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-diagnostics",
            kind: "tool",
            title: "Tool call call_02_C…",
            status: "completed",
            output: JSON.stringify({
              output: "No diagnostics found",
            }),
            timestamp: "2026-07-08T16:15:15.137Z",
            updatedAt: "2026-07-08T16:15:15.137Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "diagnostics");
  assert.equal(mapped.event.toolCall.title, "Diagnostics");
});

test("mapSessionUpdateNotification repairs OpenCode generic skill history from output text", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-skill-output",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-skill-output",
            kind: "tool",
            title: "Tool call call_00_k…",
            status: "completed",
            output: "## Skill: debugging-strategies\n\nBase directory: C:/Users/qjq/.claude/skills/debugging-strategies",
            timestamp: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:01.000Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "skill");
  assert.equal(mapped.event.toolCall.title, "Skill: debugging-strategies");
});

test("mapSessionUpdateNotification repairs OpenCode generic shell history from command titles", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-shell-title",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-shell-title",
            kind: "tool",
            title: "Get-ChildItem -Recurse -Filter \"*session*\" -Name | Select-Object -First 10",
            status: "completed",
            output: "session-live-state.ts\r\nsession-timeline.ts",
            timestamp: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:01.000Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
  assert.equal(
    mapped.event.toolCall.title,
    "Get-ChildItem -Recurse -Filter \"*session*\" -Name | Select-Object -First 10",
  );
});

test("mapSessionUpdateNotification repairs OpenCode generic fetch history from URL titles", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-history-fetch-title",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-opencode-history-fetch-title",
            kind: "tool",
            title: "https://agentclientprotocol.com/protocol/v1/tool-calls (text/markdown; charset=utf-8)",
            status: "completed",
            output: "# Tool Calls",
            timestamp: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:01.000Z",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "fetch");
  assert.equal(
    mapped.event.toolCall.title,
    "https://agentclientprotocol.com/protocol/v1/tool-calls (text/markdown; charset=utf-8)",
  );
});

test("mapSessionUpdateNotification suppresses OpenCode count-only todo tools", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-todo",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-todo",
            title: "0 todos",
            status: "completed",
            tool: "todowrite",
          },
        },
      },
    },
    {
      provider: {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        transport: "stdio",
        protocol: "acp",
      },
    },
  );

  assert.equal(mapped, null);
});

test("mapSessionUpdateNotification suppresses OpenCode title-only todowrite frames without todo payload", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-todo",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-todo-empty-frame",
            title: "todowrite",
            kind: "write",
            input: "{}",
            status: "completed",
          },
        },
      },
    },
    {
      provider: {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        transport: "stdio",
        protocol: "acp",
      },
    },
  );

  assert.equal(mapped, null);
});

test("mapSessionUpdateNotificationBatch preserves OpenCode todo tools before derived plans", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-plan",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-plan",
            tool: "todowrite",
            state: {
              input: {
                todos: [{ content: "Adapter projection", status: "completed" }],
              },
            },
          },
        },
      },
    },
    {
      provider: {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        transport: "stdio",
        protocol: "acp",
      },
    },
  );

  assert.deepEqual(mapped?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const planEvent = mapped?.events[1];
  if (planEvent?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(planEvent.plan.entries, [
    { content: "Adapter projection", priority: "medium", status: "completed" },
  ]);
});

test("mapSessionUpdateNotificationBatch preserves count-title OpenCode todo tools before plans", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-plan-rawinput",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-plan-rawinput",
            title: "3 todos",
            kind: "write",
            rawInput: {
              todos: [
                { content: "读文件", status: "completed" },
                { content: "AST 搜索", status: "in_progress" },
                { content: "写总结", status: "pending" },
              ],
            },
          },
        },
      },
    },
    {
      provider: {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        transport: "stdio",
        protocol: "acp",
      },
    },
  );

  assert.deepEqual(mapped?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const planEvent = mapped?.events[1];
  if (planEvent?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(planEvent.plan.entries, [
    { content: "读文件", priority: "medium", status: "completed" },
    { content: "AST 搜索", priority: "medium", status: "in_progress" },
    { content: "写总结", priority: "medium", status: "pending" },
  ]);
});
