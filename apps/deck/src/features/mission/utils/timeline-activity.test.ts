import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { mergeHistoricalAndLiveToolCalls } from "./timeline-activity";

function toolCall(status: AgentToolCall["status"]): AgentToolCall {
  return {
    id: "call-subagent",
    kind: "subagent",
    title: "Subagent",
    status,
    timestamp: "2026-07-19T14:12:45.768Z",
    updatedAt: status === "completed"
      ? "2026-07-19T14:12:55.834Z"
      : "2026-07-19T14:12:45.768Z",
  };
}

test("terminal timeline tool calls win over stale live running overlays", () => {
  const [merged] = mergeHistoricalAndLiveToolCalls(
    [toolCall("completed")],
    [toolCall("running")],
  );

  assert.equal(merged?.status, "completed");
});
