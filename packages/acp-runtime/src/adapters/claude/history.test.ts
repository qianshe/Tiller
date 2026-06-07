import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import { buildAuthoritativeHistoryFromEvents } from "../history-events.js";
import { loadAdapterAuthoritativeHistory } from "../index.js";
import {
  claudeCodeHistoryReader,
  loadClaudeCodeHistory,
  parseClaudeCodeJsonlHistory,
} from "./history.js";

const claudeHistoryContext = {
  provider: {
    id: "claude",
    name: "Claude",
    command: "claude-code-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  },
  runtimeSessionId: "runtime-test",
  cwd: "D:/repo",
};

test("parseClaudeCodeJsonlHistory maps messages and merges tool results", () => {
  const history = parseClaudeCodeJsonlHistory(
    [
      JSON.stringify({
        uuid: "msg-user",
        timestamp: "2026-05-17T09:34:35.000Z",
        type: "user",
        message: { role: "user", content: "检查航行日志" },
      }),
      JSON.stringify({
        uuid: "msg-assistant",
        timestamp: "2026-05-17T09:34:38.683Z",
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "我先查一下。" },
            {
              type: "tool_use",
              id: "toolu_grep",
              name: "Grep",
              input: { pattern: "航行日志", output_mode: "files_with_matches" },
            },
          ],
        },
      }),
      JSON.stringify({
        uuid: "msg-result",
        timestamp: "2026-05-17T09:34:39.559Z",
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_grep", content: "Found 12 files" }],
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user",
      role: "user",
      text: "检查航行日志",
      timestamp: "2026-05-17T09:34:35.000Z",
      timelineSequence: 1,
    },
    {
      id: "msg-assistant",
      role: "assistant",
      text: "我先查一下。",
      timestamp: "2026-05-17T09:34:38.683Z",
      timelineSequence: 2,
    },
  ]);
  assert.deepEqual(history.toolCalls, [
    {
      id: "toolu_grep",
      commandId: "toolu_grep",
      kind: "search",
      title: "Grep",
      status: "completed",
      input: JSON.stringify({ pattern: "航行日志", output_mode: "files_with_matches" }),
      output: "Found 12 files",
      timestamp: "2026-05-17T09:34:38.683Z",
      updatedAt: "2026-05-17T09:34:39.559Z",
      timelineSequence: 3,
    },
  ]);
});

test("claudeCodeHistoryReader.toEvents preserves ACP part order as common events", () => {
  const raw = [
    JSON.stringify({
      uuid: "msg-assistant",
      timestamp: "2026-05-17T09:34:38.683Z",
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "先说明。" },
          {
            type: "tool_use",
            id: "toolu_read",
            name: "Read",
            input: {
              file_path: "apps/deck/src/features/mission/conversation/plain-messages.tsx",
            },
          },
          { type: "text", text: "读完后继续。" },
        ],
      },
    }),
    JSON.stringify({
      uuid: "msg-result",
      timestamp: "2026-05-17T09:34:39.559Z",
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_read", content: "file content" },
        ],
      },
    }),
  ].join("\n");

  const events = claudeCodeHistoryReader.toEvents(raw, claudeHistoryContext);

  assert.deepEqual(
    events.map((event) => [event.kind, event.id]),
    [
      ["message", "msg-assistant"],
      ["tool_call", "toolu_read"],
      ["message", "msg-assistant#p1"],
      ["tool_result", "toolu_read"],
    ],
  );
  assert.deepEqual(
    buildSessionTimelineFromLegacy(buildAuthoritativeHistoryFromEvents(events)).map(
      (entry) => entry.kind,
    ),
    ["assistant_message", "tool_call", "assistant_message"],
  );
});

test("parseClaudeCodeJsonlHistory preserves assistant text around tool calls in ACP part order", () => {
  const history = parseClaudeCodeJsonlHistory(
    [
      JSON.stringify({
        uuid: "msg-assistant",
        timestamp: "2026-05-17T09:34:38.683Z",
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "先说明。" },
            {
              type: "tool_use",
              id: "toolu_read",
              name: "Read",
              input: { file_path: "apps/deck/src/features/mission/conversation/plain-messages.tsx" },
            },
            { type: "text", text: "读完后继续。" },
          ],
        },
      }),
      JSON.stringify({
        uuid: "msg-result",
        timestamp: "2026-05-17T09:34:39.559Z",
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_read", content: "file content" }],
        },
      }),
    ].join("\n"),
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

