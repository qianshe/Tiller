import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { normalizeOrphanedActiveSessions } from "./startup-normalize";

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
    status: "idle",
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    messageCount: 0,
    runtimeSessionId: "runtime-1",
    ...overrides,
  };
}

function createStore(items: SessionSummary[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return {
    list: () => Array.from(byId.values()),
    upsert: (next: SessionSummary) => {
      byId.set(next.id, next);
    },
    get: (id: string) => byId.get(id),
  };
}

test("normalizeOrphanedActiveSessions cancels sessions stuck in active statuses", () => {
  const store = createStore([
    summary({ id: "s-running", status: "running" }),
    summary({ id: "s-starting", status: "starting" }),
    summary({ id: "s-waiting", status: "waiting_for_permission" }),
  ]);

  const normalized = normalizeOrphanedActiveSessions(store, "2026-07-26T12:00:00.000Z");

  assert.deepEqual(normalized.sort(), ["s-running", "s-starting", "s-waiting"]);
  for (const id of ["s-running", "s-starting", "s-waiting"]) {
    assert.equal(store.get(id)?.status, "cancelled");
    assert.equal(store.get(id)?.updatedAt, "2026-07-26T12:00:00.000Z");
  }
});

test("normalizeOrphanedActiveSessions leaves terminal and idle sessions untouched", () => {
  const store = createStore([
    summary({ id: "s-idle", status: "idle" }),
    summary({ id: "s-cancelled", status: "cancelled" }),
    summary({ id: "s-error", status: "error" }),
  ]);

  const normalized = normalizeOrphanedActiveSessions(store, "2026-07-26T12:00:00.000Z");

  assert.deepEqual(normalized, []);
  assert.equal(store.get("s-idle")?.status, "idle");
  assert.equal(store.get("s-idle")?.updatedAt, "2026-05-10T00:00:00.000Z");
  assert.equal(store.get("s-cancelled")?.status, "cancelled");
  assert.equal(store.get("s-error")?.status, "error");
});
