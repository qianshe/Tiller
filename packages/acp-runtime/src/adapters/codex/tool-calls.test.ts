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
  assert.equal(normalized.commandId, undefined);
  assert.equal(normalized.status, "running");
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
  assert.equal(normalized.commandId, "subagent:inspect_tools");
  assert.equal(normalized.status, "running");
});

test("normalizeCodexToolCall keeps a spawned agent running under a stable task identity", () => {
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
  assert.equal(normalized.commandId, "subagent:Cicero");
  assert.equal(normalized.status, "running");
});

test("normalizeCodexToolCall joins wait_agent completion to its spawned agent", () => {
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
  assert.equal(normalized.commandId, "subagent:Cicero");
  assert.equal(normalized.status, "completed");
});
