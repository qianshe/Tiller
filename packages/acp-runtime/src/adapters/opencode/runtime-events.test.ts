import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotificationBatch } from "../../runtime";
import { createRuntimeEventOriginTracker, mapSessionUpdateNotification } from "../../events";

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

test("mapSessionUpdateNotification classifies OpenCode task calls before input arrives", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-task-before-input",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-opencode-task-before-input",
          title: "task",
          kind: "tool",
          status: "in_progress",
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.events[0]?.type, "tool-call");
  if (mapped?.events[0]?.type !== "tool-call") {
    throw new Error("Expected OpenCode task tool-call event");
  }
  assert.equal(mapped.events[0].toolCall.kind, "subagent");
});

test("OpenCode flat tool updates keep subagent identity across sparse completion frames", () => {
  const sessionId = "session-opencode-flat-subagent";
  const toolCallId = "call-opencode-flat-subagent";
  const input = {
    description: "Reply with a short OpenCode result",
    prompt: "Return OPEN_CODE_OK",
    category: "explore",
    run_in_background: false,
  };
  const running = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: "task",
          kind: "tool",
          status: "running",
          rawInput: input,
        },
      },
    },
    { providerId: "opencode" },
  );
  const completed = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
          rawOutput: [
            {
              type: "content",
              content: {
                type: "text",
                text: [
                  "Task Result",
                  "<task_metadata>",
                  "session_id: ses_opencode_flat",
                  "task_id: ses_opencode_flat",
                  "subagent: explore",
                  "</task_metadata>",
                  "to continue: task(task_id=\"ses_opencode_flat\")",
                ].join("\n"),
              },
            },
          ],
        },
      },
    },
    { providerId: "opencode" },
  );
  const runningCall = running?.events.find((event) => event.type === "tool-call");
  const completedCall = completed?.events.find((event) => event.type === "tool-call");

  assert.equal(runningCall?.type, "tool-call");
  assert.equal(completedCall?.type, "tool-call");
  if (runningCall?.type !== "tool-call" || completedCall?.type !== "tool-call") {
    throw new Error("Expected OpenCode tool-call events");
  }
  assert.equal(runningCall.toolCall.id, toolCallId);
  assert.equal(runningCall.toolCall.kind, "subagent");
  assert.equal(runningCall.toolCall.title, "explore");
  assert.equal(completedCall.toolCall.id, toolCallId);
  assert.equal(completedCall.toolCall.kind, "subagent");
  assert.equal(completedCall.toolCall.status, "completed");
  assert.equal(completedCall.toolCall.title, "explore");
  assert.equal(completedCall.toolCall.commandId, "subagent:ses_opencode_flat");
});

test("OpenCode running metadata updates reuse the initial subagent entities", () => {
  const sessionId = "session-opencode-running-metadata-reuse";
  const map = (update: Record<string, unknown>) => mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update },
    },
    { providerId: "opencode" },
  );
  const initial = (toolCallId: string, prompt: string) => map({
    sessionUpdate: "tool_call",
    toolCallId,
    title: "task",
    kind: "tool",
    status: "running",
    rawInput: {
      description: prompt,
      prompt,
      category: "explore",
      run_in_background: true,
    },
  });
  const metadataUpdate = (toolCallId: string, prompt: string, taskId: string) => map({
    sessionUpdate: "tool_call_update",
    toolCall: {
      id: toolCallId,
      kind: "tool",
      title: "task",
      status: "running",
      input: {
        category: "explore",
        prompt,
      },
      rawOutput: {
        output: "Background task launched. Status: pending",
        metadata: {
          taskId,
          sessionId: taskId,
          category: "explore",
          prompt,
          run_in_background: true,
        },
      },
    },
  });

  const firstInitial = initial("first-root", "Find topic subscription setup");
  const secondInitial = initial("second-root", "Trace session status update flow");
  const firstUpdate = metadataUpdate(
    "first-metadata",
    "Find topic subscription setup",
    "first-child",
  );
  const secondUpdate = metadataUpdate(
    "second-metadata",
    "Trace session status update flow",
    "second-child",
  );
  const toolCallFrom = (mapped: ReturnType<typeof map>) => {
    const event = mapped?.events.find((candidate) => candidate.type === "tool-call");
    return event?.type === "tool-call" ? event.toolCall : undefined;
  };

  assert.equal(toolCallFrom(firstInitial)?.id, "first-root");
  assert.equal(toolCallFrom(secondInitial)?.id, "second-root");
  assert.equal(toolCallFrom(firstUpdate)?.id, "first-root");
  assert.equal(toolCallFrom(secondUpdate)?.id, "second-root");
  assert.equal(toolCallFrom(firstUpdate)?.commandId, "subagent:first-child");
  assert.equal(toolCallFrom(secondUpdate)?.commandId, "subagent:second-child");
});

