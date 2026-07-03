import type {
  AgentMessage,
  SessionRestoreMethod,
  SessionTimelineContextCompactionEntry,
  SessionTimelineEntry,
} from "@tiller/shared";
import {
  looksLikeCompactionCompletedMessage,
  looksLikeCompactionStartedMessage,
  looksLikeContinuationSummary,
  sortSessionTimelineEntries,
} from "@tiller/shared";
import { buildSessionCompactionEntryFromProvider } from "../../sessions/compaction-entry";

type LegacySessionResumedEntry = {
  kind: "session_resumed";
  id: string;
  restoreMethod?: SessionRestoreMethod;
  timestamp: string;
  updatedAt: string;
  replayCompleteness: string;
};

type CompactionBootstrapTimelineEntry =
  | SessionTimelineEntry
  | LegacySessionResumedEntry;

type CompactionBootstrapBoundary = {
  compactionIdSuffix: string;
  compactionTimestamp: string;
  resumedMessage: AgentMessage;
  summaryMessageId?: string;
  summaryText?: string;
};

type RepairCompactionBootstrapTimelineInput = {
  sessionId: string;
  timeline: CompactionBootstrapTimelineEntry[];
  messages: AgentMessage[];
  providerId?: string;
  restoreMethod?: SessionRestoreMethod;
};

export type RepairCompactionTimelineResult = {
  entries: SessionTimelineEntry[];
  synthesizedBoundary: boolean;
};

export const MIGRATE_LEGACY_RESUMED_TO_COMPACTION_ONLY =
  process.env.TILLER_MIGRATE_LEGACY_RESUMED_TO_COMPACTION_ONLY !== "0";

const TRAILING_COMPACTION_REANCHOR_THRESHOLD_MS = 5 * 60 * 1000;

export function repairCompactionBootstrapTimeline(
  input: RepairCompactionBootstrapTimelineInput,
): RepairCompactionTimelineResult | null {
  if (!input.timeline.length) {
    return null;
  }

  const existingResumed = findLegacyResumedEntry(input.timeline);
  const boundary =
    resolveCompactionBootstrapBoundary(input.messages) ??
    resolveTrailingCompactionReplayBoundary(input.timeline, input.messages) ??
    resolveLegacyResumeBoundary(input.timeline, existingResumed);
  if (!boundary) {
    return repairTimelineOnlyTrailingCompactionCluster(input.timeline);
  }

  const existingCompaction = findMatchingCompactionEntry(input.timeline, boundary);
  const removableIds = new Set<string>();
  if (existingCompaction) {
    removableIds.add(existingCompaction.id);
  }
  if (existingResumed) {
    removableIds.add(existingResumed.id);
  }

  const baseTimeline = input.timeline.filter(
    (entry): entry is SessionTimelineEntry =>
      entry.kind !== "session_resumed" && !removableIds.has(entry.id),
  );

  const anchorEntry = resolveTimelineAnchorEntry(
    baseTimeline,
    boundary.resumedMessage,
    resolveLegacyResumeAnchorId(existingResumed?.id),
  );
  const compactionEntry = normalizeCompactionBootstrapEntry({
    entry: buildCompactionBootstrapEntry(
      input.sessionId,
      boundary,
      input.providerId,
      existingCompaction,
    ),
    anchorTimestamp: anchorEntry ? resolveTimelineAnchorTimestamp(anchorEntry) : undefined,
  });

  const nextEntries = anchorEntry
    ? repositionCompactionBeforeAnchor({
        entries: baseTimeline,
        compactionEntry,
        anchorId: resolveTimelineAnchorId(anchorEntry),
      })
    : sortSessionTimelineEntries([...baseTimeline, compactionEntry]);

  return sameTimelineEntryOrder(input.timeline, nextEntries)
    ? null
    : {
        entries: nextEntries,
        synthesizedBoundary: !input.timeline.some((entry) => entry.kind === "context_compaction"),
      };
}

function repairTimelineOnlyTrailingCompactionCluster(
  timeline: CompactionBootstrapTimelineEntry[],
): RepairCompactionTimelineResult | null {
  const trailingCluster = findTrailingReplayCompactionCluster(timeline);
  if (!trailingCluster.length) {
    return null;
  }

  const baseTimeline = timeline
    .slice(0, timeline.length - trailingCluster.length)
    .filter((entry): entry is SessionTimelineEntry => entry.kind !== "session_resumed");
  const anchorEntry = findFirstNonTranscriptEntry(baseTimeline);
  if (!anchorEntry) {
    return null;
  }

  const nextEntries = sortSessionTimelineEntries([
    ...baseTimeline,
    ...normalizeTrailingCompactionCluster({
      entries: trailingCluster,
      anchorTimestamp: anchorEntry.timestamp,
    }),
  ]);

  return sameTimelineEntryOrder(timeline, nextEntries)
    ? null
    : {
        entries: nextEntries,
        synthesizedBoundary: false,
      };
}

