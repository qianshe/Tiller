import type { SessionTimelineBatch, SessionTimelineEntry } from "@tiller/shared";
import { sortSessionTimelineEntries } from "@tiller/shared";

export function buildReplaceBatch(
  entries: SessionTimelineEntry[],
  deliverySequence: number,
): SessionTimelineBatch {
  const sorted = sortSessionTimelineEntries(entries);
  const lastSequence = resolveLastSequence(sorted);
  return {
    replace: true,
    deliverySequence,
    lastSequence,
    entries: sorted,
  };
}

function resolveLastSequence(entries: SessionTimelineEntry[]) {
  let max = 0;
  for (const entry of entries) {
    if ("sequence" in entry && typeof entry.sequence === "number" && entry.sequence > max) {
      max = entry.sequence;
    }
  }
  return max;
}
