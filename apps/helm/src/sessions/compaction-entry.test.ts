import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessionCompactionEntryFromProvider,
  upsertSessionCompactionEntry,
} from "./compaction-entry";

test("buildSessionCompactionEntryFromProvider exposes Codex compaction details when a summary exists", () => {
  const entry = buildSessionCompactionEntryFromProvider({
    sessionId: "session-codex-compaction",
    timestamp: "2026-06-28T00:00:00.000Z",
    providerId: "codex",
    summaryText: "Compaction summary",
  });

  assert.equal(entry.detailsVisibility, "expandable");
});

test("buildSessionCompactionEntryFromProvider keeps non-Codex summaries expandable", () => {
  const entry = buildSessionCompactionEntryFromProvider({
    sessionId: "session-claude-compaction",
    timestamp: "2026-06-28T00:00:00.000Z",
    providerId: "claude-acp",
    summaryText: "Compaction summary",
  });

  assert.equal(entry.detailsVisibility, "expandable");
});

test("upsertSessionCompactionEntry keeps an unrelated heuristic compaction separate", () => {
  const entries = [
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-17T11:46:35.173Z",
      providerId: "claudecode",
      source: "provider",
    }),
  ];

  upsertSessionCompactionEntry(
    entries,
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-17T14:01:30.007Z",
      providerId: "claudecode",
      source: "heuristic",
      summaryText: "Recovered summary",
      summaryMessageId: "replayed-summary",
    }),
  );

  assert.equal(entries.length, 2);
  assert.equal(
    entries[1]?.kind === "context_compaction" ? entries[1].summaryText : undefined,
    "Recovered summary",
  );
});

test("upsertSessionCompactionEntry merges entries with the same compaction identity", () => {
  const entries = [
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-17T11:46:35.173Z",
      providerId: "claudecode",
      source: "provider",
      summaryMessageId: "summary-1",
    }),
  ];

  upsertSessionCompactionEntry(
    entries,
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-17T14:01:30.007Z",
      providerId: "claudecode",
      source: "heuristic",
      summaryText: "Recovered summary",
      summaryMessageId: "summary-1",
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(
    entries[0]?.kind === "context_compaction" ? entries[0].source : undefined,
    "provider",
  );
});

test("upsertSessionCompactionEntry preserves two independent provider compactions", () => {
  const entries = [
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-17T11:46:35.173Z",
      providerId: "claudecode",
      source: "provider",
      summaryMessageId: "summary-1",
    }),
  ];

  upsertSessionCompactionEntry(
    entries,
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-17T14:01:30.007Z",
      providerId: "claudecode",
      source: "provider",
      summaryMessageId: "summary-2",
    }),
  );

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) =>
      entry.kind === "context_compaction" ? entry.summaryMessageId : undefined,
    ),
    ["summary-1", "summary-2"],
  );
});
