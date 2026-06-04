import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentPlan, SessionSummary } from "@tiller/shared";
import {
  DraftSessionCard,
  SessionCard,
  SessionPreviewMessages,
  SessionRestoreNotice,
  formatProjectWorktreeLabel,
  shouldShowSessionScrollToBottom,
  type MissionDraftChatWindow,
} from "./session-cards.js";

const sessionCardsSource = readFileSync(
  new URL("./session-cards.tsx", import.meta.url),
  "utf8",
);

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    title: "Build feature",
    agentId: "codex",
    agentName: "Codex",
    projectId: "project-1",
    projectName: "Tiller",
    cwd: "D:/myProject/tools/Tiller",
    status: "running",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:01:00.000Z",
    ...overrides,
  } as SessionSummary;
}

const completedPlan: AgentPlan = {
  entries: [
    { content: "复核 Markdown 渲染", priority: "medium", status: "completed" },
    { content: "检查权限审核抽屉", priority: "medium", status: "completed" },
  ],
  updatedAt: "2026-05-29T00:02:00.000Z",
};

test("SessionPreviewMessages renders session preview and restoring state", () => {
  const html = renderToStaticMarkup(
    <SessionPreviewMessages session={session()} restoring />,
  );

  assert.match(html, /Build feature/);
  assert.match(html, /Codex/);
  assert.match(html, /restoring/);
});

test("SessionRestoreNotice shows only the status word and keeps detail in tooltip", () => {
  const html = renderToStaticMarkup(
    <SessionRestoreNotice notice={{ title: "恢复中", message: "正在重连 ACP" }} />,
  );

  assert.match(html, /恢复中/);
  // 描述性细节仅保留在悬浮 tooltip（title 属性）中，不再出现在可见文案里
  assert.match(html, /title="恢复中：正在重连 ACP"/);
  assert.doesNotMatch(html, /恢复中 · 正在重连 ACP/);
});

test("DraftSessionCard renders selectable agent options", () => {
  const draftWindow: MissionDraftChatWindow = {
    id: "draft-1",
    title: "新任务",
    projectName: "Tiller",
    worktreeName: "feature/0.1.6",
    agentName: null,
    status: "select-agent",
    message: "请选择一个 ACP Agent。",
  };

  const html = renderToStaticMarkup(
    <DraftSessionCard
      draftWindow={draftWindow}
      active={false}
      agentOptions={[{ id: "codex", name: "Codex" }]}
    />,
  );

  assert.match(html, /选择 ACP Agent/);
  assert.match(html, /Codex/);
});

test("session cards use real borders so scroll content cannot cover the frame", () => {
  const card = renderToStaticMarkup(
    <SessionCard
      session={session()}
      active={false}
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );
  const draft = renderToStaticMarkup(
    <DraftSessionCard
      draftWindow={{
        id: "draft-1",
        title: "新任务",
        projectName: "Tiller",
        worktreeName: "feature/0.1.6",
        agentName: null,
        status: "select-agent",
        message: "请选择一个 ACP Agent。",
      }}
      active={false}
      agentOptions={[]}
    />,
  );

  assert.match(card, /border-border-ghost/);
  assert.match(draft, /border-border-ghost/);
  assert.doesNotMatch(card, /inset 0 0 0 1px var\(--border-ghost\)/);
  assert.doesNotMatch(draft, /inset 0 0 0 1px var\(--border-ghost\)/);
});

test("session scroll-to-bottom affordance appears only when content is away from bottom", () => {
  assert.equal(
    shouldShowSessionScrollToBottom({
      scrollHeight: 1000,
      scrollTop: 700,
      clientHeight: 220,
    }),
    false,
  );
  assert.equal(
    shouldShowSessionScrollToBottom({
      scrollHeight: 1000,
      scrollTop: 680,
      clientHeight: 220,
    }),
    true,
  );
});

