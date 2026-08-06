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

test("identified subagent titles win over stale live task overlays", () => {
  const historical = {
    ...toolCall("running"),
    title: "Sisyphus-Junior",
    commandId: "subagent:task-1",
  };
  const live = {
    ...toolCall("running"),
    title: "task",
  };

  const [merged] = mergeHistoricalAndLiveToolCalls([historical], [live]);

  assert.equal(merged?.title, "Sisyphus-Junior");
  assert.equal(merged?.commandId, "subagent:task-1");
});
