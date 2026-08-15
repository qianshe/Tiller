import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRequestOption, SessionSummary } from "@tiller/shared";
import {
  buildDashboardHourlyActivityTrend,
  buildDashboardViewModel,
  resolveDashboardApprovalDecision,
  resolveDashboardApprovalDecisions,
} from "./view-model";

test("buildDashboardHourlyActivityTrend keeps 24 hourly buckets for the one-day view", () => {
  const points = buildDashboardHourlyActivityTrend(
    {
      "session-1": [
        {
          id: "prompt-1",
          kind: "user_message",
          message: {} as any,
          timestamp: "2026-06-02T09:10:00.000Z",
          updatedAt: "2026-06-02T09:10:00.000Z",
        },
        {
          id: "prompt-2",
          kind: "user_message",
          message: {} as any,
          timestamp: "2026-06-02T10:05:00.000Z",
          updatedAt: "2026-06-02T10:05:00.000Z",
        },
      ],
    },
    {
      "session-1": [
        { id: "tool-1", timestamp: "2026-06-02T09:20:00.000Z" },
        { id: "tool-2", timestamp: "2026-06-02T10:30:00.000Z" },
      ],
    },
    Date.parse("2026-06-02T10:37:00.000Z"),
  );

  assert.equal(points.length, 24);
  assert.deepEqual(points.at(-2), {
    date: "2026-06-02T09:00:00.000Z",
    promptCount: 1,
    toolCallCount: 1,
  });
  assert.deepEqual(points.at(-1), {
    date: "2026-06-02T10:00:00.000Z",
    promptCount: 1,
    toolCallCount: 1,
  });
});

test("dashboard activity falls back to messages and canonical tool calls without double counting", () => {
  const now = Date.parse("2026-06-02T10:37:00.000Z");
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    agents: [],
    projects: [],
    sessions: [],
    messages: {
      "session-1": [{
        id: "prompt-1",
        role: "user",
        text: "继续",
        timestamp: "2026-06-02T10:05:00.000Z",
      } as any],
    },
    sessionTimeline: {
      "session-1": [
        {
          id: "prompt-1",
          kind: "user_message",
          message: {} as any,
          timestamp: "2026-06-02T10:05:00.000Z",
          updatedAt: "2026-06-02T10:05:00.000Z",
        },
        {
          id: "tool-1-entry",
          kind: "tool_call",
          toolCall: {
            id: "tool-1",
            timestamp: "2026-06-02T10:20:00.000Z",
          },
          timestamp: "2026-06-02T10:20:00.000Z",
          updatedAt: "2026-06-02T10:20:00.000Z",
        },
      ] as any,
    },
    toolCalls: {
      "session-1": [{ id: "tool-1", timestamp: "2026-06-02T10:20:00.000Z" }],
    },
    now,
    approvalItemsById: {},
    resolveDisplaySessionTitle: (session: SessionSummary) => session.title ?? session.id,
  });

  assert.equal(model.promptCount, 1);
  assert.equal(model.toolCallCount, 1);
  assert.equal(model.recentToolCallCount, 1);
  assert.deepEqual(model.activityTrendHourly.at(-1), {
    date: "2026-06-02T10:00:00.000Z",
    promptCount: 1,
    toolCallCount: 1,
  });
});

test("dashboard activity uses the Helm summary before any session is opened", () => {
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    agents: [],
    projects: [],
    sessions: [],
    messages: {},
    sessionTimeline: {},
    toolCalls: {},
    now: Date.parse("2026-06-02T10:37:00.000Z"),
    activitySummary: {
      generatedAt: "2026-06-02T10:37:00.000Z",
      promptCount: 4,
      recentToolCallCount: 7,
      toolCallCount: 18,
      activityTrend: [{ date: "2026-06-02", promptCount: 4, toolCallCount: 7 }],
      activityTrendHourly: [{ date: "2026-06-02T10:00:00.000Z", promptCount: 4, toolCallCount: 7 }],
    },
    approvalItemsById: {},
    resolveDisplaySessionTitle: (session: SessionSummary) => session.title ?? session.id,
  });

  assert.equal(model.promptCount, 4);
  assert.equal(model.recentToolCallCount, 7);
  assert.equal(model.toolCallCount, 18);
  assert.deepEqual(model.activityTrend, [
    { date: "2026-06-02", promptCount: 4, toolCallCount: 7 },
  ]);
  assert.deepEqual(model.activityTrendHourly, [
    { date: "2026-06-02T10:00:00.000Z", promptCount: 4, toolCallCount: 7 },
  ]);
});

test("dashboard session selection is independent from mission window state", () => {
  const sessions = [
    { id: "dashboard-session", title: "Dashboard session" },
    { id: "mission-session", title: "Mission session" },
  ] as SessionSummary[];
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    agents: [],
    projects: [],
    sessions,
    activeSessionId: "mission-session",
    openChatSessionIds: ["mission-session"],
    focusedChatWindowId: "session:mission-session",
    selectedSessionId: "dashboard-session",
    toolCalls: {},
    approvalItemsById: {},
    resolveDisplaySessionTitle: (session: SessionSummary) => session.title ?? session.id,
  } as any);

  assert.equal(model.sessions.find((session: { id: string }) => session.id === "dashboard-session")?.selected, true);
  assert.equal(model.sessions.find((session: { id: string }) => session.id === "mission-session")?.selected, false);
});

