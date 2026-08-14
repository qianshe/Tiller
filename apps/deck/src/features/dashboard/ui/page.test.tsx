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
import {
  buildDashboardTrendChartData,
  DashboardActivityTrend,
  selectDashboardTrendPoints,
} from "./activity/trend";
import { DashboardPage } from "./page";

const currentDir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(currentDir, "page.tsx"), "utf8");
const activityStreamPath = resolve(currentDir, "activity", "stream.tsx");
const activityStreamSource = existsSync(activityStreamPath)
  ? readFileSync(activityStreamPath, "utf8")
  : "";
const activityTrendPath = resolve(currentDir, "activity", "trend.tsx");
const activityTrendSource = existsSync(activityTrendPath)
  ? readFileSync(activityTrendPath, "utf8")
  : "";

const commonProps = {
  activeHelmLabel: "workstation · 127.0.0.1:47631",
  onlineHelmCount: 2,
  totalHelmCount: 3,
  runningAcpCount: 1,
  totalAcpCount: 2,
  runningSessionCount: 1,
  totalSessionCount: 3,
  pendingApprovalCount: 3,
  planSessionCount: 1,
  completedPlanSessionCount: 0,
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
  activeSection: "overview" as const,
  onSelectSection: () => undefined,
};

test("DashboardPage renders the v6 KPI, activity, and approvals layout", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, commonProps));

  assert.match(html, /在线 Helm/);
  assert.match(html, /2 \/ 3/);
  assert.match(html, /活动流/);
  assert.doesNotMatch(html, /Helm 资源/);
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

test("DashboardPage keeps activity counts in the trend chart", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
  }));

  assert.match(html, /在线 Helm/);
  assert.match(html, /ACP Agent/);
  assert.match(html, /1 \/ 2/);
  assert.match(html, /运行中会话[\s\S]*1 \/ 3/);
  assert.equal((html.match(/dashboard-metric-card/g) ?? []).length, 4);
  assert.doesNotMatch(html, /24h Prompt/);
  assert.doesNotMatch(html, /24h 工具调用/);
  assert.doesNotMatch(html, /dashboard-recent-prompt-count/);
  assert.doesNotMatch(html, /dashboard-recent-tool-count/);
  assert.match(html, /待审批/);
  assert.doesNotMatch(html, /<span[^>]*>计划<\/span>/);
  assert.match(html, /1 个离线/);
});

test("DashboardPage renders the activity trend with shadcn-style range controls", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    activityTrend: [
      { date: "2026-05-31", promptCount: 2, toolCallCount: 1 },
      { date: "2026-06-01", promptCount: 3, toolCallCount: 4 },
    ],
    activityTrendHourly: [
      { date: "2026-06-02T09:00:00.000Z", promptCount: 2, toolCallCount: 1 },
      { date: "2026-06-02T10:00:00.000Z", promptCount: 3, toolCallCount: 4 },
    ],
  }));

  assert.match(html, /dashboard-activity-trend/);
  assert.match(html, /Prompt 与工具调用/);
  assert.match(html, /近1个月/);
  assert.match(html, /近1周/);
  assert.match(html, /近1天/);
  assert.match(html, /data-state="active"[^>]*>近1天<\/button>/);
  assert.match(html, /Prompt[\s\S]*>5<\/span>/);
  assert.match(html, /工具调用[\s\S]*>5<\/span>/);
  assert.doesNotMatch(html, /data-slot="dashboard-trend-summary"/);
  assert.match(html, /data-slot="dashboard-trend-chart"/);
  assert.match(html, /data-slot="dashboard-trend-legend"/);
  assert.match(activityTrendSource, /flex min-w-0 flex-nowrap items-center gap-2/);
  assert.match(activityTrendSource, /getHours\(\)/);
  assert.doesNotMatch(activityTrendSource, /getUTCHours\(\)/);
  assert.match(pageSource, /DashboardActivityTrend/);
});

