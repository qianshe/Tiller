import assert from "node:assert/strict";
import test from "node:test";
import { createHistorySnapshot, resolveProviderHistorySnapshot } from "./provider-history-source.js";

test("provider history snapshot records source and sync timestamp", () => {
  const snapshot = createHistorySnapshot({
    source: "acp-session-load",
    messages: [],
    toolCalls: [],
    outputs: [],
    diffs: [],
  });

  assert.equal(snapshot.source, "acp-session-load");
  assert.equal(typeof snapshot.syncedAt, "string");
});

test("provider history resolver chooses the first available source", async () => {
  const calls: string[] = [];
  const snapshot = await resolveProviderHistorySnapshot([
    {
      source: "acp-session-load",
      load: async () => {
        calls.push("acp-session-load");
        return null;
      },
    },
    {
      source: "adapter-authoritative-history",
      load: async () => {
        calls.push("adapter-authoritative-history");
        return { messages: [], toolCalls: [], outputs: [], diffs: [] };
      },
    },
    {
      source: "local-cache",
      load: async () => {
        calls.push("local-cache");
        return { messages: [], toolCalls: [], outputs: [], diffs: [] };
      },
    },
  ]);

  assert.equal(snapshot?.source, "adapter-authoritative-history");
  assert.deepEqual(calls, ["acp-session-load", "adapter-authoritative-history"]);
});
