import assert from "node:assert/strict";
import test from "node:test";
import type { CommandChunk, SessionSummary } from "@tiller/shared";
import { mergeCommandHistory, upsertSessionSummary } from "./helpers";

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    cwd: "D:/myProject/tools/Tiller",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

function output(id: string, timestamp: string, sequence?: number): CommandChunk {
  return {
    id,
    commandId: `command-${id}`,
    text: id,
    stream: "stdout",
    timestamp,
    ...(sequence === undefined ? {} : { sequence }),
  };
}

test("mergeCommandHistory orders complete canonical sequences instead of timestamps", () => {
  const result = mergeCommandHistory([], [
    output("arrived-second", "2026-07-11T10:00:01.000Z", 2),
    output("arrived-first", "2026-07-11T10:00:02.000Z", 1),
  ]);

  assert.deepEqual(result.map((item) => item.id), ["arrived-first", "arrived-second"]);
});

test("mergeCommandHistory preserves source order when a sequence is missing", () => {
  const result = mergeCommandHistory([], [
    output("first", "2026-07-11T10:00:02.000Z", 2),
    output("second", "2026-07-11T10:00:01.000Z"),
  ]);

  assert.deepEqual(result.map((item) => item.id), ["first", "second"]);
});

test("upsertSessionSummary preserves the previous title when an update omits it", () => {
  const result = upsertSessionSummary(
    [session({ title: "稳定标题" })],
    session({
      title: undefined,
      updatedAt: "2026-07-18T00:01:00.000Z",
      lastMessagePreview: "后续 prompt",
    }),
  );

  assert.equal(result[0]?.title, "稳定标题");
  assert.equal(result[0]?.lastMessagePreview, "后续 prompt");
});
