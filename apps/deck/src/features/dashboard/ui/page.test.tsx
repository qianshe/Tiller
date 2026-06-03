import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardPage } from "./page";

const currentDir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(currentDir, "page.tsx"), "utf8");

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
      agentName: "Codex",
      status: "running",
      updatedAt: "2026-06-02T00:00:00.000Z",
      planSummary: { completed: 1, total: 2, label: "1/2 进行中" },
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
  assert.match(html, /计划/);
  assert.match(html, /1\/2 进行中/);
  assert.match(html, /overview-activity-row/);
  assert.match(html, /overview-activity-agent/);
  assert.doesNotMatch(html, /会话活动 ·/);
  assert.match(html, /Allow/);
  assert.doesNotMatch(html, /本日消息/);
});

test("DashboardPage distinguishes compact activity row states", () => {
  const html = renderToStaticMarkup(
    createElement(DashboardPage, {
      ...commonProps,
      sessions: [
        { id: "selected", title: "Selected session", agentName: "Codex", status: "idle", selected: true },
        { id: "selected-2", title: "Second selected session", agentName: "Codex", status: "cancelled", selected: true },
        { id: "running", title: "Running session", agentName: "OpenCode", status: "running" },
        { id: "failed", title: "Failed session", agentName: "ClaudeCode", status: "error" },
        { id: "idle", title: "Idle session", agentName: "Codex", status: "completed" },
      ],
    }),
  );

  assert.match(html, /会话: Selected session. 已选中. Codex/);
  assert.match(html, /会话: Second selected session. 已选中. Codex/);
  assert.match(html, /会话: Running session. 运行中. OpenCode/);
  assert.match(html, /会话: Failed session. 出错. ClaudeCode/);
  assert.match(html, /会话: Idle session. 未选中. Codex/);
  assert.match(html, /bg-primary/);
  assert.match(html, /bg-success/);
  assert.match(html, /bg-destructive/);
  assert.match(html, /bg-muted-foreground/);
});

test("DashboardPage renders approval session name and tool name", () => {
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
          allowDecision: "allow",
        },
      ],
    } as any),
  );

  assert.match(html, /你好/);
  assert.match(html, /MCP · sanshu\/zhi/);
});

test("DashboardPage wires Allow buttons to approval responses", () => {
  assert.match(pageSource, /onRespondApproval\?\.\(approval\.id, approval\.allowDecision\)/);
  assert.match(pageSource, /disabled=\{approval\.resolving \|\| !onRespondApproval\}/);
});

test("DashboardPage links session activities back to mission sessions", () => {
  assert.match(pageSource, /onOpenSession\?\.\(activity\.sessionId\)/);
  assert.match(pageSource, /disabled=\{!activity\.sessionId \|\| !onOpenSession\}/);
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
  assert.match(pageSource, /Sparkline/);
  assert.doesNotMatch(pageSource, /docs\/redesign\/v6/);
  assert.doesNotMatch(pageSource, /\.\.\/data\/mock/);
  assert.doesNotMatch(pageSource, /"系统"/);
});
