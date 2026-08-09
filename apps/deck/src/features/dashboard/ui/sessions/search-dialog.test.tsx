import assert from "node:assert/strict";
import test from "node:test";
import { filterDashboardSessions, type DashboardSessionSearchItem } from "./search-dialog";

const sessions: DashboardSessionSearchItem[] = [
  { id: "s-1", title: "修复 ACP 流式渲染", projectName: "Tiller", agentName: "OpenCode" },
  { id: "s-2", title: "Dashboard 导航优化", projectName: "Tiller", agentName: "Codex" },
  { id: "s-3", title: "Release checklist", projectName: "Deck", agentName: "ClaudeCode" },
];

test("session search filters by title without changing session order", () => {
  assert.deepEqual(
    filterDashboardSessions(sessions, "DASHBOARD").map((session) => session.id),
    ["s-2"],
  );
  assert.deepEqual(
    filterDashboardSessions(sessions, "").map((session) => session.id),
    ["s-1", "s-2", "s-3"],
  );
});

test("session search only matches session titles", () => {
  assert.deepEqual(filterDashboardSessions(sessions, "OpenCode"), []);
  assert.deepEqual(filterDashboardSessions(sessions, "release").map((session) => session.id), ["s-3"]);
});
