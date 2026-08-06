import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalPolicyRule } from "@tiller/shared";
import { createSessionRuntimeEventState } from "../../runtime/session/event/runtime-state";
import { createSessionLiveStateStore } from "../../runtime/session-timeline/live-state-store";
import { handleApprovalRpcRequest } from "./rpc";

const baseRequest = {
  id: "approval-1",
  command: "Run shell command :: {}",
  reason: "需要审核",
  cwd: "D:/repo",
};

function createContextWithApproval(overrides: Record<string, unknown> = {}) {
  const runtimeResponses: Array<{ requestId: string; decision: string }> = [];
  const sessionLiveStateStore = createSessionLiveStateStore();
  sessionLiveStateStore.apply("s1", { type: "status", status: "running" }, 0);
  sessionLiveStateStore.apply("s1", { type: "pending-approval-count", count: 1 }, 1);
  const approvalStates = new Map<string, any>([
    [
      "s1",
      {
        sequence: 1,
        active: {
          "approval-1": {
            id: "approval-1",
            sessionId: "s1",
            runtimeInstanceId: "runtime-s1",
            sequence: 1,
            status: "pending",
            request: baseRequest,
            updatedAt: "2026-07-12T00:00:00.000Z",
          },
        },
      },
    ],
  ]);
  const sessionApprovalStateStore = {
    get: (sessionId: string) => approvalStates.get(sessionId) ?? { sequence: 0, active: {} },
    commit: (sessionId: string, event: any, sequence: number) => {
      const current = approvalStates.get(sessionId) ?? { sequence: 0, active: {} };
      const active = { ...current.active };
      if (event.type === "requested") {
        active[event.approval.id] = event.approval;
      } else if (event.type === "status-changed" && active[event.approvalId]) {
        active[event.approvalId] = { ...active[event.approvalId], status: event.status };
      } else if (event.type === "resolved" || event.type === "expired") {
        delete active[event.approvalId];
      }
      const next = { sequence, active };
      approvalStates.set(sessionId, next);
      return next;
    },
  };
  return {
    runtimeResponses,
    approvalIndex: new Map([
      ["approval-1", { sessionId: "s1", request: baseRequest }],
    ]),
    permissionIndex: new Map(),
    sessions: new Map([
      [
        "s1",
        {
          summary: { id: "s1", agentId: "codex", projectId: "tiller" },
          runtime: {
            supportsPermissionResponses: true,
            respondPermission: (requestId: string, decision: string) => {
              runtimeResponses.push({ requestId, decision });
            },
          },
        },
      ],
    ]),
    saveApprovalPolicyRule: () => undefined,
    readApprovalPolicy: () => ({ rules: [] }),
    logWarn: () => undefined,
    updateSessionSummary: (_id: string, fn: (current: any) => any) =>
      fn({ id: "s1", status: "waiting_for_permission" }),
    sessionStore: {
      list: () => [{ id: "s1", agentId: "codex", runtimeSessionId: "runtime-s1" }],
    },
    broadcastNotification: () => undefined,
    broadcastSessionTopic: () => undefined,
    hydrateSessionSummary: (item: unknown) => item,
    sessionLiveStateStore,
    sessionApprovalStateStore,
    sessionRuntimeEventState: createSessionRuntimeEventState(),
    ...overrides,
  } as any;
}

test("approval/list_pending returns all pending approvals", async () => {
  const result = await handleApprovalRpcRequest(
    "approval/list_pending",
    {},
    createContextWithApproval(),
  );

  assert.deepEqual(result, {
    approvals: [{
      sessionId: "s1",
      request: baseRequest,
      status: "pending",
      createdAt: "2026-07-12T00:00:00.000Z",
    }],
  });
});

test("approval/list returns persisted lifecycle records", async () => {
  const context = createContextWithApproval();
  const history = {
    ...context.sessionApprovalStateStore.get("s1").active["approval-1"],
    status: "resolved",
    decision: "allow",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:01:00.000Z",
  };
  context.sessionApprovalStateStore.listHistory = (options: unknown) => {
    assert.deepEqual(options, { limit: 25, before: undefined });
    return { approvals: [history], hasMore: false };
  };

  const result = await handleApprovalRpcRequest(
    "approval/list",
    { limit: 25 },
    context,
  );

  assert.deepEqual(result, { approvals: [history], hasMore: false });
});

test("approval/clear_history removes only processed records through the canonical store", async () => {
  const context = createContextWithApproval();
  let calls = 0;
  const pending = context.sessionApprovalStateStore.get("s1").active["approval-1"];
  context.sessionApprovalStateStore.clearProcessedHistory = () => {
    calls += 1;
    return 3;
  };
  context.sessionApprovalStateStore.listHistory = (options: unknown) => {
    assert.deepEqual(options, { limit: 100 });
    return { approvals: [pending], hasMore: false };
  };

  const result = await handleApprovalRpcRequest(
    "approval/clear_history",
    {},
    context,
  );

  assert.deepEqual(result, {
    ok: true,
    removed: 3,
    approvals: [pending],
    hasMore: false,
  });
  assert.equal(calls, 1);
});

