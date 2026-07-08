import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentMessage,
  AgentToolCall,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import {
  applyLocalMessageRepair,
  applyTranscriptMessageRepair,
} from "./message-repair";

test("applyLocalMessageRepair inserts missing assistant replies from previous local history first", () => {
  const sessionId = "session-local-repair";
  let messages: AgentMessage[] = [
    message("user-1", "user", "你好", 1),
    message("user-2", "user", "做个todolist我用来测试效果，不要全部完成", 2),
    message("assistant-2a", "assistant", "好嘞主人喵~ 我先创建几个任务:", 4),
  ];
  let timeline: SessionTimelineEntry[] = [];
  const appendedUpdates: SessionUpdateRecord[] = [];

  const repaired = applyLocalMessageRepair({
    sessionId,
    summary: createSummary(sessionId),
    agent: createClaudeAgent(),
    previousMessages: [
      message("user-1-local", "user", "你好", 1),
      message("assistant-1-local", "assistant", "你好喵~ 主人！", 2),
      message("user-2-local", "user", "做个todolist我用来测试效果，不要全部完成", 3),
      message("assistant-2a-local", "assistant", "好嘞主人喵~ 我先创建几个任务:", 4),
    ],
    sessionMessageStore: {
      list: () => messages,
      replace: (_sessionId, nextMessages) => {
        messages = nextMessages;
      },
    },
    sessionArtifactStore: {
      get: () => ({
        outputs: [],
        diffs: [],
        toolCalls: [thinkingCall("thinking-1", 3)],
      }),
    },
    sessionTimelineStore: {
      replace: (_sessionId, entries) => {
        timeline = entries;
        return entries;
      },
    },
    sessionUpdateStore: {
      listPage: () => ({
        updates: [],
        hasMore: false,
      }),
      append: (record) => {
        appendedUpdates.push(record);
      },
    },
  });

  assert.equal(repaired, true);
  assert.deepEqual(messages.map((item) => `${item.role}:${item.text}`), [
    "user:你好",
    "assistant:你好喵~ 主人！",
    "user:做个todolist我用来测试效果，不要全部完成",
    "assistant:好嘞主人喵~ 我先创建几个任务:",
  ]);
  assert.equal(
    timeline.findIndex((entry) => entry.kind === "assistant_message" && entry.id === "assistant-1-local") <
      timeline.findIndex((entry) => entry.kind === "user_message" && entry.message.text.startsWith("做个todolist")),
    true,
  );
  assert.equal(appendedUpdates.length, 1);
  assert.equal(appendedUpdates[0]?.source, "local_history_repair");
});