export function resolveCompactionBootstrapBoundary(messages: AgentMessage[]) {
  const summaryIndex = findLastMatchingMessageIndex(messages, (message) =>
    looksLikeContinuationSummary(message.text)
  );
  if (summaryIndex !== -1) {
    const summaryMessage = messages[summaryIndex]!;
    const completedMessage = findLastMatchingMessageBeforeIndex(messages, summaryIndex, (message) =>
      looksLikeCompactionCompletedMessage(message.text)
    );
    const resumedMessage = findResumedMessageAfterIndex(messages, summaryIndex);
    if (!resumedMessage) {
      return null;
    }
    return {
      compactionIdSuffix: completedMessage?.id ?? summaryMessage.id,
      compactionTimestamp: completedMessage?.timestamp ?? summaryMessage.timestamp,
      resumedMessage,
      summaryMessageId: summaryMessage.id,
      summaryText: summaryMessage.text.trim(),
    } satisfies CompactionBootstrapBoundary;
  }

  const completedIndex = findLastMatchingMessageIndex(messages, (message) =>
    looksLikeCompactionCompletedMessage(message.text)
  );
  if (completedIndex === -1) {
    return null;
  }
  const completedMessage = messages[completedIndex]!;
  const resumedMessage = findResumedMessageAfterIndex(messages, completedIndex);
  if (!resumedMessage) {
    return null;
  }
  return {
    compactionIdSuffix: completedMessage.id,
    compactionTimestamp: completedMessage.timestamp,
    resumedMessage,
  } satisfies CompactionBootstrapBoundary;
}

function resolveTrailingCompactionReplayBoundary(
  timeline: CompactionBootstrapTimelineEntry[],
  messages: AgentMessage[],
) {
  const compactionEntry = findTrailingReplayCompactionEntry(timeline);
  if (!compactionEntry) {
    return null;
  }
  const resumedMessage = findFirstReplayContentMessage(messages);
  if (!resumedMessage) {
    return null;
  }
  return {
    compactionIdSuffix:
      compactionEntry.summaryMessageId ??
      compactionEntry.id.split(":").at(-1) ??
      compactionEntry.id,
    compactionTimestamp: compactionEntry.timestamp,
    resumedMessage,
    summaryMessageId: compactionEntry.summaryMessageId,
    summaryText: compactionEntry.summaryText,
  } satisfies CompactionBootstrapBoundary;
}

function resolveLegacyResumeBoundary(
  timeline: CompactionBootstrapTimelineEntry[],
  existingResumed: LegacySessionResumedEntry | undefined,
) {
  if (!existingResumed) {
    return null;
  }
  const anchorId = resolveLegacyResumeAnchorId(existingResumed.id);
  if (!anchorId) {
    return null;
  }
  const resumedEntryIndex = timeline.findIndex((entry) => entry.id === existingResumed.id);
  const compactionEntry = findLegacyResumeCompactionEntry(timeline, resumedEntryIndex);
  const anchorEntry = findTimelineEntryById(timeline, anchorId);
  if (!compactionEntry || !anchorEntry) {
    return null;
  }
  return {
    compactionIdSuffix:
      compactionEntry.summaryMessageId ??
      compactionEntry.id.split(":").at(-1) ??
      compactionEntry.id,
    compactionTimestamp: compactionEntry.timestamp,
    resumedMessage: toAnchorMessage(anchorEntry),
    summaryMessageId: compactionEntry.summaryMessageId,
    summaryText: compactionEntry.summaryText,
  } satisfies CompactionBootstrapBoundary;
}

