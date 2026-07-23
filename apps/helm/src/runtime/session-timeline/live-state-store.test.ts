import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalSessionState } from "@tiller/shared";
import type { SessionStateStore } from "@tiller/persistence";
import { createSessionUpdateRecord } from "../session-updates/reducer";
import { createSessionLiveStateStore } from "./live-state-store";

function createPersistentStore(initial?: CanonicalSessionState) {
  const persisted = new Map<string, CanonicalSessionState>();
  if (initial) {
    persisted.set("session-1", initial);
  }
  const store: SessionStateStore = {
    get: (sessionId) => persisted.get(sessionId),
    getAppliedSequence: (sessionId) => persisted.get(sessionId)?.sequence ?? 0,
    replace: (sessionId, state) => {
      persisted.set(sessionId, state);
      return state;
    },
    commitUpdate: (update, state) => {
      assert.equal(update.sequence, state.sequence);
      persisted.set(update.sessionId, state);
      return state;
    },
    remove: (sessionId) => {
      persisted.delete(sessionId);
    },
    close: () => {},
  };
  return { persisted, store };
}

test("live state store applies canonical state events through one reducer", () => {
  const store = createSessionLiveStateStore();

  store.apply("session-1", {
    type: "status",
    status: "running",
  }, 1);
  store.apply("session-1", {
    type: "usage-update",
    usage: { used: 10, size: 100 },
  }, 2);
  store.apply("session-1", {
    type: "mode-update",
    agentMode: "architect",
  }, 3);

  const snapshot = store.get("session-1");
  assert.equal(snapshot?.sequence, 3);
  assert.equal(snapshot?.status.effectiveStatus, "running");
  assert.deepEqual(snapshot?.usage, { used: 10, size: 100 });
  assert.equal(snapshot?.config.agentMode, "architect");
});

test("live state store atomically commits an update record before exposing state", () => {
  const committed: Array<[number, number]> = [];
  const persistent = createPersistentStore();
  persistent.store.commitUpdate = (update, state) => {
    committed.push([update.sequence, state.sequence]);
    persistent.persisted.set(update.sessionId, state);
    return state;
  };
  const store = createSessionLiveStateStore(persistent.store);
  const update = createSessionUpdateRecord({
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    source: "acp_live",
    sequence: 1,
    event: { type: "status", status: "running" },
  });

  const snapshot = store.commit(
    "session-1",
    { type: "status", status: "running" },
    1,
    update,
  );

  assert.deepEqual(committed, [[1, 1]]);
  assert.equal(snapshot?.status.runtimeStatus, "running");
  assert.deepEqual(store.get("session-1"), snapshot);
});

test("live state store adopts state already committed by a control transaction", () => {
  let replaceCalls = 0;
  const persistent = createPersistentStore();
  persistent.store.replace = (_sessionId, state) => {
    replaceCalls += 1;
    return state;
  };
  const store = createSessionLiveStateStore(persistent.store);
  const committed: CanonicalSessionState = {
    sequence: 5,
    status: {
      runtimeStatus: "running",
      effectiveStatus: "waiting_for_permission",
      pendingApprovalCount: 1,
    },
    config: { configOptions: [], modelOptions: [] },
    availableCommands: [],
    sessionInfo: {},
    diffs: [],
  };

  store.adoptCommitted("session-1", committed);

  assert.deepEqual(store.get("session-1"), committed);
  assert.equal(replaceCalls, 0);
});

test("live state store keeps legacy plan patch as a canonical state update", () => {
  const store = createSessionLiveStateStore();
  const plan = {
    entries: [{ content: "Keep compatibility", priority: "medium" as const, status: "pending" as const }],
    updatedAt: "2026-07-11T12:00:00.000Z",
  };

  const snapshot = store.patch("session-1", { plan });

  assert.deepEqual(snapshot.plan, plan);
  assert.equal(snapshot.status.effectiveStatus, "starting");
  assert.deepEqual(snapshot.availableCommands, []);
});

test("live state store removes all canonical state for a session", () => {
  const store = createSessionLiveStateStore();
  store.apply("session-1", { type: "status", status: "running" }, 1);
  store.remove("session-1");
  assert.equal(store.get("session-1"), undefined);
});

test("live state store loads a cold snapshot and persists subsequent updates", () => {
  const initial: CanonicalSessionState = {
    sequence: 4,
    status: {
      runtimeStatus: "idle",
      effectiveStatus: "idle",
      pendingApprovalCount: 0,
    },
    config: { configOptions: [], modelOptions: [] },
    availableCommands: [],
    sessionInfo: { title: "Persisted" },
    diffs: [],
  };
  const persistent = createPersistentStore(initial);
  const store = createSessionLiveStateStore(persistent.store);

  assert.deepEqual(store.get("session-1"), initial);

  const next = store.apply("session-1", { type: "status", status: "running" }, 5);
  assert.deepEqual(persistent.persisted.get("session-1"), next);
});

test("live state store removes both hot and persisted state", () => {
  const persistent = createPersistentStore({
    sequence: 1,
    status: {
      runtimeStatus: "idle",
      effectiveStatus: "idle",
      pendingApprovalCount: 0,
    },
    config: { configOptions: [], modelOptions: [] },
    availableCommands: [],
    sessionInfo: {},
    diffs: [],
  });
  const store = createSessionLiveStateStore(persistent.store);

  store.get("session-1");
  store.remove("session-1");

  assert.equal(store.get("session-1"), undefined);
  assert.equal(persistent.persisted.has("session-1"), false);
});

test("live state store treats the persisted snapshot as the recovery authority", () => {
  const persistent = createPersistentStore({
    sequence: 4,
    status: {
      runtimeStatus: "idle",
      effectiveStatus: "idle",
      pendingApprovalCount: 0,
    },
    config: { configOptions: [], modelOptions: [] },
    availableCommands: [],
    sessionInfo: {},
    diffs: [],
  });
  const store = createSessionLiveStateStore(persistent.store);
  const snapshot = store.get("session-1");

  assert.equal(snapshot?.sequence, 4);
  assert.equal(snapshot?.promptQueue, undefined);
  assert.equal(persistent.persisted.get("session-1")?.sequence, 4);
});

test("live state recovery does not scan the diagnostic journal", () => {
  const persistent = createPersistentStore({
    sequence: 99_999,
    status: {
      runtimeStatus: "idle",
      effectiveStatus: "idle",
      pendingApprovalCount: 0,
    },
    config: { configOptions: [], modelOptions: [] },
    availableCommands: [],
    sessionInfo: {},
    diffs: [],
  });
  const snapshot = createSessionLiveStateStore(persistent.store).get("session-1");

  assert.equal(snapshot?.sequence, 99_999);
  assert.equal(snapshot?.status.runtimeStatus, "idle");
});
