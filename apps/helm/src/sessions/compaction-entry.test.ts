import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionCompactionEntryFromProvider } from "./compaction-entry";

test("buildSessionCompactionEntryFromProvider hides Codex compaction details through provider policy", () => {
  const entry = buildSessionCompactionEntryFromProvider({
    sessionId: "session-codex-compaction",
    timestamp: "2026-06-28T00:00:00.000Z",
    providerId: "codex",
    summaryText: "Compaction summary",
  });

  assert.equal(entry.detailsVisibility, "hidden");
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