test("applyTranscriptMessageRepair inserts missing assistant replies from transcript in visible order", () => {
  const sessionId = "session-claude-repair";
  let messages: AgentMessage[] = [
    message("user-1", "user", "你好", 1),
    message("user-2", "user", "做个todolist我用来测试效果，不要全部完成", 2),
    message("assistant-2a", "assistant", "好嘞主人喵~ 我先创建几个任务:", 4),
    message("assistant-2b", "assistant", "任务都建好了喵~ 现在保留一部分待办。", 5),
  ];
  let timeline: SessionTimelineEntry[] = [];
  const appendedUpdates: SessionUpdateRecord[] = [];

  const repaired = applyTranscriptMessageRepair({
    sessionId,
    summary: createSummary(sessionId),
    agent: createClaudeAgent(),
    transcriptMessages: [
      message("user-1-transcript", "user", "你好", 1),
      message("assistant-1", "assistant", "你好喵~ 主人！", 2),
      message("user-2-transcript", "user", "做个todolist我用来测试效果，不要全部完成", 3),
      message("assistant-2a-transcript", "assistant", "好嘞主人喵~ 我先创建几个任务:", 4),
      message("assistant-2b-transcript", "assistant", "任务都建好了喵~ 现在保留一部分待办。", 5),
    ],
    sessionMessageStore: {
      list: () => messages,
      replace: (_sessionId, nextMessages) => {
        messages = nextMessages;
      },
    },
    sessionArtifactStore: {
      get: () => ({
        outputs: [],
        diffs: [],
        toolCalls: [thinkingCall("thinking-1", 3)],
      }),
    },
    sessionTimelineStore: {
      replace: (_sessionId, entries) => {
        timeline = entries;
        return entries;
      },
    },
    sessionUpdateStore: {
      listPage: () => ({
        updates: [
          {
            sessionId,
            runtimeSessionId: "runtime-1",
            providerId: "claudecode",
            sequence: 5,
            source: "acp_load_replay",
            updateType: "message",
            receivedAt: "2026-06-05T14:10:00.000Z",
            payloadJson: "{}",
          },
        ],
        hasMore: false,
      }),
      append: (record) => {
        appendedUpdates.push(record);
      },
    },
  });

  assert.equal(repaired, true);
  assert.deepEqual(messages.map((item) => `${item.role}:${item.text}`), [
    "user:你好",
    "assistant:你好喵~ 主人！",
    "user:做个todolist我用来测试效果，不要全部完成",
    "assistant:好嘞主人喵~ 我先创建几个任务:",
    "assistant:任务都建好了喵~ 现在保留一部分待办。",
  ]);
  assert.equal(
    timeline.findIndex((entry) => entry.kind === "assistant_message" && entry.id === "assistant-1") <
      timeline.findIndex((entry) => entry.kind === "user_message" && entry.message.text.startsWith("做个todolist")),
    true,
  );
  assert.equal(appendedUpdates.length, 1);
  assert.equal(appendedUpdates[0]?.source, "agent_transcript_repair");
  assert.equal(appendedUpdates[0]?.updateType, "message");
  assert.equal(JSON.parse(appendedUpdates[0]?.payloadJson ?? "{}").message.text, "你好喵~ 主人！");
});

test("applyTranscriptMessageRepair preserves existing tool-call interleaving", () => {
  const sessionId = "session-claude-repair-interleaving";
  let messages: AgentMessage[] = [
    message("user-1", "user", "先看一眼当前状态", 1),
    message("user-2", "user", "继续下一步", 20),
    message("assistant-2", "assistant", "已经继续处理", 21),
  ];
  let timeline: SessionTimelineEntry[] = [];

  const repaired = applyTranscriptMessageRepair({
    sessionId,
    summary: createSummary(sessionId),
    agent: createClaudeAgent(),
    transcriptMessages: [
      message("user-1-transcript", "user", "先看一眼当前状态", 1),
      message("assistant-1", "assistant", "我先检查仓库状态", 2),
      message("user-2-transcript", "user", "继续下一步", 20),
      message("assistant-2-transcript", "assistant", "已经继续处理", 21),
    ],
    sessionMessageStore: {
      list: () => messages,
      replace: (_sessionId, nextMessages) => {
        messages = nextMessages;
      },
    },
    sessionArtifactStore: {
      get: () => ({
        outputs: [],
        diffs: [],
        toolCalls: [thinkingCall("thinking-1", 10)],
      }),
    },
    sessionTimelineStore: {
      replace: (_sessionId, entries) => {
        timeline = entries;
        return entries;
      },
    },
    sessionUpdateStore: {
      listPage: () => ({
        updates: [],
        hasMore: false,
      }),
      append: () => undefined,
    },
  });

  assert.equal(repaired, true);
  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["assistant_message", "assistant-1"],
      ["assistant_message", "thinking-1"],
      ["user_message", "user-2"],
      ["assistant_message", "assistant-2"],
    ],
  );
});

