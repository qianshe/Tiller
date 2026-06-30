import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
  SessionTimelineEntry,
} from "@tiller/shared";
import {
  clearRecoveredArtifactTimelineSequences,
  chooseRecoverySummary,
  findAcpReplayCoverageGap,
  readReimportedHistoryPage,
  recoverUserPromptFromSessionSummary,
  resolveLegacyHistoryBaseline,
  sanitizeRecoveredHistorySequenceResets,
} from "./helpers.js";

function sessionSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "session-1",
    title: "Active title",
    status: "idle",
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    messageCount: 0,
    ...overrides,
  };
}

test("chooseRecoverySummary prefers stored text when active summary has no recoverable text", () => {
  const active = sessionSummary({ title: "", lastMessagePreview: "" });
  const stored = sessionSummary({ title: "Stored title", lastMessagePreview: "Stored prompt" });

  assert.equal(chooseRecoverySummary(active, stored), stored);
});

test("recoverUserPromptFromSessionSummary inserts a prompt before provider messages", () => {
  let messages: AgentMessage[] = [
    {
      id: "assistant-1",
      role: "assistant",
      text: "answer",
      timestamp: "2026-05-28T00:00:10.000Z",
    },
  ];
  const store = {
    list: () => messages,
    replace: (_sessionId: string, next: AgentMessage[]) => {
      messages = next;
    },
  };

  recoverUserPromptFromSessionSummary({
    sessionId: "session-1",
    summary: sessionSummary({ lastMessagePreview: "Original prompt" }),
    sessionMessageStore: store,
  });

  assert.equal(messages[0]?.role, "user");
  assert.equal(messages[0]?.text, "Original prompt");
  assert.equal(messages[0]?.timestamp, "2026-05-28T00:00:09.999Z");
});

test("readReimportedHistoryPage returns and persists rebuilt timeline", () => {
  const messages: AgentMessage[] = [
    {
      id: "user-1",
      role: "user",
      text: "重新导入",
      timestamp: "2026-05-28T00:00:00.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "导入完成",
      timestamp: "2026-05-28T00:00:02.000Z",
      sequence: 3,
    },
  ];
  const outputs: CommandChunk[] = [];
  const diffs: FileDiffSummary[] = [];
  const toolCalls: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "shell",
      title: "pnpm test",
      status: "completed",
      timestamp: "2026-05-28T00:00:01.000Z",
      updatedAt: "2026-05-28T00:00:01.000Z",
      sequence: 2,
    },
  ];
  let storedTimeline: SessionTimelineEntry[] = [];

  const result = readReimportedHistoryPage({
    sessionId: "session-1",
    message: "历史已从 ACP 重新导入。",
    sessionMessageStore: {
      list: () => messages,
      replace: () => undefined,
      listPage: () => ({ messages, hasMore: false }),
    },
    sessionArtifactStore: {
      get: () => ({ outputs, diffs, toolCalls }),
      getPage: () => ({ outputs, diffs, toolCalls, hasMore: false }),
    },
    sessionTimelineStore: {
      replace: (_sessionId, entries) => {
        storedTimeline = entries;
        return entries;
      },
    },
  });

  assert.deepEqual(result.timeline?.map((entry) => entry.kind), [
    "user_message",
    "tool_call",
    "assistant_message",
  ]);
  assert.deepEqual(storedTimeline.map((entry) => entry.id), [
    "user-1",
    "tool:tool-1",
    "assistant-1",
  ]);
});

