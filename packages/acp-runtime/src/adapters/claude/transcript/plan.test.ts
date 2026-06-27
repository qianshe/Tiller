import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  extractClaudePlanFromTranscriptText,
  readClaudeTranscriptPlanFromDisk,
  resolveClaudeTranscriptPath,
} from "./plan";

test("extractClaudePlanFromTranscriptText rebuilds TaskCreate and TaskUpdate state", () => {
  const transcript = [
    assistantToolUse("tool-1", "TaskCreate", {
      subject: "梳理并行聊天窗口的状态管理逻辑",
      description: "阅读相关文件",
      activeForm: "梳理并行聊天窗口的状态管理逻辑",
    }, "2026-06-05T14:09:50.766Z"),
    userToolResult("tool-1", "Task #1 created successfully: 梳理并行聊天窗口的状态管理逻辑", "2026-06-05T14:09:51.168Z"),
    assistantToolUse("tool-2", "TaskCreate", {
      subject: "修复会话历史同步的边界情况",
      description: "处理边界情况",
      activeForm: "修复会话历史同步的边界情况",
    }, "2026-06-05T14:09:50.775Z"),
    userToolResult("tool-2", "Task #2 created successfully: 修复会话历史同步的边界情况", "2026-06-05T14:09:51.471Z"),
    assistantToolUse("tool-3", "TaskCreate", {
      subject: "为 queued-prompts 补充单元测试",
      description: "覆盖核心场景",
      activeForm: "为 queued-prompts 补充单元测试",
    }, "2026-06-05T14:09:50.778Z"),
    userToolResult("tool-3", "Task #3 created successfully: 为 queued-prompts 补充单元测试", "2026-06-05T14:09:51.773Z"),
    assistantToolUse("tool-4", "TaskCreate", {
      subject: "优化 session-cards 的渲染性能",
    }, "2026-06-05T14:09:50.789Z"),
    userToolResult("tool-4", "Task #4 created successfully: 优化 session-cards 的渲染性能", "2026-06-05T14:09:52.070Z"),
    assistantToolUse("tool-5", "TaskCreate", {
      subject: "更新 shell 样式以适配新布局",
    }, "2026-06-05T14:09:53.000Z"),
    userToolResult("tool-5", "Task #5 created successfully: 更新 shell 样式以适配新布局", "2026-06-05T14:09:53.100Z"),
    assistantToolUse("tool-update-1", "TaskUpdate", { taskId: "1", status: "completed" }, "2026-06-05T14:10:00.000Z"),
    userToolResult("tool-update-1", "Updated task #1 status", "2026-06-05T14:10:01.000Z"),
    assistantToolUse("tool-update-2", "TaskUpdate", { taskId: "2", status: "completed" }, "2026-06-05T14:10:02.000Z"),
    userToolResult("tool-update-2", "Updated task #2 status", "2026-06-05T14:10:03.000Z"),
    assistantToolUse("tool-update-3", "TaskUpdate", { taskId: "3", status: "in_progress" }, "2026-06-05T14:10:04.000Z"),
    userToolResult("tool-update-3", "Updated task #3 status", "2026-06-05T14:10:05.000Z"),
  ].join("\n");

  const plan = extractClaudePlanFromTranscriptText(transcript);

  assert.deepEqual(plan?.entries, [
    { content: "梳理并行聊天窗口的状态管理逻辑", priority: "medium", status: "completed" },
    { content: "修复会话历史同步的边界情况", priority: "medium", status: "completed" },
    { content: "为 queued-prompts 补充单元测试", priority: "medium", status: "in_progress" },
    { content: "优化 session-cards 的渲染性能", priority: "medium", status: "pending" },
    { content: "更新 shell 样式以适配新布局", priority: "medium", status: "pending" },
  ]);
  assert.equal(plan?.updatedAt, "2026-06-05T14:10:05.000Z");
});

test("readClaudeTranscriptPlanFromDisk resolves the Claude project transcript path", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-claude-transcript-"));
  try {
    const projectCwd = join(tempDir, "workspace", "project");
    const options = {
      runtimeSessionId: "runtime-1",
      cwd: projectCwd,
      claudeConfigDir: tempDir,
    };
    const transcriptPath = resolveClaudeTranscriptPath(options);
    const expectedTranscriptPath = join(
      tempDir,
      "projects",
      resolve(projectCwd).replace(/[\\/:]/gu, "-"),
      "runtime-1.jsonl",
    );
    assert.equal(transcriptPath, expectedTranscriptPath);
    mkdirSync(dirname(transcriptPath), { recursive: true });
    writeFileSync(transcriptPath, "", "utf8");

    assert.equal(readClaudeTranscriptPlanFromDisk(options), null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function assistantToolUse(id: string, name: string, input: unknown, timestamp: string) {
  return JSON.stringify({
    type: "assistant",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
    },
  });
}

function userToolResult(toolUseId: string, content: string, timestamp: string) {
  return JSON.stringify({
    type: "user",
    timestamp,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
  });
}