test("parseClaudeCodeJsonlHistory preserves user image attachments", () => {
  const history = parseClaudeCodeJsonlHistory(
    [
      JSON.stringify({
        uuid: "msg-user-image",
        timestamp: "2026-05-17T09:34:35.000Z",
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "请看图" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgo=",
              },
            },
          ],
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-user-image",
      role: "user",
      text: "请看图",
      timestamp: "2026-05-17T09:34:35.000Z",
      timelineSequence: 1,
      attachments: [
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
          name: "msg-user-image-image-1.png",
        },
      ],
    },
  ]);
});

test("parseClaudeCodeJsonlHistory hides local command wrappers and model switch stdout", () => {
  const history = parseClaudeCodeJsonlHistory(
    [
      JSON.stringify({
        uuid: "msg-command",
        timestamp: "2026-05-17T09:34:35.000Z",
        type: "user",
        message: {
          role: "user",
          content: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>",
        },
      }),
      JSON.stringify({
        uuid: "msg-caveat",
        timestamp: "2026-05-17T09:34:36.000Z",
        type: "user",
        message: {
          role: "user",
          content: "<local-command-caveat>Caveat: generated local command metadata</local-command-caveat>",
        },
      }),
      JSON.stringify({
        uuid: "msg-model-stdout",
        timestamp: "2026-05-17T09:34:37.000Z",
        type: "user",
        message: {
          role: "user",
          content: "<local-command-stdout>Set model to opus (claude-opus-4-7)</local-command-stdout>",
        },
      }),
      JSON.stringify({
        uuid: "msg-stdout",
        timestamp: "2026-05-17T09:34:38.000Z",
        type: "user",
        message: {
          role: "user",
          content: "<local-command-stdout>Command finished</local-command-stdout>",
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-stdout",
      role: "user",
      text: "Command finished",
      timestamp: "2026-05-17T09:34:38.000Z",
      timelineSequence: 1,
    },
  ]);
});

test("parseClaudeCodeJsonlHistory preserves thinking as collapsible think items", () => {
  const history = parseClaudeCodeJsonlHistory(
    JSON.stringify({
      uuid: "msg-thinking",
      timestamp: "2026-05-17T09:34:36.442Z",
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "需要先定位数据链路" }],
      },
    }),
  );

  assert.deepEqual(history.messages, []);
  assert.deepEqual(history.toolCalls, [
    {
      id: "msg-thinking:thinking:0",
      commandId: "msg-thinking:thinking:0",
      kind: "think",
      title: "Thinking",
      status: "completed",
      output: "需要先定位数据链路",
      timestamp: "2026-05-17T09:34:36.442Z",
      updatedAt: "2026-05-17T09:34:36.442Z",
      timelineSequence: 1,
    },
  ]);
});

test("parseClaudeCodeJsonlHistory preserves thinking blocks before final text answers", () => {
  const history = parseClaudeCodeJsonlHistory(
    JSON.stringify({
      uuid: "msg-final",
      timestamp: "2026-05-17T09:34:40.000Z",
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "这段思考不应作为历史 Thinking 展示" },
          { type: "text", text: "最终结论" },
        ],
      },
    }),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-final",
      role: "assistant",
      text: "最终结论",
      timestamp: "2026-05-17T09:34:40.000Z",
      timelineSequence: 2,
    },
  ]);
  assert.deepEqual(history.toolCalls, [
    {
      id: "msg-final:thinking:0",
      commandId: "msg-final:thinking:0",
      kind: "think",
      title: "Thinking",
      status: "completed",
      output: "这段思考不应作为历史 Thinking 展示",
      timestamp: "2026-05-17T09:34:40.000Z",
      updatedAt: "2026-05-17T09:34:40.000Z",
      timelineSequence: 1,
    },
  ]);
});

test("parseClaudeCodeJsonlHistory classifies common Claude Code tools", () => {
  const history = parseClaudeCodeJsonlHistory(
    [
      ["bash", "Bash"],
      ["read", "Read"],
      ["edit", "Edit"],
      ["grep", "Grep"],
      ["todo", "TodoWrite"],
      ["agent", "Agent"],
      ["skill", "Skill"],
      ["mcp", "mcp__mcp_router__search_context"],
      ["unknown", "UnknownTool"],
    ]
      .map(([id, name], index) =>
        JSON.stringify({
          uuid: `msg-${id}`,
          timestamp: `2026-05-17T09:34:${String(10 + index).padStart(2, "0")}.000Z`,
          type: "assistant",
          message: { role: "assistant", content: [{ type: "tool_use", id: `toolu_${id}`, name, input: {} }] },
        }),
      )
      .join("\n"),
  );

  assert.deepEqual(
    history.toolCalls.map((tool) => [tool.id, tool.kind, tool.title]),
    [
      ["toolu_bash", "shell", "Bash"],
      ["toolu_read", "read", "Read"],
      ["toolu_edit", "write", "Edit"],
      ["toolu_grep", "search", "Grep"],
      ["toolu_todo", "todo", "TodoWrite"],
      ["toolu_agent", "subagent", "Agent"],
      ["toolu_skill", "skill", "Skill"],
      ["toolu_mcp", "mcp", "mcp__mcp_router__search_context"],
      ["toolu_unknown", "tool", "UnknownTool"],
    ],
  );
});

