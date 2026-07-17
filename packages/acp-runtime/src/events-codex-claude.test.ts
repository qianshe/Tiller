import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotificationBatch } from "./runtime";
import { mapSessionUpdateNotification } from "./events";

test("mapSessionUpdateNotification classifies Claude Task tool with subagent_type as subagent", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-task-tool",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-task-tool",
          toolName: "Task",
          title: "Task",
          status: "in_progress",
          rawInput: { prompt: "Inspect session flow", subagent_type: "Explore" },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Task");
});

test("mapSessionUpdateNotification classifies Claude ACP Task tool with provider config as subagent", () => {
  const provider = {
    id: "claude-acp",
    name: "Claude Agent",
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-acp-task-tool",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-claude-acp-task-tool",
          toolName: "Task",
          title: "Task",
          status: "in_progress",
          rawInput: { prompt: "Inspect session flow", subagent_type: "Explore" },
        },
      },
    },
    { provider, providerId: provider.id },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Task");
});

test("mapSessionUpdateNotification classifies Claude ACP history repair tool calls from provider id", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-acp-history-task-tool",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-acp-history-task-tool",
            kind: "tool",
            title: "Task",
            input: JSON.stringify({ prompt: "Inspect session flow" }),
            status: "completed",
            timestamp: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:01.000Z",
          },
          rawInput: { prompt: "Inspect session flow", subagent_type: "Explore" },
        },
      },
    },
    { providerId: "claude-acp" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Task");
});

test("mapSessionUpdateNotification classifies Claude Agent tool as subagent", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-agent",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-agent",
          title: "Agent",
          status: "in_progress",
          rawInput: {
            prompt: "Find all API endpoints",
            description: "Find API endpoints",
            subagent_type: "Explore",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "Agent");
});

test("mapSessionUpdateNotification keeps Claude TaskOutput timeouts running until explicit result", () => {
  const sessionId = "session-claude-task-output-lifecycle";
  mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-task-output-wait",
            kind: "tool",
            title: "TaskOutput",
            status: "completed",
            input: JSON.stringify({ task_id: "child-timeout", block: true }),
            output: "<task_id>child-timeout</task_id>\n<status>running</status>\nTimed out waiting for output",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );
  const completed = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-task-output-result",
            kind: "tool",
            title: "TaskOutput",
            status: "completed",
            input: JSON.stringify({ task_id: "child-timeout", block: true }),
            output: "<task_id>child-timeout</task_id>\n<status>completed</status>\n<output>done</output>",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );
  const waiting = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: `${sessionId}-wait-only`,
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-task-output-wait-only",
            kind: "tool",
            title: "TaskOutput",
            status: "completed",
            input: JSON.stringify({ task_id: "child-timeout", block: true }),
            output: "<task_id>child-timeout</task_id>\n<status>running</status>\n<output>Still running</output>",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(waiting?.event.type, "tool-call");
  assert.equal(
    waiting?.event.type === "tool-call" ? waiting.event.toolCall.status : undefined,
    "running",
  );
  assert.equal(completed?.event.type, "tool-call");
  assert.equal(
    completed?.event.type === "tool-call" ? completed.event.toolCall.status : undefined,
    "completed",
  );
});

test("mapSessionUpdateNotificationBatch preserves Claude task tools before derived plans", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const sessionId = "session-claude-task-plan-live";

  const created = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "toolu_task_1",
          toolName: "TaskCreate",
          status: "in_progress",
          rawInput: { subject: "恢复实时 Claude plan" },
        },
      },
    },
    { provider, providerId: "claudecode" },
  );
  assert.deepEqual(created?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const createdPlan = created?.events[1];
  if (createdPlan?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(createdPlan.plan.entries, [
    { content: "恢复实时 Claude plan", priority: "medium", status: "pending" },
  ]);

  const createdOutput = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "toolu_task_1",
          rawOutput: "Task #1 created successfully: 恢复实时 Claude plan",
        },
      },
    },
    { provider, providerId: "claudecode" },
  );
  assert.deepEqual(createdOutput?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const createdOutputPlan = createdOutput?.events[1];
  if (createdOutputPlan?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(createdOutputPlan.plan.entries, [
    { content: "恢复实时 Claude plan", priority: "medium", status: "pending" },
  ]);

  const updated = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "toolu_update_1",
          toolName: "TaskUpdate",
          status: "completed",
          rawInput: { taskId: "1", status: "in_progress" },
        },
      },
    },
    { provider, providerId: "claudecode" },
  );
  assert.deepEqual(updated?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const updatedPlan = updated?.events[1];
  if (updatedPlan?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event");
  }
  assert.deepEqual(updatedPlan.plan.entries, [
    { content: "恢复实时 Claude plan", priority: "medium", status: "in_progress" },
  ]);
});

