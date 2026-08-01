import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotification } from "../../events";

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
  assert.equal(mapped.event.toolCall.title, "Subagent");
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
  assert.equal(mapped.event.toolCall.title, "Subagent");
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
  assert.equal(mapped.event.toolCall.title, "Subagent");
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
    assert.equal(mapped.event.toolCall.title, "Subagent");
  }
});

test("mapSessionUpdateNotification classifies Codex subAgentActivity updates without reviving completed interactions", () => {
  const provider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const sessionId = "session-codex-subagent-activity";
  const mapActivity = (
    id: string,
    activityKind: "started" | "interacted" | "interrupted",
    status: "in_progress" | "completed",
  ) => mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: activityKind === "started" ? "tool_call" : "tool_call_update",
          toolCallId: id,
          title: `${activityKind} subagent weather_research`,
          status,
          rawInput: {
            agentThreadId: "thread-weather",
            agentPath: "/root/weather_research",
            activityKind,
          },
        },
      },
    },
    { provider, providerId: provider.id },
  );

  const started = mapActivity("activity-start", "started", "in_progress");
  assert.equal(started?.event.type, "tool-call");
  if (started?.event.type !== "tool-call") {
    throw new Error("Expected subAgentActivity start tool-call event");
  }
  assert.equal(started.event.toolCall.kind, "subagent");
  assert.equal(started.event.toolCall.status, "running");
  assert.equal(started.event.toolCall.commandId, "subagent:thread-weather");
  assert.equal(started.event.toolCall.subagentOperation?.action, "spawn");

  const interacted = mapActivity("activity-interacted", "interacted", "completed");
  assert.equal(interacted?.event.type, "tool-call");
  if (interacted?.event.type !== "tool-call") {
    throw new Error("Expected subAgentActivity interaction tool-call event");
  }
  assert.equal(interacted.event.toolCall.kind, "subagent");
  assert.equal(interacted.event.toolCall.status, "completed");
  assert.equal(interacted.event.toolCall.commandId, "subagent:thread-weather");

  const interrupted = mapActivity("activity-interrupted", "interrupted", "completed");
  assert.equal(interrupted?.event.type, "tool-call");
  if (interrupted?.event.type !== "tool-call") {
    throw new Error("Expected subAgentActivity interruption tool-call event");
  }
  assert.equal(interrupted.event.toolCall.kind, "subagent");
  assert.equal(interrupted.event.toolCall.status, "completed");
  assert.equal(interrupted.event.toolCall.subagentOperation?.action, "close");
});

test("mapSessionUpdateNotification restores Codex subAgentActivity from metadata-only replay", () => {
  const provider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
  const mapped = mapSessionUpdateNotification(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-codex-subagent-metadata",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "activity-interacted",
          title: "Interact with subagent weather_research",
          status: "completed",
          _meta: {
            codex: {
              subagent: {
                threadId: "thread-weather",
                path: "/root/weather_research",
                activity: "interacted",
              },
            },
          },
        },
      },
    },
    { provider, providerId: provider.id },
  );

  assert.equal(mapped?.event.type, "tool-call");
  if (mapped?.event.type !== "tool-call") {
    throw new Error("Expected metadata-only subAgentActivity tool-call event");
  }
  assert.equal(mapped.event.toolCall.kind, "subagent");
  assert.equal(mapped.event.toolCall.status, "completed");
  assert.equal(mapped.event.toolCall.commandId, "subagent:thread-weather");
  assert.equal(mapped.event.toolCall.title, "Subagent");
  assert.equal(mapped.event.toolCall.subagentOperation, undefined);
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
