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
  localMessageCount: 127,
  toolCallCount: 23,
  onNavigateAgents: () => undefined,
};

test("DashboardPage renders the v6 KPI, activity, Helm matrix, and approvals layout", () => {
  const html = renderToStaticMarkup(createElement(DashboardPage, commonProps));

  assert.match(html, /在线 Helm/);
  assert.match(html, /2 \/ 3/);
  assert.match(html, /活动流/);
  assert.match(html, /Helm 矩阵/);
  assert.match(html, /待审批/);
  assert.match(html, /Allow/);
});

test("DashboardPage uses shared v6 pane primitives and no redesign mock imports", () => {
  assert.match(pageSource, /wb-pane/);
  assert.match(pageSource, /Sparkline/);
  assert.doesNotMatch(pageSource, /docs\/redesign\/v6/);
  assert.doesNotMatch(pageSource, /\.\.\/data\/mock/);
});
