export type SessionReplayCompleteness = "full" | "compacted" | "unknown" | "none";

export type SessionTranscriptIntegrity =
  | "complete"
  | "local-prefix-preserved"
  | "prefix-missing";

export type SessionTranscriptRuntimeRestoreState =
  | "ready"
  | "history-only"
  | "runtime-restore-needed"
  | "runtime-restored";

export type SessionTranscriptStatus = {
  source: "local" | "acp-load" | "mixed";
  replayCompleteness: SessionReplayCompleteness;
  integrity: SessionTranscriptIntegrity;
  runtimeRestoreState: SessionTranscriptRuntimeRestoreState;
  warning?: "history-gap";
};

export type SessionTimelineContextCompactionEntry = {
  kind: "context_compaction";
  id: string;
  summaryMessageId?: string;
  summaryText?: string;
  timestamp: string;
  updatedAt: string;
  replayCompleteness: Exclude<SessionReplayCompleteness, "none">;
};

export type SessionTimelineResumedEntry = {
  kind: "session_resumed";
  id: string;
  restoreMethod: "client-reconnect" | "session/load" | "session/resume";
  timestamp: string;
  updatedAt: string;
  replayCompleteness: SessionReplayCompleteness;
};

export type SessionTimelineHistoryGapEntry = {
  kind: "history_gap";
  id: string;
  timestamp: string;
  updatedAt: string;
  message: "Earlier transcript is unavailable; only post-compaction history could be restored.";
};

export type SessionTimelineTranscriptEventEntry =
  | SessionTimelineContextCompactionEntry
  | SessionTimelineResumedEntry
  | SessionTimelineHistoryGapEntry;

export function isTranscriptEventEntry(
  entry: { kind: string },
): entry is SessionTimelineTranscriptEventEntry {
  return entry.kind === "context_compaction" ||
    entry.kind === "session_resumed" ||
    entry.kind === "history_gap";
}

export function injectTranscriptBoundaryEvents(
  entries: import("./session-timeline").SessionTimelineEntry[],
  compactionEntry: SessionTimelineContextCompactionEntry,
  resumedEntry: SessionTimelineResumedEntry,
): import("./session-timeline").SessionTimelineEntry[] {
  if (
    entries.some((entry) => entry.id === compactionEntry.id || entry.id === resumedEntry.id)
  ) {
    return entries;
  }
  const resumedTimestamp = resumedEntry.timestamp;

  const insertIndex = entries.findIndex(
    (entry) => entry.timestamp >= resumedTimestamp,
  );

  if (insertIndex === -1) {
    return [...entries, compactionEntry, resumedEntry];
  }

  return [
    ...entries.slice(0, insertIndex),
    compactionEntry,
    resumedEntry,
    ...entries.slice(insertIndex),
  ];
}
