import assert from "node:assert/strict";
import test from "node:test";
import { handleRuntimePermissionRequest } from "./approval-boundary";

function createContext(overrides: Record<string, unknown> = {}) {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const summaryUpdates: unknown[] = [];
  const responses: Array<{ requestId: string; decision: string }> = [];
  const stateCommits: Array<{ sequence: number; update: unknown }> = [];
  const context = {
    approvalIndex: new Map(),
    sessionApprovalStateStore: {
      get: () => ({ sequence: 0, active: {} }),
      commit: () => ({ sequence: 1, active: {} }),
    },
    sessionLiveStateStore: {
      get: () => undefined,
      commit: (_sessionId: string, _event: unknown, sequence: number, update: unknown) => {
        stateCommits.push({ sequence, update });
        return {
          sequence,
          status: { effectiveStatus: "running", pendingApprovalCount: 0 },
        };
      },
      adoptCommitted: () => undefined,
    },
    sessions: new Map([
      [
        "session-1",
        {
          summary: { id: "session-1", agentId: "codex", projectId: "tiller" },
          runtime: {
            supportsPermissionResponses: true,
            respondPermission: (requestId: string, decision: string) => {
              responses.push({ requestId, decision });
            },
          },
        },
      ],
    ]),
    readApprovalPolicy: () => ({ rules: [] }),
    logInfo: () => undefined,
    logWarn: (message: string) => warnings.push(message),
    logError: (message: string) => errors.push(message),
    updateSessionSummary: (_sessionId: string, mutate: (current: any) => any) => {
      const next = mutate({ id: "session-1", status: "running" });
      summaryUpdates.push(next);
      return next;
    },
    broadcastNotification: (method: string, params: unknown) => notifications.push({ method, params }),
    broadcastSessionTopic: () => undefined,
    ...overrides,
  } as any;
  return {
    context,
    notifications,
    warnings,
    errors,
    summaryUpdates,
    responses,
    stateCommits,
  };
}

const request = {
  id: "approval-1",
  command: "MCP • sanshu/zhi :: {}",
  reason: "Approve MCP tool call",
  cwd: "D:/repo",
};

test("approval boundary creates a manual pending approval when no policy matches", () => {
  const { context, notifications, summaryUpdates } = createContext();

  handleRuntimePermissionRequest(
    {
      sessionId: "session-1",
      request,
      logScope: "session=session-1",
      sequence: 1,
      update: {} as any,
    },
    context,
  );

  assert.equal(context.approvalIndex.get("approval-1")?.sessionId, "session-1");
  assert.equal(summaryUpdates.length, 1);
  const createdApproval = (
    notifications[0]?.params as
      | { approval?: { createdAt: string; updatedAt: string } }
      | undefined
  )?.approval;
  assert.ok(createdApproval);
  assert.equal(createdApproval.createdAt, createdApproval.updatedAt);
  assert.ok(Number.isFinite(Date.parse(createdApproval.createdAt)));
  assert.deepEqual(notifications, [
    {
      method: "approval/created",
      params: {
        sessionId: "session-1",
        request,
        approval: {
          id: "approval-1",
          sessionId: "session-1",
          runtimeInstanceId: "session-1",
          toolCallId: undefined,
          sequence: 1,
          status: "pending",
          request,
          createdAt: createdApproval.createdAt,
          updatedAt: createdApproval.updatedAt,
        },
        session: { id: "session-1", agentId: "codex", projectId: "tiller" },
      },
    },
  ]);
});

test("approval boundary auto-responds when policy matches and runtime supports responses", () => {
  const { context, notifications, summaryUpdates, responses } = createContext({
    readApprovalPolicy: () => ({
      rules: [
        {
          id: "rule-1",
          action: "allow",
          label: "Allow sanshu",
          providerId: "codex",
          commandPattern: "^MCP • sanshu/",
          createdAt: "2026-05-16T00:00:00.000Z",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
      ],
    }),
  });

  handleRuntimePermissionRequest(
    {
      sessionId: "session-1",
      request,
      logScope: "session=session-1",
      sequence: 1,
      update: {} as any,
    },
    context,
  );

  assert.deepEqual(responses, [{ requestId: "approval-1", decision: "allow" }]);
  assert.equal(context.approvalIndex.has("approval-1"), false);
  assert.deepEqual(notifications, []);
  assert.deepEqual(summaryUpdates, []);
});

test("auto approval persists its request audit before responding", () => {
  const { context, responses, stateCommits } = createContext({
    readApprovalPolicy: () => ({
      rules: [{ id: "rule-1", action: "allow", label: "allow", commandPattern: "MCP", createdAt: "", updatedAt: "" }],
    }),
  });
  const update = { sequence: 1 } as any;

  handleRuntimePermissionRequest(
    { sessionId: "session-1", request, logScope: "session=session-1", sequence: 1, update },
    context,
  );

  assert.deepEqual(stateCommits, [{ sequence: 1, update }]);
  assert.deepEqual(responses, [{ requestId: "approval-1", decision: "allow" }]);
});

test("auto approval does not respond when its atomic state commit fails", () => {
  const { context, responses, errors } = createContext({
    readApprovalPolicy: () => ({
      rules: [{ id: "rule-1", action: "allow", label: "allow", commandPattern: "MCP", createdAt: "", updatedAt: "" }],
    }),
    sessionLiveStateStore: {
      get: () => undefined,
      commit: () => { throw new Error("disk full"); },
      adoptCommitted: () => undefined,
    },
  });

  handleRuntimePermissionRequest(
    {
      sessionId: "session-1",
      request,
      logScope: "session=session-1",
      sequence: 1,
      update: { sequence: 1 } as any,
    },
    context,
  );

  assert.deepEqual(responses, []);
  assert.equal(errors.some((line) => line.includes("canonical_state_missing")), true);
});

test("approval boundary falls back to manual approval when policy read fails", () => {
  const { context, notifications, warnings } = createContext({
    readApprovalPolicy: () => {
      throw new Error("config read failed");
    },
  });

  handleRuntimePermissionRequest(
    {
      sessionId: "session-1",
      request,
      logScope: "session=session-1",
      sequence: 1,
      update: {} as any,
    },
    context,
  );

  assert.equal(context.approvalIndex.has("approval-1"), true);
  assert.equal(notifications.some((item) => item.method === "approval/created"), true);
  assert.equal(warnings.some((line) => line.includes("approval policy read failed")), true);
});

test("manual approvals fail fast without canonical persistence dependencies", () => {
  const { context, errors, notifications, summaryUpdates } = createContext({
    sessionApprovalStateStore: undefined,
    sessionLiveStateStore: undefined,
  });

  handleRuntimePermissionRequest(
    {
      sessionId: "session-1",
      request,
      logScope: "session=session-1",
      sequence: 1,
      update: {} as any,
    },
    context,
  );

  assert.equal(context.approvalIndex.has(request.id), false);
  assert.equal(summaryUpdates.length, 0);
  assert.deepEqual(notifications, []);
  assert.equal(errors.some((line) => line.includes("canonical_state_missing")), true);
  assert.equal(errors.some((line) => line.includes(request.reason)), false);
});
