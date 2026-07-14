import assert from "node:assert/strict";
import test from "node:test";
import type { CommandChunk } from "@tiller/shared";
import { mergeCommandHistory } from "./helpers";

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