test("readReimportedHistoryPage preserves existing replay timeline instead of rebuilding from grouped legacy stores", () => {
  const messages: AgentMessage[] = [
    {
      id: "assistant-1",
      role: "assistant",
      text: "工具前说明。工具后继续。",
      timestamp: "2026-05-28T00:00:01.000Z",
      sequence: 1,
    },
  ];
  const outputs: CommandChunk[] = [];
  const diffs: FileDiffSummary[] = [];
  const toolCalls: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "shell",
      title: "Shell",
      status: "completed",
      timestamp: "2026-05-28T00:00:02.000Z",
      updatedAt: "2026-05-28T00:00:02.000Z",
      sequence: 2,
    },
  ];
  const replayTimeline: SessionTimelineEntry[] = [
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content",
          text: "工具前说明。",
          timestamp: "2026-05-28T00:00:01.000Z",
          sequence: 1,
        },
        {
          id: "assistant-1:content:3",
          kind: "content",
          text: "工具后继续。",
          timestamp: "2026-05-28T00:00:03.000Z",
          sequence: 3,
        },
      ],
      timestamp: "2026-05-28T00:00:01.000Z",
      updatedAt: "2026-05-28T00:00:03.000Z",
      sequence: 1,
    },
    {
      id: "tool:tool-1",
      kind: "tool_call",
      toolCall: toolCalls[0]!,
      timestamp: "2026-05-28T00:00:02.000Z",
      updatedAt: "2026-05-28T00:00:02.000Z",
      sequence: 2,
    },
  ];
  let replaceCalled = false;

  const result = readReimportedHistoryPage({
    sessionId: "session-1",
    message: "历史已从 ACP 重新导入。",
    sessionMessageStore: {
      list: () => messages,
      replace: () => undefined,
      listPage: () => ({ messages, hasMore: false }),
    },
    sessionArtifactStore: {
      get: () => ({ outputs, diffs, toolCalls }),
      getPage: () => ({ outputs, diffs, toolCalls, hasMore: false }),
    },
    sessionTimelineStore: {
      list: () => replayTimeline,
      replace: () => {
        replaceCalled = true;
        return [];
      },
    },
  });

  assert.equal(replaceCalled, false);
  assert.equal(result.timeline, replayTimeline);
  assert.deepEqual(
    result.timeline?.flatMap((entry) =>
      entry.kind === "assistant_message"
        ? entry.chunks.map((chunk) => `${chunk.kind}:${chunk.sequence}:${chunk.text}`)
        : entry.kind === "tool_call" || entry.kind === "user_message" || entry.kind === "system_message"
          ? [`${entry.kind}:${entry.sequence}`]
          : [`${entry.kind}:transcript-event`],
    ),
    [
      "content:1:工具前说明。",
      "content:3:工具后继续。",
      "tool_call:2",
    ],
  );
});

test("resolveLegacyHistoryBaseline falls back to canonical timeline when legacy mirrors are empty", () => {
  const timeline: SessionTimelineEntry[] = [
    {
      id: "user-1",
      kind: "user_message",
      message: {
        id: "user-1",
        role: "user",
        text: "继续",
        timestamp: "2026-05-28T00:00:00.000Z",
        sequence: 1,
      },
      timestamp: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1:content",
        kind: "content",
        text: "好的",
        timestamp: "2026-05-28T00:00:01.000Z",
        sequence: 2,
      }],
      timestamp: "2026-05-28T00:00:01.000Z",
      updatedAt: "2026-05-28T00:00:01.000Z",
      sequence: 2,
    },
    {
      id: "tool:cmd-1",
      kind: "tool_call",
      toolCall: {
        id: "cmd-1",
        commandId: "cmd-1",
        kind: "shell",
        title: "Shell",
        status: "completed",
        output: "ok",
        stream: "stdout",
        timestamp: "2026-05-28T00:00:02.000Z",
        updatedAt: "2026-05-28T00:00:03.000Z",
        sequence: 3,
      },
      timestamp: "2026-05-28T00:00:02.000Z",
      updatedAt: "2026-05-28T00:00:03.000Z",
      sequence: 3,
    },
  ];

  const baseline = resolveLegacyHistoryBaseline({
    messages: [],
    artifacts: {
      outputs: [],
      diffs: [{ path: "file.ts", status: "modified", additions: 1, deletions: 0 }],
      toolCalls: [],
    },
    timeline,
  });

  assert.deepEqual(
    baseline.messages.map((message) => [message.id, message.text]),
    [
      ["user-1", "继续"],
      ["assistant-1", "好的"],
    ],
  );
  assert.deepEqual(
    baseline.artifacts.toolCalls.map((toolCall) => toolCall.id),
    ["cmd-1"],
  );
  assert.deepEqual(
    baseline.artifacts.outputs.map((output) => [output.commandId, output.text]),
    [["cmd-1", "ok"]],
  );
  assert.deepEqual(baseline.artifacts.diffs, [
    { path: "file.ts", status: "modified", additions: 1, deletions: 0 },
  ]);
});

