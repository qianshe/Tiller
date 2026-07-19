import assert from "node:assert/strict";
import test from "node:test";
import {
  appendToolCallToSessionTimeline,
  type AgentToolCall,
  type SessionTimelineEntry,
} from "@tiller/shared";
import {
  createClaudeToolCallNormalizer,
  normalizeClaudeToolCall,
} from "./tool-calls.js";

function baseToolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: "claude_tool_test",
    kind: "tool",
    title: "Task",
    status: "running",
    timestamp: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizeClaudeToolCall classifies task payloads with subagent_type as subagent", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({ input: JSON.stringify({ prompt: "Inspect timeline" }) }),
    {
      toolCall: {
        rawInput: {
          prompt: "Inspect timeline",
          subagent_type: "Explore",
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
});

test("normalizeClaudeToolCall upgrades MCP payloads from raw input", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      title: "mcp__mcp_router__find_symbol",
      input: "{}",
    }),
    {
      toolCall: {
        rawInput: {
          server: "mcp_router",
          tool: "find_symbol",
          arguments: { relative_path: "packages/shared/src/session-timeline.ts" },
        },
      },
    },
  );

  assert.equal(normalized.kind, "mcp");
  assert.equal(normalized.title, "Tool: mcp_router/find_symbol");
});

test("normalizeClaudeToolCall derives Claude shell titles from raw input", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      kind: "shell",
      title: "Tool call call_shell",
      status: "completed",
      input: "{}",
    }),
    {
      rawInput: {
        command: "node -e \"setTimeout(()=>console.log('waited'),3000)\"",
      },
    },
  );

  assert.equal(normalized.kind, "shell");
  assert.equal(
    normalized.title,
    "node -e \"setTimeout(()=>console.log('waited'),3000)\"",
  );
});

test("normalizeClaudeToolCall waits for a complete shell command before using it as the title", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      kind: "shell",
      title: "Tool call call_shell",
      input: "{}",
    }),
    {
      rawInput: {
        command: "pnpm --filter @tiller/de",
      },
    },
  );

  assert.equal(normalized.kind, "shell");
  assert.equal(normalized.title, "Shell");
});

test("normalizeClaudeToolCall keeps a streaming structured search title stable", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      kind: "search",
      title: "Grep",
      input: JSON.stringify({ pattern: "normalizeClaude" }),
    }),
    {},
  );

  assert.equal(normalized.kind, "search");
  assert.equal(normalized.title, "Search");
});

test("Claude lifecycle normalization preserves a running shell command on completion", () => {
  const command = "node -e \"console.log('shell-title')\"";
  const normalizer = createClaudeToolCallNormalizer(() => ({
    name: "Bash",
    input: { command },
  }));
  const sessionId = "claude-shell-session";

  const running = normalizer.normalize(baseToolCall({
    id: "shell-call",
    kind: "shell",
    title: "Tool call shell-call",
  }), {}, sessionId, "D:/repo");
  const completed = normalizer.normalize(baseToolCall({
    id: "shell-call",
    kind: "shell",
    title: "Bash",
    status: "completed",
    output: "shell-title",
  }), {}, sessionId, "D:/repo");

  assert.equal(running?.title, "Shell");
  assert.equal(completed?.title, command);
  assert.equal(completed?.input, JSON.stringify({ command }));
  assert.equal(completed?.status, "completed");
});

test("Claude lifecycle normalization restores native search names from transcript", () => {
  const input = { path: "D:/repo", pattern: "**/*.ts" };
  const normalizer = createClaudeToolCallNormalizer(() => ({
    name: "Glob",
    input,
  }));
  const sessionId = "claude-search-session";

  const running = normalizer.normalize(baseToolCall({
    id: "search-call",
    kind: "search",
    title: "Search",
    input: JSON.stringify(input),
  }), {}, sessionId, "D:/repo");
  const completed = normalizer.normalize(baseToolCall({
    id: "search-call",
    kind: "search",
    title: "Search",
    status: "completed",
    output: "apps/deck/src/features/logbook/tool-title.ts",
  }), {}, sessionId, "D:/repo");

  assert.equal(running?.kind, "search");
  assert.equal(running?.title, "Search");
  assert.equal(completed?.kind, "search");
  assert.equal(completed?.title, "Glob");
  assert.equal(completed?.input, JSON.stringify(input));
});

test("normalizeClaudeToolCall derives the skill title from structured input", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      kind: "skill",
      title: "Skill",
      input: JSON.stringify({ skill: "superpowers:verification-before-completion" }),
    }),
    {},
  );

  assert.equal(normalized.kind, "skill");
  assert.equal(normalized.title, "Skill: superpowers:verification-before-completion");
});

