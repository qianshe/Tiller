import assert from "node:assert/strict";
import test from "node:test";
import type { AcpRuntimeProviderConfig, AgentToolCall } from "@tiller/shared";
import {
  disposeAdapterSession,
  mapAdapterToolCallUpdate,
  normalizeAdapterToolCall,
  resolveAcpAgentAdapter,
} from "./index.js";

function provider(id: string): AcpRuntimeProviderConfig {
  return {
    id,
    name: id,
    command: `${id}-acp`,
    transport: "stdio",
    protocol: "acp",
  };
}

function toolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: "tool-1",
    kind: "tool",
    title: "opaque-tool-call",
    status: "running",
    timestamp: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

test("generic adapter enriches unknown provider MCP tool calls", () => {
  const normalized = normalizeAdapterToolCall(provider("third-party"), "third-party", {
    toolCall: toolCall({ input: JSON.stringify({ toolName: "mcp_router/find_symbol" }) }),
    update: {},
  });

  assert.ok(normalized);
  assert.equal(normalized.kind, "mcp");
  assert.deepEqual(normalized.mcp, {
    serverName: "mcp_router",
    toolName: "find_symbol",
    source: "structured-tool-name",
    rawTitle: "opaque-tool-call",
  });
});

test("provider-specific tool-call semantics survive the generic fallback", () => {
  const normalized = normalizeAdapterToolCall(provider("codex"), "codex", {
    toolCall: toolCall({ id: "call-codex" }),
    update: {
      sessionUpdate: "tool_call",
      rawInput: {
        namespace: "multi_agent_v1",
        name: "spawn_agent",
        arguments: { message: "Inspect tool normalization" },
      },
    },
  });

  assert.ok(normalized);
  assert.equal(normalized.kind, "subagent");
});

test("Claude adapter defers weak tool placeholders until their category is known", () => {
  const normalized = normalizeAdapterToolCall(provider("claude"), "claude", {
    sessionId: "claude-placeholder",
    toolCall: toolCall({
      id: "call-placeholder",
      title: "Tool call call-placeholder",
      input: "{}",
      output: "[]",
    }),
    update: {},
  });

  assert.equal(normalized, null);
});

test("provider adapters expose category hooks instead of a global notification interceptor", () => {
  const adapter = resolveAcpAgentAdapter(provider("codex"));

  assert.equal("mapSessionUpdate" in adapter, false);
  assert.equal(typeof adapter.mapMessageUpdate, "function");
  assert.equal(typeof adapter.mapToolCallUpdate, "function");
});

test("disposing an adapter session releases provider-owned projection state", () => {
  const claude = provider("claude");
  const sessionId = "adapter-dispose-session";
  const created = mapAdapterToolCallUpdate(claude, {
    sessionId,
    updateType: "tool_call",
    text: null,
    update: {
      toolCallId: "task-call-1",
      toolName: "TaskCreate",
      rawInput: { subject: "Release adapter state" },
    },
  });
  assert.equal(created && "type" in created ? created.type : null, "plan-update");

  disposeAdapterSession(claude, sessionId);

  const staleUpdate = mapAdapterToolCallUpdate(claude, {
    sessionId,
    updateType: "tool_call_update",
    text: null,
    update: {
      toolCallId: "task-call-1",
      rawOutput: "Task #1 created successfully: Release adapter state",
    },
  });
  assert.equal(staleUpdate, null);
});
