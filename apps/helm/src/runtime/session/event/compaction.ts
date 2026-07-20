import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  SessionTimelineContextCompactionEntry,
  SessionTimelineEntry,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import { startNextAssistantResponseSegment } from "../../segment-state";
import {
  assertCanonicalTimelinePipeline,
  prepareRuntimeSessionUpdate,
  routeCanonicalTimelineEvent,
} from "./canonical";
import { flushLiveAssistantMessage } from "./message-stream";
import { hydrateRuntimeCompactionEventSummary } from "../../../sessions/compaction-summary";

export function hasPendingTimelineCompaction(
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessionTimelineStore">,
): context is Pick<HelmHandlerContext, "sessionTimelineStore"> & {
  sessionTimelineStore: NonNullable<HelmHandlerContext["sessionTimelineStore"]>;
} {
  return Boolean(findPendingTimelineCompactionEntry(sessionId, context));
}

function findPendingTimelineCompactionEntry(
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessionTimelineStore">,
): SessionTimelineContextCompactionEntry | undefined {
  const entries = context.sessionTimelineStore?.list?.(sessionId) as SessionTimelineEntry[] | undefined;
  if (!entries?.length) {
    return undefined;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === "user_message") {
      return undefined;
    }
    if (entry?.kind === "context_compaction" && entry.phase === "started") {
      return entry;
    }
  }
  return undefined;
}

function shouldInferCompactionCompletionFromEvent(event: SessionRuntimeEvent) {
  switch (event.type) {
    case "message":
      return event.message.role === "assistant";
    case "tool-call":
    case "command-output":
    case "permission-request":
      return true;
    default:
      return false;
  }
}

function resolveCompactionCompletionTimestamp(
  event: SessionRuntimeEvent,
  pending: SessionTimelineContextCompactionEntry,
) {
  switch (event.type) {
    case "message":
      return event.message.timestamp;
    case "tool-call":
      return event.toolCall.timestamp;
    case "command-output":
      return event.chunk.timestamp;
    default:
      return pending.updatedAt;
  }
}

export function inferPendingCompactionCompletion(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
) {
  if (!shouldInferCompactionCompletionFromEvent(event)) {
    return false;
  }
  const pending = findPendingTimelineCompactionEntry(sessionId, context);
  if (!pending) {
    return false;
  }
  assertCanonicalTimelinePipeline(context);
  const completionEvent = {
    type: "compaction",
    phase: "completed",
    source: pending.source,
    timestamp: resolveCompactionCompletionTimestamp(event, pending),
  } as const;
  const hydratedEvent = hydrateRuntimeCompactionEventSummary(sessionId, completionEvent, context);
  const prepared = prepareRuntimeSessionUpdate(sessionId, hydratedEvent, context);
  routeCanonicalTimelineEvent(
    sessionId,
    hydratedEvent,
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
  return true;
}

export function handleRuntimeCompactionEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "compaction" }>,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  flushLiveAssistantMessage(sessionId, context);
  const shouldStartNewAssistantTurn = !hasPendingTimelineCompaction(sessionId, context);
  const hydratedEvent = hydrateRuntimeCompactionEventSummary(sessionId, event, context);
  const prepared = prepareRuntimeSessionUpdate(sessionId, hydratedEvent, context);
  if (shouldStartNewAssistantTurn) {
    startNextAssistantResponseSegment(sessionId);
  }
  routeCanonicalTimelineEvent(
    sessionId,
    hydratedEvent,
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
}
