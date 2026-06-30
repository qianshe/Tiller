import { resolveAdapterCompactionDetailsVisibility } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../handlers/context";
import type {
  SessionTimelineContextCompactionEntry,
  SessionTimelineEntry,
  SessionSummary,
} from "@tiller/shared";

export function buildSessionCompactionEntry(args: {
  sessionId: string;
  timestamp: string;
  context: HelmHandlerContext;
  summaryText?: string;
  summaryMessageId?: string;
  idSuffix?: string;
}): SessionTimelineContextCompactionEntry {
  return buildSessionCompactionEntryFromProvider({
    sessionId: args.sessionId,
    timestamp: args.timestamp,
    providerId: contextProviderId(args.sessionId, args.context),
    summaryText: args.summaryText,
    summaryMessageId: args.summaryMessageId,
    idSuffix: args.idSuffix,
  });
}

export function buildSessionCompactionEntryFromProvider(args: {
  sessionId: string;
  timestamp: string;
  providerId?: string;
  summaryText?: string;
  summaryMessageId?: string;
  idSuffix?: string;
}): SessionTimelineContextCompactionEntry {
  const summaryText = args.summaryText?.trim() || undefined;
  const idSuffix = args.summaryMessageId || args.idSuffix || `compaction:${args.timestamp}`;
  return {
    kind: "context_compaction",
    id: `compaction:${args.sessionId}:${idSuffix}`,
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

  const mergeIndex = findCompactionSummaryMergeIndex(entries, incoming);
  if (mergeIndex !== -1) {
    const current = entries[mergeIndex];
    if (current?.kind === "context_compaction") {
      const merged = mergeCompactionEntry(current, incoming);
      entries[mergeIndex] = merged;
      return merged;
    }
  }

  entries.push(incoming);
  return incoming;
}

function contextProviderId(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions?.get?.(sessionId);
  const storedSessions = context.sessionStore?.list?.() ?? [];
  return record?.agent?.id ??
    record?.summary?.agentId ??
    storedSessions.find((item: SessionSummary) => item.id === sessionId)?.agentId;
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

function findCompactionSummaryMergeIndex(
  entries: SessionTimelineEntry[],
  incoming: SessionTimelineContextCompactionEntry,
) {
  if (!incoming.summaryText) {
    return -1;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const current = entries[index];
    if (current?.kind !== "context_compaction" || current.summaryText?.trim()) {
      continue;
    }
    if (isCompactionSummaryMergeCandidate(current, incoming)) {
      return index;
    }
  }
  return -1;
}

function isCompactionSummaryMergeCandidate(
  current: SessionTimelineContextCompactionEntry,
  incoming: SessionTimelineContextCompactionEntry,
) {
  const currentTime = Date.parse(current.timestamp);
  const incomingTime = Date.parse(incoming.timestamp);
  if (!Number.isFinite(currentTime) || !Number.isFinite(incomingTime)) {
    return true;
  }
  const deltaMs = incomingTime - currentTime;
  return deltaMs >= 0 && deltaMs <= 5 * 60 * 1000;
}

function mergeCompactionEntry(
  current: SessionTimelineContextCompactionEntry,
  incoming: SessionTimelineContextCompactionEntry,
): SessionTimelineContextCompactionEntry {
  return {
    ...current,
    ...incoming,
    id: current.id,
    timestamp: current.timestamp,
    updatedAt: incoming.updatedAt ?? incoming.timestamp ?? current.updatedAt,
    summaryMessageId: incoming.summaryMessageId ?? current.summaryMessageId,
    summaryText: incoming.summaryText ?? current.summaryText,
    detailsVisibility: incoming.detailsVisibility ?? current.detailsVisibility,
  };
}
