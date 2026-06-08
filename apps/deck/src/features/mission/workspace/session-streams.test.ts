import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall, SessionSummary, SessionTimelineEntry } from "@tiller/shared";
import { buildSessionStreamHydrationPlan } from "./session-streams";

const idleSession = {
  id: "idle-session",
  status: "idle",
} as SessionSummary;
const runningSession = {
  id: "running-session",
  status: "running",
} as SessionSummary;
const resumeUnavailableSession = {
  id: "resume-unavailable-session",
  status: "idle",
  resume: { state: "resume-unavailable" },
} as SessionSummary;

test("buildSessionStreamHydrationPlan skips cached streams and deduplicates ids", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [
      idleSession.id,
      idleSession.id,
      runningSession.id,
      resumeUnavailableSession.id,
    ],
    sessionById: new Map([
      [idleSession.id, idleSession],
      [runningSession.id, runningSession],
      [resumeUnavailableSession.id, resumeUnavailableSession],
    ]),
    messageHistoryState: {
      [runningSession.id]: { hasMore: false, loading: false },
    },
    activityHistoryState: {},
    sessionTimelineBySession: {},
    outputsBySession: {
      [runningSession.id]: [{ id: "output-1" }],
    },
    toolCallsBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [
    idleSession.id,
    resumeUnavailableSession.id,
  ]);
  assert.deepEqual(plan.activitySessionIds, [
    idleSession.id,
    resumeUnavailableSession.id,
  ]);
  assert.deepEqual(plan.resumeCheckSessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan respects existing resume checks", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {},
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: { [idleSession.id]: [{ id: "tool-1" }] as AgentToolCall[] },
    checkedResumeSessionIds: new Set([idleSession.id]),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
  assert.deepEqual(plan.activitySessionIds, []);
  assert.deepEqual(plan.resumeCheckSessionIds, []);
});

test("buildSessionStreamHydrationPlan hydrates cached todo activity when the plan is missing", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {},
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {
      [idleSession.id]: [{ id: "todo-1", kind: "todo" }] as AgentToolCall[],
    },
    sessionPlansBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
  assert.deepEqual(plan.activitySessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan hydrates cached Claude task activity when the plan is missing", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {},
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {
      [idleSession.id]: [{
        id: "toolu_task_1",
        kind: "tool",
        title: "TaskCreate",
      }] as AgentToolCall[],
    },
    sessionPlansBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
  assert.deepEqual(plan.activitySessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan rehydrates Claude task activity when stale activity state has no plan", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {
      [idleSession.id]: { hasMore: false, loading: false },
    },
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {
      [idleSession.id]: [{
        id: "toolu_task_1",
        kind: "tool",
        title: "TaskCreate",
      }] as AgentToolCall[],
    },
    sessionPlansBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.activitySessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan rehydrates plans when ACP replay omitted task tools", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {
      [idleSession.id]: { hasMore: false, loading: false },
    },
    activityHistoryState: {
      [idleSession.id]: { hasMore: false, loading: false },
    },
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {},
    sessionPlansBySession: {},
    checkedResumeSessionIds: new Set(),
    checkedPlanSessionIds: new Set(),
  });

  assert.deepEqual(plan.activitySessionIds, [idleSession.id]);
  assert.deepEqual(plan.planActivitySessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan rehydrates Claude task plans past stale loading state", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {
      [idleSession.id]: { hasMore: false, loading: true },
    },
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {
      [idleSession.id]: [{
        id: "toolu_task_1",
        kind: "tool",
        title: "TaskCreate",
      }] as AgentToolCall[],
    },
    sessionPlansBySession: {},
    checkedResumeSessionIds: new Set(),
    checkedPlanSessionIds: new Set(),
  });

  assert.deepEqual(plan.activitySessionIds, [idleSession.id]);
  assert.deepEqual(plan.planActivitySessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan skips stale plan rehydration after the plan was checked", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {
      [idleSession.id]: { hasMore: false, loading: false },
    },
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {
      [idleSession.id]: [{
        id: "toolu_task_1",
        kind: "tool",
        title: "TaskCreate",
      }] as AgentToolCall[],
    },
    sessionPlansBySession: {},
    checkedResumeSessionIds: new Set(),
    checkedPlanSessionIds: new Set([idleSession.id]),
  });

  assert.deepEqual(plan.activitySessionIds, []);
  assert.deepEqual(plan.planActivitySessionIds, []);
});

test("buildSessionStreamHydrationPlan skips cached todo activity when a plan exists", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {},
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {
      [idleSession.id]: [{ id: "todo-1", kind: "todo" }] as AgentToolCall[],
    },
    sessionPlansBySession: {
      [idleSession.id]: {
        updatedAt: "2026-06-02T13:37:09.663Z",
        entries: [{ content: "已有 plan", priority: "medium", status: "completed" }],
      },
    },
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.activitySessionIds, []);
});

test("buildSessionStreamHydrationPlan hydrates messages when timeline is missing", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {},
    sessionTimelineBySession: {},
    outputsBySession: {},
    toolCallsBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan hydrates messages when timeline is cached but history state is missing", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    activityHistoryState: {},
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan hydrates cached messages when timeline cache is missing", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([
      [
        idleSession.id,
        {
          ...idleSession,
          messageCount: 1,
        },
      ],
    ]),
    messageHistoryState: {
      [idleSession.id]: { hasMore: false, loading: false },
    },
    activityHistoryState: {},
    messagesBySession: {
      [idleSession.id]: [
        { id: "user-1", role: "user" },
        { id: "assistant-1", role: "assistant" },
      ] as AgentMessage[],
    },
    sessionTimelineBySession: {},
    outputsBySession: {},
    toolCallsBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan keeps empty timeline cache as hydrated", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([
      [
        idleSession.id,
        {
          ...idleSession,
          messageCount: 1,
        },
      ],
    ]),
    messageHistoryState: {
      [idleSession.id]: { hasMore: false, loading: false },
    },
    activityHistoryState: {},
    messagesBySession: {
      [idleSession.id]: [{ id: "user-1", role: "user" }] as AgentMessage[],
    },
    sessionTimelineBySession: { [idleSession.id]: [] },
    outputsBySession: {},
    toolCallsBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, []);
});

test("buildSessionStreamHydrationPlan compares cached users with the summary send count", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([
      [
        idleSession.id,
        {
          ...idleSession,
          messageCount: 2,
        },
      ],
    ]),
    messageHistoryState: {
      [idleSession.id]: { hasMore: false, loading: false },
    },
    activityHistoryState: {},
    messagesBySession: {
      [idleSession.id]: [
        { id: "assistant-1", role: "assistant" },
        { id: "assistant-2", role: "assistant" },
      ] as AgentMessage[],
    },
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    outputsBySession: {},
    toolCallsBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
});
