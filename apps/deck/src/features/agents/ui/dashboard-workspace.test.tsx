import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardAgentsWorkspace } from "./dashboard-workspace";

const helms = [
  {
    key: "local",
    name: "Local Helm",
    endpoint: "localhost:47631",
    connection: "connected" as const,
    counts: { agents: 2, projects: 3, worktrees: 4, sessions: 1 },
  },
  {
    key: "remote",
    name: "Remote Helm",
    endpoint: "192.168.1.2:47631",
    connection: "disconnected" as const,
    counts: { agents: 0, projects: 1, worktrees: 0, sessions: 0 },
  },
];

test("DashboardAgentsWorkspace renders a scan-friendly Helm list", () => {
  const html = renderToStaticMarkup(createElement(DashboardAgentsWorkspace, {
    screen: "list",
    helms,
    detail: null,
    onSelectHelm: () => undefined,
    onAddHelm: () => undefined,
  }));

  assert.match(html, /Helm 列表/);
  assert.match(html, /Local Helm/);
  assert.match(html, /localhost:47631/);
  assert.match(html, /bg-success/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /2 Agents/);
  assert.match(html, /3 项目/);
  assert.match(html, /4 工作区/);
  assert.match(html, /添加 Helm/);
});

test("DashboardAgentsWorkspace lets Helm details fill the workspace", () => {
  const html = renderToStaticMarkup(createElement(DashboardAgentsWorkspace, {
    screen: "detail",
    helms,
    detail: createElement("div", null, "Helm detail"),
    onSelectHelm: () => undefined,
  }));

  assert.match(html, /dashboard-agents-detail/);
  assert.match(html, /Helm detail/);
  assert.doesNotMatch(html, /Helm 列表/);
});
