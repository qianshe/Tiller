import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessionTimelineFromLegacy,
  type AgentMessage,
  type AgentToolCall,
  type CommandChunk,
  type SessionSummary,
  type SessionTimelineEntry,
} from "@tiller/shared";
import type { AgentPlan, SessionUpdateRecord } from "@tiller/shared";
import { reduceSessionUpdateRecords } from "../session-updates/records.js";
import { createSessionUpdateRecord } from "../session-updates/reducer.js";
import { createProviderHistoryService } from "./service.js";

function summary(sessionId: string): SessionSummary {
  return {
    id: sessionId,
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    cwd: "D:/repo",
    worktreeName: "main",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    messageCount: 0,
  };
}

test("readSessionPlan restores latest plan from the persisted plan store", () => {
  const sessionId = "session-plan-from-updates";
  const latestPlan: AgentPlan = {
    updatedAt: "2026-06-08T01:01:00.000Z",
    entries: [{ content: "最新计划", priority: "high", status: "in_progress" }],
  };
  const service = createTestProviderHistoryService({}, {
    sessionPlanStore: {
      get: () => latestPlan,
      replace: () => latestPlan,
      remove: () => undefined,
    },
  });

  assert.deepEqual(service.readSessionPlan(sessionId), latestPlan);
});

test("readSessionPlan skips empty stored plans", () => {
  const sessionId = "session-plan-skips-empty";
  const emptyPlan: AgentPlan = {
    updatedAt: "2026-06-08T01:01:00.000Z",
    entries: [],
  };
  const service = createTestProviderHistoryService({}, {
    sessionPlanStore: {
      get: () => emptyPlan,
      replace: () => emptyPlan,
      remove: () => undefined,
    },
  });

  assert.equal(service.readSessionPlan(sessionId), undefined);
});

test("readSessionPlan recovers OpenCode plans from persisted todo tool-call updates", () => {
  const sessionId = "session-opencode-plan-from-tool-call";
  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates: [{
          sessionId,
          runtimeSessionId: "runtime-1",
          providerId: "opencode",
          sequence: 1,
          source: "acp_load_replay",
          updateType: "tool-call",
          receivedAt: "2026-07-07T15:05:41.190Z",
          payloadJson: JSON.stringify({
            type: "tool-call",
            toolCall: {
              id: "call-opencode-todo",
              kind: "write",
              title: "3 todos",
              input: JSON.stringify({
                todos: [
                  { content: "读文件", status: "completed" },
                  { content: "AST 搜索", status: "in_progress" },
                  { content: "写总结", status: "pending" },
                ],
              }),
              timestamp: "2026-07-07T14:55:12.252Z",
              updatedAt: "2026-07-07T14:55:12.518Z",
            },
          }),
        }],
        hasMore: false,
      }),
    },
    {
      sessionPlanStore: {
        get: () => undefined,
        replace: (_sessionId, plan) => plan,
        remove: () => undefined,
      },
    },
  );

  assert.deepEqual(service.readSessionPlan(sessionId), {
    updatedAt: "2026-07-07T14:55:12.518Z",
    entries: [
      { content: "读文件", priority: "medium", status: "completed" },
      { content: "AST 搜索", priority: "medium", status: "in_progress" },
      { content: "写总结", priority: "medium", status: "pending" },
    ],
  });
});

test("recordSessionPlan persists visible plans to the plan store", () => {
  const sessionId = "session-record-visible-plan";
  const plan: AgentPlan = {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [{ content: "可见计划", priority: "high", status: "completed" }],
  };
  let stored: AgentPlan | undefined;
  const service = createTestProviderHistoryService({}, {
    sessionPlanStore: {
      get: () => stored,
      replace: (_sessionId: string, nextPlan: AgentPlan) => {
        stored = nextPlan;
        return nextPlan;
      },
      remove: () => undefined,
    },
  });

  service.recordSessionPlan(sessionId, plan);

  assert.deepEqual(service.readSessionPlan(sessionId), plan);
});

test("recordSessionPlan ignores empty plans", () => {
  const sessionId = "session-empty-recorded-plan";
  const service = createTestProviderHistoryService();
  service.recordSessionPlan(sessionId, {
    updatedAt: "2026-06-08T01:01:00.000Z",
    entries: [],
  });

  assert.equal(service.readSessionPlan(sessionId), undefined);
});

