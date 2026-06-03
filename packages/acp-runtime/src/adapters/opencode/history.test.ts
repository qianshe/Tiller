import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import { buildAuthoritativeHistoryFromEvents } from "../history-events.js";
import { loadAdapterAuthoritativeHistory } from "../index.js";
import {
  openCodeHistoryReader,
  parseOpenCodeExportHistory,
  parseOpenCodeSqliteHistory,
} from "./history.js";

const openCodeHistoryContext = {
  provider: {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    transport: "stdio" as const,
    protocol: "acp" as const,
  },
  runtimeSessionId: "session-test",
  cwd: "D:/repo",
};

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
      timelineSequence: 1,
    },
    {
      id: "msg-assistant",
      role: "assistant",
      text: "我来调用工具",
      timestamp: "2026-04-30T09:58:57.977Z",
      timelineSequence: 2,
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
      timelineSequence: 3,
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
      timelineSequence: 1,
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
      timelineSequence: 1,
    },
  ]);
});

test("openCodeHistoryReader.toEvents emits export text and tool events in part order", () => {
  const events = openCodeHistoryReader.toEvents(
    {
      kind: "export",
      raw: JSON.stringify({
        messages: [
          {
            id: "msg-assistant",
            info: { role: "assistant", time: { created: 1777543137977 } },
            parts: [
              { type: "text", text: "先说明。" },
              {
                id: "prt-tool",
                type: "tool",
                tool: "read",
                callID: "call-read",
                state: {
                  status: "completed",
                  input: {
                    filePath: "apps/deck/src/features/mission/conversation/plain-messages.tsx",
                  },
                  output: "file content",
                  title: "Read",
                  time: { start: 1777543150384, end: 1777543150482 },
                },
              },
              { type: "text", text: "读完后继续。" },
            ],
          },
        ],
      }),
    },
    openCodeHistoryContext,
  );

  assert.deepEqual(
    events.map((event) => [event.kind, event.id]),
    [
      ["message", "msg-assistant"],
      ["tool_call", "call-read"],
      ["message", "msg-assistant#p1"],
    ],
  );
  assert.deepEqual(
    buildSessionTimelineFromLegacy(
      buildAuthoritativeHistoryFromEvents(events, openCodeHistoryReader.options),
    ).map((entry) => entry.kind),
    ["assistant_message", "tool_call", "assistant_message"],
  );
});

test("openCodeHistoryReader.toEvents emits sqlite image-only message events", () => {
  const events = openCodeHistoryReader.toEvents(
    {
      kind: "sqlite",
      messageRows: [
        {
          id: "msg-user-image-only",
          time_created: 1777543137952,
          data: JSON.stringify({ role: "user", time: { created: 1777543137952 } }),
        },
      ],
      partRows: [
        {
          id: "prt-image",
          message_id: "msg-user-image-only",
          time_created: 1777543137952,
          time_updated: 1777543137952,
          data: JSON.stringify({
            type: "input_image",
            imageUrl: "data:image/webp;base64,sqlite-webp",
          }),
        },
      ],
    },
    openCodeHistoryContext,
  );

  assert.deepEqual(events, [
    {
      kind: "message",
      id: "msg-user-image-only",
      role: "user",
      timestamp: "2026-04-30T09:58:57.952Z",
      attachments: [
        {
          type: "image",
          data: "sqlite-webp",
          mimeType: "image/webp",
          name: "msg-user-image-only-image-1.webp",
        },
      ],
    },
  ]);
});

test("parseOpenCodeExportHistory preserves user image attachments", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-user-image",
          info: { role: "user", time: { created: 1777543137952 } },
          parts: [
            { type: "text", text: "看这张图" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,opencode-png",
              },
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user-image",
      role: "user",
      text: "看这张图",
      timestamp: "2026-04-30T09:58:57.952Z",
      timelineSequence: 1,
      attachments: [
        {
          type: "image",
          data: "opencode-png",
          mimeType: "image/png",
          name: "msg-user-image-image-1.png",
        },
      ],
    },
  ]);
});

test("parseOpenCodeSqliteHistory preserves image-only user prompts", () => {
  const history = parseOpenCodeSqliteHistory(
    [
      {
        id: "msg-user-image-only",
        time_created: 1777543137952,
        data: JSON.stringify({ role: "user", time: { created: 1777543137952 } }),
      },
    ],
    [
      {
        id: "prt-image",
        message_id: "msg-user-image-only",
        time_created: 1777543137952,
        time_updated: 1777543137952,
        data: JSON.stringify({
          type: "input_image",
          imageUrl: "data:image/webp;base64,sqlite-webp",
        }),
      },
    ],
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user-image-only",
      role: "user",
      text: "图片 1 张",
      timestamp: "2026-04-30T09:58:57.952Z",
      timelineSequence: 1,
      attachments: [
        {
          type: "image",
          data: "sqlite-webp",
          mimeType: "image/webp",
          name: "msg-user-image-only-image-1.webp",
        },
      ],
    },
  ]);
});

