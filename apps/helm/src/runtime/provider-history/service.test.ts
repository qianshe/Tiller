import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionTimelineFromLegacy, type AgentMessage, type AgentToolCall, type SessionSummary } from "@tiller/shared";
import type { AgentPlan, SessionUpdateRecord } from "@tiller/shared";
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

function createTestProviderHistoryService(
  sessionUpdateStore: {
    listPage?: (
      sessionId: string,
      options: { limit?: number; before?: string },
    ) => { updates: SessionUpdateRecord[]; nextCursor?: string; hasMore?: boolean };
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