test("OpenCode skill-loaded completion with a new call id reuses the running entity", () => {
  const sessionId = "session-opencode-skill-completion-reuse";
  const taskId = "ses_01935f1bbffe78lG6X0Ak409jE";
  const map = (update: Record<string, unknown>) => mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update },
    },
    { providerId: "opencode" },
  );

  const running = map({
    sessionUpdate: "tool_call",
    toolCallId: "call-opencode-skill-running",
    title: "task",
    kind: "tool",
    status: "running",
    rawInput: {
      category: "unspecified-high",
      description: "测试带技能加载的 subagent",
      load_skills: ["frontend-patterns"],
      prompt: "测试带技能加载的 subagent",
      run_in_background: true,
    },
  });

  const completed = map({
    sessionUpdate: "tool_call_update",
    toolCall: {
      id: "call-opencode-skill-completed",
      kind: "tool",
      title: "task",
      status: "completed",
      rawOutput: {
        output: [
          "Task completed in 19s.",
          "Agent: Sisyphus-Junior (category: unspecified-high)",
          "<task_result>",
          "技能注入：确认 frontend-patterns 内容已注入上下文",
          "</task_result>",
          "<task_metadata>",
          `session_id: ${taskId}`,
          `task_id: ${taskId}`,
          "subagent: Sisyphus-Junior",
          "category: unspecified-high",
          "</task_metadata>",
          `to continue: task(task_id=\"${taskId}\")`,
        ].join("\\n"),
        metadata: {
          taskId,
          sessionId: taskId,
          agent: "Sisyphus-Junior",
          category: "unspecified-high",
          description: "测试带技能加载的 subagent",
          load_skills: ["frontend-patterns"],
          run_in_background: true,
        },
      },
    },
  });

  const runningCalls = running?.events.filter((event) => event.type === "tool-call") ?? [];
  const completedCalls = completed?.events.filter((event) => event.type === "tool-call") ?? [];
  assert.deepEqual(
    runningCalls.map((event) => event.type === "tool-call" ? event.toolCall.id : undefined),
    ["call-opencode-skill-running"],
  );
  assert.deepEqual(
    completedCalls.map((event) => event.type === "tool-call" ? event.toolCall.id : undefined),
    ["call-opencode-skill-running"],
  );
  assert.equal(
    completedCalls[0]?.type === "tool-call" ? completedCalls[0].toolCall.status : undefined,
    "completed",
  );
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
  assert.equal(mapped.event.toolCall.title, "quick");
});

test("mapSessionUpdateNotification recognizes OpenCode explore tasks with subagent_type input", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-explore-subagent-type",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-opencode-explore-subagent-type",
          title: "Check acp-runtime thinking pipeline state",
          kind: "think",
          status: "in_progress",
          rawInput: {
            description: "Check acp-runtime thinking pipeline state",
            prompt: "Inspect the thinking pipeline and report the relevant state.",
            subagent_type: "explore",
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
  assert.equal(mapped.event.toolCall.title, "explore");
});

test("mapSessionUpdateNotification recognizes current OpenCode task result metadata", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-task-result",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-opencode-task-result",
          status: "completed",
          rawOutput: {
            output: [
              '<task id="ses_opencode_child" state="completed">',
              "<task_result>",
              "DONE",
              "</task_result>",
              "</task>",
            ].join("\\n"),
            metadata: {
              parentSessionId: "ses_opencode_parent",
              sessionId: "ses_opencode_child",
              model: { providerID: "opencode", modelID: "test" },
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
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.commandId, "subagent:ses_opencode_child");
});