test("sanitizeRecoveredHistorySequenceResets clears stale low sequences after a later timestamp gap", () => {
  const timeline: SessionTimelineEntry[] = [
    {
      id: "assistant-200",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-200:content",
          kind: "content",
          text: "authoritative history",
          timestamp: "2026-05-28T10:00:00.000Z",
          sequence: 200,
        },
      ],
      timestamp: "2026-05-28T10:00:00.000Z",
      updatedAt: "2026-05-28T10:00:00.000Z",
      sequence: 200,
    },
    {
      id: "late-user",
      kind: "user_message",
      message: {
        id: "late-user",
        role: "user",
        text: "post-compact prompt",
        timestamp: "2026-05-28T10:10:00.000Z",
        sequence: 1,
      },
      timestamp: "2026-05-28T10:10:00.000Z",
      updatedAt: "2026-05-28T10:10:00.000Z",
      sequence: 1,
    },
    {
      id: "late-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "late-assistant:content",
          kind: "content",
          text: "post-compact reply",
          timestamp: "2026-05-28T10:11:00.000Z",
          sequence: 2,
        },
      ],
      timestamp: "2026-05-28T10:11:00.000Z",
      updatedAt: "2026-05-28T10:11:00.000Z",
      sequence: 2,
    },
    {
      id: "assistant-300",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-300:content",
          kind: "content",
          text: "new authoritative replay",
          timestamp: "2026-05-28T10:12:00.000Z",
          sequence: 300,
        },
      ],
      timestamp: "2026-05-28T10:12:00.000Z",
      updatedAt: "2026-05-28T10:12:00.000Z",
      sequence: 300,
    },
    {
      id: "tool:late-tool",
      kind: "tool_call",
      toolCall: {
        id: "late-tool",
        kind: "read",
        title: "Read file",
        status: "completed",
        timestamp: "2026-05-28T10:20:00.000Z",
        updatedAt: "2026-05-28T10:20:00.000Z",
        sequence: 3,
      },
      timestamp: "2026-05-28T10:20:00.000Z",
      updatedAt: "2026-05-28T10:20:00.000Z",
      sequence: 3,
    },
  ];

  const sanitized = sanitizeRecoveredHistorySequenceResets(timeline);
  const lateUser = sanitized.entries[1];
  const lateAssistant = sanitized.entries[2];
  const authoritative = sanitized.entries[3];
  const lateTool = sanitized.entries[4];

  assert.deepEqual(Array.from(sanitized.clearedMessageIds), ["late-user", "late-assistant"]);
  assert.deepEqual(Array.from(sanitized.clearedToolCallIds), ["late-tool"]);
  assert.equal(lateUser?.kind, "user_message");
  assert.equal(lateUser?.sequence, undefined);
  assert.equal(lateUser?.kind === "user_message" ? lateUser.message.sequence : undefined, undefined);
  assert.equal(lateAssistant?.kind, "assistant_message");
  assert.equal(lateAssistant?.sequence, undefined);
  assert.equal(
    lateAssistant?.kind === "assistant_message" ? lateAssistant.chunks[0]?.sequence : undefined,
    undefined,
  );
  assert.equal(authoritative?.kind, "assistant_message");
  assert.equal(authoritative?.sequence, 300);
  assert.equal(lateTool?.kind, "tool_call");
  assert.equal(lateTool?.sequence, undefined);
  assert.equal(lateTool?.kind === "tool_call" ? lateTool.toolCall.sequence : undefined, undefined);
});