function buildCompactionBootstrapEntry(
  sessionId: string,
  boundary: CompactionBootstrapBoundary,
  providerId: string | undefined,
  existingEntry: SessionTimelineContextCompactionEntry | undefined,
): SessionTimelineContextCompactionEntry {
  const entry = buildSessionCompactionEntryFromProvider({
    sessionId,
    providerId,
    phase: "completed",
    source: "provider",
    summaryText: boundary.summaryText,
    summaryMessageId: boundary.summaryMessageId,
    timestamp: boundary.compactionTimestamp,
    idSuffix: boundary.compactionIdSuffix,
  });
  return {
    ...entry,
    ...(existingEntry ?? {}),
    id: existingEntry?.id ?? `compaction:${sessionId}:${boundary.compactionIdSuffix}`,
    phase: "completed",
    source: existingEntry?.source ?? "provider",
    summaryMessageId: boundary.summaryMessageId ?? existingEntry?.summaryMessageId,
    summaryText: boundary.summaryText ?? existingEntry?.summaryText,
    detailsVisibility: entry.detailsVisibility ?? existingEntry?.detailsVisibility,
    timestamp: boundary.compactionTimestamp,
    updatedAt: boundary.compactionTimestamp,
    replayCompleteness: "compacted",
  };
}

function normalizeCompactionBootstrapEntry(input: {
  entry: SessionTimelineContextCompactionEntry;
  anchorTimestamp?: string;
}) {
  if (!input.anchorTimestamp || !shouldClampCompactionTimestamp(input.entry.timestamp, input.anchorTimestamp)) {
    return input.entry;
  }
  const clampedTimestamp = new Date(Date.parse(input.anchorTimestamp) - 1).toISOString();
  return {
    ...input.entry,
    timestamp: clampedTimestamp,
    updatedAt: clampedTimestamp,
  };
}

function repositionCompactionBeforeAnchor(input: {
  entries: SessionTimelineEntry[];
  compactionEntry: SessionTimelineContextCompactionEntry;
  anchorId: string;
}) {
  const next = input.entries.filter((entry) => entry.id !== input.compactionEntry.id);
  const anchorIndex = next.findIndex((entry) => entry.id === input.anchorId);
  if (anchorIndex === -1) {
    return sortSessionTimelineEntries([...next, input.compactionEntry]);
  }

  let insertIndex = anchorIndex;
  while (insertIndex > 0 && isCanonicalTranscriptPrefixEntry(next[insertIndex - 1]!)) {
    insertIndex -= 1;
  }

  return [
    ...next.slice(0, insertIndex),
    input.compactionEntry,
    ...next.slice(insertIndex),
  ];
}

function resolveTimelineAnchorEntry(
  entries: SessionTimelineEntry[],
  resumedMessage: AgentMessage,
  legacyResumeAnchorId: string,
) {
  const candidates = entries.filter(isTimelineAnchorEntry);
  if (!candidates.length) {
    return undefined;
  }

  return findTimelineAnchorById(candidates, legacyResumeAnchorId) ??
    findTimelineAnchorById(candidates, resumedMessage.id) ??
    findTimelineAnchorBySequence(candidates, resumedMessage) ??
    findTimelineAnchorByTimestampAndText(candidates, resumedMessage) ??
    findTimelineAnchorByTimestamp(candidates, resumedMessage);
}

function findTimelineAnchorById(
  entries: TimelineAnchorEntry[],
  anchorId: string,
) {
  if (!anchorId) {
    return undefined;
  }
  return entries.find((entry) => resolveTimelineAnchorId(entry) === anchorId);
}

function findTimelineAnchorBySequence(
  entries: TimelineAnchorEntry[],
  message: AgentMessage,
) {
  if (typeof message.sequence !== "number") {
    return undefined;
  }
  return entries.find((entry) =>
    resolveTimelineAnchorRole(entry) === message.role &&
    resolveTimelineAnchorSequence(entry) === message.sequence
  );
}

function findTimelineAnchorByTimestampAndText(
  entries: TimelineAnchorEntry[],
  message: AgentMessage,
) {
  const text = normalizeAnchorText(message.text);
  if (!text) {
    return undefined;
  }
  return entries.find((entry) =>
    resolveTimelineAnchorRole(entry) === message.role &&
    resolveTimelineAnchorTimestamp(entry) === message.timestamp &&
    normalizeAnchorText(resolveTimelineAnchorText(entry)) === text
  );
}

function findTimelineAnchorByTimestamp(
  entries: TimelineAnchorEntry[],
  message: AgentMessage,
) {
  return entries.find((entry) =>
    resolveTimelineAnchorRole(entry) === message.role &&
    resolveTimelineAnchorTimestamp(entry) === message.timestamp
  );
}

function findLegacyResumeCompactionEntry(
  timeline: CompactionBootstrapTimelineEntry[],
  resumedEntryIndex: number,
) {
  for (let index = resumedEntryIndex - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (entry?.kind === "context_compaction") {
      return entry;
    }
  }
  return timeline.find((entry): entry is SessionTimelineContextCompactionEntry =>
    entry.kind === "context_compaction"
  );
}