test("approval/respond rejects missing or already-resolved request", async () => {
  await assert.rejects(
    handleApprovalRpcRequest(
      "approval/respond",
      { approvalRequestId: "missing", decision: "allow" },
      createContextWithApproval({
        approvalIndex: new Map(),
        sessionApprovalStateStore: {
          get: () => ({ sequence: 0, active: {} }),
          commit: () => ({ sequence: 0, active: {} }),
        },
      }),
    ),
    /not found|already resolved/i,
  );
});

test("approval/respond removes inventory entry and broadcasts approval/resolved", async () => {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const context = createContextWithApproval({
    broadcastNotification: (method: string, params: unknown) =>
      notifications.push({ method, params }),
  });

  const result = await handleApprovalRpcRequest(
    "approval/respond",
    { approvalRequestId: "approval-1", decision: "allow" },
    context,
  );

  assert.deepEqual(result, {
    ok: true,
    approvalRequestId: "approval-1",
    decision: "allow",
  });
  assert.equal(context.approvalIndex.has("approval-1"), false);
  assert.equal(
    notifications.some((item) => item.method === "approval/resolved"),
    true,
  );
});

test("approval/respond keeps request pending when runtime response fails", async () => {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const context = createContextWithApproval({
    sessions: new Map([
      [
        "s1",
        {
          summary: { id: "s1", agentId: "codex", projectId: "tiller" },
          runtime: {
            supportsPermissionResponses: true,
            respondPermission: async () => {
              throw new Error("provider disconnected");
            },
          },
        },
      ],
    ]),
    broadcastNotification: (method: string, params: unknown) =>
      notifications.push({ method, params }),
  });

  await assert.rejects(
    handleApprovalRpcRequest(
      "approval/respond",
      { approvalRequestId: "approval-1", decision: "allow" },
      context,
    ),
    /provider disconnected/u,
  );

  assert.equal(context.approvalIndex.get("approval-1")?.status, "pending");
  assert.equal(
    notifications.some((item) => item.method === "approval/resolved"),
    false,
  );
});

test("canonical approval resolution clears waiting state after runtime success", async () => {
  const sessionUpdates: unknown[] = [];
  const sessionLiveStateStore = createSessionLiveStateStore();
  sessionLiveStateStore.apply("s1", {
    type: "status",
    status: "running",
  }, 0);
  sessionLiveStateStore.apply("s1", {
    type: "pending-approval-count",
    count: 1,
  }, 1);
  const context = createContextWithApproval({
    sessionLiveStateStore,
    broadcastSessionTopic: (
      _sessionId: string,
      _method: string,
      params: { update: unknown },
    ) => sessionUpdates.push(params.update),
  });

  await handleApprovalRpcRequest(
    "approval/respond",
    { approvalRequestId: "approval-1", decision: "allow" },
    context,
  );

  const liveState = sessionUpdates.find((update: any) => update.kind === "live_state") as any;
  assert.equal(liveState?.snapshot.sequence, 3);
  assert.equal(liveState?.snapshot.status.pendingApprovalCount, 0);
  assert.equal(liveState?.snapshot.status.effectiveStatus, "running");
  assert.equal(
    sessionUpdates.some((update: any) => update.kind === "status_change"),
    false,
  );
});

test("canonical approval resolution persists resolving and resolved transitions", async () => {
  const commits: Array<{ type: string; status?: string; sequence: number }> = [];
  const sessionLiveStateStore = createSessionLiveStateStore();
  sessionLiveStateStore.apply("s1", { type: "status", status: "running" }, 1);
  sessionLiveStateStore.apply("s1", { type: "pending-approval-count", count: 1 }, 2);
  const context = createContextWithApproval({
    sessionLiveStateStore,
    sessionApprovalStateStore: {
      get: () => ({
        sequence: 2,
        active: {
          "approval-1": { id: "approval-1", sessionId: "s1", status: "pending", request: baseRequest },
        },
      }),
      commit: (_sessionId: string, event: any, sequence: number) => {
        commits.push({ type: event.type, status: event.status, sequence });
        return { sequence, active: {} };
      },
    },
  });

  await handleApprovalRpcRequest(
    "approval/respond",
    { approvalRequestId: "approval-1", decision: "allow" },
    context,
  );

  assert.deepEqual(
    commits.map(({ type, status }) => ({ type, status })),
    [
      { type: "status-changed", status: "resolving" },
      { type: "resolved", status: undefined },
    ],
  );
  assert.equal(commits[0]?.sequence < commits[1]?.sequence, true);
  assert.equal(context.approvalIndex.has("approval-1"), false);
});

