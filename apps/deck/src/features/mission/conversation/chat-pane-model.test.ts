import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTimelineEntry } from "@tiller/shared";
import {
  formatSessionPreviewTime,
  resolveSessionStatusLabel,
  resolveSessionStatusTone,
  resolveSessionStreamContentLength,
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

test("resolveSessionStatusLabel maps every session status to a short word", () => {
  assert.equal(resolveSessionStatusLabel("starting" as any), "启动中");
  assert.equal(resolveSessionStatusLabel("running" as any), "运行中");
  assert.equal(resolveSessionStatusLabel("waiting_for_permission" as any), "等待审批");
  assert.equal(resolveSessionStatusLabel("idle" as any), "空闲");
  assert.equal(resolveSessionStatusLabel("error" as any), "错误");
  assert.equal(resolveSessionStatusLabel("cancelled" as any), "已取消");
});

test("formatSessionPreviewTime returns placeholder for missing or invalid values", () => {
  assert.equal(formatSessionPreviewTime(undefined), "--:--");
  assert.equal(formatSessionPreviewTime("not-a-date"), "--:--");
});

test("resolveSessionStreamContentLength grows as streamed text and tool output grow", () => {
  const baseTimeline: SessionTimelineEntry[] = [
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content",
          text: "答",
          timestamp: "2026-05-29T00:00:00.000Z",
        },
      ],
      timestamp: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
    },
  ];
  const grownTimeline: SessionTimelineEntry[] = [
    {
      ...baseTimeline[0],
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content",
          text: "答案更长了",
          timestamp: "2026-05-29T00:00:00.000Z",
        },
      ],
    } as SessionTimelineEntry,
  ];

  const before = resolveSessionStreamContentLength({ timeline: baseTimeline });
  const after = resolveSessionStreamContentLength({ timeline: grownTimeline });
  assert.ok(after > before, "streamed content growth must increase the signature");

  const toolBefore = resolveSessionStreamContentLength({
    toolCalls: [
      { id: "t", kind: "shell", title: "Run", status: "running", output: "12", timestamp: "2026-05-29T00:00:00.000Z" },
    ] as any,
  });
  const toolAfter = resolveSessionStreamContentLength({
    toolCalls: [
      { id: "t", kind: "shell", title: "Run", status: "running", output: "123456", timestamp: "2026-05-29T00:00:00.000Z" },
    ] as any,
  });
  assert.ok(toolAfter > toolBefore, "growing tool output must increase the signature");

  assert.equal(resolveSessionStreamContentLength({}), 0);
});