test("mapSessionUpdateNotification replaces a running OpenCode task with its agent and output metadata", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-running-agent-metadata",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-running-agent-metadata",
            kind: "tool",
            title: "task",
            status: "running",
            rawOutput: {
              output: "Task is still running.",
              metadata: {
                taskId: "task-running-42",
                sessionId: "session-running-42",
                agent: "Sisyphus-Junior",
                model: {
                  providerID: "cpa-claude",
                  modelID: "deepseek-v4-flash",
                  variant: "low",
                },
              },
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
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.status, "running");
  assert.equal(mapped.event.toolCall.title, "Sisyphus-Junior");
  assert.equal(mapped.event.toolCall.output, undefined);
  assert.deepEqual(
    (JSON.parse(mapped.event.toolCall.input ?? "{}") as { model?: Record<string, unknown> }).model,
    {
      providerID: "cpa-claude",
      modelID: "deepseek-v4-flash",
      variant: "low",
    },
  );
});

test("mapSessionUpdateNotification upgrades a running OpenCode task after a later identity update", () => {
  const sessionId = "session-opencode-running-agent-later";
  const initial = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-opencode-running-agent-later",
          title: "task",
          kind: "tool",
          status: "running",
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(initial?.event.type, "tool-call");
  if (initial?.event.type !== "tool-call") {
    throw new Error("Expected initial OpenCode tool-call event");
  }
  assert.equal(initial.event.toolCall.title, "task");

  const identified = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-running-agent-later",
            kind: "tool",
            title: "task",
            status: "running",
            rawOutput: {
              output: "Task is still running.",
              metadata: {
                taskId: "task-running-later-42",
                sessionId: "session-running-later-42",
                agent: "Sisyphus-Junior",
              },
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(identified?.event.type, "tool-call");
  if (identified?.event.type !== "tool-call") {
    throw new Error("Expected identified OpenCode tool-call event");
  }
  assert.equal(identified.event.toolCall.kind, "subagent");
  assert.equal(identified.event.toolCall.status, "running");
  assert.equal(identified.event.toolCall.title, "Sisyphus-Junior");
});

test("mapSessionUpdateNotification upgrades a running OpenCode task from streamed agent output", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-running-agent-output",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-running-agent-output",
            kind: "tool",
            title: "task",
            status: "running",
            rawOutput: "Agent: Sisyphus-Junior (category: unspecified-low)",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected identified OpenCode tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.status, "running");
  assert.equal(mapped.event.toolCall.title, "Sisyphus-Junior");
  assert.equal(mapped.event.toolCall.output, undefined);
});

test("mapSessionUpdateNotification keeps an early OpenCode category over a later agent identity", () => {
  const sessionId = "session-opencode-running-agent-category";
  const initial = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-opencode-running-agent-category",
          title: "task",
          kind: "tool",
          status: "running",
          rawInput: {
            description: "Inspect the repository",
            prompt: "Inspect the repository",
            category: "quick",
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  const identified = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-opencode-running-agent-category",
          title: "task",
          kind: "tool",
          status: "running",
          rawOutput: {
            output: "Task is still running.",
            metadata: {
              taskId: "task-running-category-42",
              sessionId: "session-running-category-42",
              agent: "oracle",
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(initial?.event.type, "tool-call");
  assert.equal(identified?.event.type, "tool-call");
  if (identified?.event.type !== "tool-call") {
    throw new Error("Expected identified OpenCode tool-call event");
  }
  assert.equal(identified.event.toolCall.kind, "subagent");
  assert.equal(identified.event.toolCall.status, "running");
  assert.equal(identified.event.toolCall.title, "quick");
});

test("mapSessionUpdateNotification upgrades a running OpenCode task from raw input agent type", () => {
  const sessionId = "session-opencode-running-agent-input";
  const toolCallId = "call-opencode-running-agent-input";
  const initial = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: "task",
          kind: "tool",
          status: "pending",
          rawInput: {},
        },
      },
    },
    { providerId: "opencode" },
  );

  const identified = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          title: "Second subagent test",
          kind: "tool",
          status: "in_progress",
          rawInput: {
            description: "Second subagent test",
            prompt: "Return a short result.",
            subagent_type: "Sisyphus-Junior",
            run_in_background: false,
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(initial?.event.type, "tool-call");
  assert.equal(identified?.event.type, "tool-call");
  if (identified?.event.type !== "tool-call") {
    throw new Error("Expected identified OpenCode tool-call event");
  }
  assert.equal(identified.event.toolCall.id, toolCallId);
  assert.equal(identified.event.toolCall.kind, "subagent");
  assert.equal(identified.event.toolCall.status, "running");
  assert.equal(identified.event.toolCall.title, "Sisyphus-Junior");
  assert.match(identified.event.toolCall.input ?? "", /"subagent_type":"Sisyphus-Junior"/);
});