test("parseOpenCodeExportHistory preserves assistant text around tool calls in ACP part order", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-assistant",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            { type: "text", text: "先说明。" },
            {
              id: "prt-tool",
              type: "tool",
              tool: "read",
              callID: "call-read",
              state: {
                status: "completed",
                input: { filePath: "apps/deck/src/features/mission/conversation/plain-messages.tsx" },
                output: "file content",
                title: "Read",
                time: { start: 1777543150384, end: 1777543150482 },
              },
            },
            { type: "text", text: "读完后继续。" },
          ],
        },
      ],
    }),
  );

  const timeline = buildSessionTimelineFromLegacy(history);

  assert.deepEqual(
    timeline.map((entry) => entry.kind),
    ["assistant_message", "tool_call", "assistant_message"],
  );
  assert.deepEqual(
    timeline.map((entry) => {
      if (entry.kind === "assistant_message") {
        return entry.chunks.map((chunk) => "text" in chunk ? chunk.text : "").join("");
      }
      if (entry.kind === "tool_call") {
        return entry.toolCall.output;
      }
      return "";
    }),
    ["先说明。", "file content", "读完后继续。"],
  );
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
        timelineSequence: 1,
      },
      {
        id: "msg-assistant",
        role: "assistant",
        text: "你好，主人喵~",
        timestamp: "2026-04-30T09:58:57.977Z",
        timelineSequence: 2,
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
      timelineSequence: 1,
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

test("parseOpenCodeExportHistory derives the latest todo tool call as a plan", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-assistant-todos",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            {
              type: "tool",
              tool: "todowrite",
              callID: "call-todo-progress",
              state: {
                status: "completed",
                input: {
                  todos: [
                    { content: "并行委派 apps/helm 竞态模式搜索", status: "completed", priority: "high" },
                    { content: "补充读取候选代码并验证是否真有 await 竞态", status: "completed", priority: "high" },
                    { content: "汇总类似问题、风险等级与证据位置", status: "in_progress", priority: "high" },
                  ],
                },
                output: [],
                title: "1 todos",
                time: { start: 1777543150784, end: 1777543150882 },
              },
            },
            {
              type: "tool",
              tool: "todowrite",
              callID: "call-todo-complete",
              state: {
                status: "completed",
                input: {
                  todos: [
                    { content: "并行委派 apps/helm 竞态模式搜索", status: "completed", priority: "high" },
                    { content: "补充读取候选代码并验证是否真有 await 竞态", status: "completed", priority: "high" },
                    { content: "汇总类似问题、风险等级与证据位置", status: "completed", priority: "high" },
                  ],
                },
                title: "0 todos",
                time: { start: 1777543151784, end: 1777543151882 },
              },
            },
          ],
        },
      ],
    }),
  );

  assert.equal(history.toolCalls.at(-1)?.kind, "todo");
  assert.deepEqual(history.plan, {
    updatedAt: "2026-04-30T09:59:11.882Z",
    entries: [
      { content: "并行委派 apps/helm 竞态模式搜索", priority: "high", status: "completed" },
      { content: "补充读取候选代码并验证是否真有 await 竞态", priority: "high", status: "completed" },
      { content: "汇总类似问题、风险等级与证据位置", priority: "high", status: "completed" },
    ],
  });
});

test("parseOpenCodeExportHistory keeps delegate task tools as subagent calls", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-assistant-subagent",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            {
              type: "tool",
              tool: "mcpServers_delegate_task",
              callID: "call-subagent",
              state: {
                status: "completed",
                input: {
                  task: "检查 mission 会话 UI",
                  agent: "explore",
                  mcpServers: ["morph"],
                },
                title: "mcpServers_delegate_task",
                time: { start: 1777543150784, end: 1777543150882 },
              },
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(
    history.toolCalls.map((tool) => [tool.id, tool.kind, tool.title]),
    [["call-subagent", "subagent", "mcpServers_delegate_task"]],
  );
});

test("parseOpenCodeExportHistory treats typed task payloads as subagent calls", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-assistant-subagent-task",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            {
              type: "tool",
              tool: "task",
              callID: "call-task-subagent",
              state: {
                status: "completed",
                input: {
                  description: "Review concurrency findings",
                  prompt: "TASK: Review race-condition findings.",
                  run_in_background: false,
                  subagent_type: "oracle",
                  task_id: "",
                },
                title: "Review concurrency findings",
                time: { start: 1777543150784, end: 1777543150882 },
              },
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(
    history.toolCalls.map((tool) => [tool.id, tool.kind, tool.title]),
    [["call-task-subagent", "subagent", "Review concurrency findings"]],
  );
});

test("parseOpenCodeExportHistory does not infer subagent from task text alone", () => {
  const history = parseOpenCodeExportHistory(
    JSON.stringify({
      messages: [
        {
          id: "msg-assistant-task-title",
          info: { role: "assistant", time: { created: 1777543137977 } },
          parts: [
            {
              type: "tool",
              tool: "custom_tool",
              callID: "call-task-title",
              state: {
                status: "completed",
                input: { value: "notes" },
                title: "Review task findings",
                time: { start: 1777543150784, end: 1777543150882 },
              },
            },
          ],
        },
      ],
    }),
  );

  assert.deepEqual(
    history.toolCalls.map((tool) => [tool.id, tool.kind, tool.title]),
    [["call-task-title", "tool", "Review task findings"]],
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
      timelineSequence: 2,
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
      timelineSequence: 1,
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
      timelineSequence: 3,
    },
  ]);
});
