import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCanonicalSessionStateEvent,
  createCanonicalSessionState,
} from "./state-reducer";

test("session state reducer combines config updates into one normalized config state", () => {
  let state = createCanonicalSessionState();
  state = applyCanonicalSessionStateEvent(state, {
    type: "config-options",
    state: { model: "gpt-5", reasoningEffort: "high" },
    options: [{ id: "model", currentValue: "gpt-5" }],
  }, 2);
  state = applyCanonicalSessionStateEvent(state, {
    type: "mode-update",
    agentMode: "architect",
  }, 3);
  state = applyCanonicalSessionStateEvent(state, {
    type: "model-options",
    state: {
      currentModelId: "gpt-5",
      options: [{ id: "gpt-5", name: "GPT-5" }],
    },
  }, 4);

  assert.deepEqual(state.config, {
    agentMode: "architect",
    model: "gpt-5",
    reasoningEffort: "high",
    configOptions: [{ id: "model", currentValue: "gpt-5" }],
    modelOptions: [{ id: "gpt-5", name: "GPT-5" }],
  });
  assert.equal(state.sequence, 4);
});

test("session state reducer preserves partial session info null semantics and ACP usage", () => {
  let state = createCanonicalSessionState();
  state = applyCanonicalSessionStateEvent(state, {
    type: "session-info",
    title: "Initial title",
    updatedAt: "2026-07-11T12:00:00.000Z",
  }, 5);
  state = applyCanonicalSessionStateEvent(state, {
    type: "session-info",
    title: null,
  }, 6);
  state = applyCanonicalSessionStateEvent(state, {
    type: "usage-update",
    usage: {
      used: 123,
      size: 200_000,
      cost: { amount: 0.02, currency: "USD" },
    },
  }, 7);

  assert.deepEqual(state.sessionInfo, {
    title: null,
    updatedAt: "2026-07-11T12:00:00.000Z",
  });
  assert.deepEqual(state.usage, {
    used: 123,
    size: 200_000,
    cost: { amount: 0.02, currency: "USD" },
  });
});

test("session state reducer derives waiting status from pending approvals", () => {
  let state = createCanonicalSessionState();
  state = applyCanonicalSessionStateEvent(state, {
    type: "status",
    status: "running",
  }, 1);
  state = applyCanonicalSessionStateEvent(state, {
    type: "pending-approval-count",
    count: 1,
  }, 2);
  state = applyCanonicalSessionStateEvent(state, {
    type: "status",
    status: "idle",
  }, 3);

  assert.deepEqual(state.status, {
    runtimeStatus: "idle",
    effectiveStatus: "waiting_for_permission",
    pendingApprovalCount: 1,
  });

  state = applyCanonicalSessionStateEvent(state, {
    type: "pending-approval-count",
    count: 0,
  }, 4);
  assert.equal(state.status.effectiveStatus, "idle");
});

test("session state reducer owns latest plan commands diffs and prompt queue", () => {
  let state = createCanonicalSessionState();
  state = applyCanonicalSessionStateEvent(state, {
    type: "plan-update",
    plan: {
      entries: [{ content: "Implement reducer", priority: "high", status: "in_progress" }],
      updatedAt: "2026-07-11T12:00:00.000Z",
    },
  }, 8);
  state = applyCanonicalSessionStateEvent(state, {
    type: "available-commands",
    commands: [{ name: "review", kind: "command" }],
  }, 9);
  state = applyCanonicalSessionStateEvent(state, {
    type: "diff-update",
    files: [{ path: "src/a.ts", status: "modified", additions: 2, deletions: 1 }],
  }, 10);
  state = applyCanonicalSessionStateEvent(state, {
    type: "prompt-queue",
    snapshot: {
      sessionId: "session-1",
      queued: [],
    },
  }, 11);

  assert.equal(state.plan?.entries[0]?.content, "Implement reducer");
  assert.equal(state.availableCommands[0]?.name, "review");
  assert.equal(state.diffs[0]?.path, "src/a.ts");
  assert.equal(state.promptQueue?.sessionId, "session-1");
  assert.equal(state.sequence, 11);
});