test("one-day trend selects hourly points and keeps prompt/tool counts separate", () => {
  const hourlyPoints = [
    { date: "2026-06-02T09:00:00.000Z", promptCount: 2, toolCallCount: 1 },
    { date: "2026-06-02T10:00:00.000Z", promptCount: 1, toolCallCount: 3 },
  ];
  assert.deepEqual(
    selectDashboardTrendPoints(
      [{ date: "2026-06-02", promptCount: 99, toolCallCount: 99 }],
      hourlyPoints,
      "1d",
    ),
    hourlyPoints,
  );

  const html = renderToStaticMarkup(createElement(DashboardActivityTrend, {
    points: hourlyPoints,
  }));

  assert.doesNotMatch(html, /data-slot="dashboard-trend-summary"/);
  assert.match(html, /h-\[180px\] min-h-\[180px\] w-full sm:h-\[220px\] sm:min-h-\[220px\]/);
  assert.match(html, /data-slot="dashboard-trend-chart"/);
  assert.match(activityTrendSource, /ChartContainer/);
  assert.match(activityTrendSource, /AreaChart/);
});

test("activity trend renders one prompt at the same height as two tool calls", () => {
  assert.deepEqual(
    buildDashboardTrendChartData([
      { date: "2026-06-02", promptCount: 1, toolCallCount: 2 },
      { date: "2026-06-03", promptCount: 2, toolCallCount: 4 },
    ]),
    [
      { date: "2026-06-02", prompt: 2, tools: 2, promptCount: 1, toolCallCount: 2 },
      { date: "2026-06-03", prompt: 4, tools: 4, promptCount: 2, toolCallCount: 4 },
    ],
  );
});

test("activity trend keeps multi-digit Y-axis labels visible", () => {
  assert.match(activityTrendSource, /margin=\{\{ left: 12, right: 8, top: 8, bottom: 0 \}\}/);
  assert.match(activityTrendSource, /width=\{44\}/);
});

test("activity trend reserves a visible canvas for both charts", () => {
  const html = renderToStaticMarkup(createElement(DashboardActivityTrend, {
    points: [{ date: "2026-06-02", promptCount: 2, toolCallCount: 1 }],
  }));

  const chart = html.match(/<div[^>]*data-slot="dashboard-trend-chart"[^>]*>/)?.[0] ?? "";
  assert.match(chart, /min-h-0/);
  assert.match(html, /data-slot="dashboard-trend-chart"/);
  assert.match(html, /data-slot="dashboard-trend-legend"/);
  assert.match(html, /class="[^\"]*h-\[180px\][^\"]*min-h-\[180px\][^\"]*w-full/);
});

test("DashboardPage keeps the trend chart as the activity metric", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    activityTrend: [{ date: "2026-06-02", promptCount: 0, toolCallCount: 0 }],
  }));

  assert.doesNotMatch(html, /data-slot="dashboard-recent-activity-summary"/);
  assert.doesNotMatch(html, /24h 活动/);
  assert.doesNotMatch(html, /data-slot="dashboard-trend-summary"/);
  assert.doesNotMatch(html, /data-slot="dashboard-recent-prompt-count"/);
  assert.doesNotMatch(html, /data-slot="dashboard-recent-tool-count"/);
  assert.match(activityTrendSource, /useState<DashboardTrendRange>\("1d"\)/);
  assert.doesNotMatch(activityStreamSource, /buildActivitySparkline/);
});

test("DashboardPage renders the session list only once on the overview", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, commonProps));

  assert.doesNotMatch(pageSource, /DashboardTaskList/);
  assert.doesNotMatch(html, /dashboard-tasks-title/);
  assert.equal((html.match(/<span class="min-w-0 truncate text-section">Plan review<\/span>/g) ?? []).length, 1);
});

test("DashboardPage uses the shadcn sidebar shell with an offcanvas collapse", () => {
  const sidebarSource = readFileSync(resolve(currentDir, "sidebar.tsx"), "utf8");

  assert.match(pageSource, /SidebarProvider/);
  assert.match(pageSource, /SidebarInset/);
  assert.match(pageSource, /showSidebarTrigger/);
  assert.match(sidebarSource, /collapsible="offcanvas"/);
  assert.match(sidebarSource, /工作台/);
  assert.match(sidebarSource, /配置/);
  assert.doesNotMatch(sidebarSource, /本地工作区/);
  assert.doesNotMatch(sidebarSource, /Local runtime/);
  assert.doesNotMatch(sidebarSource, /当前 Helm/);
  assert.equal((sidebarSource.match(/>Tiller</g) ?? []).length, 1);
  assert.match(sidebarSource, /className="dashboard-sidebar"/);
  assert.doesNotMatch(sidebarSource, /className="dashboard-sidebar relative"/);
});

