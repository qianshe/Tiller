export type SessionReplayCompleteness = "full" | "compacted" | "unknown" | "none";
export type SessionCompactionPhase = "started" | "completed";
export type SessionCompactionSource = "provider" | "heuristic";

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
  phase: SessionCompactionPhase;
  source: SessionCompactionSource;
  summaryMessageId?: string;
  summaryText?: string;
  detailsVisibility?: "hidden" | "expandable";
  timestamp: string;
  updatedAt: string;
  replayCompleteness: Exclude<SessionReplayCompleteness, "none">;
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
  | SessionTimelineHistoryGapEntry;

export function isTranscriptEventEntry(
  entry: { kind: string },
): entry is SessionTimelineTranscriptEventEntry {
  return entry.kind === "context_compaction" ||
    entry.kind === "history_gap";
}