test("provider history migration materializes canonical history and plans for every stored session", () => {
  const sessionId = "session-bulk-migrate";
  const plan: AgentPlan = {
    updatedAt: "2026-06-08T01:01:00.000Z",
    entries: [{ content: "迁移计划", priority: "high", status: "in_progress" }],
  };
  const messages: AgentMessage[] = [
    {
      id: "user-1",
      role: "user",
      text: "开始",
      timestamp: "2026-06-30T10:00:00.000Z",
      sequence: 1,
    },
  ];
  const toolCalls: AgentToolCall[] = [{
    id: "tool-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    output: "done",
    timestamp: "2026-06-30T10:00:01.000Z",
    updatedAt: "2026-06-30T10:00:01.000Z",
    sequence: 2,
  }];
  const expectedTimeline = buildSessionTimelineFromLegacy({
    messages,
    outputs: [],
    toolCalls,
  });
  let migratedTimeline: ReturnType<typeof buildSessionTimelineFromLegacy> = [];
  let migratedPlan: AgentPlan | undefined;
  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates: [planUpdateRecord(sessionId, 1, plan)],
        hasMore: false,
      }),
    },
    {
      sessionStore: { list: () => [summary(sessionId)] },
      sessionMessageStore: {
        list: () => messages,
        replace: () => {},
        append: () => {},
      },
      sessionArtifactStore: {
        get: () => ({ toolCalls, outputs: [], diffs: [] }),
        replaceToolCalls: () => {},
      },
      sessionTimelineStore: {
        list: () => migratedTimeline,
        replace: (_sessionId, entries) => {
          migratedTimeline = entries;
          return entries;
        },
      },
      sessionPlanStore: {
        get: () => migratedPlan,
        replace: (_sessionId, nextPlan) => {
          migratedPlan = nextPlan;
          return nextPlan;
        },
        remove: () => undefined,
      },
    },
  );

  service.migrateLegacySessionHistory();

  assert.deepEqual(migratedTimeline, expectedTimeline);
  assert.deepEqual(migratedPlan, plan);
});

test("provider history migration purges legacy mirrors for inactive stored sessions after canonical migration", () => {
  const sessionId = "session-purge-legacy-history";
  const plan: AgentPlan = {
    updatedAt: "2026-06-08T01:01:00.000Z",
    entries: [{ content: "迁移计划", priority: "high", status: "in_progress" }],
  };
  const messages: AgentMessage[] = [{
    id: "user-1",
    role: "user",
    text: "开始",
    timestamp: "2026-06-30T10:00:00.000Z",
    sequence: 1,
  }];
  const toolCalls: AgentToolCall[] = [{
    id: "tool-1",
    kind: "shell",
    title: "Shell",
    status: "completed",
    output: "done",
    timestamp: "2026-06-30T10:00:01.000Z",
    updatedAt: "2026-06-30T10:00:01.000Z",
    sequence: 2,
  }];
  let removedMessages = 0;
  let clearedOutputs = 0;
  let clearedToolCalls = 0;
  let removedUpdates = 0;
  let migratedTimeline: ReturnType<typeof buildSessionTimelineFromLegacy> = [];
  let migratedPlan: AgentPlan | undefined;
  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates: [planUpdateRecord(sessionId, 1, plan)],
        hasMore: false,
      }),
      remove: () => {
        removedUpdates += 1;
      },
    },
    {
      sessionStore: { list: () => [summary(sessionId)] },
      sessionMessageStore: {
        list: () => messages,
        replace: () => {},
        append: () => {},
        remove: () => {
          removedMessages += 1;
        },
      },
      sessionArtifactStore: {
        get: () => ({ toolCalls, outputs: [], diffs: [] }),
        replaceOutputs: (_sessionId, outputs) => {
          clearedOutputs += 1;
          assert.deepEqual(outputs, []);
        },
        replaceToolCalls: (_sessionId, nextToolCalls) => {
          clearedToolCalls += 1;
          assert.deepEqual(nextToolCalls, []);
        },
      },
      sessionTimelineStore: {
        list: () => migratedTimeline,
        replace: (_sessionId, entries) => {
          migratedTimeline = entries;
          return entries;
        },
      },
      sessionPlanStore: {
        get: () => migratedPlan,
        replace: (_sessionId, nextPlan) => {
          migratedPlan = nextPlan;
          return nextPlan;
        },
        remove: () => undefined,
      },
    },
  );

  service.migrateLegacySessionHistory();

  assert.deepEqual(migratedPlan, plan);
  assert.ok(migratedTimeline.length > 0);
  assert.equal(removedMessages, 1);
  assert.equal(clearedOutputs, 1);
  assert.equal(clearedToolCalls, 1);
  assert.equal(removedUpdates, 1);
});

