import assert from "node:assert/strict";
import test from "node:test";
import type {
  SessionTimelineBatch,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { SessionTimelineStore } from "@tiller/persistence";
import { buildSessionCompactionEntryFromProvider } from "../../sessions/compaction-entry";
import { createSessionTimelineDispatcher } from "./dispatcher";

test("timeline dispatcher commits updates with materialized entries before publishing", () => {
  const order: string[] = [];
  const batch: SessionTimelineBatch = {
    replace: false,
    deliverySequence: 1,
    lastSequence: 1,
    entries: [],
  };
  const update: SessionUpdateRecord = {
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence: 1,
    source: "acp_live",
    updateType: "message",
    receivedAt: "2026-07-11T16:00:00.000Z",
    payloadJson: '{"type":"message"}',
  };
  const store = {
    commitBatch: (
      _sessionId: string,
      _batch: SessionTimelineBatch,
      updates: SessionUpdateRecord[],
    ) => {
      order.push(`commit:${updates.length}`);
      return [];
    },
  } as unknown as SessionTimelineStore;
  const dispatcher = createSessionTimelineDispatcher({
    store,
    publish: () => order.push("publish"),
  });

  dispatcher.dispatch("session-1", batch, [update]);

  assert.deepEqual(order, ["commit:1", "publish"]);
});

test("timeline dispatcher does not publish when the atomic commit fails", () => {
  let published = false;
  const dispatcher = createSessionTimelineDispatcher({
    store: {
      commitBatch: () => {
        throw new Error("commit failed");
      },
    } as unknown as SessionTimelineStore,
    publish: () => {
      published = true;
    },
  });

  assert.throws(
    () =>
      dispatcher.dispatch(
        "session-1",
        {
          replace: false,
          deliverySequence: 1,
          lastSequence: 1,
          entries: [],
        },
        [],
      ),
    /commit failed/u,
  );
  assert.equal(published, false);
});

test("timeline dispatcher reconciles delayed heuristic summaries with persisted provider compactions", () => {
  const persistedEntry = buildSessionCompactionEntryFromProvider({
    sessionId: "session-1",
    timestamp: "2026-07-17T11:46:35.173Z",
    providerId: "claudecode",
    source: "provider",
    summaryMessageId: "replayed-summary",
  });
  const incomingEntry = buildSessionCompactionEntryFromProvider({
    sessionId: "session-1",
    timestamp: "2026-07-17T14:01:30.007Z",
    providerId: "claudecode",
    source: "heuristic",
    summaryText: "Recovered summary",
    summaryMessageId: "replayed-summary",
  });
  let committedEntries: SessionTimelineEntry[] = [];
  let publishedEntries: SessionTimelineEntry[] = [];
  const store = {
    list: () => [persistedEntry],
    commitBatch: (_sessionId: string, batch: SessionTimelineBatch) => {
      committedEntries = batch.entries;
      return batch.entries;
    },
  } as unknown as SessionTimelineStore;
  const dispatcher = createSessionTimelineDispatcher({
    store,
    publish: (_sessionId, batch) => {
      publishedEntries = batch.entries;
    },
  });

  dispatcher.dispatch("session-1", {
    replace: false,
    deliverySequence: 2,
    lastSequence: 1,
    entries: [incomingEntry],
  });

  for (const entries of [committedEntries, publishedEntries]) {
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.id, persistedEntry.id);
    assert.equal(
      entries[0]?.kind === "context_compaction" ? entries[0].summaryText : undefined,
      "Recovered summary",
    );
    assert.equal(
      entries[0]?.kind === "context_compaction" ? entries[0].source : undefined,
      "provider",
    );
  }
});