test("applyTranscriptMessageRepair reanchors Codex transcript web fetch between repaired messages", () => {
  const sessionId = "session-codex-repair-web-order";
  let messages: AgentMessage[] = [
    {
      id: "user-1",
      role: "user",
      text: "再测试一下web搜索能力",
      timestamp: "2026-07-08T04:45:06.316Z",
      sequence: 80,
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "[🌳木] 目标是再做一轮 `web` 搜索测试，并给你一个可复核的结果。",
      timestamp: "2026-07-08T04:45:06.317Z",
      sequence: 81,
    },
    {
      id: "assistant-2",
      role: "assistant",
      text: "又做了一轮 `web` 搜索测试，能力正常，主人，喵~",
      timestamp: "2026-07-08T04:45:06.320Z",
      sequence: 83,
    },
  ];
  let timeline: SessionTimelineEntry[] = [];

  const repaired = applyTranscriptMessageRepair({
    sessionId,
    summary: {
      ...createSummary(sessionId),
      agentId: "codex",
      agentName: "Codex",
    },
    agent: {
      id: "codex",
      name: "Codex",
      kind: "custom" as const,
      command: "codex-acp",
      transport: "stdio" as const,
      protocol: "acp" as const,
    },
    transcriptMessages: [
      {
        id: "codex-transcript-message-1",
        role: "user",
        text: "再测试一下web搜索能力",
        timestamp: "2026-07-07T17:12:51.998Z",
        sequence: 1,
      },
      {
        id: "codex-transcript-message-2",
        role: "assistant",
        text: "[🌳木] 目标是再做一轮 `web` 搜索测试，并给你一个可复核的结果。",
        timestamp: "2026-07-07T17:12:52.100Z",
        sequence: 2,
      },
      {
        id: "codex-transcript-message-3",
        role: "assistant",
        text: "又做了一轮 `web` 搜索测试，能力正常，主人，喵~",
        timestamp: "2026-07-07T17:13:15.465Z",
        sequence: 3,
      },
    ],
    sessionMessageStore: {
      list: () => messages,
      replace: (_sessionId, nextMessages) => {
        messages = nextMessages;
      },
    },
    sessionArtifactStore: {
      get: () => ({
        outputs: [],
        diffs: [],
        toolCalls: [{
          id: "ws_1",
          kind: "fetch",
          title: "Searching for: site:developers.openai.com Responses API OpenAI",
          status: "completed",
          timestamp: "2026-07-07T17:13:09.352Z",
          updatedAt: "2026-07-07T17:13:09.352Z",
        }],
      }),
    },
    sessionTimelineStore: {
      replace: (_sessionId, entries) => {
        timeline = entries;
        return entries;
      },
    },
    sessionUpdateStore: {
      listPage: () => ({
        updates: [],
        hasMore: false,
      }),
      append: () => undefined,
    },
  });

  assert.equal(repaired, true);
  assert.deepEqual(
    messages.map((message) => [message.id, message.timestamp]),
    [
      ["user-1", "2026-07-07T17:12:51.998Z"],
      ["assistant-1", "2026-07-07T17:12:52.100Z"],
      ["assistant-2", "2026-07-07T17:13:15.465Z"],
    ],
  );
  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.id]),
    [
      ["user_message", "user-1"],
      ["assistant_message", "assistant-1"],
      ["tool_call", "tool:ws_1"],
      ["assistant_message", "assistant-2"],
    ],
  );
});

function createSummary(sessionId: string) {
  return {
    id: sessionId,
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    agentId: "claudecode",
    agentName: "ClaudeCode",
    cwd: "D:/repo",
    status: "idle" as const,
    createdAt: "2026-06-05T14:08:00.000Z",
    updatedAt: "2026-06-05T14:10:00.000Z",
    messageCount: 2,
    runtimeSessionId: "runtime-1",
  };
}

function createClaudeAgent() {
  return {
    id: "claudecode",
    name: "ClaudeCode",
    kind: "custom" as const,
    command: "claude-agent-acp",
    transport: "stdio" as const,
    protocol: "acp" as const,
  };
}

function message(
  id: string,
  role: AgentMessage["role"],
  text: string,
  sequence: number,
): AgentMessage {
  return {
    id,
    role,
    text,
    timestamp: `2026-06-05T14:08:${String(sequence).padStart(2, "0")}.000Z`,
    sequence,
  };
}

function thinkingCall(id: string, sequence: number): AgentToolCall {
  return {
    id,
    commandId: id,
    kind: "think",
    title: "Thinking",
    status: "completed",
    output: "思考内容",
    timestamp: "2026-06-05T14:08:03.500Z",
    updatedAt: "2026-06-05T14:08:03.500Z",
    sequence,
  };
}
