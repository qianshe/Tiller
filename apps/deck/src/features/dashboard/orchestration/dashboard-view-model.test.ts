import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRequestOption, SessionSummary } from "@tiller/shared";
import {
  buildDashboardViewModel,
  resolveDashboardApprovalDecision,
  resolveDashboardApprovalDecisions,
} from "./dashboard-view-model";

test("resolveDashboardApprovalDecision prefers allow options", () => {
  const options: PermissionRequestOption[] = [
    { label: "Deny", decision: "deny" },
    { label: "Allow session", decision: "allow_session" },
  ];

  assert.equal(resolveDashboardApprovalDecision(options), "allow_session");
});

test("resolveDashboardApprovalDecisions exposes compact dashboard actions", () => {
  assert.deepEqual(resolveDashboardApprovalDecisions(), [
    "deny",
    "allow",
    "allow_session",
    "allow_always",
  ]);
});

test("buildDashboardViewModel derives helm rows and approval rows", () => {
  const sessions: SessionSummary[] = [
    {
      id: "session-1",
      projectId: "tiller",
      projectName: "Tiller",
      helmId: "local",
      cwd: "D:/myProject/tools/Tiller",
      worktreeName: "main",
      title: "Review plan",
      agentId: "codex",
      agentName: "Codex",
      status: "running",
      createdAt: "2026-05-29T10:00:00.000Z",
      updatedAt: "2026-05-29T10:00:00.000Z",
      messageCount: 1,
    } as SessionSummary,
  ];

  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    activeHelm: { id: "local", name: "Local Helm", host: "127.0.0.1", port: 47631 },
    helms: [
      {
        id: "local",
        name: "Local Helm",
        host: "127.0.0.1",
        port: 47631,
        agentCount: 3,
        projectCount: 2,
        sessionCount: 1,
      },
    ],
    agents: [{ id: "codex" }],
    projects: [{ id: "tiller" }],
    sessions,
    statuses: { "session-1": "waiting_for_permission" },
    activeSessionId: "session-1",
    openChatSessionIds: ["session-1"],
    focusedChatWindowId: "session:session-1",
    sessionPlans: {
      "session-1": {
        updatedAt: "2026-06-02T00:00:00.000Z",
        entries: [
          { content: "调研 ACP plan", priority: "medium", status: "completed" },
          { content: "接入 Dashboard", priority: "medium", status: "in_progress" },
        ],
      },
    },
    toolCalls: { "session-1": [{ id: "tool-1" }] },
    approvalItemsById: {
      "approval-1": {
        id: "approval-1",
        sessionId: "session-1",
        resolving: true,
        request: {
          id: "approval-1",
          sessionId: "session-1",
          command: "file.write",
          options: [{ label: "Allow", decision: "allow" }],
        },
      },
    },
    approvalHistory: [
      {
        id: "approval-1",
        sessionId: "session-1",
        runtimeInstanceId: "runtime-1",
        sequence: 1,
        status: "pending",
        request: {
          id: "approval-1",
          command: "file.write",
          reason: "Write file",
          cwd: "D:/repo",
        },
        createdAt: "2026-05-29T10:00:20.000Z",
        updatedAt: "2026-05-29T10:00:20.000Z",
      },
      {
        id: "approval-history-1",
        sessionId: "session-1",
        runtimeInstanceId: "runtime-1",
        sequence: 2,
        status: "resolved",
        decision: "deny",
        request: {
          id: "approval-history-1",
          command: "shell_command",
          reason: "Run focused tests",
          cwd: "D:/repo",
        },
        createdAt: "2026-05-29T10:00:30.000Z",
        updatedAt: "2026-05-29T10:00:45.000Z",
      },
    ],
    notifications: [{
      id: "notification-1",
      kind: "error",
      message: "ACP connection closed",
      source: "runtime",
      code: "ACP_PROMPT_FAILED",
      sessionId: "session-1",
      createdAt: "2026-05-29T10:01:00.000Z",
    }],
    resolveDisplaySessionTitle: (session) => session.title ?? session.id,
  });

  assert.equal(model.activeHelmLabel, "Local Helm · 127.0.0.1:47631");
  assert.equal(model.onlineHelmCount, 1);
  assert.equal(model.activeSessionCount, 1);
  assert.equal(model.pendingApprovalCount, 1);
  assert.equal(model.toolCallCount, 1);
  assert.equal(model.planSessionCount, 1);
  assert.equal(model.completedPlanSessionCount, 0);
  assert.equal(model.helms[0]?.endpoint, "127.0.0.1:47631");
  assert.equal(model.approvals[0]?.kind, "file.write");
  assert.deepEqual(model.approvals[0]?.decisions, [
    "deny",
    "allow",
    "allow_session",
    "allow_always",
  ]);
  assert.equal(model.approvals[0]?.sessionName, "Review plan");
  assert.equal(model.approvals[0]?.projectName, "Tiller");
  assert.equal(model.approvals[0]?.worktreeName, "main");
  const resolvingHistory = model.approvalHistory.find((approval) => approval.kind === "file.write");
  const resolvedHistory = model.approvalHistory.find((approval) => approval.decision === "deny");
  assert.equal(resolvingHistory?.status, "resolving");
  assert.equal(resolvedHistory?.status, "resolved");
  assert.equal(resolvedHistory?.createdAt, "2026-05-29T10:00:30.000Z");
  assert.equal(resolvedHistory?.updatedAt, "2026-05-29T10:00:45.000Z");
  assert.equal(model.sessions[0]?.status, "waiting_for_permission");
  assert.equal(model.sessions[0]?.selected, true);
  assert.equal(model.sessions[0]?.projectName, "Tiller");
  assert.equal(model.sessions[0]?.worktreeName, "main");
  assert.equal(model.notifications[0]?.message, "ACP connection closed");
  assert.equal(model.notifications[0]?.code, "ACP_PROMPT_FAILED");
  assert.equal(model.notifications[0]?.sessionName, "Review plan");
  assert.deepEqual(model.sessions[0]?.planSummary, {
    completed: 1,
    total: 2,
    label: "1/2 进行中",
  });
});
