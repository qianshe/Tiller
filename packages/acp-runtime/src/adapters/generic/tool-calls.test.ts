import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { normalizeGenericToolCall } from "./tool-calls.js";

function baseToolCall(overrides: Partial<AgentToolCall> = {}): AgentToolCall {
  return {
    id: "generic_tool_test",
    kind: "mcp",
    title: "Tool: mcp_router/get_diagnostics_for_file",
    status: "completed",
    timestamp: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizeGenericToolCall keeps MCP diagnostics under the MCP category", () => {
  const normalized = normalizeGenericToolCall(baseToolCall({
    mcp: {
      serverName: "mcp_router",
      toolName: "get_diagnostics_for_file",
      source: "structured-input",
    },
    input: JSON.stringify({
      server: "mcp_router",
      tool: "get_diagnostics_for_file",
      arguments: { relative_path: "packages/acp-runtime/src/tool-events.ts" },
    }),
  }));

  assert.equal(normalized.kind, "mcp");
  assert.equal(normalized.title, "Tool: mcp_router/get_diagnostics_for_file");
  assert.equal(normalized.mcp?.toolName, "get_diagnostics_for_file");
});
