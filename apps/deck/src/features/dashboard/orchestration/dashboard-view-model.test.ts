import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRequestOption, SessionSummary } from "@tiller/shared";
import { buildDashboardViewModel, resolveDashboardApprovalDecision } from "./dashboard-view-model";

test("resolveDashboardApprovalDecision prefers allow options", () => {
  const options: PermissionRequestOption[] = [
    { label: "Deny", decision: "deny" },
    { label: "Allow session", decision: "allow_session" },
  ];

  assert.equal(resolveDashboardApprovalDecision(options), "allow_session");
});

test("buildDashboardViewModel derives helm rows and approval rows", () => {
  const sessions: SessionSummary[] = [
    {
      id: "session-1",
      projectId: "tiller",
      projectName: "Tiller",
      helmId: "local",
      cwd: "D:/myProject/tools/Tiller",
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
    toolCalls: { "session-1": [{ id: "tool-1" }] },
    approvalItemsById: {
      "approval-1": {
        id: "approval-1",
        sessionId: "session-1",
        request: {
          id: "approval-1",
          sessionId: "session-1",
          command: "file.write",
          options: [{ label: "Allow", decision: "allow" }],
        },
      },
    },
    resolveDisplaySessionTitle: (session) => session.title ?? session.id,
  });

  assert.equal(model.activeHelmLabel, "Local Helm · 127.0.0.1:47631");
  assert.equal(model.onlineHelmCount, 1);
  assert.equal(model.activeSessionCount, 1);
  assert.equal(model.pendingApprovalCount, 1);
  assert.equal(model.toolCallCount, 1);
  assert.equal(model.helms[0]?.endpoint, "127.0.0.1:47631");
  assert.equal(model.approvals[0]?.kind, "file.write");
  assert.equal(model.approvals[0]?.sessionName, "Review plan");
});