test("mapSessionUpdateNotification keeps OpenCode task-id reuse as a new invocation", () => {
  const sessionId = "session-opencode-reused-task-id";
  const map = (update: Record<string, unknown>) => mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId, update },
    },
    { providerId: "opencode" },
  );
  const start = (toolCallId: string) => map({
    sessionUpdate: "tool_call",
    toolCallId,
    title: "task",
    kind: "tool",
    status: "running",
  });
  const result = (toolCallId: string) => map({
    sessionUpdate: "tool_call_update",
    toolCall: {
      id: toolCallId,
      kind: "tool",
      title: "task",
      status: "completed",
      rawOutput: {
        output: "Task completed in 1s.",
        metadata: {
          taskId: "reused-task-id",
          sessionId: "reused-task-id",
          agent: "Sisyphus-Junior",
        },
      },
    },
  });

  const firstStart = start("first-task-call");
  const firstResult = result("first-task-result");
  const secondStart = start("second-task-call");
  const secondResult = result("second-task-result");

  assert.equal(firstStart?.event.type, "tool-call");
  assert.equal(firstResult?.event.type, "tool-call");
  assert.equal(secondStart?.event.type, "tool-call");
  assert.equal(secondResult?.event.type, "tool-call");
  if (
    firstStart?.event.type !== "tool-call" ||
    firstResult?.event.type !== "tool-call" ||
    secondStart?.event.type !== "tool-call" ||
    secondResult?.event.type !== "tool-call"
  ) {
    throw new Error("Expected OpenCode task tool-call events");
  }
  assert.equal(firstStart.event.toolCall.id, "first-task-call");
  assert.equal(firstResult.event.toolCall.id, "first-task-call");
  assert.equal(firstResult.event.toolCall.status, "completed");
  assert.equal(secondStart.event.toolCall.id, "second-task-call");
  assert.equal(secondStart.event.toolCall.title, "task");
  assert.equal(secondResult.event.toolCall.id, "second-task-call");
  assert.equal(secondResult.event.toolCall.title, "Sisyphus-Junior");
  assert.equal(secondResult.event.toolCall.status, "completed");
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
  assert.equal(mapped.event.toolCall.title, "quick");
  assert.equal(mapped.event.toolCall.output, "hello from subagent");
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

test("mapSessionUpdateNotification completes OpenCode launches that include a task result", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-background-result",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-background-result",
            kind: "tool",
            title: "Reply with exactly: SUBAGENT_OK_FROM_QUICK",
            status: "completed",
            input: JSON.stringify({
              category: "quick",
              prompt: "Reply with exactly: SUBAGENT_OK_FROM_QUICK",
              run_in_background: true,
            }),
            rawOutput: [
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Background task launched.\nStatus: pending",
                },
              },
              {
                type: "content",
                content: {
                  type: "text",
                  text: "Task Result\n\nSUBAGENT_OK_FROM_QUICK",
                },
                metadata: {
                  taskId: "ses_background_result",
                  sessionId: "ses_background_result",
                  backgroundTaskId: "bg_background_result",
                },
              },
            ],
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
  assert.equal(mapped.event.toolCall.status, "completed");
  assert.equal(mapped.event.toolCall.commandId, "subagent:ses_background_result");
});

