import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  copyNotificationReport,
  DashboardNotificationList,
  formatNotificationReport,
} from "./notification-list";
import { DashboardPage } from "./page";

const currentDir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(currentDir, "page.tsx"), "utf8");
const activityStreamPath = resolve(currentDir, "activity-stream.tsx");
const activityStreamSource = existsSync(activityStreamPath)
  ? readFileSync(activityStreamPath, "utf8")
  : "";

const commonProps = {
  activeHelmLabel: "workstation · 127.0.0.1:47631",
  onlineHelmCount: 2,
  totalHelmCount: 3,
  activeSessionCount: 1,
  pendingApprovalCount: 3,
  planSessionCount: 1,
  completedPlanSessionCount: 0,
  toolCallCount: 23,
  sessions: [
    {
      id: "session-1",
      title: "Plan review",
      projectName: "Tiller",
      worktreeName: "feature/0.1.6",
      agentName: "Codex",
      status: "running",
      updatedAt: "2026-06-02T00:00:00.000Z",
      planSummary: { completed: 1, total: 2, label: "1/2 进行中" },
    },
  ],
  approvals: [
    {
      id: "approval-default",
      kind: "file.write",
      target: "等待权限请求",
      allowDecision: "allow" as const,
      agentName: "Codex",
      sessionName: "Plan review",
      projectName: "Tiller",
      worktreeName: "feature/0.1.6",
    },
  ],
  notifications: [
    {
      id: "notification-1",
      kind: "error" as const,
      message: "ACP connection closed",
      source: "runtime",
      code: "ACP_PROMPT_FAILED",
      sessionId: "session-1",
      sessionName: "Plan review",
      createdAt: "2026-06-02T00:00:00.000Z",
    },
  ],
  onNavigateAgents: () => undefined,
};

test("DashboardPage renders the v6 KPI, activity, Helm matrix, and approvals layout", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, commonProps));

  assert.match(html, /在线 Helm/);
  assert.match(html, /2 \/ 3/);
  assert.match(html, /活动流/);
  assert.match(html, /Helm 矩阵/);
  assert.match(html, /待审批/);
  assert.match(html, /通知/);
  assert.match(html, /计划/);
  assert.match(html, /1\/2 进行中/);
  assert.match(html, /overview-activity-row/);
  assert.match(html, /overview-activity-agent/);
  assert.doesNotMatch(html, /会话活动 ·/);
  assert.match(html, /取消/);
  assert.match(html, /单次/);
  assert.match(html, /会话/);
  assert.match(html, /全局/);
  assert.doesNotMatch(html, /本日消息/);
});

test("DashboardPage distinguishes compact activity row states", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardPage, {
      ...commonProps,
      sessions: [
        { id: "selected", title: "Selected session", agentName: "Codex", status: "idle", selected: true },
        { id: "selected-2", title: "Second selected session", agentName: "Codex", status: "cancelled", selected: true },
        { id: "starting", title: "Starting session", agentName: "Codex", status: "starting" },
        { id: "running", title: "Running session", agentName: "OpenCode", status: "running" },
        { id: "waiting", title: "Waiting session", agentName: "Codex", status: "waiting_for_permission" },
        { id: "failed", title: "Failed session", agentName: "ClaudeCode", status: "error" },
        { id: "idle", title: "Idle session", agentName: "Codex", status: "idle" },
      ],
    }),
  );

  assert.match(html, /会话: Selected session. 空闲. Codex/);
  assert.match(html, /会话: Second selected session. 已取消. Codex/);
  assert.match(html, /会话: Starting session. 启动中. Codex/);
  assert.match(html, /会话: Running session. 运行中. OpenCode/);
  assert.match(html, /会话: Waiting session. 等待审批. Codex/);
  assert.match(html, /会话: Failed session. 错误. ClaudeCode/);
  assert.match(html, /会话: Idle session. 空闲. Codex/);
  assert.doesNotMatch(html, /已选中|未选中/);
  assert.match(html, /aria-current="true"/);
  assert.match(html, /before:bg-primary/);
  assert.match(html, /bg-primary/);
  assert.match(html, /bg-warning/);
  assert.match(html, /bg-destructive/);
  assert.match(html, /bg-muted-foreground/);
});

test("DashboardPage renders approval tool name with project and worktree scope", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardPage, {
      ...commonProps,
      approvals: [
        {
          id: "approval-1",
          kind: "MCP · sanshu/zhi",
          target: "Approve MCP tool call",
          agentName: "Codex",
          sessionName: "你好",
          projectName: "Tiller",
          worktreeName: "feature/0.1.6",
          allowDecision: "allow",
        },
      ],
    } as any),
  );

  assert.doesNotMatch(html, /你好/);
  assert.match(html, /MCP · sanshu\/zhi/);
  assert.doesNotMatch(html, /Approve MCP tool call/);
  assert.match(html, /Tiller/);
  assert.match(html, /feature\/0\.1\.6/);
  assert.match(html, /取消/);
  assert.match(html, /单次/);
  assert.match(html, /会话/);
  assert.match(html, /全局/);
});

