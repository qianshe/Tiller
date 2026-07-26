import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { normalizeCodexToolCall } from "./tool-calls.js";

function baseToolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: "call_codex_test",
    kind: "tool",
    title: "call_codex_test",
    status: "running",
    timestamp: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizeCodexToolCall classifies wrapped MCP payloads from update metadata", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({ input: "{}" }),
    {
      sessionUpdate: "tool_call",
      rawInput: {
        namespace: "mcp__mcp_router",
        name: "find_symbol",
        arguments: { relative_path: "packages/shared/src/session-timeline.ts" },
      },
    },
  );

  assert.equal(normalized.kind, "mcp");
  assert.equal(normalized.title, "Tool: mcp_router/find_symbol");
  assert.deepEqual(normalized.mcp, {
    serverName: "mcp_router",
    toolName: "find_symbol",
    source: "structured-tool-name",
    rawTitle: "mcp__mcp_router.find_symbol",
  });
});

test("normalizeCodexToolCall classifies wrapped multi-agent payloads from update metadata", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      id: "call_codextest",
      title: "call_codextest",
    }),
    {
      sessionUpdate: "tool_call",
      rawInput: {
        namespace: "multi_agent_v1",
        name: "spawn_agent",
        arguments: {
          message: "Inspect tool normalization",
          fork_context: true,
        },
      },
    },
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "spawn_agent");
  assert.equal(normalized.commandId, "call_codextest");
  assert.equal(normalized.status, "running");
  assert.deepEqual(normalized.subagentOperation, {
    action: "spawn",
    targets: [{ id: "call_codextest" }],
  });
});

test("normalizeCodexToolCall waits for a complete web query before using it as the title", () => {
  const running = normalizeCodexToolCall(
    baseToolCall({ title: "web.run" }),
    {
      rawInput: {
        namespace: "web",
        name: "run",
        arguments: { query: "latest TypeScr" },
      },
    },
  );
  const completed = normalizeCodexToolCall(
    baseToolCall({ title: "web.run", status: "completed" }),
    {
      rawInput: {
        namespace: "web",
        name: "run",
        arguments: { query: "latest TypeScript release" },
      },
    },
  );

  assert.equal(running.kind, "fetch");
  assert.equal(running.title, "Searching the Web");
  assert.equal(completed.title, "Searching for: latest TypeScript release");
});

test("normalizeCodexToolCall keeps a streaming shell command out of the title", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall(),
    {
      rawInput: {
        command: "pnpm --filter @tiller/de",
      },
    },
  );

  assert.equal(normalized.kind, "shell");
  assert.equal(normalized.title, "Shell");
});

test("normalizeCodexToolCall derives Codex write titles from ACP diff content", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      kind: "write",
      title: "Editing files",
      status: "completed",
    }),
    {
      sessionUpdate: "tool_call",
      content: [
        {
          type: "diff",
          path: "D:\\repo\\apps\\deck\\src\\first.tsx",
          oldText: "old",
          newText: "new",
        },
        {
          type: "diff",
          path: "D:\\repo\\packages\\shared\\src\\second.ts",
          oldText: null,
          newText: "new",
        },
      ],
    },
  );

  assert.equal(normalized.kind, "write");
  assert.equal(normalized.title, "apps\\deck\\src\\first.tsx (+1 more)");
});

test("normalizeCodexToolCall derives legacy Codex write titles from rawInput changes", () => {
  const input = JSON.stringify({
    call_id: "call-write",
    changes: {
      "apps/deck/src/example.tsx": {
        type: "update",
        unified_diff: "@@ -1 +1 @@",
      },
    },
  });
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      kind: "write",
      title: "Editing files",
      input,
    }),
    {},
  );

  assert.equal(normalized.title, "apps/deck/src/example.tsx");
  assert.equal(normalized.input, input);
});

test("normalizeCodexToolCall does not treat unrelated changes as a write", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({ title: "Update settings" }),
    {
      rawInput: {
        changes: {
          theme: { from: "light", to: "dark" },
        },
      },
    },
  );

  assert.equal(normalized.kind, "tool");
  assert.equal(normalized.title, "Update settings");
});