function findLegacyResumedEntry(timeline: CompactionBootstrapTimelineEntry[]) {
  return timeline.find((entry): entry is LegacySessionResumedEntry =>
    entry.kind === "session_resumed" && entry.replayCompleteness === "compacted"
  );
}

function findMatchingCompactionEntry(
  timeline: CompactionBootstrapTimelineEntry[],
  boundary: CompactionBootstrapBoundary,
) {
  const summaryText = boundary.summaryText?.trim();
  return timeline.find((entry): entry is SessionTimelineContextCompactionEntry =>
    entry.kind === "context_compaction" && (
      entry.summaryMessageId === boundary.summaryMessageId ||
      entry.id.endsWith(`:${boundary.compactionIdSuffix}`) ||
      (Boolean(summaryText) && entry.summaryText?.trim() === summaryText)
    )
  );
}

function findTimelineEntryById(
  timeline: CompactionBootstrapTimelineEntry[],
  anchorId: string,
) {
  return timeline.find((entry): entry is TimelineAnchorEntry =>
    isTimelineAnchorEntry(entry) && resolveTimelineAnchorId(entry) === anchorId
  );
}

function findTrailingReplayCompactionEntry(timeline: CompactionBootstrapTimelineEntry[]) {
  const trailing = timeline.at(-1);
  if (
    trailing?.kind !== "context_compaction" ||
    trailing.phase !== "completed" ||
    !trailing.summaryText?.trim()
  ) {
    return undefined;
  }
  const previousContent = findLastNonTranscriptEntry(timeline.slice(0, -1));
  if (!previousContent) {
    return undefined;
  }
  const compactionTime = Date.parse(trailing.timestamp);
  const previousTime = Date.parse(previousContent.timestamp);
  if (!Number.isFinite(compactionTime) || !Number.isFinite(previousTime)) {
    return undefined;
  }
  return compactionTime - previousTime >= TRAILING_COMPACTION_REANCHOR_THRESHOLD_MS
    ? trailing
    : undefined;
}

function findTrailingReplayCompactionCluster(
  timeline: CompactionBootstrapTimelineEntry[],
): SessionTimelineContextCompactionEntry[] {
  const cluster: SessionTimelineContextCompactionEntry[] = [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (
      entry?.kind !== "context_compaction" ||
      entry.phase !== "completed" ||
      !entry.summaryText?.trim()
    ) {
      break;
    }
    cluster.unshift(entry);
  }
  if (!cluster.length) {
    return [];
  }
  const previousContent = findLastNonTranscriptEntry(
    timeline.slice(0, timeline.length - cluster.length),
  );
  if (!previousContent) {
    return [];
  }
  const clusterTime = Date.parse(cluster[0]!.timestamp);
  const previousTime = Date.parse(previousContent.timestamp);
  if (!Number.isFinite(clusterTime) || !Number.isFinite(previousTime)) {
    return [];
  }
  return clusterTime - previousTime >= TRAILING_COMPACTION_REANCHOR_THRESHOLD_MS
    ? cluster
    : [];
}

function normalizeTrailingCompactionCluster(input: {
  entries: SessionTimelineContextCompactionEntry[];
  anchorTimestamp: string;
}) {
  const anchorTime = Date.parse(input.anchorTimestamp);
  if (!Number.isFinite(anchorTime)) {
    return input.entries;
  }
  const clusterStart = anchorTime - input.entries.length;
  return input.entries.map((entry, index) => {
    const clampedTimestamp = new Date(clusterStart + index).toISOString();
    return {
      ...entry,
      timestamp: clampedTimestamp,
      updatedAt: clampedTimestamp,
    };
  });
}

function findLastNonTranscriptEntry(entries: CompactionBootstrapTimelineEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && !isLegacyTranscriptEntry(entry)) {
      return entry;
    }
  }
  return undefined;
}

function findFirstNonTranscriptEntry(entries: SessionTimelineEntry[]) {
  for (const entry of entries) {
    if (!isCanonicalTranscriptPrefixEntry(entry)) {
      return entry;
    }
  }
  return undefined;
}

function findResumedMessageAfterIndex(messages: AgentMessage[], index: number) {
  for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
    const message = messages[cursor];
    if (!message || isCompactionMarkerMessage(message)) {
      continue;
    }
    if (typeof message.sequence === "number") {
      return message;
    }
  }
  for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
    const message = messages[cursor];
    if (message && !isCompactionMarkerMessage(message)) {
      return message;
    }
  }
  return undefined;
}