test("DashboardPage leaves approvals empty when there are no pending approvals", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardPage, {
      ...commonProps,
      pendingApprovalCount: 0,
      approvals: [],
    }),
  );

  assert.match(html, /待审批/);
  assert.doesNotMatch(html, /file\.write/);
  assert.doesNotMatch(html, /等待权限请求/);
  assert.doesNotMatch(html, /取消|单次|全局/);
});

test("DashboardPage renders activity as scan-friendly session columns", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardPage, {
      ...commonProps,
      sessions: [
        {
          id: "session-1",
          title: "Thinking展示实现审查与聊天栏UI建议",
          projectName: "Tiller",
          worktreeName: "feature/0.1.6",
          agentName: "ClaudeCode",
          status: "completed",
          selected: true,
          planSummary: { completed: 3, total: 3, label: "3/3 已完成" },
        },
      ],
      approvals: [],
    }),
  );

  assert.match(html, /状态/);
  assert.match(html, /名称/);
  assert.match(html, /项目/);
  assert.match(html, /Worktree/);
  assert.match(html, /计划 \/ 权限/);
  assert.match(html, /ACP/);
  assert.match(html, /空闲/);
  assert.match(html, /aria-current="true"/);
  assert.doesNotMatch(html, /已选中|未选中/);
  assert.match(html, /Thinking展示实现审查与聊天栏UI建议/);
  assert.match(html, /Tiller/);
  assert.match(html, /feature\/0\.1\.6/);
  assert.match(html, /3\/3 已完成/);
  assert.match(html, /ClaudeCode/);
});

test("DashboardPage wires compact approval decisions to approval responses", () => {
  assert.match(pageSource, /onRespondApproval\?\.\(approval\.id, decision\)/);
  assert.match(pageSource, /disabled=\{approval\.resolving \|\| !onRespondApproval\}/);
  assert.match(pageSource, /deny: "取消"/);
  assert.match(pageSource, /allow: "单次"/);
  assert.match(pageSource, /allow_session: "会话"/);
  assert.match(pageSource, /allow_always: "全局"/);
});

test("DashboardPage links session activities back to mission sessions", () => {
  assert.match(activityStreamSource, /onOpenSession\?\.\(activity\.sessionId\)/);
  assert.match(activityStreamSource, /disabled=\{!activity\.sessionId \|\| !onOpenSession\}/);
});

test("DashboardPage routes conversation notifications to a clickable table", () => {
  const html = renderToStaticMarkup(createElement(DashboardNotificationList, {
    notifications: commonProps.notifications,
    onOpenSession: () => undefined,
  }));

  assert.match(pageSource, /notifications=\{notifications\}/);
  assert.match(activityStreamSource, /activeTab === "通知"/);
  assert.match(html, /Conversation/);
  assert.match(html, /打开会话/);
  assert.match(html, /Plan review/);
  assert.match(html, /ACP connection closed/);
  assert.match(html, /复制通知/);
});

test("notification reports preserve the diagnostics needed for feedback", () => {
  assert.equal(formatNotificationReport(commonProps.notifications[0]!), [
    "Tiller 错误通知",
    "时间: 2026-06-02T00:00:00.000Z",
    "来源: runtime",
    "错误码: ACP_PROMPT_FAILED",
    "会话: Plan review (session-1)",
    "消息: ACP connection closed",
  ].join("\n"));
});

test("copyNotificationReport writes the complete report to the clipboard", async () => {
  const writes: string[] = [];

  await copyNotificationReport(commonProps.notifications[0]!, {
    writeText: async (text: string) => {
      writes.push(text);
    },
  });

  assert.deepEqual(writes, [formatNotificationReport(commonProps.notifications[0]!)]);
  await assert.rejects(
    copyNotificationReport(commonProps.notifications[0]!, undefined),
    /Clipboard API is unavailable/,
  );
});

test("DashboardPage delegates activity rendering to the activity stream component", () => {
  assert.match(pageSource, /DashboardActivityStream/);
  assert.doesNotMatch(pageSource, /ACTIVITY_GRID_COLUMNS/);
  assert.doesNotMatch(pageSource, /function buildActivities/);
});

test("DashboardPage keeps activity stream metadata visually plain", () => {
  assert.doesNotMatch(activityStreamSource, /overview-activity-agent[^\n]+rounded bg-surface-sunken/);
  assert.doesNotMatch(activityStreamSource, /rounded border border-border-ghost/);
  assert.doesNotMatch(activityStreamSource, /place-items-center rounded bg-surface-sunken/);
});