test("dashboard session projection preserves completion unread state", () => {
  const session = {
    id: "completed-session",
    title: "Completed session",
    status: "idle",
    createdAt: "2026-06-02T10:00:00.000Z",
    updatedAt: "2026-06-02T10:05:00.000Z",
  } as SessionSummary;
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    agents: [],
    projects: [],
    sessions: [session],
    statuses: { [session.id]: "idle" },
    completedUnreadSessionIds: { [session.id]: true },
    toolCalls: {},
    approvalItemsById: {},
    resolveDisplaySessionTitle: (item: SessionSummary) => item.title ?? item.id,
  });

  assert.equal(model.sessions[0]?.completedUnread, true);
});

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
    agents: [{ id: "codex" }, { id: "claudecode" }],
    agentConnectionInventory: [
      { providerId: "codex", status: "ready" },
      { providerId: "claudecode", status: "closed" },
    ],
    projects: [{ id: "tiller" }],
    sessions,
    statuses: { "session-1": "waiting_for_permission" },
    selectedSessionId: "session-1",
    sessionPlans: {
      "session-1": {
        updatedAt: "2026-06-02T00:00:00.000Z",
        entries: [
          { content: "调研 ACP plan", priority: "medium", status: "completed" },
          { content: "接入 Dashboard", priority: "medium", status: "in_progress" },
        ],
      },
    },
    toolCalls: {
      "session-1": [{ id: "tool-1", timestamp: "2026-05-29T10:00:20.000Z" }],
    },
    sessionTimeline: {
      "session-1": [{
        id: "prompt-1",
        kind: "user_message",
        message: {} as any,
        timestamp: "2026-05-29T10:00:10.000Z",
        updatedAt: "2026-05-29T10:00:10.000Z",
      }],
    },
    now: Date.parse("2026-06-02T00:00:00.000Z"),
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
  assert.equal(model.runningAcpCount, 1);
  assert.equal(model.totalAcpCount, 2);
  assert.equal(model.runningSessionCount, 0);
  assert.equal(model.totalSessionCount, 1);
  assert.equal(model.pendingApprovalCount, 1);
  assert.equal(model.toolCallCount, 1);
  assert.equal(model.promptCount, 0);
  assert.deepEqual(model.activityTrend.find((point) => point.date === "2026-05-29"), {
    date: "2026-05-29",
    promptCount: 1,
    toolCallCount: 1,
  });
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
  assert.equal(model.sessions[0]?.createdAt, "2026-05-29T10:00:00.000Z");
  assert.equal(model.notifications[0]?.message, "ACP connection closed");
  assert.equal(model.notifications[0]?.code, "ACP_PROMPT_FAILED");
  assert.equal(model.notifications[0]?.sessionName, "Review plan");
  assert.deepEqual(model.sessions[0]?.planSummary, {
    completed: 1,
    total: 2,
    label: "1/2 进行中",
  });
});

test("buildDashboardViewModel counts one ACP agent across multiple worktree connections", () => {
  const agents = [{ id: "claudecode" }, { id: "opencode" }, { id: "codex" }];
  const connections = [
    { providerId: "claudecode", status: "ready" },
    { providerId: "opencode", status: "ready" },
    { providerId: "codex", status: "ready" },
    { providerId: "codex", status: "ready" },
  ];
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    currentHelmKey: "helm-local",
    helmConnectionStates: { "helm-local": "connected" },
    helmInventories: {
      "helm-local": { agents, agentConnections: connections },
    },
    agents,
    agentConnectionInventory: connections,
    projects: [],
    sessions: [],
    toolCalls: {},
    approvalItemsById: {},
    resolveDisplaySessionTitle: (session) => session.title ?? session.id,
  });

  assert.equal(model.runningAcpCount, 3);
  assert.equal(model.totalAcpCount, 3);
});

test("buildDashboardViewModel aggregates ACP agents across connected Helms", () => {
  const localAgents = [{ id: "claudecode" }, { id: "opencode" }, { id: "codex" }];
  const localConnections = [
    { providerId: "claudecode", status: "ready" },
    { providerId: "opencode", status: "ready" },
    { providerId: "codex", status: "ready" },
  ];
  const remoteAgents = [{ id: "codex" }];
  const remoteConnections = [{ providerId: "codex", status: "ready" }];
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    currentHelmKey: "helm-local",
    helmConnectionStates: {
      "helm-local": "connected",
      "helm-remote": "connected",
    },
    helmInventories: {
      "helm-local": { agents: localAgents, agentConnections: localConnections },
      "helm-remote": { agents: remoteAgents, agentConnections: remoteConnections },
    },
    agents: localAgents,
    agentConnectionInventory: localConnections,
    projects: [],
    sessions: [],
    toolCalls: {},
    approvalItemsById: {},
    resolveDisplaySessionTitle: (session) => session.title ?? session.id,
  });

  assert.equal(model.runningAcpCount, 4);
  assert.equal(model.totalAcpCount, 4);
});

