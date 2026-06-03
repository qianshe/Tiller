import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentPlan } from "@tiller/shared";
import { MissionPlanDrawer, summarizeAgentPlan } from "./plan-drawer";

const plan: AgentPlan = {
  updatedAt: "2026-06-02T00:00:00.000Z",
  entries: [
    { content: "完成协议映射", priority: "medium", status: "completed" },
    { content: "渲染抽屉", priority: "high", status: "in_progress" },
    { content: "跑验证", priority: "medium", status: "pending" },
  ],
};

const completedPlan: AgentPlan = {
  updatedAt: "2026-06-02T00:01:00.000Z",
  entries: plan.entries.map((entry) => ({ ...entry, status: "completed" })),
};

test("summarizeAgentPlan counts completed entries", () => {
  assert.deepEqual(summarizeAgentPlan(plan), {
    completed: 1,
    total: 3,
    label: "已完成 1 个任务（共 3 个）",
  });
});

test("MissionPlanDrawer renders plan entries", () => {
  const html = renderToStaticMarkup(<MissionPlanDrawer plan={plan} />);

  assert.match(html, /<details[^>]*open/);
  assert.match(html, /已完成 1 个任务（共 3 个）/);
  assert.match(html, /完成协议映射/);
  assert.match(html, /渲染抽屉/);
  assert.match(html, /跑验证/);
});

test("MissionPlanDrawer defaults completed plans collapsed", () => {
  const html = renderToStaticMarkup(<MissionPlanDrawer plan={completedPlan} />);

  assert.doesNotMatch(html, /<details[^>]*open/);
  assert.match(html, /已完成 3 个任务（共 3 个）/);
});

test("MissionPlanDrawer marks floating placement", () => {
  const html = renderToStaticMarkup(<MissionPlanDrawer plan={plan} placement="floating" />);

  assert.match(html, /data-plan-drawer-placement="floating"/);
  assert.match(html, /已完成 1 个任务（共 3 个）/);
});

test("MissionPlanDrawer renders a close affordance when dismissal is available", () => {
  const html = renderToStaticMarkup(
    <MissionPlanDrawer
      plan={completedPlan}
      placement="floating"
      onDismiss={() => undefined}
    />,
  );

  assert.match(html, /aria-label="关闭 plan"/);
  assert.match(html, /data-plan-dismiss/);
});

test("MissionPlanDrawer renders nothing for empty plans", () => {
  const html = renderToStaticMarkup(<MissionPlanDrawer plan={{ entries: [], updatedAt: plan.updatedAt }} />);

  assert.equal(html, "");
});
