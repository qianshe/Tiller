import assert from "node:assert/strict";
import test from "node:test";
import type { AgentPlan, SessionUpdateRecord } from "@tiller/shared";
import { createProviderHistoryService } from "./service.js";

test("readSessionPlan restores latest plan from session update records", () => {
  const sessionId = "session-plan-from-updates";
  const firstPlan: AgentPlan = {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [{ content: "旧计划", priority: "medium", status: "pending" }],
  };
  const latestPlan: AgentPlan = {
    updatedAt: "2026-06-08T01:01:00.000Z",
    entries: [{ content: "最新计划", priority: "high", status: "in_progress" }],
  };
  const service = createTestProviderHistoryService({
    listPage: () => ({
      updates: [
        planUpdateRecord(sessionId, 1, firstPlan),
        planUpdateRecord(sessionId, 2, latestPlan),
      ],
    }),
  });

  assert.deepEqual(service.readSessionPlan(sessionId), latestPlan);
});

test("readSessionPlan skips empty plan update records", () => {
  const sessionId = "session-plan-skips-empty";
  const visiblePlan: AgentPlan = {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [{ content: "保留可见计划", priority: "medium", status: "pending" }],
  };
  const emptyPlan: AgentPlan = {
    updatedAt: "2026-06-08T01:01:00.000Z",
    entries: [],
  };
  const service = createTestProviderHistoryService({
    listPage: () => ({
      updates: [
        planUpdateRecord(sessionId, 1, visiblePlan),
        planUpdateRecord(sessionId, 2, emptyPlan),
      ],
    }),
  });

  assert.deepEqual(service.readSessionPlan(sessionId), visiblePlan);
});

test("readSessionPlan scans older update pages until a plan is found", () => {
  const sessionId = "session-plan-from-older-page";
  const plan: AgentPlan = {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [{ content: "分页恢复计划", priority: "high", status: "completed" }],
  };
  let calls = 0;
  const service = createTestProviderHistoryService({
    listPage: (_sessionId, options) => {
      calls += 1;
      return options.before
        ? { updates: [planUpdateRecord(sessionId, 1, plan)], hasMore: false }
        : { updates: [messageUpdateRecord(sessionId, 2)], hasMore: true, nextCursor: "sequence\t2" };
    },
  });

  assert.deepEqual(service.readSessionPlan(sessionId), plan);
  assert.equal(calls, 2);
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

function createTestProviderHistoryService(sessionUpdateStore: {
  listPage?: (
    sessionId: string,
    options: { limit?: number; before?: string },
  ) => { updates: SessionUpdateRecord[]; nextCursor?: string; hasMore?: boolean };
} = {}) {
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
      replaceToolCalls: () => {},
    },
    sessionRuntimeStore: {
      get: () => undefined,
      upsert: () => {},
    },
    sessionUpdateStore: {
      replaceSession: () => {},
      ...sessionUpdateStore,
    },
    getAgents: () => [],
    getWorktrees: () => [],
    logInfo: () => {},
    logError: () => {},
  });
}

function messageUpdateRecord(sessionId: string, sequence: number): SessionUpdateRecord {
  return {
    sessionId,
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence,
    source: "acp_load_replay",
    updateType: "message",
    receivedAt: "2026-06-08T01:00:01.000Z",
    payloadJson: JSON.stringify({ type: "message" }),
  };
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