test("buildDashboardViewModel aggregates fleet session and activity metrics", () => {
  const now = Date.parse("2026-06-02T10:37:00.000Z");
  const localSessions = [
    { id: "local-session", status: "running", title: "Local" },
  ] as SessionSummary[];
  const remoteSessions = [
    { id: "remote-running", status: "running", title: "Remote running" },
    { id: "remote-idle", status: "idle", title: "Remote idle" },
  ] as SessionSummary[];
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    currentHelmKey: "127.0.0.1:47631",
    helmConnectionStates: {
      "127.0.0.1:47631": "connected",
      "remote:47631": "connected",
    },
    configuredHelms: [
      { id: "local", name: "Local", host: "127.0.0.1", port: 47631 },
      { id: "remote", name: "Remote", host: "remote", port: 47631 },
    ],
    helmInventories: {
      "127.0.0.1:47631": {
        sessions: localSessions,
        statuses: { "local-session": "running" },
        activitySummary: {
          generatedAt: "2026-06-02T10:37:00.000Z",
          promptCount: 2,
          recentToolCallCount: 3,
          toolCallCount: 4,
          activityTrend: [{ date: "2026-06-02", promptCount: 2, toolCallCount: 3 }],
          activityTrendHourly: [{ date: "2026-06-02T10:00:00.000Z", promptCount: 2, toolCallCount: 3 }],
        },
      },
      "remote:47631": {
        sessions: remoteSessions,
        statuses: {
          "remote-running": "running",
          "remote-idle": "idle",
        },
        activitySummary: {
          generatedAt: "2026-06-02T10:37:00.000Z",
          promptCount: 5,
          recentToolCallCount: 7,
          toolCallCount: 11,
          activityTrend: [{ date: "2026-06-02", promptCount: 5, toolCallCount: 7 }],
          activityTrendHourly: [{ date: "2026-06-02T10:00:00.000Z", promptCount: 5, toolCallCount: 7 }],
        },
      },
    },
    agents: [],
    projects: [],
    sessions: localSessions,
    toolCalls: {},
    activitySummary: undefined,
    now,
    approvalItemsById: {},
    resolveDisplaySessionTitle: (session) => session.title ?? session.id,
  });

  assert.equal(model.onlineHelmCount, 2);
  assert.equal(model.totalHelmCount, 2);
  assert.equal(model.runningSessionCount, 2);
  assert.equal(model.totalSessionCount, 3);
  assert.equal(model.promptCount, 7);
  assert.equal(model.recentToolCallCount, 10);
  assert.equal(model.toolCallCount, 15);
  assert.deepEqual(model.activityTrend, [
    { date: "2026-06-02", promptCount: 7, toolCallCount: 10 },
  ]);
  assert.deepEqual(model.activityTrendHourly, [
    { date: "2026-06-02T10:00:00.000Z", promptCount: 7, toolCallCount: 10 },
  ]);
});

test("buildDashboardViewModel counts configured Helms before they connect", () => {
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    currentHelmKey: "127.0.0.1:47631",
    configuredHelms: [
      { id: "local", name: "Local", host: "127.0.0.1", port: 47631 },
      { id: "remote", name: "Remote", host: "remote", port: 47631 },
      { id: "offline", name: "Offline", host: "offline", port: 47631 },
    ],
    helmConnectionStates: {
      "127.0.0.1:47631": "connected",
      "remote:47631": "connecting",
      "offline:47631": "disconnected",
    },
    agents: [],
    projects: [],
    sessions: [],
    toolCalls: {},
    approvalItemsById: {},
    resolveDisplaySessionTitle: (session) => session.title ?? session.id,
  });

  assert.equal(model.onlineHelmCount, 1);
  assert.equal(model.totalHelmCount, 3);
});

test("buildDashboardViewModel excludes historical Helm state from configured counts", () => {
  const model = buildDashboardViewModel({
    connection: "connected",
    daemonHost: "127.0.0.1",
    daemonPort: "47631",
    defaultDaemonHost: "127.0.0.1",
    defaultDaemonPort: "47631",
    currentHelmKey: "127.0.0.1:47631",
    configuredHelms: [
      { id: "local", name: "Local", host: "127.0.0.1", port: 47631 },
    ],
    helmConnectionStates: {
      "127.0.0.1:47631": "connected",
      "historical:47631": "disconnected",
    },
    helmInventories: {
      "historical:47631": {
        agents: [],
        sessions: [],
        statuses: {},
      },
    },
    agents: [],
    projects: [],
    sessions: [],
    toolCalls: {},
    approvalItemsById: {},
    resolveDisplaySessionTitle: (session) => session.title ?? session.id,
  });

  assert.equal(model.onlineHelmCount, 1);
  assert.equal(model.totalHelmCount, 1);
});