test("normalizeClaudeToolCall classifies completed background-agent launches from output", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      id: "toolu_background_agent",
      title: "Tool call toolu_back…",
      status: "completed",
      output: JSON.stringify([{
        type: "text",
        text: "Async agent launched successfully.\nagentId: internal-agent\noutput_file: C:\\Temp\\agent.output",
      }]),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Subagent");
  assert.equal(normalized.commandId, "subagent:internal-agent");
  assert.equal(normalized.status, "running");
  assert.equal("output" in normalized, false);
});

test("normalizeClaudeToolCall links completed foreground tasks to later lifecycle calls", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      id: "toolu_foreground_agent",
      title: "Claude lifecycle debug",
      status: "completed",
      input: JSON.stringify({
        description: "Claude lifecycle debug",
        prompt: "Return the lifecycle marker",
        subagent_type: "general-purpose",
      }),
      output: [
        "CLAUDE_CHILD_LIFECYCLE_OK",
        "agentId: internal-agent (use SendMessage to continue this agent)",
      ].join("\n"),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.commandId, "subagent:internal-agent");
});

test("normalizeClaudeToolCall treats SendMessage as the same subagent lifecycle", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      id: "toolu_send_message",
      title: "SendMessage",
      status: "completed",
      input: JSON.stringify({
        to: "internal-agent",
        message: "Continue and return the marker",
      }),
      output: JSON.stringify({ success: true }),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Subagent");
  assert.equal(normalized.commandId, "subagent:internal-agent");
  assert.equal(normalized.status, "running");
  assert.equal("input" in normalized, false);
  assert.equal("output" in normalized, false);
});

