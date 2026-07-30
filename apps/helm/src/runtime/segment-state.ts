import {
  mergeStreamingText,
  shouldStartNewAssistantOccurrenceAfterBoundary,
  type AgentMessage,
} from "@tiller/shared";
import { createMessageSegmentIdAllocator } from "./message-segment-id";
import {
  isRuntimeGeneratedMessageId,
  shouldStartNewRuntimeAssistantSegment,
} from "./session/event/normalizer";

const messageSegmentIds = createMessageSegmentIdAllocator();
const activeAssistantRuntimeMessageBySession = new Map<
  string,
  {
    sourceId: string;
    segmentId: string;
    text: string;
    contentKind?: AgentMessage["contentKind"];
  }
>();
const pendingAssistantBoundaryBySession = new Set<string>();

export function shouldFlushActiveAssistantSegment(
  sessionId: string,
  incomingMessageId: string,
): boolean {
  const active = activeAssistantRuntimeMessageBySession.get(sessionId);
  if (!active) {
    return false;
  }
  const activeIsProvider = !isRuntimeGeneratedMessageId(active.sourceId);
  const incomingIsProvider = !isRuntimeGeneratedMessageId(incomingMessageId);
  return activeIsProvider && incomingIsProvider && active.sourceId !== incomingMessageId;
}

export function markAssistantStreamBoundary(sessionId: string) {
  if (activeAssistantRuntimeMessageBySession.has(sessionId)) {
    pendingAssistantBoundaryBySession.add(sessionId);
  }
}

export function bumpAssistantStreamSegment(sessionId: string) {
  messageSegmentIds.bumpToolBoundary(sessionId);
  activeAssistantRuntimeMessageBySession.delete(sessionId);
  pendingAssistantBoundaryBySession.delete(sessionId);
}

export function startNextAssistantResponseSegment(sessionId: string) {
  if (!activeAssistantRuntimeMessageBySession.has(sessionId)) {
    return;
  }
  messageSegmentIds.startAssistantTurn(sessionId);
  activeAssistantRuntimeMessageBySession.delete(sessionId);
  pendingAssistantBoundaryBySession.delete(sessionId);
}

export function normalizeRuntimeAssistantMessageId(
  sessionId: string,
  message: Pick<AgentMessage, "id" | "text" | "contentKind" | "streamMode">,
) {
  const active = activeAssistantRuntimeMessageBySession.get(sessionId);
  const boundaryPending = pendingAssistantBoundaryBySession.delete(sessionId);
  const startsNewAfterBoundary = shouldStartNewAssistantOccurrenceAfterBoundary(
    active?.text,
    message.text,
    boundaryPending,
  );
  const changesContentTrack =
    active && (active.contentKind ?? "content") !== (message.contentKind ?? "content");
  if (active && changesContentTrack && !startsNewAfterBoundary) {
    activeAssistantRuntimeMessageBySession.set(sessionId, {
      sourceId: message.id,
      segmentId: active.segmentId,
      text: message.text,
      contentKind: message.contentKind,
    });
    return active.segmentId;
  }
  if (
    active &&
    !startsNewAfterBoundary &&
    !shouldStartNewRuntimeAssistantSegment(active.text, message.text)
  ) {
    activeAssistantRuntimeMessageBySession.set(sessionId, {
      sourceId: message.id,
      segmentId: active.segmentId,
      text: mergeStreamingText(active.text, message.text, message.streamMode ?? "auto") ?? active.text,
      contentKind: message.contentKind,
    });
    return active.segmentId;
  }

  if (active) {
    messageSegmentIds.bumpToolBoundary(sessionId);
  }
  const segmentId = messageSegmentIds.nextAssistantSegmentId(sessionId, {
    text: message.text,
    providerMessageId: isRuntimeGeneratedMessageId(message.id) ? null : message.id,
  });
  activeAssistantRuntimeMessageBySession.set(sessionId, {
    sourceId: message.id,
    segmentId,
    text: message.text,
    contentKind: message.contentKind,
  });
  return segmentId;
}

export function removeRuntimeSegmentState(sessionId: string) {
  messageSegmentIds.removeSession(sessionId);
  activeAssistantRuntimeMessageBySession.delete(sessionId);
  pendingAssistantBoundaryBySession.delete(sessionId);
}
