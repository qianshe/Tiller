import assert from "node:assert/strict";
import { test } from "node:test";
import type { HelmHandlerContext } from "../handlers/context";
import { createRuntimeStreamLogController } from "./stream-log";

function captureStdoutWrites(run: () => void) {
  const stdout = process.stdout as typeof process.stdout & {
    write: typeof process.stdout.write;
  };
  const originalWrite = stdout.write;
  const writes: string[] = [];
  stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof stdout.write;
  try {
    run();
  } finally {
    stdout.write = originalWrite;
  }
  return writes;
}

test("assistant stream text is not written to stdout", () => {
  const controller = createRuntimeStreamLogController();
  const logs: unknown[] = [];
  const context = {
    logger: {
      info: (event: string, fields: Record<string, unknown>) => logs.push({ level: "info", event, fields }),
    },
  } as unknown as HelmHandlerContext;

  const writes = captureStdoutWrites(() => {
    controller.ensureAssistantStreamLogStarted(
      "session-stream-test",
      { id: "message-stream-test", role: "assistant", text: "SECRET_STREAM_TEXT", timelineSequence: 12 },
      context,
      () => 1,
      () => ({ sessionId: "session-stream-test" }),
    );
    controller.closeAssistantStreamLog(
      "session-stream-test",
      context,
      () => 13,
      () => ({ sessionId: "session-stream-test" }),
    );
  });

  assert.deepEqual(writes, []);
  assert.equal(logs.length, 1);
  const log = logs[0] as {
    event: string;
    fields: Record<string, unknown>;
    level: string;
  };
  assert.equal(log.level, "info");
  assert.equal(log.event, "runtime.assistant_stream.completed");
  assert.deepEqual(log.fields, {
    sessionId: "session-stream-test",
    seq: 13,
    role: "assistant",
    segments: 1,
    chunks: 1,
    uniqueMessages: 1,
    assistantChars: "SECRET_STREAM_TEXT".length,
    durationMs: log.fields.durationMs,
    firstSeq: 12,
    lastSeq: 12,
    firstMessageId: "message-stream-test",
    lastMessageId: "message-stream-test",
  });
  assert.equal(typeof log.fields.durationMs, "number");
  assert.ok(Number(log.fields.durationMs) >= 0);
  assert.doesNotMatch(JSON.stringify(logs), /SECRET_STREAM_TEXT/u);
});