test("mapSessionUpdateNotificationBatch preserves Claude TodoWrite before the derived plan", () => {
  const provider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const sessionId = "session-claude-todowrite-plan";

  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "toolu_todo_1",
          title: "TodoWrite",
          status: "completed",
          rawInput: {
            todos: [
              { content: "Fix plan display", status: "in_progress", activeForm: "Fixing plan display" },
              { content: "Run tests", status: "pending", activeForm: "Running tests" },
            ],
          },
        },
      },
    },
    { provider, providerId: "claudecode" },
  );

  assert.deepEqual(mapped?.events.map((event) => event.type), ["tool-call", "plan-update"]);
  const planEvent = mapped?.events[1];
  if (planEvent?.type !== "plan-update") {
    throw new Error("Expected derived plan-update event from TodoWrite");
  }
  assert.equal(planEvent.plan.entries.length, 2);
  assert.deepEqual(planEvent.plan.entries, [
    { content: "Fix plan display", priority: "medium", status: "in_progress" },
    { content: "Run tests", priority: "medium", status: "pending" },
  ]);
});

test("mapSessionUpdateNotification classifies Codex spawned agents in the Codex adapter", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-subagent",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-subagent",
          toolName: "spawn_agents_on_csv",
          title: "spawn_agents_on_csv",
          status: "in_progress",
          rawInput: { path: "input.csv" },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "spawn_agents_on_csv");
});

test("mapSessionUpdateNotification classifies Codex multi_agent_v1 spawn_agent calls as subagents", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-subagent-v1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCall: {
            id: "call-codex-subagent-v1",
            kind: "tool",
            title: "spawn_agent",
            status: "in_progress",
            input: JSON.stringify({
              fork_context: true,
              message: "只修改 docs/tooling/subagent-todolist-demo.md",
            }),
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "spawn_agent");
});

test("mapSessionUpdateNotification classifies wrapped Codex multi-agent calls with opaque titles", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-subagent-wrapped",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-subagent-wrapped",
          title: "call-codex-subagent-wrapped",
          status: "in_progress",
          rawInput: {
            namespace: "multi_agent_v1",
            name: "spawn_agent",
            arguments: {
              message: "Inspect the session timeline",
              fork_context: true,
            },
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.title, "spawn_agent");
});

test("mapSessionUpdateNotification classifies all wrapped Codex multi-agent actions", () => {
  const actions = [
    "send_message",
    "followup_task",
    "wait_agent",
    "interrupt_agent",
    "list_agents",
    "resume_agent",
  ];

  for (const action of actions) {
    const mapped = mapSessionUpdateNotification(
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: `session-codex-${action}`,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: `call-codex-${action}`,
            title: `call-codex-${action}`,
            status: "in_progress",
            rawInput: {
              namespace: "multi_agent_v1",
              name: action,
              arguments: { agent_id: "agent-1" },
            },
          },
        },
      },
      { providerId: "codex" },
    );

    assert.equal(mapped?.event.type, "tool-call");
    if (mapped?.event.type !== "tool-call") {
      throw new Error("Expected tool-call event");
    }
    assert.equal(mapped.event.toolCall.kind, "subagent");
    assert.equal(mapped.event.toolCall.title, action);
  }
});

test("mapSessionUpdateNotification classifies wrapped Codex MCP calls from namespace and name", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-mcp-wrapped",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-mcp-wrapped",
          title: "call-codex-mcp-wrapped",
          status: "in_progress",
          rawInput: {
            namespace: "mcp__mcp_router",
            name: "find_symbol",
            arguments: { relative_path: "packages/shared/src/session-timeline.ts" },
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/find_symbol");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "mcp_router",
    toolName: "find_symbol",
    source: "structured-tool-name",
    rawTitle: "mcp__mcp_router.find_symbol",
  });
});

test("mapSessionUpdateNotification classifies wrapped Codex web calls as fetch", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-web-wrapped",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-web-wrapped",
          title: "call-codex-web-wrapped",
          status: "completed",
          rawInput: {
            namespace: "web",
            name: "run",
            arguments: { query: "Agent Client Protocol" },
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "fetch");
  assert.equal(mapped.event.toolCall.title, "Searching for: Agent Client Protocol");
});

test("mapSessionUpdateNotification classifies wrapped Codex skill shell calls as skills", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-skill-wrapped",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-skill-wrapped",
          title: "call-codex-skill-wrapped",
          status: "completed",
          rawInput: {
            name: "shell_command",
            arguments: {
              command: "Get-Content C:/Users/qjq/.codex/skills/frontend-design/SKILL.md",
            },
          },
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "skill");
  assert.equal(mapped.event.toolCall.title, "Skill: frontend-design");
});

test("mapSessionUpdateNotification classifies Codex shell command arrays as shell", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-shell-array",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-shell-array",
          title: "rg -n \"typecheck\" AGENTS.md",
          status: "completed",
          input: JSON.stringify({
            command: [
              "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\\pwsh.exe",
              "-Command",
              "rg -n \"typecheck\" AGENTS.md",
            ],
            parsed_cmd: [{ type: "unknown", cmd: "rg -n \"typecheck\" AGENTS.md" }],
          }),
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification keeps Codex web search placeholders as fetch", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-web-search-placeholder",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "ws-placeholder",
          kind: "fetch",
          title: "Searching the Web",
          status: "running",
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "fetch");
  assert.equal(mapped.event.toolCall.title, "Searching the Web");
});

