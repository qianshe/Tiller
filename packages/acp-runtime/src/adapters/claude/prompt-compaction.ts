import type { SessionRuntimeEvent } from "../../runtime-types";
import type { AcpPromptObservationContext } from "../types";
import {
  readClaudeTranscriptCompactionsFromDisk,
  type ClaudeTranscriptCompaction,
} from "./transcript/history";

type ClaudePromptCompactionReader = (
  context: AcpPromptObservationContext,
) => readonly ClaudeTranscriptCompaction[];

export function createClaudePromptCompactionObserver(
  readCompactions: ClaudePromptCompactionReader = readClaudeTranscriptCompactionsFromDisk,
) {
  const fingerprintsBySession = new Map<string, Set<string>>();
  const begin = (context: AcpPromptObservationContext) => {
    if (fingerprintsBySession.has(context.runtimeSessionId)) {
      return;
    }
    const compactions = readCompactionsSafely(readCompactions, context);
    fingerprintsBySession.set(
      context.runtimeSessionId,
      new Set(
        compactions
          .map(fingerprintCompaction)
          .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
      ),
    );
  };

  return {
    begin,
    poll(context: AcpPromptObservationContext): SessionRuntimeEvent[] {
      let fingerprints = fingerprintsBySession.get(context.runtimeSessionId);
      if (!fingerprints) {
        begin(context);
        fingerprints = fingerprintsBySession.get(context.runtimeSessionId);
        return [];
      }
      if (!fingerprints) {
        return [];
      }
      const events: SessionRuntimeEvent[] = [];
      for (const compaction of readCompactionsSafely(readCompactions, context)) {
        const fingerprint = fingerprintCompaction(compaction);
        if (!fingerprint || fingerprints.has(fingerprint)) {
          continue;
        }
        fingerprints.add(fingerprint);
        events.push(toCompactionEvent(compaction));
      }
      return events;
    },
    dispose(sessionId: string) {
      fingerprintsBySession.delete(sessionId);
    },
  };
}

function toCompactionEvent(compaction: ClaudeTranscriptCompaction): SessionRuntimeEvent {
  return {
    type: "compaction",
    phase: "completed",
    source: "provider",
    messageId: compaction.summaryMessageId,
    summaryText: compaction.summaryText,
    timestamp: compaction.timestamp,
  };
}

function readCompactionsSafely(
  readCompactions: ClaudePromptCompactionReader,
  context: AcpPromptObservationContext,
) {
  try {
    return readCompactions(context);
  } catch {
    return [];
  }
}

function fingerprintCompaction(
  compaction: ClaudeTranscriptCompaction | undefined,
) {
  if (!compaction) {
    return undefined;
  }
  return compaction.summaryMessageId ?? `${compaction.timestamp}:${compaction.summaryText}`;
}
