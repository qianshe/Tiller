import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import { createProviderHistoryService } from "./provider-history-service.js";
import { createHistorySnapshot } from "./provider-history-source.js";

test("authoritative provider history drops stale local thinking after final messages", () => {
  const sessionId = "session-1";
  const localMessagesBySession = new Map<string, AgentMessage[]>();
  let storedToolCalls: AgentToolCall[] = [
    {
      id: "runtime-thinking:thinking",
      commandId: "runtime-thinking:thinking",
      kind: "think",
      title: "Thinking",
      status: "running",
      output: "这段实时 Thinking 不应在最终历史里保留",
      timestamp: "2026-05-17T09:34:39.000Z",
      updatedAt: "2026-05-17T09:34:39.000Z",
    },
    {
      id: "tool-read",
      commandId: "tool-read",
      kind: "read",
      title: "Read",
      status: "completed",
      output: "file content",
      timestamp: "2026-05-17T09:34:38.000Z",
      updatedAt: "2026-05-17T09:34:38.000Z",
    },
  ];
  let replacedToolCalls = false;

  const service = createProviderHistoryService({
    sessions: new Map(),
    sessionStore: { list: () => [] },
    sessionMessageStore: {
      list: (id) => localMessagesBySession.get(id) ?? [],
      replace: (id, messages) => {
        localMessagesBySession.set(id, messages);
      },
      append: (id, message) => {
        localMessagesBySession.set(id, [...(localMessagesBySession.get(id) ?? []), message]);
      },
    },
    sessionArtifactStore: {
      get: () => ({ toolCalls: storedToolCalls, outputs: [], diffs: [] }),
      replaceToolCalls: (_id, toolCalls) => {
        replacedToolCalls = true;
        storedToolCalls = toolCalls;
      },
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "claude-acp",
        runtimeSessionId: "runtime-1",
        lastSeenAt: "2026-05-17T09:34:37.000Z",
        state: "resumeable",
      }),
      upsert: () => {},
    },
    getAgents: () => [],
    getWorktrees: () => [],
    logInfo: () => {},
    logError: () => {},
  });
  const claudeAgent = {
    id: "claude-acp",
    name: "Claude",
    command: "claude-code-acp",
    transport: "stdio",
    protocol: "acp",
  } as any;

  service.applyAuthoritativeProviderHistory(
    sessionId,
    claudeAgent,
    "runtime-1",
    createHistorySnapshot({
      source: "adapter-authoritative-history",
      messages: [
        {
          id: "msg-final",
          role: "assistant",
          text: "最终结论",
          timestamp: "2026-05-17T09:34:40.000Z",
        },
      ],
      toolCalls: [],
      outputs: [],
      diffs: [],
    }),
  );

  assert.equal(replacedToolCalls, true);
  assert.deepEqual(storedToolCalls.map((toolCall) => toolCall.id), ["tool-read"]);
});

test("authoritative provider history skips assistant-only snapshots that would drop local user prompts", () => {
  const sessionId = "session-incomplete-provider-history";
  const localMessages: AgentMessage[] = [
    {
      id: "user-1",
      role: "user",
      text: "继续",
      timestamp: "2026-05-17T09:34:37.000Z",
    },
    {
      id: "assistant-local-1",
      role: "assistant",
      text: "本地已有较完整的回复段落 1",
      timestamp: "2026-05-17T09:34:38.000Z",
    },
    {
      id: "assistant-local-2",
      role: "assistant",
      text: "本地已有较完整的回复段落 2",
      timestamp: "2026-05-17T09:34:39.000Z",
    },
  ];
  const localMessagesBySession = new Map<string, AgentMessage[]>([[sessionId, localMessages]]);
  let replaceCalled = false;
  let replacedToolCalls = false;

  const service = createProviderHistoryService({
    sessions: new Map(),
    sessionStore: { list: () => [] },
    sessionMessageStore: {
      list: (id) => localMessagesBySession.get(id) ?? [],
      replace: (id, messages) => {
        replaceCalled = true;
        localMessagesBySession.set(id, messages);
      },
      append: (id, message) => {
        localMessagesBySession.set(id, [...(localMessagesBySession.get(id) ?? []), message]);
      },
    },
    sessionArtifactStore: {
      get: () => ({ toolCalls: [], outputs: [], diffs: [] }),
      replaceToolCalls: () => {
        replacedToolCalls = true;
      },
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "claude-acp",
        runtimeSessionId: "runtime-1",
        lastSeenAt: "2026-05-17T09:34:37.000Z",
        state: "resumeable",
        providerHistory: {
          latestMessageId: "assistant-local-2",
          latestMessageHash: "old",
          latestMessageTimestamp: "2026-05-17T09:34:39.000Z",
          messageCount: 3,
          syncedAt: "2026-05-17T09:34:39.000Z",
        },
      }),
      upsert: () => {},
    },
    getAgents: () => [],
    getWorktrees: () => [],
    logInfo: () => {},
    logError: () => {},
  });

  service.applyAuthoritativeProviderHistory(
    sessionId,
    {
      id: "claude-acp",
      name: "Claude",
      command: "claude-code-acp",
      transport: "stdio",
      protocol: "acp",
    } as any,
    "runtime-1",
    createHistorySnapshot({
      source: "adapter-authoritative-history",
      messages: [
        {
          id: "provider-assistant-only",
          role: "assistant",
          text: "导出的片段不含用户提示",
          timestamp: "2026-05-17T09:34:40.000Z",
        },
      ],
      toolCalls: [
        {
          id: "provider-tool",
          kind: "read",
          title: "Read",
          status: "completed",
          timestamp: "2026-05-17T09:34:40.000Z",
          updatedAt: "2026-05-17T09:34:40.000Z",
        },
      ],
      outputs: [],
      diffs: [],
    }),
  );

  assert.equal(replaceCalled, false);
  assert.equal(replacedToolCalls, false);
  assert.deepEqual(localMessagesBySession.get(sessionId), localMessages);
});
