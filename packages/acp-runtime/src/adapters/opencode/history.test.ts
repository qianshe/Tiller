import assert from "node:assert/strict";
import test from "node:test";
import { loadAdapterAuthoritativeHistory } from "../index.js";
import { parseOpenCodeExportHistory, parseOpenCodeSqliteHistory } from "./history.js";

test("parseOpenCodeExportHistory maps message and tool timestamps from OpenCode export", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-user",
          info: { role: "user", time: { created: 1777543137952 } },
          parts: [{ type: "text", text: "尝试调用个mcp或者skill，我测试下效果" }],
        },
        {
          id: "msg-assistant",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            { type: "text", text: "我来调用工具" },
            {
              id: "prt-tool",
              type: "tool",
              tool: "mcp-router_get_current_config",
              callID: "call-1",
              state: {
                status: "completed",
                input: {},
                output: "ok",
                title: "",
                time: { start: 1777543150384, end: 1777543150482 },
              },
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user",
      role: "user",
      text: "尝试调用个mcp或者skill，我测试下效果",
      timestamp: "2026-04-30T09:58:57.952Z",
    },
    {
      id: "msg-assistant",
      role: "assistant",
      text: "我来调用工具",
      timestamp: "2026-04-30T09:58:57.977Z",
    },
  ]);
  assert.deepEqual(history.toolCalls, [
    {
      id: "call-1",
      commandId: "call-1",
      kind: "mcp",
      title: "mcp-router_get_current_config",
      status: "completed",
      input: "{}",
      output: "ok",
      timestamp: "2026-04-30T09:59:10.384Z",
      updatedAt: "2026-04-30T09:59:10.482Z",
    },
  ]);
});

test("parseOpenCodeSqliteHistory maps message and text parts from OpenCode sqlite rows", () => {
  const history = parseOpenCodeSqliteHistory(
    [
      {
        id: "msg-user",
        time_created: 1777543137952,
        data: JSON.stringify({ role: "user", time: { created: 1777543137952 } }),
      },
      {
        id: "msg-assistant",
        time_created: 1777543137977,
        data: JSON.stringify({ role: "assistant", time: { created: 1777543137977 } }),
      },
    ],
    [
      {
        id: "prt-user",
        message_id: "msg-user",
        time_created: 1777543137952,
        time_updated: 1777543137952,
        data: JSON.stringify({ type: "text", text: "你好" }),
      },
      {
        id: "prt-assistant",
        message_id: "msg-assistant",
        time_created: 1777543137977,
        time_updated: 1777543137977,
        data: JSON.stringify({ type: "text", text: "你好，主人喵~" }),
      },
    ],
  );

  assert.deepEqual(history, {
    messages: [
      {
        id: "msg-user",
        role: "user",
        text: "你好",
        timestamp: "2026-04-30T09:58:57.952Z",
      },
      {
        id: "msg-assistant",
        role: "assistant",
        text: "你好，主人喵~",
        timestamp: "2026-04-30T09:58:57.977Z",
      },
    ],
    toolCalls: [],
  });
});

test("parseOpenCodeExportHistory classifies OpenCode read/write/search and MCP tools", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-assistant-tools",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            {
              type: "tool",
              tool: "read",
              callID: "call-read",
              state: {
                status: "completed",
                input: { filePath: "apps/deck/src/features/logbook/message-history.ts" },
                title: "apps\\deck\\src\\features\\logbook\\message-history.ts",
                time: { start: 1777543150384, end: 1777543150482 },
              },
            },
            {
              type: "tool",
              tool: "write",
              callID: "call-write",
              state: {
                status: "completed",
                input: { filePath: "docs/bug/BUG-004.md" },
                title: "docs\\bug\\BUG-004.md",
                time: { start: 1777543150484, end: 1777543150582 },
              },
            },
            {
              type: "tool",
              tool: "mcpServers_search_context",
              callID: "call-mcp",
              state: {
                status: "completed",
                input: { query: "Where is logbook rendered?" },
                title: "mcpServers_search_context",
                time: { start: 1777543150584, end: 1777543150682 },
              },
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(
    history.toolCalls.map((tool) => [tool.id, tool.kind, tool.title]),
    [
      ["call-read", "read", "apps\\deck\\src\\features\\logbook\\message-history.ts"],
      ["call-write", "write", "docs\\bug\\BUG-004.md"],
      ["call-mcp", "mcp", "mcpServers_search_context"],
    ],
  );
});

test("loadAdapterAuthoritativeHistory returns null for providers without native export", async () => {
  assert.equal(
    await loadAdapterAuthoritativeHistory(
      { id: "codex", name: "Codex", command: "codex-acp", transport: "stdio", protocol: "acp" },
      "runtime-1",
      "D:/repo",
    ),
    null,
  );
  assert.equal(
    await loadAdapterAuthoritativeHistory(
      { id: "custom", name: "Custom", command: "custom-acp", transport: "stdio", protocol: "acp" },
      "runtime-1",
      "D:/repo",
    ),
    null,
  );
});
