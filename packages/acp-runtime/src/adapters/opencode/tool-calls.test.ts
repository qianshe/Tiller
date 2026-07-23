import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { normalizeOpenCodeToolCall } from "./tool-calls.js";

function baseToolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: "opencode_tool_test",
    kind: "tool",
    title: "Task",
    status: "running",
    timestamp: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizeOpenCodeToolCall classifies live task payloads as subagents", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall(),
    {
      toolCall: {
        rawInput: {
          prompt: "Inspect timeline",
          category: "analysis",
          run_in_background: true,
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
});

test("normalizeOpenCodeToolCall assigns completed subagent results to their task identity", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({
      title: "Task",
      status: "completed",
      output: JSON.stringify({
        output: "Task completed in 1s.",
        metadata: {
          taskId: "task-42",
          sessionId: "task-42",
          description: "Inspect timeline",
          agent: "Sisyphus-Junior",
        },
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.commandId, "subagent:task-42");
  assert.equal(normalized.title, "Inspect timeline");
});

test("normalizeOpenCodeToolCall classifies live skill payloads before output arrives", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({
      kind: "write",
      title: "skill",
      input: JSON.stringify({
        name: "superpowers:verification-before-completion",
        user_message: "Only load the skill instructions.",
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "skill");
  assert.equal(
    normalized.title,
    "Skill: superpowers:verification-before-completion",
  );
  assert.equal("input" in normalized, false);
});

test("normalizeOpenCodeToolCall classifies structured built-ins and derives useful titles", () => {
  const todo = normalizeOpenCodeToolCall(
    baseToolCall({
      kind: "write",
      title: "todowrite",
      status: "completed",
      input: JSON.stringify({
        todos: [
          { content: "Inspect adapter", status: "in_progress" },
          { content: "Verify UI", status: "pending" },
        ],
      }),
    }),
    {},
  );
  const search = normalizeOpenCodeToolCall(
    baseToolCall({
      kind: "write",
      title: "Tool call call_search",
      status: "completed",
      input: JSON.stringify({ pattern: "normalizeOpenCodeToolCall" }),
    }),
    {},
  );
  const diagnostics = normalizeOpenCodeToolCall(
    baseToolCall({
      kind: "write",
      title: "lsp_diagnostics",
      status: "completed",
      input: JSON.stringify({
        filePath: "D:/repo/packages/acp-runtime/src/events.ts",
      }),
    }),
    {},
  );

  assert.equal(todo.kind, "todo");
  assert.equal(todo.title, "Update 2 todos");
  assert.equal(search.kind, "search");
  assert.equal(search.title, "Search: normalizeOpenCodeToolCall");
  assert.equal(diagnostics.kind, "diagnostics");
  assert.equal(diagnostics.title, "Diagnostics: packages/acp-runtime/src/events.ts");
});

test("normalizeOpenCodeToolCall uses the requested URL as the web fetch title", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({
      kind: "fetch",
      title: "webfetch",
      status: "completed",
      input: JSON.stringify({
        url: "https://jsonplaceholder.typicode.com/todos/1",
        format: "text",
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "fetch");
  assert.equal(normalized.title, "https://jsonplaceholder.typicode.com/todos/1");
});

test("normalizeOpenCodeToolCall recognizes todowrite from the OpenCode tool field", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ kind: "write", title: "0 todos" }),
    {
      toolCall: {
        tool: "todowrite",
        title: "0 todos",
      },
    },
  );

  assert.equal(normalized.kind, "todo");
  assert.equal(normalized.title, "Update todos");
});

test("normalizeOpenCodeToolCall preserves full shell commands as canonical titles", () => {
  const command = [
    "pnpm --filter @tiller/acp-runtime test",
    "-- --test-name-pattern",
    '"normalizes a deliberately long shell command without losing its arguments"',
  ].join(" ");
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ kind: "shell", title: "Shell", status: "completed" }),
    { toolCall: { tool: "bash", input: { command } } },
  );

  assert.equal(normalized.kind, "shell");
  assert.equal(normalized.title, command);
});

test("normalizeOpenCodeToolCall keeps input-derived titles stable until input streaming ends", () => {
  const cases: Array<{
    title: string;
    input: Record<string, unknown>;
    expectedKind: AgentToolCall["kind"];
    expectedTitle: string;
  }> = [
    {
      title: "todowrite",
      input: { todos: [{ content: "Inspect", status: "pending" }] },
      expectedKind: "todo",
      expectedTitle: "Update todos",
    },
    {
      title: "lsp_diagnostics",
      input: { filePath: "D:/repo/packages/acp-runtime/src/events.ts" },
      expectedKind: "diagnostics",
      expectedTitle: "Diagnostics",
    },
    {
      title: "bash",
      input: { command: "pnpm --filter @tiller/acp-runtime" },
      expectedKind: "shell",
      expectedTitle: "Shell",
    },
    {
      title: "webfetch",
      input: { url: "https://jsonplaceholder.typicode.c" },
      expectedKind: "fetch",
      expectedTitle: "Fetch",
    },
    {
      title: "ast_grep_search",
      input: { pattern: "normalizeOpenCode" },
      expectedKind: "search",
      expectedTitle: "Search",
    },
    {
      title: "read",
      input: { filePath: "packages/acp-runtime/src/even" },
      expectedKind: "read",
      expectedTitle: "Read",
    },
    {
      title: "edit",
      input: {
        filePath: "packages/acp-runtime/src/even",
        old_string: "before",
        new_string: "after",
      },
      expectedKind: "write",
      expectedTitle: "Write",
    },
  ];

  for (const entry of cases) {
    const normalized = normalizeOpenCodeToolCall(
      baseToolCall({
        kind: "tool",
        title: entry.title,
        input: JSON.stringify(entry.input),
      }),
      {},
    );

    assert.equal(normalized.kind, entry.expectedKind, entry.title);
    assert.equal(normalized.title, entry.expectedTitle, entry.title);
  }
});

test("normalizeOpenCodeToolCall upgrades MCP payloads from raw input", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({
      title: "call_opencode_mcp",
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

test("normalizeOpenCodeToolCall summarizes skill outputs without retaining full instructions", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({
      title: "Tool call call_skill…",
      status: "completed",
      output: JSON.stringify({
        output: "## Skill: debugging-strategies\n\nLong skill instructions",
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "skill");
  assert.equal(normalized.title, "Skill: debugging-strategies");
  assert.equal("output" in normalized, false);
});
