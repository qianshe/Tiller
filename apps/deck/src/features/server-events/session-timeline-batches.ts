import type { SessionTimelineBatch, SessionTimelineEntry } from "@tiller/shared";

export type AppliedSessionTimelineState = {
  entries: SessionTimelineEntry[];
  latestDeliverySequence: number;
  reloadRequired: boolean;
};

export type SessionTimelineIndexCache = {
  entries: SessionTimelineEntry[];
  indexById: Map<string, number>;
};

export function createSessionTimelineIndexCache(
  entries: SessionTimelineEntry[],
): SessionTimelineIndexCache {
  return {
    entries,
    indexById: new Map(entries.map((entry, index) => [entry.id, index])),
  };
}

export function createEmptyAppliedTimelineState(): AppliedSessionTimelineState {
  return { entries: [], latestDeliverySequence: 0, reloadRequired: false };
}

export function applySessionTimelineBatch(
  currentState: AppliedSessionTimelineState,
  batch: SessionTimelineBatch,
  cache?: SessionTimelineIndexCache,
): AppliedSessionTimelineState {
  if (batch.replace) {
    if (cache) {
      cache.entries = batch.entries;
      cache.indexById = new Map(batch.entries.map((entry, index) => [entry.id, index]));
    }
    return {
      entries: batch.entries,
      latestDeliverySequence: batch.deliverySequence,
      reloadRequired: false,
    };
  }
  if (batch.deliverySequence <= currentState.latestDeliverySequence) {
    return currentState;
  }

  if (
    batch.deliverySequence > currentState.latestDeliverySequence + 1 &&
    !batch.replace &&
    currentState.latestDeliverySequence > 0
  ) {
    return {
      ...currentState,
      latestDeliverySequence: batch.deliverySequence,
      reloadRequired: true,
    };
  }

  const activeCache = cache?.entries === currentState.entries
    ? cache
    : createSessionTimelineIndexCache(currentState.entries);
  const nextEntries = [...currentState.entries];
  const indexById = activeCache.indexById;
  for (const entry of batch.entries) {
    const existingIndex = indexById.get(entry.id);
    if (existingIndex === undefined) {
      indexById.set(entry.id, nextEntries.length);
      nextEntries.push(entry);
      continue;
    }
    nextEntries[existingIndex] = entry;
  }
  if (cache) {
    cache.entries = nextEntries;
    cache.indexById = indexById;
  }
  return {
    entries: nextEntries,
    latestDeliverySequence: batch.deliverySequence,
    reloadRequired: false,
  };
}
