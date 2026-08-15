import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionTimelineBatch } from "@tiller/shared";
import { createSqliteSessionSubagentDetailStore } from "./subagent-detail-store";

test("sqlite subagent detail store commits timeline batches and removes session data", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-subagent-detail-"));
  const store = createSqliteSessionSubagentDetailStore(join(tempDir, "sessions.sqlite"));
  try {
    store.commitBatch("session-1", "root-1", batch(2, [
      {
        id: "subagent-prompt:root-1",
        kind: "user_message",
        message: {
          id: "subagent-prompt:root-1",
          role: "user",
          text: "inspect files",
          timestamp: "2026-07-22T00:00:00.000Z",
          sequence: 0,
        },
        timestamp: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        sequence: 0,
      },
      {
        id: "tool:tool-1",
        kind: "tool_call",
        toolCall: {
          id: "tool-1",
          commandId: "command-1",
          kind: "read",
          title: "Read",
          status: "running",
          timestamp: "2026-07-22T00:00:01.000Z",
          updatedAt: "2026-07-22T00:00:01.000Z",
          sequence: 2,
        },
        timestamp: "2026-07-22T00:00:01.000Z",
        updatedAt: "2026-07-22T00:00:01.000Z",
        sequence: 2,
      },
    ]));
    store.commitBatch("session-1", "root-1", batch(4, [{
      id: "tool:tool-1",
      kind: "tool_call",
      toolCall: {
        id: "tool-1",
        commandId: "command-1",
        kind: "read",
        title: "Read file",
        status: "completed",
        output: "ok",
        timestamp: "2026-07-22T00:00:01.000Z",
        updatedAt: "2026-07-22T00:00:04.000Z",
        sequence: 2,
      },
      timestamp: "2026-07-22T00:00:01.000Z",
      updatedAt: "2026-07-22T00:00:04.000Z",
      sequence: 2,
    }]));

    const detail = store.get("session-1", "root-1");
    assert.equal(detail.throughSequence, 4);
    assert.deepEqual(detail.entries.map((entry) => entry.id), [
      "subagent-prompt:root-1",
      "tool:tool-1",
    ]);
    const tool = detail.entries.find((entry) => entry.kind === "tool_call");
    assert.equal(tool?.kind === "tool_call" ? tool.toolCall.status : undefined, "completed");

    store.remove("session-1");
    assert.deepEqual(store.get("session-1", "root-1"), {
      sessionId: "session-1",
      parentToolCallId: "root-1",
      throughSequence: 0,
      entries: [],
    });
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("sqlite subagent detail store strips legacy inline image data when reading tool calls", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-subagent-detail-"));
  const store = createSqliteSessionSubagentDetailStore(join(tempDir, "sessions.sqlite"));
  try {
    store.commitBatch("session-1", "root-1", batch(1, [{
      id: "tool:tool-image",
      kind: "tool_call",
      toolCall: {
        id: "tool-image",
        kind: "mcp",
        title: "mcp__image_tool",
        status: "completed",
        output: JSON.stringify({
          data: `data:image/jpeg;base64,${"A".repeat(2048)}`,
          mimeType: "image/jpeg",
        }),
        timestamp: "2026-08-15T06:00:00.000Z",
        updatedAt: "2026-08-15T06:00:00.000Z",
        sequence: 1,
      },
      timestamp: "2026-08-15T06:00:00.000Z",
      updatedAt: "2026-08-15T06:00:00.000Z",
      sequence: 1,
    }]));

    const detail = store.get("session-1", "root-1");
    const tool = detail.entries.find((entry) => entry.kind === "tool_call");
    const output = tool?.kind === "tool_call" ? tool.toolCall.output : undefined;

    assert.equal(output, JSON.stringify({
      data: "[image content omitted from history]",
      mimeType: "image/jpeg",
    }));
    assert.doesNotMatch(output ?? "", /data:image\/jpeg;base64/u);
  } finally {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function batch(lastSequence: number, entries: SessionTimelineBatch["entries"]): SessionTimelineBatch {
  return {
    replace: false,
    deliverySequence: lastSequence + 1,
    lastSequence,
    entries,
  };
}
