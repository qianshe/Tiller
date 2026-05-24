import assert from "node:assert/strict";
import test from "node:test";
import { handleRuntimePermissionRequest } from "./approval-boundary";

function createContext(overrides: Record<string, unknown> = {}) {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const warnings: string[] = [];
  const summaryUpdates: unknown[] = [];
  const responses: Array<{ requestId: string; decision: string }> = [];
  const context = {
    approvalIndex: new Map(),
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
    updateSessionSummary: (_sessionId: string, mutate: (current: any) => any) => {
      const next = mutate({ id: "session-1", status: "running" });
      summaryUpdates.push(next);
      return next;
    },
    broadcastNotification: (method: string, params: unknown) => notifications.push({ method, params }),
    ...overrides,
  } as any;
  return { context, notifications, warnings, summaryUpdates, responses };
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
    { sessionId: "session-1", request, logScope: "session=session-1" },
    context,
  );

  assert.equal(context.approvalIndex.get("approval-1")?.sessionId, "session-1");
  assert.equal(summaryUpdates.length, 1);
  assert.deepEqual(notifications, [
    {
      method: "approval/created",
      params: {
        sessionId: "session-1",
        request,
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
    { sessionId: "session-1", request, logScope: "session=session-1" },
    context,
  );

  assert.deepEqual(responses, [{ requestId: "approval-1", decision: "allow" }]);
  assert.equal(context.approvalIndex.has("approval-1"), false);
  assert.deepEqual(notifications, []);
  assert.deepEqual(summaryUpdates, []);
});

test("approval boundary falls back to manual approval when policy read fails", () => {
  const { context, notifications, warnings } = createContext({
    readApprovalPolicy: () => {
      throw new Error("config read failed");
    },
  });

  handleRuntimePermissionRequest(
    { sessionId: "session-1", request, logScope: "session=session-1" },
    context,
  );

  assert.equal(context.approvalIndex.has("approval-1"), true);
  assert.equal(notifications.some((item) => item.method === "approval/created"), true);
  assert.equal(warnings.some((line) => line.includes("approval policy read failed")), true);
});