test("DashboardPage exposes the shadcn-style project-aware quick create", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    quickCreateProjects: [{ id: "project-1", name: "Tiller" }],
    onCreateTask: () => undefined,
  }));

  assert.match(html, /快速创建/);
  assert.match(pageSource, /quickCreateProjects/);
  assert.match(
    pageSource,
    /DashboardQuickCreateDialog/,
  );
  assert.match(
    readFileSync(resolve(currentDir, "sidebar.tsx"), "utf8"),
    /onOpenQuickCreate/,
  );
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

test("DashboardPage keeps task activity actions inside the dashboard route", () => {
  assert.match(activityStreamSource, /onOpenSession\?\.\(activity\.sessionId\)/);
  assert.match(activityStreamSource, /disabled=\{!activity\.sessionId \|\| !onOpenSession\}/);
});

test("DashboardPage renders tasks without switching to Mission", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    activeSection: "tasks" as const,
  }));

  assert.doesNotMatch(html, /TILLER \/ TASKS/);
  assert.doesNotMatch(html, /任务与运行状态/);
  assert.match(html, /任务/);
  assert.match(html, /看板/);
  assert.match(pageSource, /DashboardTaskWorkspace/);
  assert.doesNotMatch(html, /甘特图/);
});

test("DashboardPage removes redundant overview title content", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, commonProps));

  assert.doesNotMatch(html, /TILLER \/ CONTROL CENTER/);
  assert.doesNotMatch(html, /集中查看任务、运行趋势与需要你处理的状态/);
  assert.match(html, /dashboard-site-header/);
  assert.match(html, />概览</);
});

test("DashboardPage embeds Agent and settings inside the dashboard content", () => {
  const agentsHtml = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    activeSection: "agents" as const,
    embeddedContent: createElement("div", null, "Agents embedded"),
  }));
  const settingsHtml = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    activeSection: "settings" as const,
    embeddedContent: createElement("div", null, "Settings embedded"),
  }));

  assert.match(agentsHtml, /data-dashboard-section="agents"/);
  assert.match(agentsHtml, /Agents embedded/);
  assert.match(settingsHtml, /data-dashboard-section="settings"/);
  assert.match(settingsHtml, /Settings embedded/);
});

test("DashboardPage keeps the Agents breadcrumb header free of list actions", () => {
  const agentsHtml = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    activeSection: "agents" as const,
    embeddedContent: createElement("div", null, "Agents embedded"),
  }));
  const header = agentsHtml.match(/<header[^>]*dashboard-site-header[\s\S]*?<\/header>/)?.[0] ?? "";

  assert.match(header, />Agents</);
  assert.doesNotMatch(header, /添加 Helm/);
  assert.doesNotMatch(header, /Helm 在线/);
  assert.doesNotMatch(header, /新建任务/);
});

test("DashboardPage uses one breadcrumb header for every section", () => {
  const renderHeader = (activeSection: "overview" | "tasks" | "agents" | "settings") => {
    const html = renderToStaticMarkup(createElement(DashboardPage, {
      ...commonProps,
      activeSection,
      quickCreateProjects: [{ id: "project-1", name: "Tiller" }],
      onCreateTask: () => undefined,
      embeddedContent: createElement("div", null, "Embedded"),
    }));
    return html.match(/<header[^>]*dashboard-site-header[\s\S]*?<\/header>/)?.[0] ?? "";
  };

  for (const section of ["overview", "tasks", "agents", "settings"] as const) {
    const header = renderHeader(section);
    assert.match(header, /Tiller/);
    assert.match(header, /aria-label="切换侧栏"/);
    assert.match(header, />概览|>任务|>Agents|>设置/);
  }

  assert.doesNotMatch(renderHeader("overview"), /Helm 在线|新建任务/);
  assert.doesNotMatch(renderHeader("tasks"), /Helm 在线|新建任务/);
});

test("DashboardPage keeps the embedded shell visible while config pages load", () => {
  const settingsHtml = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    activeSection: "settings" as const,
    embeddedContent: createElement("div", null, "Settings embedded"),
  }));

  assert.match(settingsHtml, /dashboard-site-header/);
  assert.match(settingsHtml, /设置/);
  assert.equal((settingsHtml.match(/aria-label="切换侧栏"/g) ?? []).length, 1);
  assert.match(pageSource, /<Suspense fallback=\{<DashboardEmbeddedFallback section=\{section\} \/>\}>/);
  assert.match(pageSource, /正在加载/);
});