test("provider history migration keeps legacy records for active sessions", () => {
  const sessionId = "session-keep-active-legacy";
  let removedMessages = 0;
  let clearedOutputs = 0;
  let clearedToolCalls = 0;
  let removedUpdates = 0;
  const service = createTestProviderHistoryService(
    {
      listPage: () => ({ updates: [], hasMore: false }),
      remove: () => {
        removedUpdates += 1;
      },
    },
    {
      sessions: new Map([[sessionId, {} as never]]),
      sessionStore: { list: () => [summary(sessionId)] },
      sessionMessageStore: {
        list: () => [],
        replace: () => {},
        append: () => {},
        remove: () => {
          removedMessages += 1;
        },
      },
      sessionArtifactStore: {
        get: () => ({ toolCalls: [], outputs: [], diffs: [] }),
        replaceOutputs: () => {
          clearedOutputs += 1;
        },
        replaceToolCalls: () => {
          clearedToolCalls += 1;
        },
      },
    },
  );

  service.migrateLegacySessionHistory();

  assert.equal(removedMessages, 0);
  assert.equal(clearedOutputs, 0);
  assert.equal(clearedToolCalls, 0);
  assert.equal(removedUpdates, 0);
});

test("hasHistoryContent ignores empty plan payloads", () => {
  const service = createTestProviderHistoryService();

  assert.equal(
    service.hasHistoryContent({
      messages: [],
      toolCalls: [],
      outputs: [],
      diffs: [],
      plan: { updatedAt: "2026-06-08T01:01:00.000Z", entries: [] },
    }),
    false,
  );
});

test("provider history refresh does not load provider files", async () => {
  const service = createTestProviderHistoryService();

  await assert.doesNotReject(service.refreshAuthoritativeSessionHistory("session-1"));
});

test("provider history refresh normalizes stored tool calls before handler reads", async () => {
  const sessionId = "session-normalize-stored-tool-calls";
  let toolCalls: AgentToolCall[] = [
    {
      id: "call-1",
      kind: "tool",
      title: "Tool call call-1",
      status: "completed",
      input: JSON.stringify({
        server: "sanshu",
        tool: "zhi",
        arguments: { message: "review" },
      }),
      timestamp: "2026-07-06T00:00:01.000Z",
      updatedAt: "2026-07-06T00:00:02.000Z",
    },
  ];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-1",
      kind: "tool_call",
      toolCall: toolCalls[0]!,
      timestamp: "2026-07-06T00:00:01.000Z",
      updatedAt: "2026-07-06T00:00:02.000Z",
    },
  ];
  const service = createTestProviderHistoryService(
    {},
    {
      sessionStore: { list: () => [summary(sessionId)] },
      sessionArtifactStore: {
        get: () => ({ toolCalls, outputs: [], diffs: [] }),
        replaceToolCalls: (_sessionId, nextToolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          timeline = entries;
          return entries;
        },
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);

  assert.equal(toolCalls[0]?.kind, "mcp");
  assert.equal(toolCalls[0]?.title, "Tool: sanshu/zhi");
  const firstEntry = timeline[0];
  if (!firstEntry || firstEntry.kind !== "tool_call") {
    assert.fail("expected repaired tool_call timeline entry");
  }
  assert.equal(firstEntry.toolCall.kind, "mcp");
  assert.equal(firstEntry.toolCall.title, "Tool: sanshu/zhi");
});

