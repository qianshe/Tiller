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

test("upsertSessionCompactionEntry keeps separate compaction starts", () => {
  const entries = [
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-19T14:54:42.656Z",
      providerId: "claudecode",
      phase: "started",
    }),
  ];

  for (const timestamp of ["2026-07-19T15:08:10.882Z", "2026-07-19T15:15:19.539Z"]) {
    upsertSessionCompactionEntry(
      entries,
      buildSessionCompactionEntryFromProvider({
        sessionId: "session-claude-compaction",
        timestamp,
        providerId: "claudecode",
        phase: "started",
      }),
    );
  }

  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) => entry.timestamp),
    ["2026-07-19T14:54:42.656Z", "2026-07-19T15:08:10.882Z", "2026-07-19T15:15:19.539Z"],
  );
});

test("upsertSessionCompactionEntry keeps a later summary after a completed boundary", () => {
  const entries = [
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-19T15:24:06.137Z",
      providerId: "claudecode",
      phase: "completed",
    }),
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-19T15:24:30.000Z",
      providerId: "claudecode",
      phase: "completed",
      summaryMessageId: "summary-auto",
      summaryText: "Automatically compacted context",
    }),
  ];

  upsertSessionCompactionEntry(
    entries,
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-19T15:25:47.411Z",
      providerId: "claudecode",
      phase: "completed",
      summaryMessageId: "summary-manual",
      summaryText: "Manually compacted context",
    }),
  );

  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) =>
      entry.kind === "context_compaction" ? entry.summaryMessageId : undefined,
    ),
    [undefined, "summary-auto", "summary-manual"],
  );
});

test("upsertSessionCompactionEntry merges a transcript summary with a live completion marker", () => {
  const entries = [
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-19T15:24:06.137Z",
      providerId: "claudecode",
      phase: "completed",
      summaryMessageId: "completion-marker",
    }),
  ];

  upsertSessionCompactionEntry(
    entries,
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-19T15:23:58.000Z",
      providerId: "claudecode",
      phase: "completed",
      summaryMessageId: "summary-auto",
      summaryText: "Automatically compacted context",
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(
    entries[0]?.kind === "context_compaction" ? entries[0].summaryMessageId : undefined,
    "summary-auto",
  );
  assert.equal(
    entries[0]?.kind === "context_compaction" ? entries[0].summaryText : undefined,
    "Automatically compacted context",
  );
});

test("upsertSessionCompactionEntry keeps the summary identity when the marker arrives second", () => {
  const entries = [
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-19T15:23:58.000Z",
      providerId: "claudecode",
      phase: "completed",
      summaryMessageId: "summary-auto",
      summaryText: "Automatically compacted context",
    }),
  ];

  upsertSessionCompactionEntry(
    entries,
    buildSessionCompactionEntryFromProvider({
      sessionId: "session-claude-compaction",
      timestamp: "2026-07-19T15:24:06.137Z",
      providerId: "claudecode",
      phase: "completed",
      summaryMessageId: "completion-marker",
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(
    entries[0]?.kind === "context_compaction" ? entries[0].summaryMessageId : undefined,
    "summary-auto",
  );
  assert.equal(
    entries[0]?.kind === "context_compaction" ? entries[0].summaryText : undefined,
    "Automatically compacted context",
  );
});
