import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardTaskWorkspace } from "./workspace";
import { resolveTaskBoardColumn } from "./board-model";

const workspaceSource = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");

const sessions = [
  {
    id: "running-session",
    title: "实现任务工作区",
    projectId: "project-1",
    projectName: "Tiller",
    worktreeName: "feature/task-workspace",
    cwd: "D:/tiller",
    agentId: "codex",
    agentName: "Codex",
    runtimeSessionId: "runtime-running",
    status: "running",
    createdAt: "2026-08-08T08:00:00.000Z",
    updatedAt: "2026-08-08T10:00:00.000Z",
    planSummary: { completed: 1, total: 3, label: "1/3 进行中" },
  },
  {
    id: "unassigned-session",
    title: "梳理后续拆分任务",
    projectId: "project-1",
    projectName: "Tiller",
    worktreeName: "main",
    cwd: "D:/tiller",
    agentId: null,
    runtimeSessionId: null,
    status: "idle",
    createdAt: "2026-08-08T09:00:00.000Z",
    updatedAt: "2026-08-08T09:30:00.000Z",
  },
  {
    id: "attention-session",
    title: "等待权限确认",
    projectId: "project-1",
    projectName: "Tiller",
    worktreeName: "feature/task-workspace",
    cwd: "D:/tiller",
    agentId: "claude-code",
    agentName: "ClaudeCode",
    runtimeSessionId: "runtime-attention",
    status: "waiting_for_permission",
    createdAt: "2026-08-08T09:30:00.000Z",
    updatedAt: "2026-08-08T09:45:00.000Z",
  },
];

const preparations = [{
  id: "preparation-1",
  preparationId: "preparation-1",
  title: "梳理准备记录",
  content: "梳理准备记录",
  projectId: "project-1",
  projectName: "Tiller",
  worktreeName: "main",
  cwd: "D:/tiller",
  agentId: null,
  runtimeSessionId: null,
  createdAt: "2026-08-08T09:00:00.000Z",
  updatedAt: "2026-08-08T09:30:00.000Z",
  revision: 1,
}];

test("DashboardTaskWorkspace renders only the selected task view", () => {
  const panelHtml = renderToStaticMarkup(
    createElement(DashboardTaskWorkspace, { sessions, preparations }),
  );
  const tableHtml = renderToStaticMarkup(
    createElement(DashboardTaskWorkspace, { sessions, defaultView: "table" }),
  );
  assert.match(panelHtml, /任务/);
  assert.match(panelHtml, /看板/);
  assert.match(workspaceSource, /表格/);
  assert.doesNotMatch(panelHtml, /甘特图/);
  assert.match(panelHtml, /准备/);
  assert.match(panelHtml, /进行中/);
  assert.match(panelHtml, /待处理/);
  assert.match(panelHtml, /空闲/);
  assert.match(panelHtml, /data-task-column="ready"/);
  assert.match(panelHtml, /data-task-column="running"/);
  assert.match(panelHtml, /data-task-column="attention"/);
  assert.match(panelHtml, /data-task-column="idle"/);
  assert.equal((panelHtml.match(/data-task-column=/g) ?? []).length, 4);
  assert.doesNotMatch(panelHtml, /归档|archived/i);
  assert.doesNotMatch(panelHtml, /已结束|需要关注/);
  assert.match(panelHtml, /梳理后续拆分任务/);
  assert.match(panelHtml, /未分配/);
  assert.match(panelHtml, /data-task-agent-badge="codex"/);
  assert.match(panelHtml, /data-task-agent-icon="Codex"/);
  assert.match(panelHtml, /aria-label="ACP：Codex"/);
  assert.doesNotMatch(panelHtml, /data-task-session-row="running-session"[\s\S]*?进行中/);
  assert.doesNotMatch(workspaceSource, /ChevronRight/);
  assert.match(panelHtml, /data-task-view="panel"/);
  assert.match(panelHtml, /data-task-toolbar/);
  assert.match(workspaceSource, /data-task-filter=\{option\.id\}/);
  assert.doesNotMatch(panelHtml, /data-task-summary|个 Agent 运行中|个任务/);
  assert.doesNotMatch(panelHtml, /data-task-view="table"|data-task-view="gantt"/);

  const emptyColumnHtml = renderToStaticMarkup(
    createElement(DashboardTaskWorkspace, {
      sessions: sessions.filter((session) => session.id !== "attention-session"),
    }),
  );
  assert.match(emptyColumnHtml, /data-task-empty/);

  assert.match(tableHtml, /data-task-view="table"/);
  assert.doesNotMatch(tableHtml, /data-task-view="panel"|data-task-view="gantt"|甘特图/);
  assert.doesNotMatch(workspaceSource, /甘特图|ChartGantt|TaskGanttView/);
});

