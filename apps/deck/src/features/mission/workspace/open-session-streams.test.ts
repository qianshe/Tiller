import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  handlePlanHydrationRequestFailure,
  handlePlanHydrationRequestResult,
} from "./open-session-streams";

const openSessionStreamsSourceText = readFileSync(
  new URL("./open-session-streams.ts", import.meta.url),
  "utf8",
);
const workspaceControllerSourceText = readFileSync(
  new URL("./controller.tsx", import.meta.url),
  "utf8",
);

test("handlePlanHydrationRequestFailure allows failed plan hydration to retry", () => {
  const checkedPlanSessionIds = new Set(["session-1"]);
  const planActivitySessionIds = new Set(["session-1"]);
  let activityState = {
    "session-1": { hasMore: false, loading: true },
  };

  handlePlanHydrationRequestFailure({
    sessionId: "session-1",
    planActivitySessionIds,
    checkedPlanSessionIds,
    setActivityHistoryState: (updater) => {
      activityState = updater(activityState);
    },
  });

  assert.equal(checkedPlanSessionIds.has("session-1"), false);
  assert.deepEqual(activityState["session-1"], {
    hasMore: false,
    loading: false,
  });
});

test("handlePlanHydrationRequestFailure ignores non-plan activity hydration", () => {
  const checkedPlanSessionIds = new Set(["session-1"]);
  const planActivitySessionIds = new Set<string>();
  let called = false;

  handlePlanHydrationRequestFailure({
    sessionId: "session-1",
    planActivitySessionIds,
    checkedPlanSessionIds,
    setActivityHistoryState: () => {
      called = true;
    },
  });

  assert.equal(checkedPlanSessionIds.has("session-1"), true);
  assert.equal(called, false);
});

test("handlePlanHydrationRequestResult retries when plan hydration returns no plan", () => {
  const checkedPlanSessionIds = new Set(["session-1"]);
  const planActivitySessionIds = new Set(["session-1"]);
  const retryCounts = new Map<string, number>();
  const scheduled: Array<() => void> = [];
  let activityState = {
    "session-1": { hasMore: false, loading: false },
  };

  handlePlanHydrationRequestResult({
    sessionId: "session-1",
    result: { sessionId: "session-1", outputs: [], toolCalls: [] },
    planActivitySessionIds,
    checkedPlanSessionIds,
    retryCounts,
    setActivityHistoryState: (updater) => {
      activityState = updater(activityState);
    },
    scheduleRetry: (handler) => {
      scheduled.push(handler);
    },
  });

  assert.equal(checkedPlanSessionIds.has("session-1"), true);
  assert.equal(retryCounts.get("session-1"), 1);
  assert.equal(scheduled.length, 1);

  scheduled[0]?.();

  assert.equal(checkedPlanSessionIds.has("session-1"), false);
  assert.deepEqual(activityState["session-1"], {
    hasMore: false,
    loading: false,
  });
});

test("handlePlanHydrationRequestResult retries when plan hydration returns an empty plan", () => {
  const checkedPlanSessionIds = new Set(["session-1"]);
  const retryCounts = new Map<string, number>();
  const scheduled: Array<() => void> = [];

  handlePlanHydrationRequestResult({
    sessionId: "session-1",
    result: {
      sessionId: "session-1",
      plan: { updatedAt: "2026-06-08T01:00:00.000Z", entries: [] },
    },
    planActivitySessionIds: new Set(["session-1"]),
    checkedPlanSessionIds,
    retryCounts,
    setActivityHistoryState: () => {
      throw new Error("empty plan should wait for the retry timer");
    },
    scheduleRetry: (handler) => {
      scheduled.push(handler);
    },
  });

  assert.equal(checkedPlanSessionIds.has("session-1"), true);
  assert.equal(retryCounts.get("session-1"), 1);
  assert.equal(scheduled.length, 1);
});

test("handlePlanHydrationRequestResult stops retrying once a plan is returned", () => {
  const checkedPlanSessionIds = new Set(["session-1"]);
  const retryCounts = new Map([["session-1", 1]]);
  let scheduled = false;

  handlePlanHydrationRequestResult({
    sessionId: "session-1",
    result: {
      sessionId: "session-1",
      plan: {
        updatedAt: "2026-06-02T13:37:09.663Z",
        entries: [{ content: "已有 plan", priority: "medium", status: "completed" }],
      },
    },
    planActivitySessionIds: new Set(["session-1"]),
    checkedPlanSessionIds,
    retryCounts,
    setActivityHistoryState: () => {
      throw new Error("plan result should not reset activity state");
    },
    scheduleRetry: () => {
      scheduled = true;
    },
  });

  assert.equal(checkedPlanSessionIds.has("session-1"), false);
  assert.equal(retryCounts.has("session-1"), false);
  assert.equal(scheduled, false);
});

test("handlePlanHydrationRequestResult stops requeueing after missing-plan retries hit the cap", () => {
  const checkedPlanSessionIds = new Set(["session-1"]);
  const retryCounts = new Map([["session-1", 3]]);
  let scheduled = false;
  let activityState = {
    "session-1": { hasMore: false, loading: true },
  };

  handlePlanHydrationRequestResult({
    sessionId: "session-1",
    result: { sessionId: "session-1" },
    planActivitySessionIds: new Set(["session-1"]),
    checkedPlanSessionIds,
    retryCounts,
    setActivityHistoryState: (updater) => {
      activityState = updater(activityState);
    },
    maxRetries: 3,
    scheduleRetry: () => {
      scheduled = true;
    },
  });

  assert.equal(checkedPlanSessionIds.has("session-1"), true);
  assert.equal(retryCounts.has("session-1"), false);
  assert.equal(scheduled, false);
  assert.deepEqual(activityState["session-1"], {
    hasMore: false,
    loading: false,
  });
});

test("open session stream hydration reruns when Helm reconnects", () => {
  assert.match(openSessionStreamsSourceText, /connection:\s*string;/);
  assert.match(
    openSessionStreamsSourceText,
    /connection !== "connected"[\s\S]{0,160}openSessionPlanHydrationRef\.current\.clear\(\)/,
  );
  assert.match(
    openSessionStreamsSourceText,
    /\}, \[openSessionStreamKey, pairingState, connection\]\);/,
  );
  assert.match(
    openSessionStreamsSourceText,
    /sessionPlansBySession,\s*\n\s*sessions,\s*\n\s*connection,/,
  );
  assert.match(
    workspaceControllerSourceText,
    /useOpenSessionStreams\(\{[\s\S]*pairingState,\s*connection,/,
  );
});
