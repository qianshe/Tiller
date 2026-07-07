import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAgentToolCallMcpName,
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  resolveStructuredToolName,
} from "./tool-call-mcp";

test("resolveStructuredToolName keeps namespaced MCP tool names from structured payloads", () => {
  assert.equal(
    resolveStructuredToolName({
      server_name: "mcp_router",
      request: { name: "find_symbol" },
      arguments: { relative_path: "apps/deck/src/features/server-events/session-events.ts" },
    }),
    "mcp_router/find_symbol",
  );
});

test("resolveStructuredToolName infers node_repl MCP tools from payload shape", () => {
  assert.equal(
    resolveStructuredToolName({
      code: "await nodeRepl.write('ok')",
      timeout_ms: 30_000,
    }),
    "node_repl/js",
  );
});

test("resolveAgentToolCallMcp derives canonical MCP metadata from provider titles", () => {
  const claudeTool = resolveAgentToolCallMcp({
    rawTitle: "mcp__mcp-router__codebase_search",
  });
  const openCodeTool = resolveAgentToolCallMcp({
    rawTitle: "mcp-router_search_for_pattern: tool_call|toolCall|tool_name|toolName",
  });
  const claudeTitleOnlyTool = resolveAgentToolCallMcp({
    rawTitle: "mcpServers_search_context",
  });

  assert.deepEqual(claudeTool, {
    serverName: "mcp_router",
    toolName: "codebase_search",
    source: "provider-title",
    rawTitle: "mcp__mcp-router__codebase_search",
  });
  assert.deepEqual(openCodeTool, {
    serverName: "mcp_router",
    toolName: "search_for_pattern",
    source: "provider-title",
    rawTitle: "mcp-router_search_for_pattern: tool_call|toolCall|tool_name|toolName",
  });
  assert.deepEqual(claudeTitleOnlyTool, {
    toolName: "search_context",
    source: "provider-title",
    rawTitle: "mcpServers_search_context",
  });
});

test("resolveAgentToolCallMcp keeps qualified titles stable without raw-title noise", () => {
  const mcp = resolveAgentToolCallMcp({
    title: "Tool: sanshu/zhi",
  });

  assert.deepEqual(mcp, {
    serverName: "sanshu",
    toolName: "zhi",
    source: "qualified-title",
  });
  assert.equal(formatAgentToolCallMcpName(mcp!), "sanshu/zhi");
  assert.equal(formatAgentToolCallMcpTitle(mcp!), "Tool: sanshu/zhi");
});