test("normalizeClaudeToolCall classifies TaskOutput before its result arrives", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      id: "toolu_task_output_running",
      title: "TaskOutput",
      status: "running",
      input: JSON.stringify({
        task_id: "internal-agent",
        block: true,
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Subagent");
  assert.equal(normalized.commandId, "subagent:internal-agent");
  assert.equal(normalized.status, "running");
  assert.equal("input" in normalized, false);
});

test("normalizeClaudeToolCall classifies completed TaskOutput results from output", () => {
  const normalized = normalizeClaudeToolCall(
    baseToolCall({
      id: "toolu_task_output",
      title: "TaskOutput",
      status: "completed",
      input: "{}",
      output: [
        "<task_id>internal-agent</task_id>",
        "<task_type>local_agent</task_type>",
        "<status>completed</status>",
        "<output>subagent reply</output>",
      ].join("\n"),
    }),
    { output: "[]" },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Subagent");
  assert.equal(normalized.commandId, "subagent:internal-agent");
  assert.equal(normalized.output, "subagent reply");
});

test("Claude lifecycle normalization keeps one background subagent entity through SendMessage and TaskOutput", () => {
  const normalizer = createClaudeToolCallNormalizer();
  const entries: SessionTimelineEntry[] = [];
  const sessionId = "claude-session";
  const append = (toolCall: AgentToolCall, update: unknown = {}) => {
    const normalized = normalizer.normalize(toolCall, update, sessionId);
    if (normalized) {
      appendToolCallToSessionTimeline(entries, normalized);
    }
  };

  append(baseToolCall({
    id: "task-call",
    title: "Claude merged lifecycle",
    status: "completed",
    input: JSON.stringify({
      description: "Claude merged lifecycle",
      prompt: "Return the marker",
      run_in_background: true,
      subagent_type: "general-purpose",
    }),
    output: "Async agent launched successfully.\nagentId: internal-agent",
  }));
  append(baseToolCall({
    id: "send-call",
    title: "SendMessage",
    status: "completed",
    input: "{}",
    output: "[]",
  }));
  append(baseToolCall({
    id: "send-call",
    title: "SendMessage",
    status: "completed",
    input: JSON.stringify({ to: "internal-agent", message: "Continue" }),
    output: JSON.stringify({ success: true }),
  }));
  append(baseToolCall({
    id: "task-call",
    title: "Tool call task-call",
    status: "completed",
    output: "background launch metadata",
  }));
  append(baseToolCall({
    id: "output-call",
    title: "TaskOutput",
    status: "completed",
    input: "{}",
    output: "[]",
  }));
  append(baseToolCall({
    id: "output-call",
    title: "TaskOutput",
    status: "completed",
    input: JSON.stringify({ task_id: "internal-agent", block: true }),
    output: [
      "<task_id>internal-agent</task_id>",
      "<task_type>local_agent</task_type>",
      "<status>completed</status>",
      "<output>CLAUDE_MERGED_CHILD_OK</output>",
    ].join("\n"),
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.kind, "tool_call");
  if (entries[0]?.kind !== "tool_call") {
    return;
  }
  assert.equal(entries[0].toolCall.id, "task-call");
  assert.equal(entries[0].toolCall.title, "Claude merged lifecycle");
  assert.equal(entries[0].toolCall.status, "completed");
  assert.match(entries[0].toolCall.output ?? "", /CLAUDE_MERGED_CHILD_OK/);
});

test("Claude lifecycle normalization keeps concurrent subagents as separate launch entities", () => {
  const normalizer = createClaudeToolCallNormalizer();
  const entries: SessionTimelineEntry[] = [];
  const sessionId = "claude-concurrent-session";
  const append = (toolCall: AgentToolCall) => {
    const normalized = normalizer.normalize(toolCall, {}, sessionId);
    if (normalized) {
      appendToolCallToSessionTimeline(entries, normalized);
    }
  };

  append(baseToolCall({
    id: "task-a",
    title: "Inspect adapter A",
    status: "completed",
    input: JSON.stringify({
      description: "Inspect adapter A",
      prompt: "Inspect A",
      run_in_background: true,
      subagent_type: "general-purpose",
    }),
    output: "Async agent launched successfully.\nagentId: agent-a",
  }));
  append(baseToolCall({
    id: "task-b",
    title: "Inspect adapter B",
    status: "completed",
    input: JSON.stringify({
      description: "Inspect adapter B",
      prompt: "Inspect B",
      run_in_background: true,
      subagent_type: "general-purpose",
    }),
    output: "Async agent launched successfully.\nagentId: agent-b",
  }));
  append(baseToolCall({
    id: "output-a",
    title: "TaskOutput",
    status: "completed",
    input: JSON.stringify({ task_id: "agent-a", block: true }),
    output: "<task_id>agent-a</task_id><output>RESULT_A</output>",
  }));
  append(baseToolCall({
    id: "output-b",
    title: "TaskOutput",
    status: "completed",
    input: JSON.stringify({ task_id: "agent-b", block: true }),
    output: "<task_id>agent-b</task_id><output>RESULT_B</output>",
  }));

  assert.equal(entries.length, 2);
  const toolCalls = entries.flatMap((entry) =>
    entry.kind === "tool_call" ? [entry.toolCall] : []
  );
  assert.deepEqual(
    toolCalls.map((toolCall) => ({
      id: toolCall.id,
      title: toolCall.title,
      output: toolCall.output,
    })),
    [
      { id: "task-a", title: "Inspect adapter A", output: "RESULT_A" },
      { id: "task-b", title: "Inspect adapter B", output: "RESULT_B" },
    ],
  );
});

test("Claude lifecycle normalization defers weak placeholders and reuses the launched subagent id", () => {
  const normalizer = createClaudeToolCallNormalizer();
  const sessionId = "claude-placeholder-session";

  assert.equal(normalizer.normalize(baseToolCall({
    id: "task-call",
    title: "Tool call task-call",
    input: "{}",
    output: "[]",
  }), {}, sessionId), null);

  const rawLaunch = normalizer.normalize(baseToolCall({
    id: "raw-task-call",
    title: "Tool call raw-task-call",
    input: "{}",
    output: "[]",
  }), {
    rawInput: {
      description: "Claude raw launch",
      prompt: "Return marker",
      run_in_background: true,
      subagent_type: "general-purpose",
    },
  }, sessionId);
  assert.equal(rawLaunch?.kind, "subagent");
  assert.equal(rawLaunch?.status, "running");
  assert.equal(rawLaunch?.title, "Claude raw launch");

  const rawLaunchCompleted = normalizer.normalize(baseToolCall({
    id: "raw-task-call",
    title: "Tool call raw-task-call",
    status: "completed",
    output: "Subagent completed. agentId: raw-internal-agent",
  }), {}, sessionId);
  assert.equal(
    rawLaunchCompleted?.commandId,
    "subagent:raw-internal-agent",
  );
  assert.equal(rawLaunchCompleted?.title, "Claude raw launch");
  assert.equal(rawLaunchCompleted?.status, "completed");

  const launched = normalizer.normalize(baseToolCall({
    id: "task-call",
    title: "Claude placeholder lifecycle",
    input: JSON.stringify({
      prompt: "Return marker",
      run_in_background: true,
      subagent_type: "general-purpose",
    }),
    output: "Async agent launched successfully.\nagentId: internal-agent",
  }), {}, sessionId);
  assert.equal(launched?.id, "task-call");
  assert.equal(launched?.kind, "subagent");
  assert.equal(launched?.status, "running");

  assert.equal(normalizer.normalize(baseToolCall({
    id: "output-call",
    title: "TaskOutput",
    input: "{}",
    output: "[]",
  }), {}, sessionId), null);

  const completed = normalizer.normalize(baseToolCall({
    id: "output-call",
    title: "TaskOutput",
    status: "completed",
    input: JSON.stringify({ task_id: "internal-agent", block: true }),
    output: "<task_id>internal-agent</task_id><output>DONE</output>",
  }), {}, sessionId);
  assert.equal(completed?.id, "task-call");
  assert.equal(completed?.title, "Claude placeholder lifecycle");
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output, "DONE");

  const completedFollowUp = normalizer.normalize(baseToolCall({
    id: "output-call",
    title: "Tool call output-call",
    status: "completed",
    output: "completion metadata",
  }), {}, sessionId);
  assert.equal(completedFollowUp?.id, "task-call");
});