test("parseClaudeCodeJsonlHistory derives Claude tasks as the latest plan", () => {
  const history = parseClaudeCodeJsonlHistory(
    [
      JSON.stringify({
        uuid: "msg-task-1",
        timestamp: "2026-06-05T14:09:50.766Z",
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_task_1",
              name: "TaskCreate",
              input: {
                subject: "梳理并行聊天窗口的状态管理逻辑",
                description: "阅读 deck-data.ts 和 chat-pane.tsx",
              },
            },
          ],
        },
      }),
      JSON.stringify({
        uuid: "msg-result-1",
        timestamp: "2026-06-05T14:09:51.168Z",
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_task_1",
              content: "Task #1 created successfully: 梳理并行聊天窗口的状态管理逻辑",
            },
          ],
        },
      }),
      JSON.stringify({
        uuid: "msg-task-2",
        timestamp: "2026-06-05T14:09:50.775Z",
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_task_2",
              name: "TaskCreate",
              input: {
                subject: "修复会话历史同步的边界情况",
              },
            },
          ],
        },
      }),
      JSON.stringify({
        uuid: "msg-result-2",
        timestamp: "2026-06-05T14:09:51.471Z",
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_task_2",
              content: "Task #2 created successfully: 修复会话历史同步的边界情况",
            },
          ],
        },
      }),
      JSON.stringify({
        uuid: "msg-update-1",
        timestamp: "2026-06-05T14:10:21.024Z",
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_update_1",
              name: "TaskUpdate",
              input: { taskId: "1", status: "completed" },
            },
          ],
        },
      }),
      JSON.stringify({
        uuid: "msg-update-2",
        timestamp: "2026-06-05T14:10:22.184Z",
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_update_2",
              name: "TaskUpdate",
              input: { taskId: "2", status: "in_progress" },
            },
          ],
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(history.plan, {
    updatedAt: "2026-06-05T14:10:22.184Z",
    entries: [
      {
        content: "梳理并行聊天窗口的状态管理逻辑",
        priority: "medium",
        status: "completed",
      },
      {
        content: "修复会话历史同步的边界情况",
        priority: "medium",
        status: "in_progress",
      },
    ],
  });
});

test("loadClaudeCodeHistory reads cwd-scoped Claude project jsonl", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "tiller-claude-history-"));
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;
  try {
    const projectDir = join(configDir, "projects", "D--myProject-tools-Tiller");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "runtime-1.jsonl"),
      JSON.stringify({
        uuid: "msg-user",
        timestamp: "2026-05-17T09:34:35.000Z",
        type: "user",
        message: { role: "user", content: "继续" },
      }),
      "utf8",
    );

    const history = await loadClaudeCodeHistory("runtime-1", "D:\\myProject\\tools\\Tiller");

    assert.equal(history?.messages[0]?.text, "继续");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    }
    rmSync(configDir, { recursive: true, force: true });
  }
});

test("loadAdapterAuthoritativeHistory uses Claude Code history for Claude providers", async () => {
  const configDir = mkdtempSync(join(tmpdir(), "tiller-claude-adapter-"));
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;
  try {
    const projectDir = join(configDir, "projects", "D--repo");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "runtime-2.jsonl"),
      [
        JSON.stringify({
          uuid: "msg-user",
          timestamp: "2026-05-17T09:34:35.000Z",
          type: "user",
          message: { role: "user", content: "加载历史" },
        }),
        JSON.stringify({
          uuid: "msg-task",
          timestamp: "2026-05-17T09:34:36.000Z",
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_task",
                name: "TaskCreate",
                input: { subject: "恢复 Claude plan" },
              },
            ],
          },
        }),
        JSON.stringify({
          uuid: "msg-task-result",
          timestamp: "2026-05-17T09:34:37.000Z",
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_task",
                content: "Task #1 created successfully: 恢复 Claude plan",
              },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const history = await loadAdapterAuthoritativeHistory(
      { id: "claude-acp", name: "Claude", command: "claude-code-acp", transport: "stdio", protocol: "acp" },
      "runtime-2",
      "D:/repo",
    );

    assert.equal(history?.messages[0]?.text, "加载历史");
    assert.deepEqual(history?.plan?.entries, [
      { content: "恢复 Claude plan", priority: "medium", status: "pending" },
    ]);
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    }
    rmSync(configDir, { recursive: true, force: true });
  }
});