test("normalizeCodexToolCall prioritizes Codex skill commands over an incidental MCP descriptor", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      title: "call_codex_skill",
      input: "{}",
    }),
    {
      rawInput: {
        namespace: "mcp__workspace",
        name: "exec_command",
        arguments: {
          command: "Get-Content C:\\Users\\agent\\.codex\\skills\\review\\SKILL.md",
        },
      },
    },
  );

  assert.equal(normalized.kind, "skill");
  assert.equal(normalized.title, "Skill: review");
});

test("normalizeCodexToolCall summarizes completed Codex skill payloads from output metadata", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      title: "Tool call call_skill…",
      status: "completed",
      output: JSON.stringify({
        command: [
          "pwsh.exe",
          "-Command",
          "Get-Content 'C:\\Users\\agent\\.codex\\plugins\\cache\\openai-curated\\superpowers\\hash\\skills\\using-superpowers\\SKILL.md'",
        ],
        stdout: "very long skill instructions that should not become a timeline payload",
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "skill");
  assert.equal(normalized.title, "Skill: superpowers:using-superpowers");
  assert.equal("input" in normalized, false);
  assert.equal("output" in normalized, false);
});

test("normalizeCodexToolCall classifies completed MCP payloads from output metadata", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      title: "Tool call call_mcp…",
      status: "completed",
      output: JSON.stringify({
        namespace: "mcp__mcp_router",
        name: "find_symbol",
        arguments: { name_path: "normalizeCodexToolCall" },
        aggregated_output: "symbol details",
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "mcp");
  assert.equal(normalized.title, "Tool: mcp_router/find_symbol");
});

test("normalizeCodexToolCall classifies completed multi-agent payloads from output metadata", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      title: "Tool call call_agent…",
      status: "completed",
      output: JSON.stringify({
        namespace: "multi_agent_v1",
        name: "spawn_agent",
        arguments: {
          task_name: "inspect_tools",
          message: "Inspect tool normalization",
          fork_context: true,
        },
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Subagent: inspect_tools");
  assert.equal(normalized.commandId, normalized.id);
  assert.equal(normalized.status, "completed");
  assert.deepEqual(normalized.subagentOperation, {
    action: "spawn",
    targets: [{ id: "inspect_tools", label: "inspect_tools" }],
  });
});

test("normalizeCodexToolCall keeps a completed spawn as a completed operation", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      title: "Tool call call_spawn…",
      status: "completed",
      output: JSON.stringify({
        namespace: "multi_agent_v1",
        name: "spawn_agent",
        arguments: { task_name: "Cicero", message: "Reply once" },
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Subagent: Cicero");
  assert.equal(normalized.commandId, normalized.id);
  assert.equal(normalized.status, "completed");
  assert.deepEqual(normalized.subagentOperation, {
    action: "spawn",
    targets: [{ id: "Cicero", label: "Cicero" }],
  });
});

test("normalizeCodexToolCall keeps wait_agent as an independent operation", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      title: "Tool call call_wait…",
      status: "completed",
      output: JSON.stringify({
        namespace: "multi_agent_v1",
        name: "wait_agent",
        arguments: { target: "Cicero" },
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.title, "Subagent: Cicero");
  assert.equal(normalized.commandId, normalized.id);
  assert.equal(normalized.status, "completed");
  assert.deepEqual(normalized.subagentOperation, {
    action: "wait",
    targets: [{ id: "Cicero", label: "Cicero" }],
  });
});

test("normalizeCodexToolCall keeps close_agent completion distinct from cancellation", () => {
  const normalized = normalizeCodexToolCall(
    baseToolCall({
      title: "Tool call call_close…",
      status: "completed",
      output: JSON.stringify({
        namespace: "multi_agent_v1",
        name: "close_agent",
        arguments: { target: "Cicero" },
        previous_status: { completed: "done" },
      }),
    }),
    {},
  );

  assert.equal(normalized.kind, "subagent");
  assert.equal(normalized.commandId, normalized.id);
  assert.equal(normalized.status, "completed");
  assert.deepEqual(normalized.subagentOperation, {
    action: "close",
    targets: [{ id: "Cicero", label: "Cicero" }],
  });
});
