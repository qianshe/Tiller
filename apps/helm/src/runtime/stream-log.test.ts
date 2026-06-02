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
      info: (event: string, fields: Record<string, unknown>) => logs.push({ event, fields }),
    },
  } as unknown as HelmHandlerContext;

  const writes = captureStdoutWrites(() => {
    controller.ensureAssistantStreamLogStarted(
      "session-stream-test",
      { id: "message-stream-test", role: "assistant" },
      context,
      () => 1,
      () => ({ sessionId: "session-stream-test" }),
    );
    controller.closeAssistantStreamLog("session-stream-test");
  });

  assert.deepEqual(writes, []);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    event: "runtime.assistant_stream.started",
    fields: {
      sessionId: "session-stream-test",
      seq: 1,
      role: "assistant",
      messageId: "message-stream-test",
    },
  });
  assert.doesNotMatch(JSON.stringify(logs), /SECRET_STREAM_TEXT/u);
});
