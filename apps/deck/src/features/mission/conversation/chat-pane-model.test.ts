import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSessionPreviewTime,
  resolveSessionStatusTone,
  splitMissionToolCalls,
} from "./chat-pane-model";

test("splitMissionToolCalls separates thinking calls from timeline calls", () => {
  const split = splitMissionToolCalls([
    { id: "think", commandId: "think", kind: "think", title: "Thinking", status: "running", timestamp: "2026-05-29T00:00:00.000Z" },
    { id: "cmd", commandId: "cmd", kind: "shell", title: "Shell", status: "completed", timestamp: "2026-05-29T00:00:01.000Z" },
  ] as any);

  assert.deepEqual(split.thinkingToolCalls.map((item) => item.id), ["think"]);
  assert.deepEqual(split.timelineToolCalls.map((item) => item.id), ["cmd"]);
  assert.deepEqual(split.boundaryTimestamps, ["2026-05-29T00:00:00.000Z", "2026-05-29T00:00:01.000Z"]);
});

test("resolveSessionStatusTone maps session statuses", () => {
  assert.equal(resolveSessionStatusTone("running" as any), "primary");
  assert.equal(resolveSessionStatusTone("waiting_for_permission" as any), "warning");
  assert.equal(resolveSessionStatusTone("error" as any), "danger");
  assert.equal(resolveSessionStatusTone("idle" as any), "idle");
});

test("formatSessionPreviewTime returns placeholder for missing or invalid values", () => {
  assert.equal(formatSessionPreviewTime(undefined), "--:--");
  assert.equal(formatSessionPreviewTime("not-a-date"), "--:--");
});
