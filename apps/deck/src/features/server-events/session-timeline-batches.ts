import type { SessionTimelineBatch, SessionTimelineEntry } from "@tiller/shared";
import { sortSessionTimelineEntries } from "@tiller/shared";

export type AppliedSessionTimelineState = {
  entries: SessionTimelineEntry[];
  latestDeliverySequence: number;
  reloadRequired: boolean;
};

export function createEmptyAppliedTimelineState(): AppliedSessionTimelineState {
  return { entries: [], latestDeliverySequence: 0, reloadRequired: false };
}

export function applySessionTimelineBatch(
  currentState: AppliedSessionTimelineState,
  batch: SessionTimelineBatch,
): AppliedSessionTimelineState {
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

  if (batch.replace) {
    return {
      entries: sortSessionTimelineEntries(batch.entries),
      latestDeliverySequence: batch.deliverySequence,
      reloadRequired: false,
    };
  }

  const byId = new Map(currentState.entries.map((entry) => [entry.id, entry]));
  for (const entry of batch.entries) {
    byId.set(entry.id, entry);
  }
  return {
    entries: sortSessionTimelineEntries([...byId.values()]),
    latestDeliverySequence: batch.deliverySequence,
    reloadRequired: false,
  };
}
