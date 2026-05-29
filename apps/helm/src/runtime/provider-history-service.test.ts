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
