import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { normalizeLegacyPersistedAgentToolCall } from "./normalize";

test("normalizeLegacyPersistedAgentToolCall upgrades structured MCP payloads with explicit metadata", () => {
  const normalized = normalizeLegacyPersistedAgentToolCall({
    id: "tool-mcp-structured",
    kind: "tool",
    title: "Tool call toolu_str…",
    status: "completed",
    input: JSON.stringify({
      server_name: "mcp_router",
      request: { name: "find_symbol" },
      arguments: { relative_path: "apps/deck/src/features/server-events/session-events.ts" },
    }),
    timestamp: "2026-07-07T12:00:00.000Z",
    updatedAt: "2026-07-07T12:00:01.000Z",
  } satisfies AgentToolCall);

  assert.deepEqual(normalized?.mcp, {
    serverName: "mcp_router",
    toolName: "find_symbol",
    source: "structured-input",
  });
  assert.equal(normalized?.kind, "mcp");
  assert.equal(normalized?.title, "Tool: mcp_router/find_symbol");
});

test("normalizeLegacyPersistedAgentToolCall upgrades title-only MCP history with canonical names", () => {
  const normalized = normalizeLegacyPersistedAgentToolCall({
    id: "tool-mcp-title-only",
    kind: "search",
    title: "mcpServers_search_context",
    status: "completed",
    input: JSON.stringify({
      project_root_path: "D:/myProject/tools/Tiller",
      query: "session creation flow",
    }),
    timestamp: "2026-07-07T12:00:00.000Z",
    updatedAt: "2026-07-07T12:00:01.000Z",
  } satisfies AgentToolCall);

  assert.deepEqual(normalized?.mcp, {
    toolName: "search_context",
    source: "provider-title",
    rawTitle: "mcpServers_search_context",
  });
  assert.equal(normalized?.kind, "mcp");
  assert.equal(normalized?.title, "Tool: search_context");
});
