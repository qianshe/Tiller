import assert from "node:assert/strict";
import test from "node:test";
import { extractClaudeVisibleMessagesFromTranscriptText } from "./history";

test("extractClaudeVisibleMessagesFromTranscriptText keeps visible user and assistant replies in transcript order", () => {
  const transcript = [
    localCommandUser("command-1", "<command-name>/model</command-name>"),
    visibleUser("user-1", "你好", "2026-06-05T14:08:12.000Z"),
    assistantThinking("think-1", "内部思考", "2026-06-05T14:08:13.000Z"),
    visibleAssistant("assistant-1", "你好喵~ 主人！", "2026-06-05T14:08:14.000Z"),
    systemRecord("system-1"),
    visibleUser("user-2", "做个todolist我用来测试效果，不要全部完成", "2026-06-05T14:09:00.000Z"),
    visibleAssistant("assistant-2", "好嘞主人喵~ 我先创建几个任务:", "2026-06-05T14:09:01.000Z"),
    assistantToolUse("tool-1", "TaskCreate", "2026-06-05T14:09:02.000Z"),
    userToolResult("tool-1", "Task #1 created successfully: 梳理并行聊天窗口", "2026-06-05T14:09:03.000Z"),
    malformedToolUser("malformed-1", "Your tool call was malformed and could not be parsed. Please retry."),
    visibleAssistant("assistant-3", "任务都建好了喵~ 现在保留一部分待办。", "2026-06-05T14:09:04.000Z"),
  ].join("\n");

  const messages = extractClaudeVisibleMessagesFromTranscriptText(transcript);

  assert.deepEqual(messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    timelineSequence: message.timelineSequence,
  })), [
    { id: "user-1", role: "user", text: "你好", timelineSequence: 1 },
    { id: "assistant-1", role: "assistant", text: "你好喵~ 主人！", timelineSequence: 2 },
    {
      id: "user-2",
      role: "user",
      text: "做个todolist我用来测试效果，不要全部完成",
      timelineSequence: 3,
    },
    {
      id: "assistant-2",
      role: "assistant",
      text: "好嘞主人喵~ 我先创建几个任务:",
      timelineSequence: 4,
    },
    {
      id: "assistant-3",
      role: "assistant",
      text: "任务都建好了喵~ 现在保留一部分待办。",
      timelineSequence: 5,
    },
  ]);
});

function visibleUser(id: string, text: string, timestamp: string) {
  return JSON.stringify({
    uuid: id,
    type: "user",
    timestamp,
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function visibleAssistant(id: string, text: string, timestamp: string) {
  return JSON.stringify({
    uuid: id,
    type: "assistant",
    timestamp,
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function assistantThinking(id: string, text: string, timestamp: string) {
  return JSON.stringify({
    uuid: id,
    type: "assistant",
    timestamp,
    message: { role: "assistant", content: [{ type: "thinking", thinking: text }] },
  });
}

function assistantToolUse(id: string, name: string, timestamp: string) {
  return JSON.stringify({
    uuid: id,
    type: "assistant",
    timestamp,
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] },
  });
}

function userToolResult(toolUseId: string, content: string, timestamp: string) {
  return JSON.stringify({
    uuid: `${toolUseId}-result`,
    type: "user",
    timestamp,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  });
}

function localCommandUser(id: string, content: string) {
  return JSON.stringify({
    uuid: id,
    type: "user",
    timestamp: "2026-06-05T14:08:10.000Z",
    message: { role: "user", content },
  });
}

function malformedToolUser(id: string, content: string) {
  return JSON.stringify({
    uuid: id,
    type: "user",
    timestamp: "2026-06-05T14:09:03.500Z",
    message: { role: "user", content },
  });
}

function systemRecord(id: string) {
  return JSON.stringify({
    uuid: id,
    type: "system",
    timestamp: "2026-06-05T14:08:15.000Z",
  });
}
