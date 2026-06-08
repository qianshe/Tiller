import assert from "node:assert/strict";
import test from "node:test";
import { extractAgentPlan } from "./plan-events";

test("extractAgentPlan maps ACP plan entries", () => {
  const plan = extractAgentPlan(
    "plan",
    {
      sessionUpdate: "plan",
      entries: [
        { content: "Wire runtime event", priority: "high", status: "in_progress" },
        { content: "Render drawer", priority: "medium", status: "pending" },
      ],
    },
    "2026-06-02T00:00:00.000Z",
  );

  assert.deepEqual(plan, {
    entries: [
      { content: "Wire runtime event", priority: "high", status: "in_progress" },
      { content: "Render drawer", priority: "medium", status: "pending" },
    ],
    updatedAt: "2026-06-02T00:00:00.000Z",
  });
});

test("extractAgentPlan ignores empty plan updates", () => {
  const plan = extractAgentPlan(
    "plan",
    {
      sessionUpdate: "plan",
      entries: [],
    },
    "2026-06-02T00:00:00.000Z",
  );

  assert.equal(plan, null);
});

test("extractAgentPlan ignores non-plan updates", () => {
  assert.equal(extractAgentPlan("tool_call", { entries: [] }, "2026-06-02T00:00:00.000Z"), null);
});
