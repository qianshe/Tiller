import {
  shouldStartNewAssistantOccurrenceAfterBoundary,
  type AgentToolCall,
} from "@tiller/shared";
import { createMessageSegmentIdAllocator } from "./message-segment-id";
import {
  isRuntimeGeneratedMessageId,
  mergeAssistantStreamText,
  shouldStartNewRuntimeAssistantSegment,
} from "./session/event/normalizer";

const messageSegmentIds = createMessageSegmentIdAllocator();
const activeAssistantRuntimeMessageBySession = new Map<
  string,
  { sourceId: string; segmentId: string; text: string }
>();
const activeAssistantRuntimeThinkingBySession = new Map<
  string,
  { sourceId: string; segmentId: string; text: string; timestamp: string; sequence?: number }
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
  activeAssistantRuntimeThinkingBySession.delete(sessionId);
  pendingAssistantBoundaryBySession.delete(sessionId);
}

export function startNextAssistantResponseSegment(sessionId: string) {
  if (
    !activeAssistantRuntimeMessageBySession.has(sessionId) &&
    !activeAssistantRuntimeThinkingBySession.has(sessionId)
  ) {
    return;
  }
  messageSegmentIds.startAssistantTurn(sessionId);
  activeAssistantRuntimeMessageBySession.delete(sessionId);
  activeAssistantRuntimeThinkingBySession.delete(sessionId);
  pendingAssistantBoundaryBySession.delete(sessionId);
}

export function normalizeRuntimeAssistantMessageId(
  sessionId: string,
  message: { id: string; text: string },
) {
  const active = activeAssistantRuntimeMessageBySession.get(sessionId);
  const boundaryPending = pendingAssistantBoundaryBySession.delete(sessionId);
  const startsNewAfterBoundary = shouldStartNewAssistantOccurrenceAfterBoundary(
    active?.text,
    message.text,
    boundaryPending,
  );
  if (
    active &&
    !startsNewAfterBoundary &&
    !shouldStartNewRuntimeAssistantSegment(active.text, message.text)
  ) {
    activeAssistantRuntimeMessageBySession.set(sessionId, {
      sourceId: message.id,
      segmentId: active.segmentId,
      text: mergeAssistantStreamText(active.text, message.text),
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
  });
  return segmentId;
}

export function normalizeRuntimeThinkingToolCall(
  sessionId: string,
  toolCall: AgentToolCall,
): AgentToolCall {
  const text = toolCall.output ?? "";
  const active = activeAssistantRuntimeThinkingBySession.get(sessionId);
  if (active && !shouldStartNewRuntimeAssistantSegment(active.text, text)) {
    activeAssistantRuntimeThinkingBySession.set(sessionId, {
      ...active,
      sourceId: toolCall.id,
      text: mergeAssistantStreamText(active.text, text),
    });
    return {
      ...toolCall,
      id: active.segmentId,
      commandId: active.segmentId,
      sequence: active.sequence ?? toolCall.sequence,
    };
  }

  if (active) {
    messageSegmentIds.bumpToolBoundary(sessionId);
  }
  const sourceId = toolCall.id.replace(/:thinking$/u, "");
  const segmentId = `${messageSegmentIds.nextAssistantSegmentId(sessionId, {
    text,
    providerMessageId: isRuntimeGeneratedMessageId(sourceId) ? null : sourceId,
  })}:thinking`;
  activeAssistantRuntimeThinkingBySession.set(sessionId, {
    sourceId: toolCall.id,
    segmentId,
    text,
    timestamp: toolCall.timestamp,
    sequence: toolCall.sequence,
  });
  return {
    ...toolCall,
    id: segmentId,
    commandId: segmentId,
  };
}

export function clearActiveRuntimeThinking(sessionId: string) {
  activeAssistantRuntimeThinkingBySession.delete(sessionId);
}

export function removeRuntimeSegmentState(sessionId: string) {
  messageSegmentIds.removeSession(sessionId);
  activeAssistantRuntimeMessageBySession.delete(sessionId);
  activeAssistantRuntimeThinkingBySession.delete(sessionId);
  pendingAssistantBoundaryBySession.delete(sessionId);
}

export function finalizeActiveRuntimeThinking(
  sessionId: string,
  status: Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled"> = "completed",
): AgentToolCall | undefined {
  const active = activeAssistantRuntimeThinkingBySession.get(sessionId);
  if (!active) {
    return undefined;
  }
  const now = new Date().toISOString();
  activeAssistantRuntimeThinkingBySession.delete(sessionId);
  return {
    id: active.segmentId,
    commandId: active.segmentId,
    kind: "think",
    title: "Thinking",
    status,
    output: active.text,
    timestamp: active.timestamp,
    updatedAt: now,
    sequence: active.sequence,
  };
}
