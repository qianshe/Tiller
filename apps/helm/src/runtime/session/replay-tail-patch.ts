import type {
  AgentMessage,
  SessionReplayCompleteness,
  SessionTimelineEntry,
  SessionTranscriptStatus,
} from "@tiller/shared";
import { looksLikeContinuationSummary } from "@tiller/shared";

export function applyReplayTailPatch(input: {
  localMessages: AgentMessage[];
  localTimeline: SessionTimelineEntry[];
  replayMessages: AgentMessage[];
  replayTimeline: SessionTimelineEntry[];
  replayCompleteness: SessionReplayCompleteness;
}): {
  mode: "full-replace" | "tail-replace" | "keep-local-with-gap";
  nextMessages: AgentMessage[];
  nextTimeline: SessionTimelineEntry[];
  transcriptStatus: SessionTranscriptStatus;
} {
  if (input.replayCompleteness === "full") {
    return {
      mode: "full-replace",
      nextMessages: input.replayMessages,
      nextTimeline: input.replayTimeline,
      transcriptStatus: {
        source: "acp-load",
        replayCompleteness: "full",
        integrity: "complete",
        runtimeRestoreState: "runtime-restored",
      },
    };
  }

  const boundary = resolveContinuationSummaryBoundary(input.replayMessages);
  if (!boundary) {
    return keepLocalWithGap(input.localMessages, input.localTimeline, input.replayCompleteness);
  }

  const localTimelineAnchorIndex = findTimelineAnchorIndex(input.localTimeline, boundary.resumedMessage);
  const localMessageAnchorIndex = findMessageAnchorIndex(input.localMessages, boundary.resumedMessage);
  const replayMessageAnchorIndex = findMessageAnchorIndex(input.replayMessages, boundary.resumedMessage);
  const replayTimelineAnchorIndex = findTimelineAnchorIndex(input.replayTimeline, boundary.resumedMessage);

  if (
    localTimelineAnchorIndex === -1 ||
    localMessageAnchorIndex === -1 ||
    replayMessageAnchorIndex === -1 ||
    replayTimelineAnchorIndex === -1
  ) {
    return keepLocalWithGap(input.localMessages, input.localTimeline, input.replayCompleteness);
  }

  return {
    mode: "tail-replace",
    nextMessages: [
      ...input.localMessages.slice(0, localMessageAnchorIndex),
      ...input.replayMessages.slice(replayMessageAnchorIndex),
    ],
    nextTimeline: omitContinuationSummaryEntries([
      ...input.localTimeline.slice(0, localTimelineAnchorIndex),
      ...input.replayTimeline.slice(replayTimelineAnchorIndex),
    ]),
    transcriptStatus: {
      source: "mixed",
      replayCompleteness: input.replayCompleteness,
      integrity: "local-prefix-preserved",
      runtimeRestoreState: "runtime-restored",
    },
  };
}

function keepLocalWithGap(
  localMessages: AgentMessage[],
  localTimeline: SessionTimelineEntry[],
  replayCompleteness: SessionReplayCompleteness,
) {
  return {
    mode: "keep-local-with-gap" as const,
    nextMessages: localMessages,
    nextTimeline: appendHistoryGapEntry(localTimeline),
    transcriptStatus: {
      source: "mixed" as const,
      replayCompleteness,
      integrity: "prefix-missing" as const,
      runtimeRestoreState: "runtime-restored" as const,
      warning: "history-gap" as const,
    },
  };
}

function resolveContinuationSummaryBoundary(messages: AgentMessage[]) {
  const markerIndex = messages.findIndex((message) => looksLikeContinuationSummary(message.text));
  if (markerIndex === -1) {
    return undefined;
  }
  for (let index = markerIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message && typeof message.sequence === "number") {
      return {
        summaryMessage: messages[markerIndex]!,
        resumedMessage: message,
      };
    }
  }
  return undefined;
}

function findMessageAnchorIndex(messages: AgentMessage[], anchorMessage: AgentMessage) {
  const idMatches = messages
    .map((message, index) =>
      message.role === anchorMessage.role && message.id === anchorMessage.id ? index : -1)
    .filter((index) => index !== -1);
  if (idMatches.length === 1) {
    return idMatches[0]!;
  }

  if (typeof anchorMessage.sequence === "number") {
    const sequenceMatches = messages
      .map((message, index) =>
        message.role === anchorMessage.role &&
          message.sequence === anchorMessage.sequence
          ? index
          : -1)
      .filter((index) => index !== -1);
    if (sequenceMatches.length === 1) {
      return sequenceMatches[0]!;
    }
  }

  const expectedText = anchorMessage.text.trim();
  if (!expectedText) {
    return -1;
  }
  const textMatches = messages
    .map((message, index) =>
      message.role === anchorMessage.role && message.text.trim() === expectedText
        ? index
        : -1)
    .filter((index) => index !== -1);
  return textMatches.length === 1 ? textMatches[0]! : -1;
}