test("provider history refresh prunes OpenCode todo-count history from timeline and session updates", async () => {
  const sessionId = "session-opencode-plan-history-pruned";
  const originalToolCalls: AgentToolCall[] = [
    {
      id: "call-plan",
      kind: "write",
      title: "2 todos",
      status: "completed",
      input: JSON.stringify({
        todos: [
          { content: "读文件", status: "completed" },
          { content: "写总结", status: "pending" },
        ],
      }),
      timestamp: "2026-07-07T14:55:12.252Z",
      updatedAt: "2026-07-07T14:55:12.518Z",
    },
    {
      id: "call-search",
      kind: "search",
      title: "Search",
      status: "completed",
      timestamp: "2026-07-07T14:56:12.252Z",
      updatedAt: "2026-07-07T14:56:12.518Z",
    },
  ];
  let toolCalls: AgentToolCall[] = [...originalToolCalls];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "tool:call-plan",
      kind: "tool_call",
      toolCall: toolCalls[0]!,
      timestamp: toolCalls[0]!.timestamp,
      updatedAt: toolCalls[0]!.updatedAt,
    },
    {
      id: "tool:call-search",
      kind: "tool_call",
      toolCall: toolCalls[1]!,
      timestamp: toolCalls[1]!.timestamp,
      updatedAt: toolCalls[1]!.updatedAt,
    },
  ];
  let replacedUpdates: SessionUpdateRecord[] = [];
  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates: [
          {
            sessionId,
            runtimeSessionId: "runtime-1",
            providerId: "opencode",
            sequence: 1,
            source: "acp_load_replay",
            updateType: "tool-call",
            receivedAt: "2026-07-07T15:05:41.190Z",
            payloadJson: JSON.stringify({
              type: "tool-call",
              toolCall: toolCalls[0],
            }),
          },
          {
            sessionId,
            runtimeSessionId: "runtime-1",
            providerId: "opencode",
            sequence: 2,
            source: "acp_load_replay",
            updateType: "tool-call",
            receivedAt: "2026-07-07T15:05:42.190Z",
            payloadJson: JSON.stringify({
              type: "tool-call",
              toolCall: toolCalls[1],
            }),
          },
        ],
        hasMore: false,
      }),
    },
    {
      sessionStore: {
        list: () => [{ ...summary(sessionId), agentId: "opencode", agentName: "OpenCode" }],
      },
      sessionUpdateStore: {
        replaceSession: (_sessionId: string, updates: SessionUpdateRecord[]) => {
          replacedUpdates = updates;
        },
        listPage: () => ({
          updates: [
            {
              sessionId,
              runtimeSessionId: "runtime-1",
              providerId: "opencode",
              sequence: 1,
              source: "acp_load_replay",
              updateType: "tool-call",
              receivedAt: "2026-07-07T15:05:41.190Z",
              payloadJson: JSON.stringify({
                type: "tool-call",
                toolCall: originalToolCalls[0],
              }),
            },
            {
              sessionId,
              runtimeSessionId: "runtime-1",
              providerId: "opencode",
              sequence: 2,
              source: "acp_load_replay",
              updateType: "tool-call",
              receivedAt: "2026-07-07T15:05:42.190Z",
              payloadJson: JSON.stringify({
                type: "tool-call",
                toolCall: originalToolCalls[1],
              }),
            },
          ],
          hasMore: false,
        }),
      },
      sessionArtifactStore: {
        get: () => ({ toolCalls, outputs: [], diffs: [] }),
        replaceToolCalls: (_sessionId, nextToolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          timeline = entries;
          return entries;
        },
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);

  assert.deepEqual(toolCalls.map((toolCall) => toolCall.id), ["call-search"]);
  assert.deepEqual(
    timeline.filter((entry) => entry.kind === "tool_call").map((entry) => entry.toolCall.id),
    ["call-search"],
  );
  assert.deepEqual(replacedUpdates.map((update) => update.sequence), [2]);
});

test("provider history refresh materializes canonical timeline from legacy local stores once", async () => {
  const sessionId = "session-materialize-canonical";
  const messages: AgentMessage[] = [
    {
      id: "user-1",
      role: "user",
      text: "开始",
      timestamp: "2026-06-30T10:00:00.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1",
      role: "assistant",
      text: "已完成",
      timestamp: "2026-06-30T10:00:02.000Z",
      sequence: 3,
    },
  ];
  const toolCalls: AgentToolCall[] = [{
    id: "assistant-1:thinking",
    commandId: "assistant-1:thinking",
    kind: "think",
    title: "Thinking",
    status: "completed",
    output: "Reason",
    timestamp: "2026-06-30T10:00:01.000Z",
    updatedAt: "2026-06-30T10:00:01.000Z",
    sequence: 2,
  }];
  const expected = buildSessionTimelineFromLegacy({
    messages,
    outputs: [],
    toolCalls,
  });
  let timeline: ReturnType<typeof buildSessionTimelineFromLegacy> = [];
  let replaces = 0;
  const service = createTestProviderHistoryService(
    {},
    {
      sessionMessageStore: {
        list: () => messages,
        replace: () => {},
        append: () => {},
      },
      sessionArtifactStore: {
        get: () => ({ toolCalls, outputs: [], diffs: [] }),
        replaceToolCalls: () => {},
      },
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          replaces += 1;
          timeline = entries;
          return entries;
        },
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);
  await service.refreshAuthoritativeSessionHistory(sessionId);

  assert.deepEqual(timeline, expected);
  assert.equal(replaces, 1);
});

