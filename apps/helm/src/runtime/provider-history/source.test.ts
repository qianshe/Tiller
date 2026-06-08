import assert from "node:assert/strict";
import test from "node:test";
import { createHistorySnapshot, resolveProviderHistorySnapshot } from "./source.js";

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

test("provider history resolver chooses the first available ACP source", async () => {
  const calls: string[] = [];
  const snapshot = await resolveProviderHistorySnapshot([
    {
      source: "acp-session-load",
      load: async () => {
        calls.push("empty-acp-session-load");
        return null;
      },
    },
    {
      source: "acp-session-load",
      load: async () => {
        calls.push("acp-session-load");
        return { messages: [], toolCalls: [], outputs: [], diffs: [] };
      },
    },
  ]);

  assert.equal(snapshot?.source, "acp-session-load");
  assert.deepEqual(calls, ["empty-acp-session-load", "acp-session-load"]);
});
