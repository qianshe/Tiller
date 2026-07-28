import { resolveAdapterCompactionDetailsVisibility } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../handlers/context";
import type {
  SessionCompactionPhase,
  SessionCompactionSource,
  SessionTimelineContextCompactionEntry,
  SessionTimelineEntry,
  SessionSummary,
} from "@tiller/shared";

const MAX_COMPACTION_LIFECYCLE_GAP_MS = 5 * 60 * 1000;

export function buildSessionCompactionEntry(args: {
  sessionId: string;
  timestamp: string;
  context: HelmHandlerContext;
  phase?: SessionCompactionPhase;
  source?: SessionCompactionSource;
  summaryText?: string;
  summaryMessageId?: string;
  idSuffix?: string;
}): SessionTimelineContextCompactionEntry {
  return buildSessionCompactionEntryFromProvider({
    sessionId: args.sessionId,
    timestamp: args.timestamp,
    providerId: contextProviderId(args.sessionId, args.context),
    phase: args.phase,
    source: args.source,
    summaryText: args.summaryText,
    summaryMessageId: args.summaryMessageId,
    idSuffix: args.idSuffix,
  });
}

export function buildSessionCompactionEntryFromProvider(args: {
  sessionId: string;
  timestamp: string;
  providerId?: string;
  phase?: SessionCompactionPhase;
  source?: SessionCompactionSource;
  summaryText?: string;
  summaryMessageId?: string;
  idSuffix?: string;
}): SessionTimelineContextCompactionEntry {
  const summaryText = args.summaryText?.trim() || undefined;
  const idSuffix = args.summaryMessageId || args.idSuffix || `compaction:${args.timestamp}`;
  return {
    kind: "context_compaction",
    id: `compaction:${args.sessionId}:${idSuffix}`,
    phase: args.phase ?? "completed",
    source: args.source ?? "provider",
    summaryMessageId: args.summaryMessageId,
    summaryText,
    detailsVisibility: resolveCompactionDetailsVisibility(args.providerId, summaryText),
    timestamp: args.timestamp,
    updatedAt: args.timestamp,
    replayCompleteness: "compacted",
  };
}

export function upsertSessionCompactionEntry(
  entries: SessionTimelineEntry[],
  incoming: SessionTimelineContextCompactionEntry,
): SessionTimelineContextCompactionEntry {
  const sameIdIndex = entries.findIndex((entry) => entry.id === incoming.id);
  if (sameIdIndex !== -1) {
    const current = entries[sameIdIndex];
    if (current?.kind === "context_compaction") {
      const merged = mergeCompactionEntry(current, incoming);
      entries[sameIdIndex] = merged;
      return merged;
    }
    entries[sameIdIndex] = incoming;
    return incoming;
  }

  const identityMergeIndex = findCompactionIdentityMergeIndex(entries, incoming);
  if (identityMergeIndex !== -1) {
    const current = entries[identityMergeIndex];
    if (current?.kind === "context_compaction") {
      const merged = mergeCompactionEntry(current, incoming);
      entries[identityMergeIndex] = merged;
      return merged;
    }
  }

  const delayedSummaryMergeIndex = findDelayedSummaryMergeIndex(entries, incoming);
  if (delayedSummaryMergeIndex !== -1) {
    const current = entries[delayedSummaryMergeIndex];
    if (current?.kind === "context_compaction") {
      const merged = mergeCompactionEntry(current, incoming);
      entries[delayedSummaryMergeIndex] = merged;
      return merged;
    }
  }

  const lifecycleMergeIndex = findCompactionLifecycleMergeIndex(entries, incoming);
  if (lifecycleMergeIndex !== -1) {
    const current = entries[lifecycleMergeIndex];
    if (current?.kind === "context_compaction") {
      const merged = mergeCompactionEntry(current, incoming);
      entries[lifecycleMergeIndex] = merged;
      return merged;
    }
  }

  entries.push(incoming);
  return incoming;
}

function findCompactionIdentityMergeIndex(
  entries: SessionTimelineEntry[],
  incoming: SessionTimelineContextCompactionEntry,
) {
  const summaryMessageId = incoming.summaryMessageId?.trim();
  if (!summaryMessageId) {
    return -1;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry?.kind === "context_compaction" &&
      entry.summaryMessageId?.trim() === summaryMessageId
    ) {
      return index;
    }
  }
  return -1;
}