test("provider history refresh normalizes canonical timeline rebuilt from session updates", async () => {
  const sessionId = "session-normalize-updates-tool-calls";
  const updates = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 1,
      source: "acp_live",
      event: {
        type: "tool-call",
        toolCall: {
          id: "call-1",
          kind: "tool",
          title: "Tool call call-1",
          status: "completed",
          input: JSON.stringify({
            server: "sanshu",
            tool: "zhi",
            arguments: { message: "review" },
          }),
          timestamp: "2026-07-06T00:00:01.000Z",
          updatedAt: "2026-07-06T00:00:02.000Z",
          sequence: 1,
        },
      },
    }),
  ];
  let timeline: SessionTimelineEntry[] = [];
  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates,
        hasMore: false,
      }),
    },
    {
      sessionStore: { list: () => [summary(sessionId)] },
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          timeline = entries;
          return entries;
        },
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);

  assert.equal(timeline[0]?.kind, "tool_call");
  assert.equal(timeline[0]?.toolCall.kind, "mcp");
  assert.equal(timeline[0]?.toolCall.title, "Tool: sanshu/zhi");
});

test("provider history refresh applies only incremental session updates after initial repair", async () => {
  const sessionId = "session-incremental-refresh";
  const initialUpdates = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 1,
      source: "acp_live",
      event: {
        type: "message",
        message: {
          id: "assistant-1",
          role: "assistant",
          text: "第一段",
          timestamp: "2026-07-04T22:49:54.000Z",
          sequence: 1,
        },
      },
    }),
  ];
  const incrementalUpdates = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 2,
      source: "acp_live",
      event: {
        type: "tool-call",
        toolCall: {
          id: "tool-1",
          kind: "shell",
          title: "Shell",
          status: "completed",
          output: "ok",
          timestamp: "2026-07-04T22:49:55.000Z",
          updatedAt: "2026-07-04T22:49:56.000Z",
          sequence: 2,
        },
      },
    }),
  ];
  let allUpdates = [...initialUpdates];
  let timeline: SessionTimelineEntry[] = [];
  let listSinceCalls = 0;
  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates: allUpdates,
        hasMore: false,
      }),
      listSinceSequence: (_sessionId, afterSequence) => {
        listSinceCalls += 1;
        if (afterSequence < 2) {
          allUpdates = [...initialUpdates, ...incrementalUpdates];
          return incrementalUpdates;
        }
        return [];
      },
    },
    {
      sessionStore: { list: () => [summary(sessionId)] },
      sessionMessageStore: {
        list: () => [],
        replace: () => [],
        append: () => {},
      },
      sessionArtifactStore: {
        get: () => ({ toolCalls: [], outputs: [], diffs: [] }),
        replaceOutputs: () => ({ outputs: [], diffs: [], toolCalls: [] }),
        replaceToolCalls: () => ({ outputs: [], diffs: [], toolCalls: [] }),
      },
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          timeline = entries;
          return entries;
        },
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);
  await service.refreshAuthoritativeSessionHistory(sessionId);

  assert.equal(listSinceCalls, 1);
  assert.deepEqual(
    timeline.map((entry) => entry.kind),
    ["assistant_message", "tool_call"],
  );
});

