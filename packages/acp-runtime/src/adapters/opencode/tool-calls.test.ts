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
    baseToolCall({ title: "task" }),
    {
      toolCall: {
        rawInput: {
          description: "Inspect timeline",
          prompt: "Inspect timeline",
          subagent_type: "Sisyphus-Junior",
          run_in_background: true,
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Sisyphus-Junior");
});

test("normalizeOpenCodeToolCall uses category-only task titles", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ title: "task" }),
    {
      toolCall: {
        rawInput: {
          description: "Inspect the repository",
          prompt: "Inspect the repository",
          category: "oracle",
          run_in_background: false,
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "oracle");
});

test("normalizeOpenCodeToolCall preserves a category temporarily used as the task title", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ title: "unspecified-low" }),
    {
      toolCall: {
        rawInput: {
          category: "unspecified-low",
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "unspecified-low");
});

test("normalizeOpenCodeToolCall prefers category over requested subagent categories", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ title: "task" }),
    {
      toolCall: {
        rawInput: {
          prompt: "Inspect the repository",
          requested_subagent_type: "explore",
          category: "unspecified-low",
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "unspecified-low");
});

test("normalizeOpenCodeToolCall reads a dynamic agent from task output text", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ title: "task", status: "completed" }),
    {
      rawOutput: {
        output: [
          "Task Result",
          "Agent: prometheus (category: analysis)",
          "",
          "PROMETHEUS_OK",
          "<task_metadata>",
          "subagent: prometheus",
          "task_id: task-prometheus",
          "</task_metadata>",
          "to continue: task(task_id=\"task-prometheus\")",
        ].join("\n"),
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "prometheus");
  assert.equal(normalized.output, "PROMETHEUS_OK");
});

test("normalizeOpenCodeToolCall skips an empty rawInput frame when live input has the agent type", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ title: "task", input: "{}" }),
    {
      toolCall: {
        rawInput: {},
        input: {
          description: "Inspect the running subagent",
          prompt: "Inspect the running subagent",
          subagent_type: "Sisyphus-Junior",
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Sisyphus-Junior");
  assert.match(normalized.input ?? "", /"subagent_type":"Sisyphus-Junior"/);
});

test("normalizeOpenCodeToolCall merges sparse input frames with result metadata", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ title: "task", input: "{}" }),
    {
      toolCall: {
        rawInput: {},
        input: {
          category: "quick",
          prompt: "Inspect the running subagent",
        },
      },
      rawOutput: {
        metadata: {
          taskId: "task-sparse-42",
          model: {
            modelID: "deepseek-v4-flash",
            variant: "low",
          },
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "quick");
  assert.deepEqual(JSON.parse(normalized.input ?? "{}"), {
    taskId: "task-sparse-42",
    category: "quick",
    prompt: "Inspect the running subagent",
    model: {
      modelID: "deepseek-v4-flash",
      variant: "low",
    },
  });
});

test("normalizeOpenCodeToolCall upgrades running tasks from nested agent fields", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ title: "task", input: "{}" }),
    {
      toolCall: {
        rawInput: {
          state: {
            data: {
              prompt: "Inspect the running subagent",
              agentType: "Sisyphus-Junior",
            },
          },
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Sisyphus-Junior");
});

test("normalizeOpenCodeToolCall reads nested agent metadata before completion", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({ title: "task", status: "running" }),
    {
      rawOutput: {
        state: {
          data: {
            metadata: {
              agent_type: "Sisyphus-Junior",
            },
          },
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Sisyphus-Junior");
  assert.equal(normalized.status, "running");
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
  assert.equal(normalized.title, "Sisyphus-Junior");
  assert.equal(normalized.output, undefined);
});

test("normalizeOpenCodeToolCall enriches running subagents from OpenCode result metadata", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({
      title: "task",
      status: "running",
    }),
    {
      rawOutput: {
        output: "Task is still running.",
        metadata: {
          taskId: "task-running-42",
          sessionId: "session-running-42",
          agent: "Sisyphus-Junior",
          requested_subagent_type: "sisyphus-junior",
          model: {
            providerID: "cpa-claude",
            modelID: "deepseek-v4-flash",
            variant: "low",
          },
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.status, "running");
  assert.equal(normalized.title, "Sisyphus-Junior");
  assert.equal(normalized.output, undefined);
  assert.deepEqual((JSON.parse(normalized.input ?? "{}") as { model?: unknown }).model, {
    providerID: "cpa-claude",
    modelID: "deepseek-v4-flash",
    variant: "low",
  });
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

test("normalizeOpenCodeToolCall unwraps nested ACP content when subagent metadata is streamed", () => {
  const normalized = normalizeOpenCodeToolCall(
    baseToolCall({
      title: "Task",
      status: "completed",
    }),
    {
      toolCall: {
        id: "call-opencode-content-subagent",
        kind: "tool",
        title: "Task",
      },
      status: "completed",
      rawInput: {
        description: "Inspect the OpenCode adapter",
        prompt: "Return a short report",
        category: "explore",
        run_in_background: false,
      },
      rawOutput: [
        {
          type: "content",
          content: {
            type: "text",
            text: [
              "Task Result",
              "<task_metadata>",
              "session_id: ses_opencode_content",
              "task_id: ses_opencode_content",
              "subagent: explore",
              "</task_metadata>",
              "to continue: task(task_id=\"ses_opencode_content\")",
            ].join("\n"),
          },
        },
      ],
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "explore");
  assert.equal(normalized.commandId, "subagent:ses_opencode_content");
  assert.match(normalized.input ?? "", /Return a short report/);
});
