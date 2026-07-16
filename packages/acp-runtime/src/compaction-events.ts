import {
  looksLikeCompactionCompletedMessage,
  looksLikeCompactionStartedMessage,
  looksLikeContinuationSummary,
} from "@tiller/shared";
import type { SessionRuntimeEvent } from "./runtime-types";
import { resolveEventTimestamp, resolveMessageId } from "./message-events";
import {
  extractTextContent,
  isMessageChunkUpdateType,
  recordFrom,
  type UnknownRecord,
} from "./session-update";

export function projectCompactionEvent(
  sessionId: string,
  updateType: string | undefined,
  update: UnknownRecord,
  extractedText: string | null,
): Extract<SessionRuntimeEvent, { type: "compaction" }> | null {
  const text = extractedText?.trim() || "";
  const explicitPhase = resolveExplicitCompactionPhase(updateType, update, text);
  if (explicitPhase) {
    return {
      type: "compaction",
      phase: explicitPhase,
      source: "provider",
      timestamp: resolveEventTimestamp(update),
      summaryText: explicitPhase === "completed" ? resolveCompactionSummaryText(update, text) : undefined,
      messageId: explicitPhase === "completed" ? resolveMessageId(sessionId, update) : undefined,
    };
  }
  if (!text || !isMessageChunkUpdateType(updateType) || !looksLikeContinuationSummary(text)) {
    return null;
  }
  return {
    type: "compaction",
    phase: "completed",
    source: "heuristic",
    timestamp: resolveEventTimestamp(update),
    summaryText: text,
    messageId: resolveMessageId(sessionId, update),
  };
}

export function summarizeLifecycleCompactionPhase(text: string): "started" | "completed" | null {
  if (looksLikeCompactionStartedMessage(text)) {
    return "started";
  }
  if (looksLikeCompactionCompletedMessage(text)) {
    return "completed";
  }
  return null;
}

export function isCompactionRelatedUpdateType(updateType: string | undefined): boolean {
  return Boolean(updateType && /(?:^|[_./-])compaction(?:$|[_./-])|^compacting(?:$|[_./-])/iu.test(updateType));
}

function resolveExplicitCompactionPhase(
  updateType: string | undefined,
  update: UnknownRecord,
  text: string,
): "started" | "completed" | null {
  const compaction = recordFrom(update.compaction);
  const candidatePhase = normalizeCompactionPhase(
    compaction.phase ?? update.phase ?? update.compactionPhase ?? update.compaction_phase ?? update.status,
  );
  if (candidatePhase && isCompactionRelatedUpdateType(updateType)) {
    return candidatePhase;
  }
  if (isMessageChunkUpdateType(updateType) && looksLikeCompactionStartedMessage(text)) {
    return "started";
  }
  if (isMessageChunkUpdateType(updateType) && looksLikeCompactionCompletedMessage(text)) {
    return "completed";
  }
  return isCompactionRelatedUpdateType(updateType) ? normalizeCompactionPhase(updateType) : null;
}

function normalizeCompactionPhase(value: unknown): "started" | "completed" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if ([
    "started", "starting", "running", "compacting", "compaction_started", "compaction-started",
  ].includes(normalized)) {
    return "started";
  }
  if ([
    "completed", "complete", "done", "finished", "compaction_completed", "compaction-completed",
  ].includes(normalized)) {
    return "completed";
  }
  return null;
}

function resolveCompactionSummaryText(update: UnknownRecord, text: string): string | undefined {
  const compaction = recordFrom(update.compaction);
  const summary = extractTextContent(
    compaction.summaryText ?? compaction.summary_text ?? compaction.summary ??
      update.summaryText ?? update.summary_text ?? update.summary,
  );
  return summary?.trim() || (looksLikeContinuationSummary(text) ? text : undefined);
}