function findTimelineAnchorIndex(entries: SessionTimelineEntry[], message: AgentMessage) {
  const idMatches = entries
    .map((entry, index) => timelineEntryMatchesId(entry, message.id) ? index : -1)
    .filter((index) => index !== -1);
  if (idMatches.length === 1) {
    return idMatches[0]!;
  }

  if (typeof message.sequence === "number") {
    const sequenceMatches = entries
      .map((entry, index) => timelineEntryMatchesSequence(entry, message) ? index : -1)
      .filter((index) => index !== -1);
    if (sequenceMatches.length === 1) {
      return sequenceMatches[0]!;
    }
  }

  const textMatches = entries
    .map((entry, index) => timelineEntryMatchesText(entry, message) ? index : -1)
    .filter((index) => index !== -1);
  return textMatches.length === 1 ? textMatches[0]! : -1;
}

function timelineEntryMatchesId(entry: SessionTimelineEntry, messageId: string) {
  if (entry.kind === "assistant_message") {
    return entry.id === messageId;
  }
  if (isTranscriptOrToolEntry(entry)) {
    return false;
  }
  return entry.id === messageId || entry.message.id === messageId;
}

function timelineEntryMatchesSequence(entry: SessionTimelineEntry, message: AgentMessage) {
  if (!timelineEntryMatchesRole(entry, message.role) || typeof message.sequence !== "number") {
    return false;
  }
  if (entry.kind === "assistant_message") {
    return entry.sequence === message.sequence ||
      entry.chunks.some((chunk) => chunk.kind === "content" && chunk.sequence === message.sequence);
  }
  if (isTranscriptOrToolEntry(entry)) {
    return false;
  }
  return (entry.message.sequence ?? entry.sequence) === message.sequence;
}

function timelineEntryMatchesText(entry: SessionTimelineEntry, message: AgentMessage) {
  if (!timelineEntryMatchesRole(entry, message.role)) {
    return false;
  }
  const expectedText = message.text.trim();
  if (!expectedText) {
    return false;
  }
  if (entry.kind === "assistant_message") {
    return resolveAssistantComparableTexts(entry).includes(expectedText);
  }
  if (isTranscriptOrToolEntry(entry)) {
    return false;
  }
  return entry.message.text.trim() === expectedText;
}

function timelineEntryMatchesRole(
  entry: SessionTimelineEntry,
  role: AgentMessage["role"],
) {
  if (role === "assistant") {
    return entry.kind === "assistant_message";
  }
  if (role === "user") {
    return entry.kind === "user_message";
  }
  return entry.kind === "system_message";
}

function resolveAssistantComparableTexts(
  entry: Extract<SessionTimelineEntry, { kind: "assistant_message" }>,
) {
  let cumulativeText = "";
  const texts: string[] = [];
  for (const chunk of entry.chunks) {
    if (chunk.kind !== "content") {
      continue;
    }
    cumulativeText += chunk.text;
    const normalized = cumulativeText.trim();
    if (normalized) {
      texts.push(normalized);
    }
  }
  return texts;
}

function isTranscriptOrToolEntry(entry: SessionTimelineEntry) {
  return entry.kind === "tool_call" ||
    entry.kind === "context_compaction" ||
    entry.kind === "history_gap";
}

function appendHistoryGapEntry(timeline: SessionTimelineEntry[]): SessionTimelineEntry[] {
  if (timeline.some((entry) => entry.kind === "history_gap")) {
    return timeline;
  }
  const gapEntry: import("@tiller/shared").SessionTimelineHistoryGapEntry = {
    kind: "history_gap",
    id: `history-gap:${Date.now()}`,
    timestamp: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: "Earlier transcript is unavailable; only post-compaction history could be restored.",
  };
  return [...timeline, gapEntry];
}

function omitContinuationSummaryEntries(entries: SessionTimelineEntry[]) {
  return entries.filter((entry) => {
    if (entry.kind !== "user_message" && entry.kind !== "system_message") {
      return true;
    }
    return !looksLikeContinuationSummary(entry.message.text);
  });
}
