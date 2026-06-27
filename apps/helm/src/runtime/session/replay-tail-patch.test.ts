import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionTimelineEntry } from "@tiller/shared";
import { applyReplayTailPatch } from "./replay-tail-patch";

function message(id: string, text: string, sequence: number, role: "user" | "assistant" = "user"): AgentMessage {
  return {
    id,
    role,
    text,
    timestamp: new Date(Date.now() + sequence * 1000).toISOString(),
    timelineSequence: sequence,
  };
}

function userEntry(id: string, text: string, sequence: number): SessionTimelineEntry {
  return {
    kind: "user_message",
    id,
    message: message(id, text, sequence),
    timestamp: new Date(Date.now() + sequence * 1000).toISOString(),
    updatedAt: new Date(Date.now() + sequence * 1000).toISOString(),
    timelineSequence: sequence,
  };
}

test("applyReplayTailPatch with compacted replay keeps local prefix", () => {
  const localMessages = [
    message("older-user", "压缩前本地问题", 10),
    message("older-assistant", "压缩前本地回答", 11, "assistant"),
  ];
  const localTimeline = [
    userEntry("older-user", "压缩前本地问题", 10),
  ];

  const replayMessages = [
    message("compaction-summary", "This session is being continued from a previous conversation that ran out of context.", 0),
    message("provider-current-user", "继续处理", 20),
    message("provider-current-assistant", "好的，继续收尾。", 21, "assistant"),
  ];
  const replayTimeline = [
    userEntry("provider-current-user", "继续处理", 20),
  ];

  const result = applyReplayTailPatch({
    localMessages,
    localTimeline,
    replayMessages,
    replayTimeline,
    replayCompleteness: "compacted",
  });

  assert.equal(result.mode, "keep-local-with-gap");
  assert.equal(result.transcriptStatus.integrity, "prefix-missing");
  assert.equal(result.transcriptStatus.warning, "history-gap");
  assert.ok(result.nextTimeline.some((entry) => entry.kind === "history_gap"));
});

test("applyReplayTailPatch with full replay replaces everything", () => {
  const localMessages = [
    message("local-1", "本地消息", 10),
  ];
  const localTimeline = [
    userEntry("local-1", "本地消息", 10),
  ];

  const replayMessages = [
    message("replay-1", "完整重放消息", 10),
    message("replay-2", "新消息", 20),
  ];
  const replayTimeline = [
    userEntry("replay-1", "完整重放消息", 10),
    userEntry("replay-2", "新消息", 20),
  ];

  const result = applyReplayTailPatch({
    localMessages,
    localTimeline,
    replayMessages,
    replayTimeline,
    replayCompleteness: "full",
  });

  assert.equal(result.mode, "full-replace");
  assert.equal(result.transcriptStatus.source, "acp-load");
  assert.equal(result.transcriptStatus.integrity, "complete");
  assert.deepEqual(result.nextMessages, replayMessages);
  assert.deepEqual(result.nextTimeline, replayTimeline);
});

test("applyReplayTailPatch with compacted replay and matching anchor does tail replace", () => {
  const localMessages = [
    message("older-user", "压缩前问题", 10),
    message("anchor-user", "锚点消息", 20),
  ];
  const localTimeline = [
    userEntry("older-user", "压缩前问题", 10),
    userEntry("anchor-user", "锚点消息", 20),
  ];

  const replayMessages = [
    message("compaction-summary", "This session is being continued from a previous conversation that ran out of context.", 0),
    message("anchor-user", "锚点消息", 20),
    message("new-assistant", "新的回复", 21, "assistant"),
  ];
  const replayTimeline = [
    userEntry("anchor-user", "锚点消息", 20),
  ];

  const result = applyReplayTailPatch({
    localMessages,
    localTimeline,
    replayMessages,
    replayTimeline,
    replayCompleteness: "compacted",
  });

  assert.equal(result.mode, "tail-replace");
  assert.equal(result.transcriptStatus.integrity, "local-prefix-preserved");
  assert.equal(result.nextMessages.length, 3);
  assert.equal(result.nextMessages[0]?.id, "older-user");
  assert.equal(result.nextMessages[1]?.id, "anchor-user");
});

test("applyReplayTailPatch does not match compacted anchors by timestamp alone", () => {
  const localMessages = [
    message("older-user", "压缩前问题", 10),
    message("anchor-user", "锚点消息", 20),
  ];
  const localTimeline = [
    userEntry("older-user", "压缩前问题", 10),
    userEntry("anchor-user", "锚点消息", 20),
  ];

  const replayMessages: AgentMessage[] = [
    {
      id: "compaction-summary",
      role: "user",
      text: "This session is being continued from a previous conversation that ran out of context.",
      timestamp: "2026-06-18T14:05:25.193Z",
    },
    {
      id: "replay-anchor",
      role: "user",
      text: "锚点消息",
      timestamp: localMessages[1]!.timestamp,
    },
    {
      id: "new-assistant",
      role: "assistant",
      text: "新的回复",
      timestamp: "2026-06-18T14:02:16.000Z",
    },
  ];

  const replayTimeline = [
    {
      kind: "user_message" as const,
      id: "replay-anchor",
      message: replayMessages[1]!,
      timestamp: replayMessages[1]!.timestamp,
      updatedAt: replayMessages[1]!.timestamp,
    },
  ];

  const result = applyReplayTailPatch({
    localMessages,
    localTimeline,
    replayMessages,
    replayTimeline,
    replayCompleteness: "compacted",
  });

  assert.equal(result.mode, "keep-local-with-gap");
  assert.equal(result.transcriptStatus.warning, "history-gap");
});