test("DashboardPage keeps the ACP column content-sized and left-aligned", () => {
  assert.match(activityStreamSource, /resolveAcpColumnWidth/);
  assert.match(activityStreamSource, /var\(--dashboard-activity-acp-width\)/);
  assert.match(activityStreamSource, /_112px_var\(--dashboard-activity-acp-width\)/);
  assert.doesNotMatch(activityStreamSource, /minmax\(128px,1fr\)/);
  assert.doesNotMatch(activityStreamSource, /justify-self-end/);
});

test("DashboardPage keeps activity filters focused on recent, permissions, notifications, and old items", () => {
  assert.match(activityStreamSource, /\(\["最近", "权限", "通知", "7天前"\] as const\)/);
  assert.doesNotMatch(activityStreamSource, /\(\["全部", "会话", "权限"\] as const\)/);
  assert.match(activityStreamSource, /activeTab === "通知"/);
  assert.match(activityStreamSource, /activeTab === "7天前"/);
  assert.match(activityStreamSource, /ACTIVITY_OLD_MS = 7 \* 24 \* HOUR_MS/);
});

test("DashboardPage keeps permission activity details compact", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardPage, {
      ...commonProps,
      approvals: [
        {
          id: "approval-compact",
          kind: "MCP · sanshu/zhi",
          target: "Approve MCP tool call with a long permission reason",
          agentName: "Codex",
          projectName: "Tiller",
          worktreeName: "feature/0.1.6",
          allowDecision: "allow",
        },
      ],
    } as any),
  );

  assert.match(html, /权限: MCP · sanshu\/zhi\. 等待审批\. Codex\. Tiller\. feature\/0\.1\.6\. 待处理/);
  assert.doesNotMatch(html, /Approve MCP tool call with a long permission reason/);
});

test("DashboardPage puts desktop notifications after the permission tab and keeps mobile notifications after approvals", () => {
  const desktopHtml = renderToStaticMarkup(createElement(DashboardPage, commonProps));
  const mobileHtml = renderToStaticMarkup(createElement(DashboardPage, { ...commonProps, isMobile: true }));

  assert.match(desktopHtml, /最近[\s\S]*权限[\s\S]*通知[\s\S]*7天前/);
  assert.match(mobileHtml, /待审批[\s\S]*通知[\s\S]*Helm 矩阵/);
  assert.match(mobileHtml, /ACP connection closed/);
  assert.match(mobileHtml, /ACP_PROMPT_FAILED/);
  assert.match(activityStreamSource, /notifications=\{notifications\}/);
  assert.match(activityStreamSource, /onOpenSession=\{onOpenSession\}/);
  assert.match(htmlOrSourceForNotifications(), /NOTIFICATION_GRID_COLUMNS/);
});

function htmlOrSourceForNotifications() {
  return readFileSync(resolve(currentDir, "notification-list.tsx"), "utf8");
}

test("DashboardPage limits the recent activity stream to the latest 15 items", () => {
  const sessions = Array.from({ length: 18 }, (_, index) => ({
    id: `session-${index}`,
    title: `Recent activity ${index}`,
    agentName: "Codex",
    projectName: "Tiller",
    worktreeName: "feature/0.1.6",
    status: "idle",
    updatedAt: new Date(Date.UTC(2026, 5, 2, 18 - index, 0, 0)).toISOString(),
  }));
  const html = renderToStaticMarkup(
    createElement(DashboardPage, {
      ...commonProps,
      sessions,
      approvals: [],
    }),
  );

  assert.equal((html.match(/overview-activity-row/g) ?? []).length, 15);
  assert.match(html, /Recent activity 0/);
  assert.match(html, /Recent activity 14/);
  assert.doesNotMatch(html, /Recent activity 15/);
  assert.doesNotMatch(html, /Recent activity 17/);
});

test("DashboardPage derives the activity sparkline from activity timestamps", () => {
  assert.match(activityStreamSource, /buildActivitySparkline/);
  assert.match(activityStreamSource, /timestampMs/);
  assert.doesNotMatch(activityStreamSource, /const points = \[3, 5, 4/);
});

test("DashboardPage mobile keeps v6 priority order", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, { ...commonProps, isMobile: true }));

  assert.match(html, /grid grid-cols-2 gap-2 mb-3/);
  assert.match(html, /待审批[\s\S]*Helm 矩阵[\s\S]*活动流/);
  assert.match(html, /管理 ›/);
  assert.match(html, /24h/);
});

test("DashboardPage uses shared v6 pane primitives and no redesign mock imports", () => {
  assert.match(pageSource, /wb-pane/);
  assert.match(activityStreamSource, /Sparkline/);
  assert.doesNotMatch(pageSource, /docs\/redesign\/v6/);
  assert.doesNotMatch(pageSource, /\.\.\/data\/mock/);
  assert.doesNotMatch(pageSource, /"系统"/);
});
