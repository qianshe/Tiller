import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadAdapterAuthoritativeHistory } from "../index.js";
import { loadClaudeCodeHistory, parseClaudeCodeJsonlHistory } from "./history.js";

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
    },
    {
      id: "msg-assistant",
      role: "assistant",
      text: "我先查一下。",
      timestamp: "2026-05-17T09:34:38.683Z",
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
    },
  ]);
});


test("parseClaudeCodeJsonlHistory hides local command wrappers and keeps stdout text", () => {
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
        uuid: "msg-stdout",
        timestamp: "2026-05-17T09:34:37.000Z",
        type: "user",
        message: {
          role: "user",
          content: "<local-command-stdout>Set model to opus (claude-opus-4-7)</local-command-stdout>",
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(history.messages, [
    {
      id: "msg-stdout",
      role: "user",
      text: "Set model to opus (claude-opus-4-7)",
      timestamp: "2026-05-17T09:34:37.000Z",
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
      JSON.stringify({
        uuid: "msg-user",
        timestamp: "2026-05-17T09:34:35.000Z",
        type: "user",
        message: { role: "user", content: "加载历史" },
      }),
      "utf8",
    );

    const history = await loadAdapterAuthoritativeHistory(
      { id: "claude-acp", name: "Claude", command: "claude-code-acp", transport: "stdio", protocol: "acp" },
      "runtime-2",
      "D:/repo",
    );

    assert.equal(history?.messages[0]?.text, "加载历史");
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    }
    rmSync(configDir, { recursive: true, force: true });
  }
});