test("task workspace exposes compact status filters and keeps the active view in one control", () => {
  const html = renderToStaticMarkup(createElement(DashboardTaskWorkspace, { sessions }));

  assert.match(html, /data-task-filter-trigger/);
  assert.match(workspaceSource, /DropdownMenuContent align="end" className="w-44" data-task-filter-menu/);
  assert.match(workspaceSource, /DropdownMenuSubTrigger data-task-filter-category="status"/);
  assert.match(workspaceSource, /DropdownMenuSubTrigger data-task-filter-category="project"/);
  assert.match(workspaceSource, /DropdownMenuSubTrigger data-task-filter-category="agent"/);
  assert.match(workspaceSource, /DropdownMenuSubContent className="w-36"/);
  assert.match(workspaceSource, /projectOptions.map/);
  assert.match(workspaceSource, /agentOptions.map/);
  assert.match(workspaceSource, /resolveTaskProjectFilterValue/);
  assert.match(workspaceSource, /resolveTaskAgentFilterValue/);
  assert.match(workspaceSource, /filter.status === "all"/);
  assert.match(workspaceSource, /filter.project === "all"/);
  assert.match(workspaceSource, /filter.agent === "all"/);
  assert.match(workspaceSource, /data-task-filter=\{option\.id\}/);
  assert.match(workspaceSource, /TASK_FILTER_OPTIONS/);
  assert.match(workspaceSource, /TASK_BOARD_COLUMNS\.map/);
  assert.match(workspaceSource, /value=\{option\.id\}/);
  assert.match(workspaceSource, /<div className="flex min-w-0 flex-wrap items-center justify-end gap-2" data-task-toolbar>/);
  assert.match(html, /data-task-view-trigger/);
  assert.match(html, /aria-label="切换任务视图"/);
  assert.doesNotMatch(html, /个 Agent 运行中|个任务/);
});

test("task table keeps project and worktree context without an agent", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardTaskWorkspace, { sessions, preparations, defaultView: "table" }),
  );

  assert.match(html, new RegExp("项目 / 分支"));
  assert.ok(html.indexOf(">状态<") < html.indexOf(">项目 / 分支<"));
  assert.match(html, /Tiller \/ feature\/task-workspace/);
  assert.match(html, /Tiller \/ main/);
  assert.match(html, /Agent/);
  assert.match(html, /未分配/);
  assert.match(html, /data-task-status-icon="running"/);
  assert.match(html, /data-task-status-icon="idle"/);
  assert.match(html, /data-task-status-icon="ready"/);
  assert.match(html, /data-task-status-icon="attention"/);
  assert.match(html, /data-task-agent-icon="Codex"/);
  assert.match(html, /计划/);
  assert.match(html, /更新时间/);
  assert.match(html, /准备/);
  assert.doesNotMatch(html, /GripVertical|Grip/);
});

test("task table keeps the action column aligned with table surfaces", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardTaskWorkspace, { sessions, defaultView: "table" }),
  );

  assert.match(html, /sticky right-0 z-10 w-12 bg-surface-sunken\/40/);
  assert.match(html, /sticky right-0 z-10 w-12 bg-surface\/95/);
  assert.doesNotMatch(html, /sticky right-0 z-10 w-12 bg-surface-elevated/);
  assert.match(html, /border-border-ghost\/60/);
});

test("task workspace keeps the board mapping close to the view contract", () => {
  assert.equal(resolveTaskBoardColumn(sessions[0]!), "running");
  assert.equal(resolveTaskBoardColumn(sessions[1]!), "idle");
  assert.equal(resolveTaskBoardColumn(preparations[0]!), "ready");
  assert.match(workspaceSource, /overflow-x-auto/);
  assert.doesNotMatch(workspaceSource, /viewedSessionIds|待查看/);
  assert.doesNotMatch(workspaceSource, /当前任务/);
  assert.doesNotMatch(workspaceSource, /归档|archived|localStorage/i);
  assert.match(workspaceSource, /onDragOver/);
  assert.match(workspaceSource, /onDrop/);
  assert.match(workspaceSource, /application\/x-tiller-ready-session/);
  assert.match(workspaceSource, /dataTransfer\.types\.includes\("application\/x-tiller-ready-session"\)/);
});

test("ready tasks can be promoted from the board and table action menu", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardTaskWorkspace, {
      sessions,
      preparations,
      onConfigureReadySession: () => undefined,
      defaultView: "panel",
    }),
  );

  assert.match(html, /draggable="true"/);
  assert.match(html, /data-task-draggable="ready"/);
  assert.match(html, /data-task-drop-target="running"/);

  const tableHtml = renderToStaticMarkup(
    createElement(DashboardTaskWorkspace, {
      sessions,
      preparations,
      onConfigureReadySession: () => undefined,
      defaultView: "table",
    }),
  );
  assert.match(workspaceSource, /配置并开始/);
  assert.match(tableHtml, /任务操作/);
});

test("task workspace keeps wide views internally scrollable", () => {
  assert.match(workspaceSource, /overflow-x-auto/);
  assert.match(workspaceSource, /flex min-h-0 min-w-0 max-w-full flex-1 overflow-x-auto overflow-y-hidden/);
  assert.match(workspaceSource, /grid h-full min-h-0 min-w-max grid-flow-col auto-cols-\[minmax\(13rem,72vw\)\] gap-2\.5 lg:min-w-0 lg:flex-1 lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-4/);
  assert.match(workspaceSource, /min-h-0 flex-1 divide-y divide-border-ghost overflow-y-auto/);
  assert.match(workspaceSource, /data-task-table-scroll/);
  assert.match(workspaceSource, /items-start justify-center px-3 pt-5/);
  assert.match(workspaceSource, /flex min-h-0 min-w-0 flex-1 flex-col gap-4/);
  assert.doesNotMatch(workspaceSource, /h-screen/);
});