test("session scroll-to-bottom affordance stays available in flat and card modes", () => {
  assert.match(sessionCardsSource, /data-session-scroll-frame/);
  assert.match(sessionCardsSource, /className="relative min-h-0 flex-1"/);
  assert.match(sessionCardsSource, /flat \? "px-4 pb-9 pt-3" : "px-3 pb-9 pt-2\.5"/);
  assert.doesNotMatch(sessionCardsSource, /!\s*flat\s*\?\s*\(\s*<ScrollToBottomButton/);
});

test("session scroll-to-bottom affordance moves above the floating plan", () => {
  assert.match(sessionCardsSource, /const hasFloatingPlan = Boolean\(visiblePlan\?\.entries\.length\);/);
  assert.match(sessionCardsSource, /visible=\{showScrollToBottom\}/);
  assert.match(sessionCardsSource, /position=\{hasFloatingPlan \? "above-plan" : "bottom"\}/);
  assert.doesNotMatch(sessionCardsSource, /visible=\{showScrollToBottom && !hasFloatingPlan\}/);
});

test("SessionCard menu omits redundant focus action and closes on outside pointer", () => {
  assert.doesNotMatch(sessionCardsSource, /聚焦会话/);
  assert.match(sessionCardsSource, /menuContainerRef/);
  assert.match(sessionCardsSource, /document\.addEventListener\("pointerdown", handleOutsidePointerDown\)/);
  assert.match(sessionCardsSource, /document\.removeEventListener\("pointerdown", handleOutsidePointerDown\)/);
});

test("SessionCard keeps a completed plan visible as a collapsed dock", () => {
  const html = renderToStaticMarkup(
    <SessionCard
      session={session()}
      active
      plan={completedPlan}
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  assert.match(html, /data-plan-dock="session"/);
  assert.match(html, /data-plan-drawer-placement="floating"/);
  assert.match(html, /已完成 2 个任务（共 2 个）/);
  assert.doesNotMatch(html, /<details[^>]*open/);
});

test("SessionCard wires plan dismissal through the session dock", () => {
  const html = renderToStaticMarkup(
    <SessionCard
      session={session()}
      active
      plan={completedPlan}
      onDismissCompletedPlan={() => undefined}
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  assert.match(html, /data-plan-dismiss/);
  assert.match(sessionCardsSource, /dismissedTransientPlan/);
  assert.match(sessionCardsSource, /onDismissCompletedPlan\?\.\(session\.id,\s*createAgentPlanDismissalKey\(plan\),?\s*\)/);
});

test("formatProjectWorktreeLabel drops worktree suffix that echoes the project name", () => {
  assert.equal(formatProjectWorktreeLabel("Tiller", "Tiller"), "Tiller");
  assert.equal(formatProjectWorktreeLabel("Tiller", "tiller"), "Tiller");
  assert.equal(formatProjectWorktreeLabel("Tiller", "  Tiller  "), "Tiller");
  assert.equal(formatProjectWorktreeLabel("Tiller", ""), "Tiller");
  assert.equal(formatProjectWorktreeLabel("Tiller", undefined), "Tiller");
  assert.equal(formatProjectWorktreeLabel("Tiller", "feature-x"), "Tiller / feature-x");
});

test("SessionCard does not duplicate project name when worktree echoes it (any case)", () => {
  const html = renderToStaticMarkup(
    <SessionCard
      session={session({ worktreeName: "tiller" })}
      active
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  assert.doesNotMatch(html, /[Tt]iller\s*\/\s*[Tt]iller/);
});

test("SessionCard shows distinct worktree name alongside project", () => {
  const html = renderToStaticMarkup(
    <SessionCard
      session={session({ worktreeName: "feature-x" })}
      active
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  assert.match(html, /Tiller\s*\/\s*feature-x/);
});

test("SessionCard renders the plain status inside a framed, tone-colored pill", () => {
  const running = renderToStaticMarkup(
    <SessionCard
      session={session({ status: "running" })}
      active
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  // 普通状态与“工具执行中”一样进框：圆角 + 边框 + 背景，按 tone 着色，但不带呼吸点
  assert.match(running, /mission-session-status-pill/);
  assert.match(running, /rounded-full border/);
  assert.match(running, /text-primary/);
  assert.match(running, /运行中/);
  assert.doesNotMatch(running, /wb-pulse[^"]*">[\s\S]*运行中/);

  const idle = renderToStaticMarkup(
    <SessionCard
      session={session({ status: "idle" })}
      active
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  assert.match(idle, /mission-session-status-pill/);
  assert.match(idle, /text-muted-foreground/);
  assert.match(idle, /空闲/);
});

test("SessionCard keeps title order while shrinking project metadata before status", () => {
  const html = renderToStaticMarkup(
    <SessionCard
      session={session({
        projectName: "VeryLongProjectName",
        worktreeName: "feature/very-long-branch-name",
      })}
      active
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  const statusIndex = html.indexOf('data-session-status-slot="true"');
  const projectIndex = html.indexOf('data-session-project-label="true"');
  assert.ok(statusIndex >= 0);
  assert.ok(projectIndex >= 0);
  assert.ok(projectIndex < statusIndex);
  const statusClass = html.match(/<div class="([^"]*)" data-session-status-slot="true"/)?.[1] ?? "";
  assert.match(statusClass, /shrink-0/);
  const projectClass = html.match(/<span class="([^"]*)" data-session-project-label="true"/)?.[1] ?? "";
  assert.match(projectClass, /min-w-0/);
  assert.match(projectClass, /shrink-\[999\]/);
  assert.match(projectClass, /truncate/);
});

test("SessionCard renders running tool status in the title bar", () => {
  const html = renderToStaticMarkup(
    <SessionCard
      session={session()}
      active
      toolLoading={{
        activity: { title: "Tool: find -type d" },
        pendingToolPresent: true,
      }}
      onBodyScroll={() => undefined}
      onFocus={() => undefined}
      onRename={() => undefined}
      onClear={() => undefined}
      onReimportHistory={() => undefined}
      onClose={() => undefined}
    >
      <div>会话正文</div>
    </SessionCard>,
  );

  assert.match(html, /mission-tool-loading-title/);
  assert.match(html, /工具执行中/);
  assert.doesNotMatch(html, />等待 find -type d 返回结果…/);
  assert.match(html, /title="等待 find -type d 返回结果…"/);
});
