import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall, SessionSummary, SessionTimelineEntry } from "@tiller/shared";
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