test("provider history refresh rebuilds duplicated persisted messages and thinking state from authoritative updates", async () => {
  const sessionId = "session-rebuild-duplicated-state";
  const updates = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 1,
      source: "acp_live",
      event: {
        type: "message",
        message: {
          id: "assistant-final",
          role: "assistant",
          text: "Line 2\nLine 3",
          timestamp: "2026-07-08T11:10:10.100Z",
          sequence: 1,
          streaming: true,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 2,
      source: "acp_live",
      event: {
        type: "message",
        message: {
          id: "assistant-final",
          role: "assistant",
          text: "Line 4",
          timestamp: "2026-07-08T11:10:10.200Z",
          sequence: 2,
          streaming: true,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 3,
      source: "acp_live",
      event: {
        type: "message",
        message: {
          id: "assistant-final",
          role: "assistant",
          text: "Line 1\nLine 2\nLine 3\nLine 4",
          timestamp: "2026-07-08T11:10:10.300Z",
          sequence: 3,
          streaming: false,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 4,
      source: "acp_live",
      event: {
        type: "tool-call",
        toolCall: {
          id: "thinking-1",
          commandId: "thinking-1",
          kind: "think",
          title: "Thinking",
          status: "running",
          output: "Line 1\nLine 2\nLine 3",
          timestamp: "2026-07-08T11:10:10.400Z",
          updatedAt: "2026-07-08T11:10:10.400Z",
          sequence: 4,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 5,
      source: "acp_live",
      event: {
        type: "tool-call",
        toolCall: {
          id: "thinking-1",
          commandId: "thinking-1",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "Line 2\nLine 3\nLine 4",
          timestamp: "2026-07-08T11:10:10.500Z",
          updatedAt: "2026-07-08T11:10:10.500Z",
          sequence: 5,
        },
      },
    }),
  ];
  const expected = reduceSessionUpdateRecords(updates);
  let messages: AgentMessage[] = [
    {
      id: "assistant-final",
      role: "assistant" as const,
      text: "Line 2\nLine 3Line 4Line 1\nLine 2\nLine 3\nLine 4",
      timestamp: "2026-07-08T11:10:10.100Z",
      sequence: 1,
      streaming: false,
    },
  ];
  let toolCalls: AgentToolCall[] = [
    {
      id: "thinking-1",
      commandId: "thinking-1",
      kind: "think" as const,
      title: "Thinking",
      status: "completed" as const,
      output: "Line 1\nLine 2\nLine 3Line 2\nLine 3\nLine 4",
      timestamp: "2026-07-08T11:10:10.400Z",
      updatedAt: "2026-07-08T11:10:10.500Z",
      sequence: 4,
    },
  ];
  let timeline = JSON.parse(JSON.stringify(expected.entries)) as typeof expected.entries;
  const assistantEntry = timeline.find((entry) => entry.id === "assistant-final");
  if (assistantEntry?.kind === "assistant_message") {
    assistantEntry.chunks[0]!.text = "Line 2\nLine 3Line 4Line 1\nLine 2\nLine 3\nLine 4";
  }
  const thinkingEntry = timeline.find((entry) => entry.id === "thinking-1");
  if (thinkingEntry?.kind === "assistant_message") {
    thinkingEntry.chunks[0]!.text = "Line 1\nLine 2\nLine 3Line 2\nLine 3\nLine 4";
  }

  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates,
        hasMore: false,
      }),
    },
    {
      sessionStore: { list: () => [summary(sessionId)] },
      sessionMessageStore: {
        list: () => messages,
        replace: (_sessionId, nextMessages) => {
          messages = nextMessages;
        },
        append: () => {},
      },
      sessionArtifactStore: {
        get: () => ({ toolCalls, outputs: [], diffs: [] }),
        replaceOutputs: () => {},
        replaceToolCalls: (_sessionId, nextToolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          timeline = entries;
          return entries;
        },
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);

  assert.deepEqual(messages, expected.messages);
  assert.equal(toolCalls[0]?.id, expected.toolCalls[0]?.id);
  assert.equal(toolCalls[0]?.kind, expected.toolCalls[0]?.kind);
  assert.equal(toolCalls[0]?.title, expected.toolCalls[0]?.title);
  assert.equal(toolCalls[0]?.status, expected.toolCalls[0]?.status);
  assert.equal(toolCalls[0]?.output, expected.toolCalls[0]?.output);
  assert.deepEqual(timeline, expected.entries);
});

test("provider history refresh repairs repeated timeline snapshots even when no session updates exist", async () => {
  const sessionId = "session-repair-timeline-only";
  let messages: AgentMessage[] = [];
  let toolCalls: AgentToolCall[] = [];
  let outputs: CommandChunk[] = [];
  let timeline: SessionTimelineEntry[] = [{
    id: "assistant-1",
    kind: "assistant_message",
    timestamp: "2026-07-08T11:10:08.908Z",
    updatedAt: "2026-07-08T11:10:08.908Z",
    sequence: 10,
    streaming: false,
    chunks: [
      {
        id: "assistant-1:thinking",
        kind: "thinking",
        text: "Think A\nThink BThink A\nThink B",
        title: "Thinking",
        status: "completed",
        timestamp: "2026-07-08T11:10:07.908Z",
        updatedAt: "2026-07-08T11:10:08.908Z",
        sequence: 9,
      },
      {
        id: "assistant-1:content",
        kind: "content",
        text: "Line 1\nLine 2Line 1\nLine 2",
        timestamp: "2026-07-08T11:10:08.908Z",
        sequence: 10,
        streaming: false,
      },
    ],
  }];

  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates: [],
        hasMore: false,
      }),
    },
    {
      sessionStore: { list: () => [summary(sessionId)] },
      sessionMessageStore: {
        list: () => messages,
        replace: (_sessionId, nextMessages) => {
          messages = nextMessages;
        },
        append: () => {},
      },
      sessionArtifactStore: {
        get: () => ({ toolCalls, outputs, diffs: [] }),
        replaceOutputs: (_sessionId, nextOutputs) => {
          outputs = nextOutputs;
        },
        replaceToolCalls: (_sessionId, nextToolCalls) => {
          toolCalls = nextToolCalls;
        },
      },
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          timeline = entries;
          return entries;
        },
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);

  const repairedEntry = timeline[0];
  assert.equal(repairedEntry?.kind, "assistant_message");
  if (repairedEntry?.kind === "assistant_message") {
    assert.equal(repairedEntry.chunks[0]?.text, "Think A\nThink B");
    assert.equal(repairedEntry.chunks[1]?.text, "Line 1\nLine 2");
  }
  assert.equal(messages[0]?.text, "Line 1\nLine 2");
  assert.equal(toolCalls[0]?.output, "Think A\nThink B");
});