test("mapSessionUpdateNotification does not classify OpenCode background_output text as a subagent", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-background-output",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-background-output",
            kind: "tool",
            title: "background_output",
            status: "completed",
            input: JSON.stringify({ task_id: "task-background-1" }),
            output: JSON.stringify({
              output: "Background task is still running (status: pending)",
              metadata: {
                taskId: "task-background-1",
                sessionId: "task-background-1",
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
  assert.notEqual(mapped.event.toolCall.kind, "subagent");
});

test("mapSessionUpdateNotification repairs a preclassified OpenCode background_output", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-background-output-preclassified",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-background-output-preclassified",
            kind: "subagent",
            title: "background_output",
            status: "running",
            input: JSON.stringify({ task_id: "task-background-2" }),
            output: JSON.stringify({
              output: "Background task is still running (status: pending)",
              metadata: { taskId: "task-background-2" },
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
  assert.equal(mapped.event.toolCall.kind, "tool");
  assert.equal(mapped.event.toolCall.status, "completed");
});

test("mapSessionUpdateNotification treats OpenCode background_output as a completed notification", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-background-output-running",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-background-output-running",
            kind: "tool",
            title: "background_output",
            status: "running",
            input: JSON.stringify({ task_id: "task-background-running" }),
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
  assert.equal(mapped.event.toolCall.kind, "tool");
  assert.equal(mapped.event.toolCall.status, "completed");
});

test("OpenCode background_output keeps the notification completed while closing the linked subagent", () => {
  const sessionId = "session-opencode-background-output-linked-result";
  const launch = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-linked-subagent",
            kind: "tool",
            title: "task",
            status: "running",
            rawInput: {
              description: "Return the linked result",
              prompt: "Return LINKED_RESULT",
              category: "quick",
              run_in_background: true,
              taskId: "ses-opencode-linked-result",
              backgroundTaskId: "bg-opencode-linked-result",
            },
            rawOutput: {
              output: "Background task launched. Status: pending",
              metadata: {
                taskId: "ses-opencode-linked-result",
                sessionId: "ses-opencode-linked-result",
                backgroundTaskId: "bg-opencode-linked-result",
              },
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );
  assert.equal(launch?.events[0]?.type, "tool-call");
  if (launch?.events[0]?.type !== "tool-call") {
    throw new Error("Expected the OpenCode launch tool call");
  }
  assert.equal(launch.events[0].toolCall.kind, "subagent");
  assert.equal(launch.events[0].toolCall.status, "running");

  const result = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-linked-background-output",
            kind: "tool",
            title: "background_output",
            status: "running",
            rawInput: { task_id: "bg-opencode-linked-result" },
            rawOutput: {
              output: "Task Result\\n\\nLINKED_RESULT",
              metadata: {
                taskId: "ses-opencode-linked-result",
                sessionId: "ses-opencode-linked-result",
                backgroundTaskId: "bg-opencode-linked-result",
              },
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  const toolEvents = result?.events.filter((event) => event.type === "tool-call") ?? [];
  const notification = toolEvents.find((event) =>
    event.type === "tool-call" && event.toolCall.id === "call-opencode-linked-background-output",
  );
  const linkedSubagent = toolEvents.find((event) =>
    event.type === "tool-call" && event.toolCall.id === "call-opencode-linked-subagent",
  );
  assert.equal(notification?.type, "tool-call");
  if (notification?.type !== "tool-call") {
    throw new Error("Expected the background_output notification");
  }
  assert.equal(notification.toolCall.kind, "tool");
  assert.equal(notification.toolCall.status, "completed");
  assert.equal(linkedSubagent?.type, "tool-call");
  if (linkedSubagent?.type !== "tool-call") {
    throw new Error("Expected the linked subagent result");
  }
  assert.equal(linkedSubagent.toolCall.kind, "subagent");
  assert.equal(linkedSubagent.toolCall.status, "completed");
  assert.match(linkedSubagent.toolCall.output ?? "", /LINKED_RESULT/);
});

test("OpenCode pending background_output does not close the linked subagent early", () => {
  const sessionId = "session-opencode-background-output-pending";
  const launchId = "call-opencode-pending-launch";
  const taskId = "bg-opencode-pending";
  const launch = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: launchId,
            kind: "tool",
            title: "task",
            status: "running",
            rawInput: {
              description: "Return the delayed result",
              prompt: "Return DELAYED_RESULT",
              category: "quick",
              run_in_background: true,
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );
  assert.equal(launch?.events[0]?.type, "tool-call");

  const pending = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-pending-background-output",
            kind: "tool",
            title: "background_output",
            status: "running",
            rawInput: { task_id: taskId },
            rawOutput: {
              output: "Background task is still running. Status: pending",
              metadata: { backgroundTaskId: taskId },
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );
  const pendingCalls = pending?.events.filter((event) => event.type === "tool-call") ?? [];
  assert.equal(pendingCalls.length, 1);
  assert.equal(pendingCalls[0]?.type === "tool-call" ? pendingCalls[0].toolCall.kind : undefined, "tool");
  assert.equal(pendingCalls[0]?.type === "tool-call" ? pendingCalls[0].toolCall.status : undefined, "completed");

  const result = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-terminal-background-output",
            kind: "tool",
            title: "background_output",
            status: "running",
            rawInput: { task_id: taskId },
            rawOutput: {
              output: "Task Result\\n\\nDELAYED_RESULT",
              metadata: {
                taskId,
                sessionId: "ses-opencode-pending",
                backgroundTaskId: taskId,
              },
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );
  const linkedSubagent = result?.events.find((event) =>
    event.type === "tool-call" && event.toolCall.id === launchId,
  );
  assert.equal(linkedSubagent?.type, "tool-call");
  if (linkedSubagent?.type !== "tool-call") {
    throw new Error("Expected the delayed subagent result");
  }
  assert.equal(linkedSubagent.toolCall.kind, "subagent");
  assert.equal(linkedSubagent.toolCall.status, "completed");
  assert.match(linkedSubagent.toolCall.output ?? "", /DELAYED_RESULT/);
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
            status: "completed",
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
  const toolEvent = mapped?.events[0];
  if (toolEvent?.type !== "tool-call") {
    throw new Error("Expected todo tool-call event");
  }
  assert.equal(toolEvent.toolCall.status, "completed");
  const planEvent = mapped?.events[1];
  if (planEvent?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(planEvent.plan.entries, [
    { content: "Adapter projection", priority: "medium", status: "completed" },
  ]);
});

test("OpenCode completed TodoWrite updates finish the tool before the next write", () => {
  const provider = {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const updates = [
    {
      toolCallId: "call-todo-1",
      title: "1 todos",
      status: "in_progress",
      rawInput: {
        todos: [{ content: "第一步", status: "in_progress", priority: "high" }],
      },
    },
    {
      toolCallId: "call-todo-1",
      title: "1 todos",
      status: "completed",
      rawOutput: {
        output: "[]",
        metadata: {
          todos: [{ content: "第一步", status: "in_progress", priority: "high" }],
        },
      },
    },
    {
      toolCallId: "call-todo-2",
      title: "1 todos",
      status: "in_progress",
      rawInput: {
        todos: [{ content: "第一步", status: "completed", priority: "high" }],
      },
    },
    {
      toolCallId: "call-todo-2",
      title: "1 todos",
      status: "completed",
      rawOutput: {
        output: "[]",
        metadata: {
          todos: [{ content: "第一步", status: "completed", priority: "high" }],
        },
      },
    },
  ] as const;

  const lifecycle = updates.map((update) => {
    const mapped = mapSessionUpdateNotificationBatch(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-opencode-sequential-todos",
          update: {
            sessionUpdate: "tool_call_update",
            ...update,
          },
        },
      },
      { provider },
    );

    assert.deepEqual(mapped?.events.map((event) => event.type), ["tool-call", "plan-update"]);
    const toolEvent = mapped?.events[0];
    if (toolEvent?.type !== "tool-call") {
      throw new Error("Expected TodoWrite tool-call event");
    }
    return [toolEvent.toolCall.id, toolEvent.toolCall.status];
  });

  assert.deepEqual(lifecycle, [
    ["call-todo-1", "running"],
    ["call-todo-1", "completed"],
    ["call-todo-2", "running"],
    ["call-todo-2", "completed"],
  ]);
});

test("OpenCode todo snapshots respect explicit and initial running states", () => {
  for (const update of [
    {
      sessionUpdate: "tool_call",
      toolCall: {
        id: "call-opencode-plan-initial",
        tool: "todowrite",
        state: {
          input: {
            todos: [{ content: "Initial snapshot", status: "in_progress" }],
          },
        },
      },
    },
    {
      sessionUpdate: "tool_call_update",
      toolCall: {
        id: "call-opencode-plan-running",
        tool: "todowrite",
        status: "running",
        state: {
          input: {
            todos: [{ content: "Running snapshot", status: "in_progress" }],
          },
        },
      },
    },
  ]) {
    const mapped = mapSessionUpdateNotificationBatch(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "session-opencode-plan-running",
          update,
        },
      },
      { providerId: "opencode" },
    );

    assert.equal(mapped?.events[0]?.type, "tool-call");
    if (mapped?.events[0]?.type !== "tool-call") {
      throw new Error("Expected todo tool-call event");
    }
    assert.equal(mapped.events[0].toolCall.status, "running");
  }
});

test("OpenCode Todo does not infer completion from a statusless update", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-plan-statusless",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-opencode-plan-statusless",
            tool: "todowrite",
            state: {
              input: {
                todos: [{ content: "Statusless snapshot", status: "completed" }],
              },
            },
          },
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.equal(mapped?.events[0]?.type, "tool-call");
  if (mapped?.events[0]?.type !== "tool-call") {
    throw new Error("Expected todo tool-call event");
  }
  assert.equal(mapped.events[0].toolCall.status, "running");
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
test("non-Claude adapters ignore Claude subagent origin metadata", () => {
  const providers = [
    {
      id: "codex",
      name: "Codex",
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    {
      id: "opencode",
      name: "OpenCode",
      command: "opencode-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    {
      id: "generic",
      name: "Generic ACP",
      command: "generic-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
  ];

  for (const provider of providers) {
    const mapped = mapSessionUpdateNotificationBatch(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: `session-${provider.id}-claude-origin-metadata`,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: `call-${provider.id}-read`,
            title: "Read",
            kind: "read",
            status: "pending",
            _meta: {
              claudeCode: {
                parentToolUseId: "call-parent-subagent",
              },
            },
          },
        },
      },
      { provider, providerId: provider.id },
    );

    const event = mapped?.events[0];
    assert.equal(event?.type, "tool-call");
    assert.equal(event?.type === "tool-call" ? event.origin : undefined, undefined);
  }
});

