import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  extractClaudeCompactionFromTranscriptText,
  extractClaudeCompactionSummaryFromTranscriptText,
  extractClaudeVisibleMessagesFromTranscriptText,
  readClaudeTranscriptCompactionFromDisk,
} from "./history";
import { resolveClaudeTranscriptPath } from "./plan";

test("extractClaudeVisibleMessagesFromTranscriptText keeps visible user and assistant replies in transcript order", () => {
  const transcript = [
    localCommandUser("command-1", "<command-name>/model</command-name>"),
    visibleUser("user-1", "你好", "2026-06-05T14:08:12.000Z"),
    assistantThinking("think-1", "内部思考", "2026-06-05T14:08:13.000Z"),
    visibleAssistant(
      "assistant-1",
      "你好喵~ 主人！",
      "2026-06-05T14:08:14.000Z",
    ),
    systemRecord("system-1"),
    visibleUser(
      "user-2",
      "做个todolist我用来测试效果，不要全部完成",
      "2026-06-05T14:09:00.000Z",
    ),
    visibleAssistant(
      "assistant-2",
      "好嘞主人喵~ 我先创建几个任务:",
      "2026-06-05T14:09:01.000Z",
    ),
    assistantToolUse("tool-1", "TaskCreate", "2026-06-05T14:09:02.000Z"),
    userToolResult(
      "tool-1",
      "Task #1 created successfully: 梳理并行聊天窗口",
      "2026-06-05T14:09:03.000Z",
    ),
    malformedToolUser(
      "malformed-1",
      "Your tool call was malformed and could not be parsed. Please retry.",
    ),
    visibleAssistant(
      "assistant-3",
      "任务都建好了喵~ 现在保留一部分待办。",
      "2026-06-05T14:09:04.000Z",
    ),
  ].join("\n");

  const messages = extractClaudeVisibleMessagesFromTranscriptText(transcript);

  assert.deepEqual(
    messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      sequence: message.sequence,
    })),
    [
      { id: "user-1", role: "user", text: "你好", sequence: 1 },
      {
        id: "assistant-1",
        role: "assistant",
        text: "你好喵~ 主人！",
        sequence: 2,
      },
      {
        id: "user-2",
        role: "user",
        text: "做个todolist我用来测试效果，不要全部完成",
        sequence: 3,
      },
      {
        id: "assistant-2",
        role: "assistant",
        text: "好嘞主人喵~ 我先创建几个任务:",
        sequence: 4,
      },
      {
        id: "assistant-3",
        role: "assistant",
        text: "任务都建好了喵~ 现在保留一部分待办。",
        sequence: 5,
      },
    ],
  );
});

test("extractClaudeCompactionSummaryFromTranscriptText selects the summary completed at the requested time", () => {
  const transcript = [
    compactSummary(
      "summary-1",
      "2026-07-17T11:47:30.769Z",
      "1. First compacted summary\n2. Earlier state",
    ),
    compactSummary(
      "summary-2",
      "2026-07-17T12:10:00.000Z",
      "1. Second compacted summary\n2. Newer state",
    ),
  ].join("\n");

  assert.equal(
    extractClaudeCompactionSummaryFromTranscriptText(transcript, {
      completedAt: "2026-07-17T11:47:32.000Z",
    }),
    "1. First compacted summary\n2. Earlier state",
  );
  assert.equal(
    extractClaudeCompactionSummaryFromTranscriptText(transcript),
    "1. Second compacted summary\n2. Newer state",
  );
  assert.deepEqual(
    extractClaudeCompactionFromTranscriptText(transcript, {
      completedAt: "2026-07-17T11:47:32.000Z",
    }),
    {
      summaryText: "1. First compacted summary\n2. Earlier state",
      summaryMessageId: "summary-1",
    },
  );
});

test("readClaudeTranscriptCompactionFromDisk ignores stale summaries when hydrating a live marker", () => {
  const claudeConfigDir = mkdtempSync(join(tmpdir(), "tiller-claude-stale-compaction-"));
  const options = {
    runtimeSessionId: "runtime-claude-stale",
    cwd: "D:/repo",
    claudeConfigDir,
    completedAt: "2026-07-17T15:24:06.137Z",
  };
  const transcriptPath = resolveClaudeTranscriptPath(options);
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(
    transcriptPath,
    compactSummary(
      "summary-old",
      "2026-07-17T15:00:00.000Z",
      "Old compacted summary",
    ),
    "utf8",
  );

  try {
    assert.equal(readClaudeTranscriptCompactionFromDisk(options), undefined);
  } finally {
    rmSync(claudeConfigDir, { recursive: true, force: true });
  }
});

test("readClaudeTranscriptCompactionFromDisk keeps a recent summary eligible for hydration", () => {
  const claudeConfigDir = mkdtempSync(join(tmpdir(), "tiller-claude-recent-compaction-"));
  const options = {
    runtimeSessionId: "runtime-claude-recent",
    cwd: "D:/repo",
    claudeConfigDir,
    completedAt: "2026-07-17T15:24:06.137Z",
  };
  const transcriptPath = resolveClaudeTranscriptPath(options);
  mkdirSync(dirname(transcriptPath), { recursive: true });
  writeFileSync(
    transcriptPath,
    [
      compactSummary("summary-old", "2026-07-17T15:00:00.000Z", "Old compacted summary"),
      compactSummary("summary-new", "2026-07-17T15:23:58.000Z", "New compacted summary"),
    ].join("\n"),
    "utf8",
  );

  try {
    assert.deepEqual(readClaudeTranscriptCompactionFromDisk(options), {
      summaryMessageId: "summary-new",
      summaryText: "New compacted summary",
    });
  } finally {
    rmSync(claudeConfigDir, { recursive: true, force: true });
  }
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
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: text }],
    },
  });
}

function assistantToolUse(id: string, name: string, timestamp: string) {
  return JSON.stringify({
    uuid: id,
    type: "assistant",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name, input: {} }],
    },
  });
}

function userToolResult(toolUseId: string, content: string, timestamp: string) {
  return JSON.stringify({
    uuid: `${toolUseId}-result`,
    type: "user",
    timestamp,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
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

function compactSummary(id: string, timestamp: string, summary: string) {
  return JSON.stringify({
    uuid: id,
    type: "user",
    timestamp,
    isCompactSummary: true,
    message: {
      role: "user",
      content: [
        "This session is being continued from a previous conversation that ran out of context.",
        "",
        "Summary:",
        summary,
        "",
        "If you need specific details from before compaction, read the full transcript.",
        "Continue the conversation from where it left off.",
      ].join("\n"),
    },
  });
}
