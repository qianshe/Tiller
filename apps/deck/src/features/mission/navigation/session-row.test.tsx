import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectSummary, SessionStatus, SessionSummary } from "@tiller/shared";
import { SessionRow } from "./session-row.js";

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: "project-1",
    helmId: "helm-1",
    name: "repo",
    path: "D:/repo",
    worktrees: [
      { name: "main", path: "D:/repo" },
      { name: "feature", path: "D:/repo/.worktrees/feature" },
    ],
    ...overrides,
  } as ProjectSummary;
}

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    title: "检查 worktree",
    agentId: "codex",
    agentName: "Codex",
    projectId: "project-1",
    projectName: "Tiller",
    cwd: "D:/repo/.worktrees/feature",
    worktreeName: "feature",
    status: "idle",
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:01:00.000Z",
    ...overrides,
  } as SessionSummary;
}

function renderSessionRow(
  overrides: Partial<SessionSummary> = {},
  projectOverrides: Partial<ProjectSummary> = {},
  sessionStatus: SessionStatus = "idle",
  completedUnread = false,
) {
  return renderToStaticMarkup(
    <SessionRow
      activeSessionId="session-1"
      highlightedSessionId={null}
      openSessionIds={new Set()}
      copy={{ status: { starting: "启动中", running: "运行中", waiting_for_permission: "待审批", idle: "空闲", cancelled: "取消", error: "错误" } }}
      formatRelativeTime={() => "4m"}
      openSession={() => undefined}
      renderAgentIcon={() => <span>AI</span>}
      resolveDisplayTitle={(item) => item.title ?? item.id}
      regenerateSessionTitle={() => undefined}
      isRegenerating={false}
      project={project(projectOverrides)}
      session={session(overrides)}
      sessionStatus={sessionStatus}
      completedUnread={completedUnread}
      setPendingSessionCleanup={() => undefined}
    />,
  );
}

test("SessionRow keeps the action trigger inside the active row frame", () => {
  const html = renderSessionRow();
  const rowClass = html.match(/<div class="([^"]*mission-tree-session-row[^"]*)"/u)?.[1] ?? "";

  assert.match(rowClass, /active/u);
  assert.match(rowClass, /bg-primary-soft/u);
  assert.match(rowClass, /before:w-1/u);
  assert.match(rowClass, /before:bg-primary-strong/u);
  assert.match(html, /mission-tree-actions-trigger/u);
  // 行内不再显示时间（时间移入悬浮信息卡片）
  assert.doesNotMatch(html, /最后更新/u);
  assert.doesNotMatch(html, /mission-tree-time/u);
});

test("SessionRow marks managed worktree sessions with a branch tooltip", () => {
  const html = renderSessionRow();

  // worktree 标识复用用量展示的 Tooltip 风格,取代原生 title 属性;正文经 Portal 运行时挂载
  assert.match(html, /mission-tree-worktree-icon/u);
  assert.match(html, /data-state="closed"/u);
  assert.doesNotMatch(html, /title="Worktree/u);
});

test("SessionRow marks named worktrees when cwd matches a secondary worktree path", () => {
  const html = renderSessionRow({
    cwd: "D:/repo/.worktrees/test-worktree",
    projectName: "repo",
    worktreeName: "test-worktree",
  }, {
    worktrees: [
      { name: "main", path: "D:/repo" },
      { name: "test-worktree", path: "D:/repo/.worktrees/test-worktree" },
    ],
  });

  assert.match(html, /mission-tree-worktree-icon/u);
  assert.match(html, /data-state="closed"/u);
  assert.doesNotMatch(html, /title="Worktree/u);
});

test("SessionRow does not mark the project root worktree as a branch session", () => {
  const html = renderSessionRow({
    cwd: "D:/repo",
    projectName: "repo",
    worktreeName: "main",
  });

  assert.doesNotMatch(html, /mission-tree-worktree-icon/u);
  assert.doesNotMatch(html, /title="Worktree：main"/u);
});

test("SessionRow uses one aligned icon slot for worktree and status indicators", () => {
  const worktreeHtml = renderSessionRow();
  const statusHtml = renderSessionRow({}, {}, "running");
  const errorHtml = renderSessionRow({}, {}, "error");

  assert.match(worktreeHtml, /mission-tree-session-icon mission-tree-worktree-icon[^"]*leading-none/u);
  assert.match(statusHtml, /mission-tree-session-icon mission-tree-session-status[^"]*leading-none/u);
  assert.match(errorHtml, /mission-tree-session-status-error[^>]*>\s*<svg[^>]*text-destructive/u);
  assert.match(errorHtml, /d="m21\.73 18-8-14/u);
  assert.doesNotMatch(errorHtml, /<circle cx="12" cy="12" r="9"><\/circle>/u);
  assert.doesNotMatch(errorHtml, /mission-tree-session-status-error[^>]*>\s*!\s*</u);
  assert.doesNotMatch(worktreeHtml, /mission-tree-session-side[^"]*gap-1\.5/u);
  assert.doesNotMatch(statusHtml, /mission-tree-session-side[^"]*gap-1\.5/u);
});

test("SessionRow shows a completion marker for an unread completed session", () => {
  const html = renderSessionRow({}, {}, "idle", true);

  assert.match(html, /mission-tree-session-status-completed/u);
  assert.match(html, /<circle cx="12" cy="12" r="9"><\/circle>/u);
  assert.match(html, /已完成，尚未查看/u);
  assert.doesNotMatch(html, /mission-tree-worktree-icon/u);
});
