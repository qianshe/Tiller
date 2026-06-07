import assert from "node:assert/strict";
import test from "node:test";
import { loadProviderAuthoritativeHistory, type ProviderHistoryReader } from "./history-reader.js";

test("loadProviderAuthoritativeHistory reads provider source and builds common history", async () => {
  const reader: ProviderHistoryReader<string> = {
    read: async ({ runtimeSessionId }) => runtimeSessionId,
    toEvents: (source) => [
      {
        kind: "message",
        id: source,
        role: "user",
        text: "hello",
        timestamp: "2026-05-31T00:00:00.000Z",
      },
    ],
  };

  const history = await loadProviderAuthoritativeHistory(reader, {
    provider: { id: "test", name: "Test", command: "test", transport: "stdio", protocol: "acp" },
    runtimeSessionId: "msg-1",
    cwd: "D:/repo",
  });

  assert.equal(history?.messages[0]?.id, "msg-1");
  assert.equal(history?.messages[0]?.timelineSequence, 1);
});

test("loadProviderAuthoritativeHistory delegates to provider build when provided", async () => {
  const reader: ProviderHistoryReader<string> = {
    read: async ({ runtimeSessionId }) => runtimeSessionId,
    toEvents: (source) => [
      {
        kind: "message",
        id: source,
        role: "user",
        text: "common history",
        timestamp: "2026-05-31T00:00:00.000Z",
      },
    ],
    build: (events) => ({
      messages: [
        {
          id: `provider:${events[0]?.id}`,
          role: "assistant",
          text: "provider history",
          timestamp: "2026-05-31T00:00:01.000Z",
          timelineSequence: 1,
        },
      ],
      toolCalls: [],
    }),
  };

  const history = await loadProviderAuthoritativeHistory(reader, {
    provider: { id: "test", name: "Test", command: "test", transport: "stdio", protocol: "acp" },
    runtimeSessionId: "msg-1",
    cwd: "D:/repo",
  });

  assert.equal(history?.messages[0]?.id, "provider:msg-1");
  assert.equal(history?.messages[0]?.role, "assistant");
  assert.equal(history?.messages[0]?.text, "provider history");
});

test("loadProviderAuthoritativeHistory returns null when reader has no source", async () => {
  const reader: ProviderHistoryReader<string> = {
    read: async () => null,
    toEvents: () => {
      throw new Error("toEvents should not run without a source");
    },
  };

  const history = await loadProviderAuthoritativeHistory(reader, {
    provider: { id: "test", name: "Test", command: "test", transport: "stdio", protocol: "acp" },
    runtimeSessionId: "missing",
    cwd: "D:/repo",
  });

  assert.equal(history, null);
});
