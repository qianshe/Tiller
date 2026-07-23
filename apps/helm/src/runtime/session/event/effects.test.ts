import assert from "node:assert/strict";
import test from "node:test";
import { materializeRuntimeCommandOutputChunk } from "./effects";

test("50 MiB command output is externalized while the canonical delta stays bounded", () => {
  const outputBytes = 50 * 1024 * 1024;
  let storedBytes = 0;
  const context = {
    sessionOutputBodyStore: {
      putText: ({ sessionId, outputId, text }: { sessionId: string; outputId: string; text: string }) => {
        storedBytes = Buffer.byteLength(text);
        return {
          sessionId,
          outputId,
          id: outputId,
          mimeType: "text/plain; charset=utf-8",
          byteSize: storedBytes,
          sha256: "sha256-output",
          storageKey: "output-body",
          uri: `/api/sessions/${sessionId}/outputs/${outputId}`,
          createdAt: "2026-07-11T00:00:00.000Z",
        };
      },
    },
  } as any;
  const chunk = {
    id: "output-50mib",
    commandId: "command-1",
    stream: "stdout" as const,
    text: "x".repeat(outputBytes),
    timestamp: "2026-07-11T00:00:00.000Z",
  };

  const materialized = materializeRuntimeCommandOutputChunk(context, "session-1", chunk);

  assert.equal(storedBytes, outputBytes);
  assert.equal(materialized.text.length, 1024);
  assert.equal(materialized.truncated, true);
  assert.equal(materialized.contentRef?.byteSize, outputBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(materialized)) < 4 * 1024, true);
});
