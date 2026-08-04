import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionSummary, SessionTimelineEntry } from "@tiller/shared";
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
    sessionTimelineBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [
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
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    checkedResumeSessionIds: new Set([idleSession.id]),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
  assert.deepEqual(plan.resumeCheckSessionIds, []);
});

test("buildSessionStreamHydrationPlan skips a pending request before history state is stored", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    sessionTimelineBySession: {},
    checkedResumeSessionIds: new Set(),
    pendingTimelineRequestSessionIds: new Set([idleSession.id]),
  });

  assert.deepEqual(plan.messageSessionIds, []);
});

test("buildSessionStreamHydrationPlan no longer hydrates artifacts just because task tools are cached", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan hydrates messages when timeline is missing", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    sessionTimelineBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan hydrates messages when timeline is cached but history state is missing", () => {
  const plan = buildSessionStreamHydrationPlan({
    sessionIds: [idleSession.id],
    sessionById: new Map([[idleSession.id, idleSession]]),
    messageHistoryState: {},
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
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
    messagesBySession: {
      [idleSession.id]: [
        { id: "user-1", role: "user" },
        { id: "assistant-1", role: "assistant" },
      ] as AgentMessage[],
    },
    sessionTimelineBySession: {},
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan treats explicit empty timeline cache as already hydrated", () => {
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
    messagesBySession: {
      [idleSession.id]: [{ id: "user-1", role: "user" }] as AgentMessage[],
    },
    sessionTimelineBySession: { [idleSession.id]: [] },
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, []);
});

test("buildSessionStreamHydrationPlan retries stalled loading history when no request is in flight", () => {
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
      [idleSession.id]: { hasMore: false, loading: true },
    },
    messagesBySession: {
      [idleSession.id]: [{ id: "assistant-1", role: "assistant" }] as AgentMessage[],
    },
    sessionTimelineBySession: {},
    checkedResumeSessionIds: new Set(),
    pendingTimelineRequestSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, [idleSession.id]);
});

test("buildSessionStreamHydrationPlan preserves active loading requests without duplicate retries", () => {
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
      [idleSession.id]: { hasMore: false, loading: true },
    },
    messagesBySession: {
      [idleSession.id]: [{ id: "assistant-1", role: "assistant" }] as AgentMessage[],
    },
    sessionTimelineBySession: {},
    checkedResumeSessionIds: new Set(),
    pendingTimelineRequestSessionIds: new Set([idleSession.id]),
  });

  assert.deepEqual(plan.messageSessionIds, []);
});

test("buildSessionStreamHydrationPlan trusts canonical timeline cache once paging is complete", () => {
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
    messagesBySession: {
      [idleSession.id]: [
        { id: "assistant-1", role: "assistant" },
        { id: "assistant-2", role: "assistant" },
      ] as AgentMessage[],
    },
    sessionTimelineBySession: { [idleSession.id]: [{ id: "timeline-1" }] as SessionTimelineEntry[] },
    checkedResumeSessionIds: new Set(),
  });

  assert.deepEqual(plan.messageSessionIds, []);
});
