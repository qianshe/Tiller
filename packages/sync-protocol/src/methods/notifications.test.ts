import assert from "node:assert/strict";
import test from "node:test";
import * as sessionPrompt from "./session/prompt";
import * as sessionCancel from "./session/cancel";
import * as sessionSubscribe from "./session/subscribe";
import * as sessionUnsubscribe from "./session/unsubscribe";
import * as sessionUpdate from "./session/update";
import * as errorRaised from "./error/raised";
import * as notificationRaised from "./notification/raised";
import * as notificationList from "./notification/list";
import * as notificationClear from "./notification/clear";
import * as notificationCleared from "./notification/cleared";
import * as devicePair from "./device/pair";
import * as deviceAuthenticate from "./device/authenticate";
import * as daemonUpdateStatus from "./daemon/update-status";
import * as dashboardActivitySummary from "./dashboard/activity-summary";

test("session/prompt result has stopReason", () => {
  assert.equal(sessionPrompt.method, "session/prompt");
  assert.deepEqual(
    sessionPrompt.ResultSchema.parse({ accepted: "sent", stopReason: "end_turn" }),
    { accepted: "sent", stopReason: "end_turn" },
  );
});

test("session/cancel is a request so clients can confirm delivery", () => {
  assert.equal(sessionCancel.method, "session/cancel");
  assert.equal(sessionCancel.descriptor.kind, "request");
});

test("session topic subscription methods validate session ids", () => {
  assert.equal(sessionSubscribe.method, "session/subscribe");
  assert.equal(sessionUnsubscribe.method, "session/unsubscribe");
  assert.deepEqual(sessionSubscribe.ParamsSchema.parse({ sessionId: "session-1" }), {
    sessionId: "session-1",
  });
  assert.deepEqual(sessionUnsubscribe.ParamsSchema.parse({ sessionId: "session-1" }), {
    sessionId: "session-1",
  });
  assert.deepEqual(sessionSubscribe.ResultSchema.parse({ ok: true, message: "Subscribed to session session-1." }), {
    ok: true,
    message: "Subscribed to session session-1.",
  });
});

test("session/update accepts only canonical state, timeline, lifecycle, and live overlays", () => {
  assert.equal(sessionUpdate.method, "session/update");
  for (const kind of [
    "agent_message",
    "tool_call",
    "session_updated",
    "timeline_batch",
    "live_state",
    "subagent_detail",
  ]) {
    sessionUpdate.ParamsSchema.parse({
      sessionId: "s1",
      update: kind === "session_updated"
        ? { kind, session: {} }
        : kind === "timeline_batch"
          ? { kind, batch: { replace: false, deliverySequence: 1, lastSequence: 1, entries: [] } }
          : kind === "live_state"
            ? { kind, snapshot: {} }
            : kind === "subagent_detail"
              ? { kind, delta: {} }
            : kind === "agent_message"
              ? { kind, message: {} }
              : { kind, toolCall: {} },
    });
  }
});

test("session/update agent_message preserves streaming state", () => {
  const parsed = sessionUpdate.ParamsSchema.parse({
    sessionId: "s1",
    update: { kind: "agent_message", message: {}, streaming: true },
  });

  assert.equal(
    (parsed.update as Extract<typeof parsed.update, { kind: "agent_message" }>).streaming,
    true,
  );
});

test("error/raised is a notification with at least a message", () => {
  assert.equal(errorRaised.method, "error/raised");
  assert.equal(errorRaised.descriptor.kind, "notification");
  errorRaised.ParamsSchema.parse({ message: "boom" });
});

test("notification/raised carries extensible source and severity fields", () => {
  assert.equal(notificationRaised.method, "notification/raised");
  assert.equal(notificationRaised.descriptor.kind, "notification");
  notificationRaised.ParamsSchema.parse({
    kind: "warning",
    source: "storage",
    message: "Storage is temporarily unavailable",
    occurredAt: "2026-07-18T12:00:00.000Z",
  });
});

test("device/pair and device/authenticate carry the expected fields", () => {
  assert.equal(devicePair.method, "device/pair");
  assert.equal(deviceAuthenticate.method, "device/authenticate");
  devicePair.ResultSchema.parse({ ok: true, message: "paired" });
  deviceAuthenticate.ResultSchema.parse({ ok: true, message: "ok" });
});

test("daemon/update status carries capability and progress fields", () => {
  assert.equal(daemonUpdateStatus.method, "daemon/update/status");
  assert.equal(daemonUpdateStatus.descriptor.kind, "notification");
  daemonUpdateStatus.ParamsSchema.parse({
    status: "available",
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    canUpdate: true,
    checkStatus: "checked",
    manualCommand: "npm install -g @qianshe/tiller@latest",
    occurredAt: "2026-08-02T00:00:00.000Z",
  });
});

test("notification/list returns stable persisted notification records", () => {
  assert.equal(notificationList.method, "notification/list");
  assert.deepEqual(notificationList.ResultSchema.parse({
    notifications: [{
      id: "notification-1",
      kind: "warning",
      source: "storage",
      message: "Storage is temporarily unavailable",
      occurredAt: "2026-07-18T12:00:00.000Z",
    }],
  }).notifications[0]?.id, "notification-1");
});

test("notification clear and cleared descriptors validate the synchronization contract", () => {
  assert.equal(notificationClear.method, "notification/clear");
  assert.equal(notificationCleared.method, "notification/cleared");
  assert.deepEqual(notificationClear.ResultSchema.parse({
    ok: true,
    clearedAt: "2026-08-15T00:00:00.000Z",
  }), {
    ok: true,
    clearedAt: "2026-08-15T00:00:00.000Z",
  });
  assert.deepEqual(notificationCleared.ParamsSchema.parse({
    clearedAt: "2026-08-15T00:00:00.000Z",
  }), {
    clearedAt: "2026-08-15T00:00:00.000Z",
  });
});

test("dashboard/activity_summary is a typed server notification", () => {
  assert.equal(dashboardActivitySummary.method, "dashboard/activity_summary");
  assert.equal(dashboardActivitySummary.descriptor.kind, "notification");
  dashboardActivitySummary.ParamsSchema.parse({
    generatedAt: "2026-08-12T00:00:00.000Z",
    promptCount: 1,
    recentToolCallCount: 2,
    toolCallCount: 2,
    activityTrend: [],
    activityTrendHourly: [],
  });
});