test("provider history refresh suppresses repeated identical tool-call normalization logs", async () => {
  const sessionId = "session-normalization-log-dedupe";
  const logs: string[] = [];
  const unrepairedTimeline: SessionTimelineEntry[] = [
    {
      id: "call-1",
      kind: "tool_call",
      timestamp: "2026-07-06T00:00:01.000Z",
      updatedAt: "2026-07-06T00:00:02.000Z",
      sequence: 1,
      toolCall: {
        id: "call-1",
        kind: "tool",
        title: "Tool call call-1",
        status: "completed",
        input: JSON.stringify({
          server: "sanshu",
          tool: "zhi",
          arguments: { message: "review" },
        }),
        timestamp: "2026-07-06T00:00:01.000Z",
        updatedAt: "2026-07-06T00:00:02.000Z",
        sequence: 1,
      },
    },
  ];
  const service = createTestProviderHistoryService(
    {},
    {
      sessionStore: { list: () => [summary(sessionId)] },
      logInfo: (message: string) => {
        logs.push(message);
      },
      sessionTimelineStore: {
        list: () => unrepairedTimeline,
        replace: (_sessionId, entries) => entries,
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);
  await service.refreshAuthoritativeSessionHistory(sessionId);

  assert.equal(
    logs.filter((message) =>
      message.includes("provider.history.timeline.tool_calls.normalized") &&
      message.includes(sessionId)
    ).length,
    1,
  );
});

test("provider history refresh repairs incomplete canonical timeline from persisted session updates", async () => {
  const sessionId = "session-repair-canonical-from-updates";
  const updates = [
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 1,
      source: "acp_live",
      event: {
        type: "message",
        message: {
          id: "user-1",
          role: "user",
          text: "开始",
          timestamp: "2026-07-04T22:49:54.000Z",
          sequence: 1,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 2,
      source: "acp_live",
      event: {
        type: "tool-call",
        toolCall: {
          id: "tool-1",
          kind: "shell",
          title: "Shell",
          status: "completed",
          output: "ok",
          timestamp: "2026-07-04T22:49:55.000Z",
          updatedAt: "2026-07-04T22:49:56.000Z",
          sequence: 2,
        },
      },
    }),
    createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 3,
      source: "acp_live",
      event: {
        type: "message",
        message: {
          id: "assistant-1",
          role: "assistant",
          text: "完成",
          timestamp: "2026-07-04T22:49:57.000Z",
          sequence: 3,
        },
      },
    }),
  ];
  const expectedTimeline = reduceSessionUpdateRecords(updates).entries;
  let timeline = buildSessionTimelineFromLegacy({
    messages: [
      {
        id: "user-1",
        role: "user",
        text: "开始",
        timestamp: "2026-07-04T22:49:54.000Z",
        sequence: 1,
      },
      {
        id: "assistant-1",
        role: "assistant",
        text: "完成",
        timestamp: "2026-07-04T22:49:57.000Z",
        sequence: 3,
      },
    ],
    outputs: [],
    toolCalls: [],
  });
  let replaces = 0;
  const service = createTestProviderHistoryService(
    {
      listPage: () => ({
        updates,
        hasMore: false,
      }),
    },
    {
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          replaces += 1;
          timeline = entries;
          return entries;
        },
      },
    },
  );

  await service.refreshAuthoritativeSessionHistory(sessionId);

  assert.deepEqual(timeline, expectedTimeline);
  assert.equal(replaces, 1);
});

