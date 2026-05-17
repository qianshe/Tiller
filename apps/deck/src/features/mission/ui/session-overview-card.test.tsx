import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionSummary } from "@tiller/shared";
import { SessionOverviewCard } from "./session-overview-card.js";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    cwd: "D:/repo",
    worktreeName: "Tiller Worktree",
    title: "检查布局",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:01:00.000Z",
    messageCount: 8,
    lastMessagePreview: "刚刚完成按钮尺寸调整并通过验证。",
    ...overrides,
  };
}

test("SessionOverviewCard replaces metrics with one-line recent activity", () => {
  const html = renderToStaticMarkup(
    createElement(SessionOverviewCard, {
      activeSession: session(),
    }),
  );

  assert.match(html, /最近活动/);
  assert.match(html, /刚刚完成按钮尺寸调整并通过验证。/);
  assert.match(html, /line-clamp-1/);
  assert.match(html, /mission-session-overview[^\"]*p-2/);
  assert.match(html, /mission-session-preview[^\"]*px-2[^\"]*py-1\.5/);
  assert.match(html, /line-clamp-1[^\"]*text-xs/);
  assert.doesNotMatch(html, /mission-session-metrics/);
  assert.doesNotMatch(html, /状态/);
  assert.doesNotMatch(html, /消息/);
  assert.doesNotMatch(html, /变更/);
  assert.doesNotMatch(html, /航行日志/);
});

test("SessionOverviewCard shows a concise empty recent activity line", () => {
  const html = renderToStaticMarkup(
    createElement(SessionOverviewCard, {
      activeSession: null,
    }),
  );

  assert.match(html, /最近活动/);
  assert.match(html, /暂无最近活动/);
  assert.doesNotMatch(html, /待创建/);
  assert.doesNotMatch(html, /未创建/);
});