test("clearRecoveredArtifactTimelineSequences clears output chunks that would rebuild stale tool ordering", () => {
  const outputs: CommandChunk[] = [
    {
      id: "chunk-1",
      commandId: "late-tool",
      text: "stdout",
      stream: "stdout",
      timestamp: "2026-05-28T10:20:00.000Z",
      sequence: 3,
    },
    {
      id: "chunk-2",
      commandId: "other-tool",
      text: "stderr",
      stream: "stderr",
      timestamp: "2026-05-28T10:21:00.000Z",
      sequence: 4,
    },
  ];
  const toolCalls: AgentToolCall[] = [
    {
      id: "late-tool",
      kind: "read",
      title: "Read file",
      status: "completed",
      timestamp: "2026-05-28T10:20:00.000Z",
      updatedAt: "2026-05-28T10:20:00.000Z",
      sequence: 3,
    },
    {
      id: "other-tool",
      kind: "read",
      title: "Read other file",
      status: "completed",
      timestamp: "2026-05-28T10:21:00.000Z",
      updatedAt: "2026-05-28T10:21:00.000Z",
      sequence: 4,
    },
  ];

  const sanitized = clearRecoveredArtifactTimelineSequences({
    outputs,
    toolCalls,
    clearedToolCallIds: new Set(["late-tool"]),
  });

  assert.equal(sanitized.outputs[0]?.sequence, undefined);
  assert.equal(sanitized.outputs[1]?.sequence, 4);
  assert.equal(sanitized.toolCalls[0]?.sequence, undefined);
  assert.equal(sanitized.toolCalls[1]?.sequence, 4);
});

test("findAcpReplayCoverageGap detects omitted assistant messages", () => {
  const previousMessages: AgentMessage[] = [
    {
      id: "assistant-existing",
      role: "assistant",
      text: "第一轮完整回复",
      timestamp: "2026-06-08T01:00:00.000Z",
    },
    {
      id: "assistant-replayed",
      role: "assistant",
      text: "第二轮回复",
      timestamp: "2026-06-08T01:00:01.000Z",
    },
  ];
  const replayMessages: AgentMessage[] = [
    {
      id: "assistant-replayed",
      role: "assistant",
      text: "第二轮回复",
      timestamp: "2026-06-08T01:00:01.000Z",
    },
  ];

  assert.equal(
    findAcpReplayCoverageGap({ previousMessages, replayMessages }),
    "ACP replay 遗漏了 1 条本地已有的助手消息。",
  );
});

test("findAcpReplayCoverageGap detects omitted visible plan", () => {
  const previousPlan: AgentPlan = {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [{ content: "已有计划", priority: "high", status: "in_progress" }],
  };

  assert.equal(
    findAcpReplayCoverageGap({
      previousMessages: [],
      replayMessages: [],
      previousPlan,
      replayPlan: { updatedAt: "2026-06-08T01:01:00.000Z", entries: [] },
    }),
    "ACP replay 未返回本地已有的可见计划。",
  );
});

test("findAcpReplayCoverageGap accepts assistant text replayed as separate chunks", () => {
  const previousMessages: AgentMessage[] = [
    {
      id: "assistant-existing",
      role: "assistant",
      text: "我先并行创建几个任务:任务都建好了喵~",
      timestamp: "2026-06-08T01:00:00.000Z",
    },
  ];
  const replayMessages: AgentMessage[] = [
    {
      id: "assistant-replayed-1",
      role: "assistant",
      text: "我先并行创建几个任务:",
      timestamp: "2026-06-08T01:00:00.000Z",
    },
    {
      id: "assistant-replayed-2",
      role: "assistant",
      text: "任务都建好了喵~",
      timestamp: "2026-06-08T01:00:01.000Z",
    },
  ];

  assert.equal(findAcpReplayCoverageGap({ previousMessages, replayMessages }), null);
});