test("DashboardPage exposes Mission mode below session search", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, commonProps));
  const sidebarSource = readFileSync(resolve(currentDir, "sidebar.tsx"), "utf8");

  assert.match(html, /Mission 模式/);
  assert.match(html, /搜索会话/);
  assert.match(html, /自动化/);
  assert.match(html, /Issues/);
  assert.match(sidebarSource, /onOpenMission/);
  assert.match(pageSource, /onOpenMission/);
  assert.match(sidebarSource, /Mission 模式/);
  assert.match(sidebarSource, /id: "overview", label: "概览", icon: "dashboard"/);
  assert.match(sidebarSource, /id: "tasks", label: "任务", icon: "listChecks"/);
  assert.match(sidebarSource, /id: "agents", label: "Agents", icon: "users"/);
  assert.match(sidebarSource, /<Icon name="mission" \/>/);
  assert.match(sidebarSource, /id: "automations", label: "自动化", icon: "workflow"/);
  assert.match(sidebarSource, /id: "issues", label: "Issues", icon: "fileText"/);
  assert.match(sidebarSource, /comingSoon/);
});

test("DashboardPage exposes session search as a first-class action", () => {
  const sidebarSource = readFileSync(resolve(currentDir, "sidebar.tsx"), "utf8");

  assert.match(sidebarSource, /onSearchSessions/);
  assert.match(pageSource, /DashboardSessionSearchDialog/);
  assert.match(pageSource, /setSessionSearchOpen/);
  assert.match(sidebarSource, /搜索会话/);
  assert.match(sidebarSource, /快速创建[\s\S]*搜索会话[\s\S]*Mission 模式/);
});

test("DashboardPage lets embedded pages fill the content shell", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    activeSection: "settings" as const,
    embeddedContent: createElement("div", null, "Settings embedded"),
  }));

  assert.match(html, /class="[^"]*dashboard-embedded-content[^"]*\bw-full\b/);
  const dashboardContentTag = html.match(/<div[^>]*max-w-none[^>]*>/)?.[0] ?? "";
  assert.match(dashboardContentTag, /\bw-full\b/);
  assert.match(dashboardContentTag, /\bgap-0\b/);
  assert.match(dashboardContentTag, /\bpx-0\b/);
  assert.match(dashboardContentTag, /\bpy-0\b/);
});

test("DashboardPage exposes bounded desktop sidebar resizing", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, commonProps));
  const resizeHandle = html.match(/<div[^>]*data-slot="dashboard-sidebar-resize-handle"[^>]*>/)?.[0] ?? "";
  const sidebarSource = readFileSync(resolve(currentDir, "sidebar.tsx"), "utf8");

  assert.match(resizeHandle, /role="separator"/);
  assert.match(resizeHandle, /aria-valuemin="220"/);
  assert.match(resizeHandle, /aria-valuemax="360"/);
  assert.match(resizeHandle, /aria-valuenow="288"/);
  assert.match(sidebarSource, /onPointerDown/);
  assert.match(sidebarSource, /ArrowLeft/);
  assert.match(sidebarSource, /ArrowRight/);
  assert.match(sidebarSource, /group-data-\[collapsible=offcanvas\]:hidden/);
  assert.match(pageSource, /"--sidebar-width": `\$\{sidebarWidth\}px`/);
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