function contextProviderId(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions?.get?.(sessionId);
  const storedSessions = context.sessionStore?.list?.() ?? [];
  return (
    record?.agent?.id ??
    record?.summary?.agentId ??
    storedSessions.find((item: SessionSummary) => item.id === sessionId)?.agentId
  );
}

function resolveCompactionDetailsVisibility(
  providerId: string | undefined,
  summaryText: string | undefined,
): SessionTimelineContextCompactionEntry["detailsVisibility"] {
  const providerVisibility = resolveAdapterCompactionDetailsVisibility(providerId);
  if (providerVisibility) {
    return providerVisibility;
  }
  if (summaryText) {
    return "expandable";
  }
  return undefined;
}

function findCompactionLifecycleMergeIndex(
  entries: SessionTimelineEntry[],
  incoming: SessionTimelineContextCompactionEntry,
) {
  if (incoming.phase !== "completed") {
    return -1;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const current = entries[index];
    if (current?.kind === "user_message") {
      return -1;
    }
    if (current?.kind !== "context_compaction" || current.phase !== "started") {
      continue;
    }
    if (isCompactionLifecycleMergeCandidate(current, incoming)) {
      return index;
    }
  }
  return -1;
}

function findDelayedSummaryMergeIndex(
  entries: SessionTimelineEntry[],
  incoming: SessionTimelineContextCompactionEntry,
) {
  if (incoming.phase !== "completed") {
    return -1;
  }
  const incomingHasSummary = Boolean(incoming.summaryText?.trim());
  if (!incomingHasSummary && !incoming.summaryMessageId?.trim()) {
    return -1;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const current = entries[index];
    if (current?.kind === "user_message") {
      return -1;
    }
    if (current?.kind !== "context_compaction") {
      continue;
    }
    const currentHasSummary = Boolean(current.summaryText?.trim());
    if (
      current.phase === "completed" &&
      currentHasSummary !== incomingHasSummary &&
      current.source === incoming.source &&
      isCompactionLifecycleMergeCandidate(current, incoming, true)
    ) {
      return index;
    }
    return -1;
  }
  return -1;
}

function isCompactionLifecycleMergeCandidate(
  current: SessionTimelineContextCompactionEntry,
  incoming: SessionTimelineContextCompactionEntry,
  allowReverseTime = false,
) {
  const currentTime = Date.parse(current.timestamp);
  const incomingTime = Date.parse(incoming.timestamp);
  if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime)) {
    return false;
  }
  const deltaMs = incomingTime - currentTime;
  const gapMs = allowReverseTime ? Math.abs(deltaMs) : deltaMs;
  return gapMs >= 0 && gapMs <= MAX_COMPACTION_LIFECYCLE_GAP_MS;
}

function mergeCompactionEntry(
  current: SessionTimelineContextCompactionEntry,
  incoming: SessionTimelineContextCompactionEntry,
): SessionTimelineContextCompactionEntry {
  const preserveCurrentProviderDetails =
    current.source === "provider" && incoming.source === "heuristic";
  const currentHasSummary = Boolean(current.summaryText?.trim());
  const incomingHasSummary = Boolean(incoming.summaryText?.trim());
  const preserveCurrentSummaryIdentity = preserveCurrentProviderDetails && currentHasSummary;
  return {
    ...current,
    ...incoming,
    id: current.id,
    timestamp: current.timestamp,
    updatedAt: incoming.updatedAt ?? incoming.timestamp ?? current.updatedAt,
    phase: incoming.phase ?? current.phase,
    source:
      current.source === "provider" || incoming.source === "provider"
        ? "provider"
        : (incoming.source ?? current.source),
    summaryMessageId: preserveCurrentSummaryIdentity
      ? (current.summaryMessageId ?? incoming.summaryMessageId)
      : incomingHasSummary
        ? (incoming.summaryMessageId ?? current.summaryMessageId)
        : (current.summaryMessageId ?? incoming.summaryMessageId),
    summaryText: preserveCurrentProviderDetails
      ? (current.summaryText ?? incoming.summaryText)
      : incomingHasSummary
        ? (incoming.summaryText ?? current.summaryText)
        : (current.summaryText ?? incoming.summaryText),
    detailsVisibility: preserveCurrentProviderDetails
      ? (current.detailsVisibility ?? incoming.detailsVisibility)
      : incomingHasSummary
        ? (incoming.detailsVisibility ?? current.detailsVisibility)
        : (current.detailsVisibility ?? incoming.detailsVisibility),
  };
}
