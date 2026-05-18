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

test("parseOpenCodeExportHistory replaces enhanced OpenCode user wrapper with original prompt", () => {
  const originalPrompt = "调查这个 bug 的根因，给出触发路径。";
  const enhancedPrompt = [
    "IF COMPLEX - DO NOT STRUGGLE ALONE.",
    "",
    "# Task",
    "",
    originalPrompt,
    "",
    "# Acceptance Criteria",
    "",
    "- 给出修复建议。",
  ].join("\n");

  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-user-enhanced",
          info: { role: "user", time: { created: 1777543137952 } },
          parts: [
            { type: "text", text: enhancedPrompt },
            { type: "text", text: originalPrompt },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user-enhanced",
      role: "user",
      text: originalPrompt,
      timestamp: "2026-04-30T09:58:57.952Z",
    },
  ]);
});

test("parseOpenCodeExportHistory preserves normal user text parts when no wrapper contains another part", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-user-normal-parts",
          info: { role: "user", time: { created: 1777543137952 } },
          parts: [
            { type: "text", text: "第一段" },
            { type: "text", text: "第二段" },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user-normal-parts",
      role: "user",
      text: "第一段第二段",
      timestamp: "2026-04-30T09:58:57.952Z",
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

test("parseOpenCodeSqliteHistory replaces enhanced OpenCode user wrapper with original prompt", () => {
  const originalPrompt = "帮我解决这个问题，这个应该在插件中解决还是在通用里解决呢？";
  const enhancedPrompt = [
    "You are operating inside OpenCode.",
    "",
    "# User Request",
    "",
    originalPrompt,
    "",
    "# Runtime Notes",
    "",
    "Prefer concise answers.",
  ].join("\n");

  const history = parseOpenCodeSqliteHistory(
    [
      {
        id: "msg-user-enhanced",
        time_created: 1777543137952,
        data: JSON.stringify({ role: "user", time: { created: 1777543137952 } }),
      },
    ],
    [
      {
        id: "prt-enhanced",
        message_id: "msg-user-enhanced",
        time_created: 1777543137952,
        time_updated: 1777543137952,
        data: JSON.stringify({ type: "text", text: enhancedPrompt }),
      },
      {
        id: "prt-original",
        message_id: "msg-user-enhanced",
        time_created: 1777543137953,
        time_updated: 1777543137953,
        data: JSON.stringify({ type: "text", text: originalPrompt }),
      },
    ],
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user-enhanced",
      role: "user",
      text: originalPrompt,
      timestamp: "2026-04-30T09:58:57.952Z",
    },
  ]);
  assert.deepEqual(history.toolCalls, []);
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

test("parseOpenCodeExportHistory keeps single OpenCode analyze wrapper and extracts reasoning", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-user-wrapper",
          info: { role: "user", time: { created: 1777543137952 } },
          parts: [
            {
              type: "text",
              text: [
                "[analyze-mode]",
                "ANALYSIS MODE. Gather context before diving deep:",
                "---",
                "MANDATORY delegate_task params: ALWAYS include load_skills",
                "",
                "---",
                "",
                "你是什么模型？并且分析一下还有没有plan需要执行的",
              ].join("\n"),
            },
          ],
        },
        {
          id: "msg-assistant-reasoning",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            {
              id: "prt-reasoning",
              type: "reasoning",
              text: "Let me inspect the plan files.",
              time: { start: 1777543138000, end: 1777543139000 },
            },
            { type: "text", text: "没有 plan 需要执行。" },
          ],
        },
      ],
    }),
  );

  assert.match(history.messages[0]?.text ?? "", /^\[analyze-mode\]/u);
  assert.match(history.messages[0]?.text ?? "", /你是什么模型？并且分析一下还有没有plan需要执行的/u);
  assert.deepEqual(history.toolCalls, [
    {
      id: "prt-reasoning",
      commandId: "prt-reasoning",
      kind: "think",
      title: "Thinking",
      status: "completed",
      output: "Let me inspect the plan files.",
      timestamp: "2026-04-30T09:58:58.000Z",
      updatedAt: "2026-04-30T09:58:59.000Z",
    },
  ]);
});

test("parseOpenCodeExportHistory keeps OpenCode reasoning scoped to each assistant message", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-a",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            {
              id: "reason-a",
              sessionID: "ses-1",
              type: "reasoning",
              text: "first thought",
              time: { start: 1777543138000, end: 1777543139000 },
            },
            {
              id: "reason-a2",
              sessionID: "ses-1",
              type: "reasoning",
              text: "first follow-up",
              time: { start: 1777543139500, end: 1777543139900 },
            },
          ],
        },
        {
          id: "msg-b",
          info: { role: "assistant", time: { created: 1777543140000 } },
          parts: [
            {
              id: "reason-b",
              sessionID: "ses-1",
              type: "reasoning",
              text: "second thought",
              time: { start: 1777543141000, end: 1777543142000 },
            },
            { type: "text", text: "final" },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(history.toolCalls.filter((tool) => tool.kind === "think"), [
    {
      id: "msg-a:thinking",
      commandId: "msg-a:thinking",
      kind: "think",
      title: "Thinking",
      status: "completed",
      output: "first thought\n\nfirst follow-up",
      timestamp: "2026-04-30T09:58:58.000Z",
      updatedAt: "2026-04-30T09:58:59.900Z",
    },
    {
      id: "msg-b:thinking",
      commandId: "msg-b:thinking",
      kind: "think",
      title: "Thinking",
      status: "completed",
      output: "second thought",
      timestamp: "2026-04-30T09:59:01.000Z",
      updatedAt: "2026-04-30T09:59:02.000Z",
    },
  ]);
});