test("notification reports include structured system error diagnostics", () => {
  const report = formatNotificationReport({
    ...commonProps.notifications[0]!,
    source: "rpc",
    sessionId: undefined,
    details: {
      phase: "notification-handler",
      method: "session/update",
      helmKey: "localhost:47631",
      updateKind: "timeline_batch",
      errorName: "Error",
      errorStack: "Error: Maximum update depth exceeded.",
    },
  });

  assert.match(report, /诊断信息:/);
  assert.match(report, /阶段: notification-handler/);
  assert.match(report, /RPC 方法: session\/update/);
  assert.match(report, /Helm: localhost:47631/);
  assert.match(report, /错误堆栈:\nError: Maximum update depth exceeded\./);
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
  assert.match(activityStreamSource, /minmax\(0,var\(--dashboard-activity-acp-width\)\)/);
  assert.doesNotMatch(activityStreamSource, /minmax\((?:88|96|112|140)px/);
  assert.doesNotMatch(activityStreamSource, /minmax\(128px,1fr\)/);
  assert.doesNotMatch(activityStreamSource, /justify-self-end/);
});

test("DashboardPage confines desktop scrolling to the right content region", () => {
  assert.match(pageSource, /SidebarProvider[\s\S]*className="dashboard-page h-full min-h-0 overflow-hidden"/);
  assert.match(pageSource, /SidebarInset className="dashboard-sidebar-inset min-h-0 overflow-hidden md:mr-0!"/);
  assert.match(pageSource, /overflow-y-auto overflow-x-hidden/);
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

test("DashboardPage renders persisted approval outcomes and exposes processed-history cleanup", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardPage, {
      ...commonProps,
      approvals: [],
      approvalHistory: [
        {
          id: "history-1",
          sessionId: "session-1",
          kind: "shell_command",
          target: "Run tests",
          status: "resolved",
          decision: "deny",
          createdAt: "2026-06-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:01:00.000Z",
          agentName: "Codex",
          projectName: "Tiller",
          worktreeName: "feature/0.1.6",
        },
      ],
      onClearApprovalHistory: () => undefined,
    } as any),
  );

  assert.match(html, /已拒绝/);
  assert.match(activityStreamSource, /title="清理已处理"/);
  assert.match(activityStreamSource, /activeTab === "权限"/);
});

test("DashboardPage keeps desktop activity tabs and replaces the mobile activity stream with permissions and notifications", () => {
  const desktopHtml = renderToStaticMarkup(createElement(DashboardPage, commonProps));
  const mobileHtml = renderToStaticMarkup(createElement(DashboardPage, { ...commonProps, isMobile: true }));

  assert.match(desktopHtml, /最近[\s\S]*权限[\s\S]*通知[\s\S]*7天前/);
  assert.match(mobileHtml, /待审批[\s\S]*通知/);
  assert.doesNotMatch(mobileHtml, /权限与通知/);
  assert.doesNotMatch(mobileHtml, /活动流/);
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

test("DashboardPage mobile keeps v6 priority order", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, { ...commonProps, isMobile: true }));

  assert.match(html, /data-slot="dashboard-metrics"/);
  assert.match(html, /grid-cols-2 gap-2 md:grid-cols-4/);
  assert.match(html, /待审批[\s\S]*通知/);
  assert.doesNotMatch(html, /2\/3 Helm 在线/);
  assert.match(html, /最近 24 小时/);
});

test("DashboardPage keeps empty mobile panels always visible with empty states", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, {
    ...commonProps,
    approvals: [],
    approvalHistory: [],
    notifications: [],
    pendingApprovalCount: 0,
    isMobile: true,
  }));

  assert.match(html, /暂无待处理请求/);
  assert.match(html, /暂无通知/);
  assert.doesNotMatch(html, /权限与通知/);
  assert.doesNotMatch(pageSource, /approvalRows\.length > 0\s*\|\|\s*pendingApprovalCount > 0/);
  assert.doesNotMatch(pageSource, /approvalHistory\.length > 0\s*\|\|\s*notifications\.length > 0/);
});

test("DashboardPage keeps the mobile trend panel within the viewport", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, { ...commonProps, isMobile: true }));

  assert.match(html, /dashboard-activity-trend[^>]*min-w-0[^>]*w-full/);
  assert.match(html, /dashboard-activity-trend[^>]*shrink-0/);
  assert.match(pageSource, /<SidebarProvider/);
  assert.match(pageSource, /<SidebarTrigger/);
});

test("DashboardPage uses the shadcn sidebar drawer on mobile", () => {
  assert.doesNotMatch(pageSource, /if \(isMobile\) \{/);
  assert.doesNotMatch(pageSource, /DashboardMobileNavigation/);
});

test("DashboardPage uses shared v6 pane primitives and no redesign mock imports", () => {
  assert.match(pageSource, /wb-pane/);
  assert.match(activityTrendSource, /AreaChart/);
  assert.doesNotMatch(activityStreamSource, /Sparkline/);
  assert.doesNotMatch(pageSource, /docs\/redesign\/v6/);
  assert.doesNotMatch(pageSource, /\.\.\/data\/mock/);
  assert.doesNotMatch(pageSource, /"系统"/);
});
