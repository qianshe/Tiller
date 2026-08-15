import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { createRuntimeReachability, detectStalledActiveSessions } from "./stalled-detection";

const NOW = "2026-08-15T12:00:00.000Z";

function summary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Project One",
    helmId: "helm-1",
    cwd: "worktree-1",
    worktreeName: "Worktree One",
    agentId: "codex",
    agentName: "Codex",
    status: "running",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    messageCount: 0,
    runtimeSessionId: "runtime-1",
    ...overrides,
  };
}

test("detectStalledActiveSessions reports active sessions whose runtime is unreachable", () => {
  const stalled = detectStalledActiveSessions({
    summaries: [
      summary({ id: "s-running", status: "running" }),
      summary({ id: "s-starting", status: "starting" }),
      summary({ id: "s-waiting", status: "waiting_for_permission" }),
    ],
    isRuntimeReachable: () => false,
    now: NOW,
  });

  assert.deepEqual(
    stalled.map((item) => item.id).sort(),
    ["s-running", "s-starting", "s-waiting"],
  );
});

test("detectStalledActiveSessions keeps sessions whose runtime is still reachable", () => {
  const stalled = detectStalledActiveSessions({
    summaries: [summary({ id: "s-running", status: "running" })],
    isRuntimeReachable: () => true,
    now: NOW,
  });

  assert.deepEqual(stalled, []);
});

test("detectStalledActiveSessions ignores terminal statuses", () => {
  const stalled = detectStalledActiveSessions({
    summaries: [
      summary({ id: "s-idle", status: "idle" }),
      summary({ id: "s-error", status: "error" }),
      summary({ id: "s-cancelled", status: "cancelled" }),
    ],
    isRuntimeReachable: () => false,
    now: NOW,
  });

  assert.deepEqual(stalled, []);
});

test("detectStalledActiveSessions spares sessions updated inside the grace window", () => {
  const stalled = detectStalledActiveSessions({
    summaries: [summary({ id: "s-fresh", updatedAt: "2026-08-15T11:59:30.000Z" })],
    isRuntimeReachable: () => false,
    now: NOW,
    graceMs: 60_000,
  });

  assert.deepEqual(stalled, []);
});

test("detectStalledActiveSessions treats an unparsable updatedAt as stalled", () => {
  const stalled = detectStalledActiveSessions({
    summaries: [summary({ id: "s-broken", updatedAt: "not-a-timestamp" })],
    isRuntimeReachable: () => false,
    now: NOW,
  });

  assert.deepEqual(stalled.map((item) => item.id), ["s-broken"]);
});

test("createRuntimeReachability marks sessions without a runtime record unreachable", () => {
  const isReachable = createRuntimeReachability({
    hasRuntimeRecord: () => false,
    connections: [{ status: "ready", sessions: [{ tillerSessionId: "s-1" }] }],
  });

  assert.equal(isReachable("s-1"), false);
});

test("createRuntimeReachability marks sessions on a ready connection reachable", () => {
  const isReachable = createRuntimeReachability({
    hasRuntimeRecord: () => true,
    connections: [{ status: "ready", sessions: [{ tillerSessionId: "s-1" }] }],
  });

  assert.equal(isReachable("s-1"), true);
});

test("createRuntimeReachability marks sessions on a closed or errored connection unreachable", () => {
  const closed = createRuntimeReachability({
    hasRuntimeRecord: () => true,
    connections: [{ status: "closed", sessions: [{ tillerSessionId: "s-1" }] }],
  });
  const errored = createRuntimeReachability({
    hasRuntimeRecord: () => true,
    connections: [{ status: "error", sessions: [{ tillerSessionId: "s-2" }] }],
  });

  assert.equal(closed("s-1"), false);
  assert.equal(errored("s-2"), false);
});

test("createRuntimeReachability marks orphaned records unreachable when no connection owns them", () => {
  const isReachable = createRuntimeReachability({
    hasRuntimeRecord: () => true,
    connections: [{ status: "ready", sessions: [{ tillerSessionId: "s-other" }] }],
  });

  assert.equal(isReachable("s-1"), false);
});

test("detectStalledActiveSessions spares a slow session/new that has not registered a runtime yet", () => {
  // session/new 与 session/load 的 ACP 请求超时是 120s。在那之前会话摘要已是
  // starting/running,但运行时记录尚未落地,默认宽限期必须覆盖这段窗口。
  const stalled = detectStalledActiveSessions({
    summaries: [
      summary({
        id: "s-slow-start",
        status: "starting",
        updatedAt: "2026-08-15T11:58:00.000Z",
      }),
    ],
    isRuntimeReachable: () => false,
    now: NOW,
  });

  assert.deepEqual(stalled, []);
});
