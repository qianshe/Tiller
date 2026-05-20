import assert from "node:assert/strict";
import test from "node:test";
import { buildOverviewMetrics } from "./overview-metrics";

test("buildOverviewMetrics maps real overview counts without mock dashboard constants", () => {
  const metrics = buildOverviewMetrics({
    activeHelmLabel: "Local Helm · 127.0.0.1:47631",
    connectionLabel: "已连接",
    projectCount: 3,
    worktreeCount: 4,
    agentCount: 2,
    sessionCount: 5,
  });

  assert.deepEqual(metrics.map((item) => item.label), ["Helm", "连接", "项目", "工作区", "ACP 舰员", "任务"]);
  assert.equal(metrics[0]?.value, "Local Helm · 127.0.0.1:47631");
  assert.equal(metrics[5]?.value, "5");
});