test("findAcpReplayCoverageGap accepts replay without local markdown emphasis", () => {
  const previousMessages: AgentMessage[] = [
    {
      id: "assistant-existing",
      role: "assistant",
      text: "现在状态是:**2 个完成、1 个进行中、2 个保持待办**。",
      timestamp: "2026-06-08T01:00:00.000Z",
    },
  ];
  const replayMessages: AgentMessage[] = [
    {
      id: "assistant-replayed",
      role: "assistant",
      text: "现在状态是:2 个完成、1 个进行中、2 个保持待办。",
      timestamp: "2026-06-08T01:00:00.000Z",
    },
  ];

  assert.equal(findAcpReplayCoverageGap({ previousMessages, replayMessages }), null);
});

test("findAcpReplayCoverageGap accepts assistant text represented by replay thinking timeline", () => {
  const previousMessages: AgentMessage[] = [
    {
      id: "assistant-thinking-existing",
      role: "assistant",
      text: "用户想要一个待办事项列表来演示效果。",
      timestamp: "2026-06-08T01:00:00.000Z",
    },
  ];
  const replayTimeline: SessionTimelineEntry[] = [
    {
      id: "assistant-replayed",
      kind: "assistant_message",
      chunks: [
        {
          id: "thinking-1",
          kind: "thinking",
          title: "Thinking",
          text: "用户想要一个待办事项列表来演示效果。",
          status: "completed",
          timestamp: "2026-06-08T01:00:00.000Z",
          updatedAt: "2026-06-08T01:00:01.000Z",
        },
      ],
      timestamp: "2026-06-08T01:00:00.000Z",
      updatedAt: "2026-06-08T01:00:01.000Z",
    },
  ];

  assert.equal(
    findAcpReplayCoverageGap({
      previousMessages,
      replayMessages: [],
      replayTimeline,
    }),
    null,
  );
});

test("findAcpReplayCoverageGap ignores previous assistant messages represented as previous thinking timeline", () => {
  const previousMessages: AgentMessage[] = [
    {
      id: "assistant-thinking-existing",
      role: "assistant",
      text: "用户想要一个待办事项列表来演示效果。",
      timestamp: "2026-06-08T01:00:00.000Z",
    },
  ];
  const previousTimeline: SessionTimelineEntry[] = [
    {
      id: "assistant-thinking-existing",
      kind: "assistant_message",
      chunks: [
        {
          id: "thinking-1",
          kind: "thinking",
          title: "Thinking",
          text: "用户想要一个待办事项列表来演示效果。",
          status: "completed",
          timestamp: "2026-06-08T01:00:00.000Z",
          updatedAt: "2026-06-08T01:00:01.000Z",
        },
      ],
      timestamp: "2026-06-08T01:00:00.000Z",
      updatedAt: "2026-06-08T01:00:01.000Z",
    },
  ];

  assert.equal(
    findAcpReplayCoverageGap({
      previousMessages,
      replayMessages: [],
      previousTimeline,
    }),
    null,
  );
});

test("findAcpReplayCoverageGap accepts replay covering previous assistant text and plan", () => {
  const previousPlan: AgentPlan = {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [{ content: "已有计划", priority: "high", status: "in_progress" }],
  };

  assert.equal(
    findAcpReplayCoverageGap({
      previousMessages: [
        {
          id: "assistant-existing",
          role: "assistant",
          text: "第一轮完整回复",
          timestamp: "2026-06-08T01:00:00.000Z",
        },
      ],
      replayMessages: [
        {
          id: "assistant-replayed",
          role: "assistant",
          text: "第一轮完整回复\n\n第二轮回复",
          timestamp: "2026-06-08T01:00:01.000Z",
        },
      ],
      previousPlan,
      replayPlan: previousPlan,
    }),
    null,
  );
});
