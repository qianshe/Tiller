import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { runStalledSessionSweep, startStalledSessionWatchdog } from "./stalled-watchdog";

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

test("runStalledSessionSweep marks active sessions that lost their ACP connection", () => {
  const marked: string[] = [];

  const stalled = runStalledSessionSweep({
    listSessionSummaries: () => [summary({ id: "s-lost" })],
    hasRuntimeRecord: () => true,
    listConnections: () => [{ status: "closed", sessions: [{ tillerSessionId: "s-lost" }] }],
    markStalled: (session) => marked.push(session.id),
    now: () => NOW,
  });

  assert.deepEqual(marked, ["s-lost"]);
  assert.deepEqual(stalled.map((item) => item.id), ["s-lost"]);
});

test("runStalledSessionSweep leaves healthy running sessions alone", () => {
  const marked: string[] = [];

  runStalledSessionSweep({
    listSessionSummaries: () => [summary({ id: "s-live" })],
    hasRuntimeRecord: () => true,
    listConnections: () => [{ status: "ready", sessions: [{ tillerSessionId: "s-live" }] }],
    markStalled: (session) => marked.push(session.id),
    now: () => NOW,
  });

  assert.deepEqual(marked, []);
});

test("runStalledSessionSweep keeps sweeping after one session fails to be marked", () => {
  const marked: string[] = [];
  const errors: string[] = [];

  runStalledSessionSweep({
    listSessionSummaries: () => [summary({ id: "s-a" }), summary({ id: "s-b" })],
    hasRuntimeRecord: () => false,
    listConnections: () => [],
    markStalled: (session) => {
      if (session.id === "s-a") {
        throw new Error("publish failed");
      }
      marked.push(session.id);
    },
    now: () => NOW,
    logError: (message) => errors.push(message),
  });

  assert.deepEqual(marked, ["s-b"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /s-a/);
});

test("runStalledSessionSweep does not re-mark a session already moved to error", () => {
  const marked: string[] = [];
  let status: SessionSummary["status"] = "running";

  const deps = {
    listSessionSummaries: () => [summary({ id: "s-lost", status })],
    hasRuntimeRecord: () => false,
    listConnections: () => [],
    markStalled: (session: { id: string }) => {
      marked.push(session.id);
      status = "error";
    },
    now: () => NOW,
  };

  runStalledSessionSweep(deps);
  runStalledSessionSweep(deps);

  assert.deepEqual(marked, ["s-lost"]);
});

test("startStalledSessionWatchdog sweeps on every interval tick until disposed", () => {
  const marked: string[] = [];
  let tick: (() => void) | undefined;
  let cleared = false;

  const dispose = startStalledSessionWatchdog({
    listSessionSummaries: () => [summary({ id: "s-lost" })],
    hasRuntimeRecord: () => false,
    listConnections: () => [],
    markStalled: (session) => marked.push(session.id),
    now: () => NOW,
    intervalMs: 30_000,
    setInterval: (handler) => {
      tick = handler;
      return "timer";
    },
    clearInterval: () => {
      cleared = true;
    },
  });

  tick?.();
  assert.deepEqual(marked, ["s-lost"]);

  dispose();
  assert.equal(cleared, true);
});