test("canonical approval resolution returns to pending when runtime response fails", async () => {
  const commits: Array<{ type: string; status?: string }> = [];
  const sessionLiveStateStore = createSessionLiveStateStore();
  sessionLiveStateStore.apply("s1", { type: "pending-approval-count", count: 1 }, 1);
  const context = createContextWithApproval({
    sessions: new Map([
      [
        "s1",
        {
          summary: { id: "s1", agentId: "codex", projectId: "tiller" },
          runtime: {
            supportsPermissionResponses: true,
            respondPermission: async () => {
              throw new Error("provider disconnected");
            },
          },
        },
      ],
    ]),
    sessionLiveStateStore,
    sessionApprovalStateStore: {
      get: () => ({
        sequence: 1,
        active: {
          "approval-1": { id: "approval-1", sessionId: "s1", status: "pending", request: baseRequest },
        },
      }),
      commit: (_sessionId: string, event: any) => {
        commits.push({ type: event.type, status: event.status });
        return { sequence: commits.length, active: {} };
      },
    },
  });

  await assert.rejects(
    handleApprovalRpcRequest(
      "approval/respond",
      { approvalRequestId: "approval-1", decision: "allow" },
      context,
    ),
    /provider disconnected/u,
  );

  assert.deepEqual(commits, [
    { type: "status-changed", status: "resolving" },
    { type: "status-changed", status: "pending" },
  ]);
  assert.equal(context.approvalIndex.get("approval-1")?.status, "pending");
});

test("permission/list_pending compat shim reads canonical approval state", async () => {
  const result = await handleApprovalRpcRequest(
    "permission/list_pending",
    {},
    createContextWithApproval(),
  );

  assert.deepEqual(result, {
    permissions: [{ sessionId: "s1", request: baseRequest }],
  });
});

test("permission/respond compat shim resolves canonical approval state and echoes legacy fields", async () => {
  const context = createContextWithApproval();
  const result = await handleApprovalRpcRequest(
    "permission/respond",
    { permissionRequestId: "approval-1", decision: "allow" },
    context,
  );

  assert.deepEqual(result, {
    ok: true,
    permissionRequestId: "approval-1",
    decision: "allow",
  });
  assert.equal(context.approvalIndex.has("approval-1"), false);
});

test("approval/respond resolves once and rejects the second concurrent completion", async () => {
  const context = createContextWithApproval();

  await handleApprovalRpcRequest(
    "approval/respond",
    { approvalRequestId: "approval-1", decision: "allow" },
    context,
  );

  await assert.rejects(
    handleApprovalRpcRequest(
      "approval/respond",
      { approvalRequestId: "approval-1", decision: "allow" },
      context,
    ),
    /already resolved|not found/i,
  );
});


test("approval/respond persists allow_always as an allow policy rule", async () => {
  const savedRules: ApprovalPolicyRule[] = [];
  const context = createContextWithApproval({
    saveApprovalPolicyRule: (rule: ApprovalPolicyRule) => savedRules.push(rule),
  });

  const result = await handleApprovalRpcRequest(
    "approval/respond",
    { approvalRequestId: "approval-1", decision: "allow_always" },
    context,
  ) as any;

  assert.equal(result.ok, true);
  assert.equal(savedRules.length, 1);
  assert.equal(savedRules[0]?.action, "allow");
  assert.deepEqual(context.runtimeResponses, [{ requestId: "approval-1", decision: "allow_always" }]);
});

test("approval/respond does not persist allow once", async () => {
  const savedRules: ApprovalPolicyRule[] = [];
  const context = createContextWithApproval({
    saveApprovalPolicyRule: (rule: ApprovalPolicyRule) => savedRules.push(rule),
  });

  await handleApprovalRpcRequest(
    "approval/respond",
    { approvalRequestId: "approval-1", decision: "allow" },
    context,
  );

  assert.equal(savedRules.length, 0);
});

test("approval/respond still responds when policy persistence fails", async () => {
  const warnings: string[] = [];
  const context = createContextWithApproval({
    saveApprovalPolicyRule: () => {
      throw new Error("disk full");
    },
    logWarn: (message: string) => warnings.push(message),
  });

  const result = await handleApprovalRpcRequest(
    "approval/respond",
    { approvalRequestId: "approval-1", decision: "allow_always" },
    context,
  ) as any;

  assert.equal(result.ok, true);
  assert.deepEqual(context.runtimeResponses, [{ requestId: "approval-1", decision: "allow_always" }]);
  assert.equal(warnings.some((line) => line.includes("approval policy save failed")), true);
});