test("provider history migration leaves existing canonical timelines untouched", () => {
  const sessionId = "session-normalize-canonical";
  const logs: string[] = [];
  let timeline: SessionTimelineEntry[] = [
    {
      id: "older-assistant",
      kind: "assistant_message",
      chunks: [{
        id: "older-assistant:content",
        kind: "content",
        text: "older",
        timestamp: "2026-06-30T10:00:00.000Z",
        sequence: 255,
      }],
      timestamp: "2026-06-30T10:00:00.000Z",
      updatedAt: "2026-06-30T10:00:00.000Z",
      sequence: 255,
    },
    {
      id: "current-user",
      kind: "user_message",
      message: {
        id: "current-user",
        role: "user",
        text: "current",
        timestamp: "2026-06-30T10:00:05.000Z",
        sequence: 256,
      },
      timestamp: "2026-06-30T10:00:05.000Z",
      updatedAt: "2026-06-30T10:00:05.000Z",
      sequence: 256,
    },
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1:content",
        kind: "content",
        text: "answer",
        timestamp: "2026-06-30T10:00:20.000Z",
        sequence: 276,
      }],
      timestamp: "2026-06-30T10:00:20.000Z",
      updatedAt: "2026-06-30T10:00:20.000Z",
      sequence: 276,
    },
    {
      id: "compaction-1",
      kind: "context_compaction",
      phase: "completed",
      source: "provider",
      summaryMessageId: "compaction-summary",
      summaryText: "continued from previous conversation",
      detailsVisibility: "expandable",
      timestamp: "2026-06-30T10:00:40.000Z",
      updatedAt: "2026-06-30T10:00:40.000Z",
      replayCompleteness: "compacted",
    },
  ];
  let replaces = 0;
  const service = createTestProviderHistoryService(
    {},
    {
      sessionStore: { list: () => [summary(sessionId)] },
      logInfo: (message: string) => {
        logs.push(message);
      },
      sessionTimelineStore: {
        list: () => timeline,
        replace: (_sessionId, entries) => {
          replaces += 1;
          timeline = entries;
          return entries;
        },
      },
    },
  );

  service.migrateLegacySessionHistory();

  assert.deepEqual(
    timeline.map((entry) => entry.id),
    ["older-assistant", "current-user", "assistant-1", "compaction-1"],
  );
  assert.equal(replaces, 0);
  assert.equal(
    logs.some((message) => message.includes("provider.history.timeline.normalized") && message.includes(sessionId)),
    false,
  );
});

function createTestProviderHistoryService(
  sessionUpdateStore: {
    listPage?: (
      sessionId: string,
      options: { limit?: number; before?: string },
    ) => { updates: SessionUpdateRecord[]; nextCursor?: string; hasMore?: boolean };
    listSinceSequence?: (
      sessionId: string,
      afterSequence: number,
      limit?: number,
    ) => SessionUpdateRecord[];
    remove?: (sessionId: string) => void;
  } = {},
  overrides: Partial<Parameters<typeof createProviderHistoryService>[0]> = {},
) {
  return createProviderHistoryService({
    sessions: new Map(),
    sessionStore: { list: () => [] },
    sessionMessageStore: {
      list: () => [],
      replace: () => {},
      append: () => {},
    },
    sessionArtifactStore: {
      get: () => ({ toolCalls: [], outputs: [], diffs: [] }),
      replaceOutputs: () => {},
      replaceToolCalls: () => {},
    },
    sessionRuntimeStore: {
      get: () => undefined,
      upsert: () => {},
    },
    sessionPlanStore: {
      get: () => undefined,
      replace: (_sessionId, plan) => plan,
      remove: () => undefined,
    },
    sessionUpdateStore: {
      replaceSession: () => {},
      ...sessionUpdateStore,
    },
    getAgents: () => [],
    getWorktrees: () => [],
    logInfo: () => {},
    logError: () => {},
    ...overrides,
  });
}

function planUpdateRecord(
  sessionId: string,
  sequence: number,
  plan: AgentPlan,
): SessionUpdateRecord {
  return {
    sessionId,
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence,
    source: "acp_load_replay",
    updateType: "plan-update",
    receivedAt: "2026-06-08T01:00:00.000Z",
    payloadJson: JSON.stringify({ type: "plan-update", plan }),
  };
}