function findFirstReplayContentMessage(messages: AgentMessage[]) {
  for (const message of messages) {
    if (!isCompactionMarkerMessage(message)) {
      return message;
    }
  }
  return undefined;
}

function findLastMatchingMessageIndex(
  messages: AgentMessage[],
  predicate: (message: AgentMessage) => boolean,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && predicate(message)) {
      return index;
    }
  }
  return -1;
}

function findLastMatchingMessageBeforeIndex(
  messages: AgentMessage[],
  beforeIndex: number,
  predicate: (message: AgentMessage) => boolean,
) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && predicate(message)) {
      return message;
    }
  }
  return undefined;
}

function shouldClampCompactionTimestamp(
  compactionTimestamp: string,
  anchorTimestamp: string,
) {
  const compactionTime = Date.parse(compactionTimestamp);
  const anchorTime = Date.parse(anchorTimestamp);
  if (!Number.isFinite(compactionTime) || !Number.isFinite(anchorTime)) {
    return false;
  }
  return compactionTime >= anchorTime;
}

function isCompactionMarkerMessage(message: AgentMessage) {
  return looksLikeContinuationSummary(message.text) ||
    looksLikeCompactionStartedMessage(message.text) ||
    looksLikeCompactionCompletedMessage(message.text);
}

function isLegacyTranscriptEntry(entry: CompactionBootstrapTimelineEntry) {
  return entry.kind === "context_compaction" ||
    entry.kind === "history_gap" ||
    entry.kind === "session_resumed";
}

function isCanonicalTranscriptPrefixEntry(entry: SessionTimelineEntry) {
  return entry.kind === "context_compaction" || entry.kind === "history_gap";
}

type TimelineAnchorEntry = Extract<
  SessionTimelineEntry,
  { kind: "assistant_message" | "user_message" | "system_message" }
>;

function isTimelineAnchorEntry(
  entry: CompactionBootstrapTimelineEntry,
): entry is TimelineAnchorEntry {
  return entry.kind === "assistant_message" ||
    entry.kind === "user_message" ||
    entry.kind === "system_message";
}

function resolveTimelineAnchorId(entry: TimelineAnchorEntry) {
  return entry.id;
}

function resolveTimelineAnchorRole(entry: TimelineAnchorEntry) {
  return entry.kind === "assistant_message" ? "assistant" : entry.message.role;
}

function resolveTimelineAnchorText(entry: TimelineAnchorEntry) {
  if (entry.kind === "assistant_message") {
    return entry.chunks
      .filter((chunk) => chunk.kind === "content")
      .map((chunk) => chunk.text)
      .join("");
  }
  return entry.message.text;
}

function resolveTimelineAnchorTimestamp(entry: TimelineAnchorEntry) {
  if (entry.kind === "assistant_message") {
    return entry.chunks.find((chunk) => chunk.kind === "content" && chunk.text.trim())?.timestamp ??
      entry.timestamp;
  }
  return entry.message.timestamp;
}

function resolveTimelineAnchorSequence(entry: TimelineAnchorEntry) {
  if (entry.kind === "assistant_message") {
    return entry.sequence ??
      entry.chunks.find((chunk) => typeof chunk.sequence === "number")?.sequence;
  }
  return entry.message.sequence ?? entry.sequence;
}

function toAnchorMessage(entry: TimelineAnchorEntry): AgentMessage {
  if (entry.kind === "assistant_message") {
    return {
      id: entry.id,
      role: "assistant",
      text: resolveTimelineAnchorText(entry),
      timestamp: resolveTimelineAnchorTimestamp(entry),
      ...(typeof resolveTimelineAnchorSequence(entry) === "number"
        ? { sequence: resolveTimelineAnchorSequence(entry) }
        : {}),
    };
  }
  return entry.message;
}

function normalizeAnchorText(text: string | undefined) {
  return text?.trim() ?? "";
}

function resolveLegacyResumeAnchorId(resumeId: string | undefined) {
  const parts = resumeId?.split(":") ?? [];
  return parts.length >= 3 ? parts.slice(2).join(":") : "";
}

function sameTimelineEntryOrder(
  left: CompactionBootstrapTimelineEntry[],
  right: SessionTimelineEntry[],
) {
  return left.length === right.length &&
    left.every((entry, index) =>
      entry.id === right[index]?.id &&
      entry.kind === right[index]?.kind &&
      entry.timestamp === right[index]?.timestamp
    );
}