test("mapSessionUpdateNotification classifies Codex skill file shell reads as skill", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-skill-shell",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-skill-shell",
          title: "Get-Content 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/d6169bef/skills/using-superpowers/SKILL.md' -TotalCount 220",
          status: "completed",
          input: JSON.stringify({
            command: [
              "C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.3.0_x64__8wekyb3d8bbwe\\pwsh.exe",
              "-Command",
              "Get-Content 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/d6169bef/skills/using-superpowers/SKILL.md' -TotalCount 220",
            ],
            parsed_cmd: [{
              type: "unknown",
              cmd: "Get-Content 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/d6169bef/skills/using-superpowers/SKILL.md' -TotalCount 220",
            }],
          }),
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "skill");
  assert.equal(
    mapped.event.toolCall.title,
    "Skill: superpowers:using-superpowers",
  );
});

test("mapSessionUpdateNotification classifies Codex command arrays as shell before filename write heuristics", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-shell-path",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-codex-shell-path",
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
        },
      },
    },
    { providerId: "codex" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification keeps Claude Bash grep commands as shell", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-shell-search",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-shell-search",
            kind: "shell",
            title: "echo \"=== form.tsx mobile variants ===\"; grep -nE 'isMobile|py-1' apps/deck/src/features/mission/composer/form.tsx 2>/dev/null | head -30",
            status: "completed",
            input: "{\"command\":\"echo \\\"=== form.tsx mobile variants ===\\\"; grep -nE 'isMobile|py-1' apps/deck/src/features/mission/composer/form.tsx 2>/dev/null | head -30\",\"description\":\"检查实现内容是否存在\"}",
            timestamp: "2026-07-07T00:34:41.000Z",
            updatedAt: "2026-07-07T00:34:41.000Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification repairs Claude non-search shell history that was previously mislabeled as search", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-history-shell",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-history-shell",
            kind: "search",
            title: "cd /d/myProject/tools/Tiller && pnpm --filter @tiller/deck lint 2>&1 | tail -15",
            status: "completed",
            input: "{}{\"command\":\"cd /d/myProject/tools/Tiller && pnpm --filter @tiller/deck lint 2>&1 | tail -15\"}",
            timestamp: "2026-07-07T00:34:41.000Z",
            updatedAt: "2026-07-07T00:34:41.000Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "shell");
});

test("mapSessionUpdateNotification repairs Claude Grep payloads that were mislabeled as shell", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-history-grep",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-history-grep",
            kind: "shell",
            title: "{\"pattern\":\"Tiller\",\"glob\":\"**/README.md\",\"output_mode\":\"files_with_matches\"}",
            status: "completed",
            input: "{\"pattern\":\"Tiller\",\"glob\":\"**/README.md\",\"output_mode\":\"files_with_matches\"}",
            timestamp: "2026-07-07T16:07:01.000Z",
            updatedAt: "2026-07-07T16:07:02.000Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
});

test("mapSessionUpdateNotification classifies shell-labeled Find payloads with structured patterns as search", () => {
  const mapped = mapSessionUpdateNotification({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-structured-find-search",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-structured-find-search",
        kind: "shell",
        title: "Find `**/AGENTS.md`",
        rawInput: {
          pattern: "**/AGENTS.md",
        },
        status: "completed",
        timestamp: "2026-07-07T14:42:00.952Z",
        updatedAt: "2026-07-07T14:42:02.458Z",
      },
    },
  });

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
  assert.equal(mapped.event.toolCall.title, "Find `**/AGENTS.md`");
});

test("mapSessionUpdateNotification classifies Claude native Grep command titles as search when input is structured search payload", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-native-grep",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-native-grep",
            kind: "shell",
            title: "grep -l \"tool-call-repair\"",
            status: "completed",
            input: "{\"output_mode\":\"files_with_matches\",\"pattern\":\"tool-call-repair\"}",
            timestamp: "2026-07-07T09:10:38.372Z",
            updatedAt: "2026-07-07T09:10:39.092Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "search");
});

test("mapSessionUpdateNotification classifies Claude mcp__ prefixed tools as mcp", () => {
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-claude-mcp-search",
        update: {
          type: "tool_call_update",
          toolCall: {
            id: "call-claude-mcp-search",
            kind: "search",
            title: "mcp__mcp-router__codebase_search",
            status: "completed",
            input: "{\"repo_path\":\"D:\\\\myProject\\\\tools\\\\Tiller\",\"search_string\":\"会话历史恢复后如何重新导入工具调用元数据\"}",
            timestamp: "2026-07-07T09:08:58.265Z",
            updatedAt: "2026-07-07T09:09:36.321Z",
          },
        },
      },
    },
    { providerId: "claudecode" },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "mcp");
  assert.equal(mapped.event.toolCall.title, "Tool: mcp_router/codebase_search");
  assert.deepEqual(mapped.event.toolCall.mcp, {
    serverName: "mcp_router",
    toolName: "codebase_search",
    source: "provider-title",
    rawTitle: "mcp__mcp-router__codebase_search",
  });
});
