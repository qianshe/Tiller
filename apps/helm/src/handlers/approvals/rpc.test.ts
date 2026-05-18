import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalPolicyRule } from "@tiller/shared";
import { handleApprovalRpcRequest } from "./rpc";

const baseRequest = {
  id: "approval-1",
  command: "Run shell command :: {}",
  reason: "需要审核",
  cwd: "D:/repo",
};

function createContextWithApproval(overrides: Record<string, unknown> = {}) {
  const runtimeResponses: Array<{ requestId: string; decision: string }> = [];
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
    broadcastNotification: () => undefined,
    broadcastSessionTopic: () => undefined,
    hydrateSessionSummary: (item: unknown) => item,
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
    approvals: [{ sessionId: "s1", request: baseRequest }],
  });
});

test("approval/respond rejects missing or already-resolved request", async () => {
  await assert.rejects(
    handleApprovalRpcRequest(
      "approval/respond",
      { approvalRequestId: "missing", decision: "allow" },
      createContextWithApproval({ approvalIndex: new Map() }),
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

test("permission/list_pending compat shim reads from approvalIndex", async () => {
  const result = await handleApprovalRpcRequest(
    "permission/list_pending",
    {},
    createContextWithApproval(),
  );

  assert.deepEqual(result, {
    permissions: [{ sessionId: "s1", request: baseRequest }],
  });
});

test("permission/respond compat shim resolves via approvalIndex and echoes legacy fields", async () => {
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
