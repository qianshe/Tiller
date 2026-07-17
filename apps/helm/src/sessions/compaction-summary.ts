import {
  resolveAdapterCompactionDetailsVisibility,
  resolveAdapterCompactionSummary,
  type AcpCompactionSummary,
  type SessionRuntimeEvent,
} from "@tiller/acp-runtime";
import type { SessionSummary, SessionTimelineEntry } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";

type CompactionSummaryResolver = typeof resolveAdapterCompactionSummary;

export function hydrateRuntimeCompactionEventSummary(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "compaction" }>,
  context: HelmHandlerContext,
  resolveSummary: CompactionSummaryResolver = resolveAdapterCompactionSummary,
) {
  if (event.phase !== "completed" || (event.source !== "provider" && event.summaryText?.trim())) {
    return event;
  }
  const resolved = resolveSessionCompactionSummary(
    sessionId,
    event.timestamp,
    context,
    resolveSummary,
  );
  const summaryText = event.summaryText?.trim() || resolved?.summaryText;
  return summaryText
    ? {
        ...event,
        summaryText,
        messageId: resolved?.summaryMessageId ?? event.messageId,
      }
    : event;
}

export function hydrateSessionCompactionEntries(
  sessionId: string,
  entries: SessionTimelineEntry[],
  context: HelmHandlerContext,
  resolveSummary: CompactionSummaryResolver = resolveAdapterCompactionSummary,
) {
  const hydratedEntries: SessionTimelineEntry[] = entries.map((entry) => {
    if (
      entry.kind !== "context_compaction" ||
      entry.phase !== "completed" ||
      (entry.source !== "provider" && entry.summaryText?.trim())
    ) {
      return entry;
    }
    const resolved = resolveSessionCompactionSummary(
      sessionId,
      entry.updatedAt,
      context,
      resolveSummary,
    );
    if (!resolved?.summaryText) {
      return entry;
    }
    return {
      ...entry,
      summaryText: entry.summaryText?.trim() || resolved.summaryText,
      summaryMessageId: resolved.summaryMessageId ?? entry.summaryMessageId,
      detailsVisibility:
        resolveAdapterCompactionDetailsVisibility(resolved.providerId) ?? "expandable",
    };
  });
  return mergeAdjacentCompactionSummaries(hydratedEntries);
}

function mergeAdjacentCompactionSummaries(entries: SessionTimelineEntry[]): SessionTimelineEntry[] {
  const mergedEntries: SessionTimelineEntry[] = [];
  for (const entry of entries) {
    const previous = mergedEntries.at(-1);
    if (
      previous?.kind === "context_compaction" &&
      entry.kind === "context_compaction" &&
      previous.phase === "completed" &&
      entry.phase === "completed" &&
      previous.source === "provider" &&
      entry.source === "heuristic" &&
      hasSameCompactionIdentity(previous.summaryMessageId, entry.summaryMessageId)
    ) {
      mergedEntries[mergedEntries.length - 1] = {
        ...previous,
        updatedAt: entry.updatedAt,
        summaryMessageId: entry.summaryMessageId ?? previous.summaryMessageId,
        summaryText: previous.summaryText ?? entry.summaryText,
        detailsVisibility: previous.detailsVisibility ?? entry.detailsVisibility,
      };
      continue;
    }
    mergedEntries.push(entry);
  }
  return mergedEntries;
}

function hasSameCompactionIdentity(
  providerSummaryMessageId: string | undefined,
  heuristicSummaryMessageId: string | undefined,
) {
  return Boolean(
    providerSummaryMessageId &&
    heuristicSummaryMessageId &&
    providerSummaryMessageId === heuristicSummaryMessageId,
  );
}

function resolveSessionCompactionSummary(
  sessionId: string,
  completedAt: string,
  context: HelmHandlerContext,
  resolveSummary: CompactionSummaryResolver,
) {
  const liveRecord = context.sessions?.get?.(sessionId);
  const storedSummary = context.sessionStore?.get?.(sessionId) as SessionSummary | undefined;
  const sessionSummary = liveRecord?.summary ?? storedSummary;
  const runtimeDescriptor = context.sessionRuntimeStore?.get?.(sessionId);
  const providerId =
    liveRecord?.agent?.id ?? sessionSummary?.agentId ?? runtimeDescriptor?.providerId;
  const cwd = liveRecord?.worktree?.path ?? sessionSummary?.cwd;
  const runtimeSessionId =
    liveRecord?.runtime?.runtimeSessionId ??
    sessionSummary?.runtimeSessionId ??
    runtimeDescriptor?.runtimeSessionId;
  if (!cwd || !runtimeSessionId) {
    return undefined;
  }
  const resolved = resolveSummary(providerId, {
    cwd,
    runtimeSessionId,
    completedAt,
  });
  const compactionSummary = normalizeCompactionSummary(resolved);
  return compactionSummary ? { providerId, ...compactionSummary } : undefined;
}

function normalizeCompactionSummary(
  resolved: string | AcpCompactionSummary | undefined,
): AcpCompactionSummary | undefined {
  if (typeof resolved === "string") {
    const summaryText = resolved.trim();
    return summaryText ? { summaryText } : undefined;
  }
  if (!resolved) {
    return undefined;
  }
  const summaryText = resolved.summaryText.trim();
  if (!summaryText) {
    return undefined;
  }
  return {
    summaryText,
    summaryMessageId: resolved.summaryMessageId?.trim() || undefined,
  };
}