test("tracker backfills OpenCode child tool-call origin from the root subagent commandId", () => {
  const provider = {
    id: "opencode",
    name: "OpenCode",
    command: "opencode-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const tracker = createRuntimeEventOriginTracker();
  const launch = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-opencode-subagent-children",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-opencode-root",
        title: "explore - research",
        kind: "subagent",
        status: "completed",
        commandId: "subagent:ses_child_1",
      },
    },
  }, { provider, providerId: provider.id, originTracker: tracker });
  assert.equal(launch?.events[0]?.type, "tool-call");
  assert.equal(
    launch?.events[0]?.type === "tool-call" ? launch.events[0].origin : undefined,
    undefined,
  );

  const child = mapSessionUpdateNotificationBatch({
    method: "session/update",
    params: {
      sessionId: "session-opencode-subagent-children",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-opencode-child-read",
        title: "Read",
        kind: "read",
        status: "completed",
        commandId: "subagent:ses_child_1",
      },
    },
  }, { provider, providerId: provider.id, originTracker: tracker });
  const childEvent = child?.events[0];
  assert.equal(childEvent?.type, "tool-call");
  assert.deepEqual(
    childEvent?.type === "tool-call" ? childEvent.origin : undefined,
    { scope: "subagent", parentToolCallId: "call-opencode-root" },
  );
});
