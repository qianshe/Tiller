import type { AgentMessage } from "../types";

export function findEquivalentReplayDuplicateMessageIndex(
  messages: AgentMessage[],
  incoming: AgentMessage,
) {
  if (!isReplayDuplicateCandidateMessage(incoming)) {
    return -1;
  }
  const normalizedIncomingText = normalizeComparableReplayText(incoming.text);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index];
    if (!current || !isReplayDuplicateCandidateMessage(current)) {
      continue;
    }
    if (
      current.role !== incoming.role ||
      normalizeComparableReplayText(current.text) !== normalizedIncomingText
    ) {
      continue;
    }
    if (isLaterReplayDuplicate(current, incoming)) {
      return index;
    }
  }
  return -1;
}

export function isReplayDuplicateCandidateMessage(message: AgentMessage) {
  return (message.role === "user" || message.role === "assistant") &&
    Boolean(message.text.trim()) &&
    typeof message.sequence === "number";
}

export function isLaterReplayDuplicate(
  current: Pick<AgentMessage, "timestamp" | "sequence">,
  incoming: Pick<AgentMessage, "timestamp" | "sequence">,
) {
  if (
    typeof current.sequence !== "number" ||
    typeof incoming.sequence !== "number"
  ) {
    return false;
  }
  const currentTime = Date.parse(current.timestamp);
  const incomingTime = Date.parse(incoming.timestamp);
  return Number.isFinite(currentTime) &&
    Number.isFinite(incomingTime) &&
    incomingTime > currentTime &&
    incoming.sequence <= current.sequence;
}

export function normalizeComparableReplayText(text: string) {
  return text.replace(/[*_~`]/gu, "").replace(/\s+/gu, " ").trim();
}
