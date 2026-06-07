import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
  SessionTimelineEntry,
} from "@tiller/shared";
import {
  chooseRecoverySummary,
  readReimportedHistoryPage,
  recoverUserPromptFromSessionSummary,
} from "./session-history-reimport-helpers.js";

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
      timelineSequence: 1,
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "导入完成",
      timestamp: "2026-05-28T00:00:02.000Z",
      timelineSequence: 3,
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
      timelineSequence: 2,
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
