import type { AgentMessage, SessionSummary } from "@tiller/shared";

export function applyUserPromptToSummary(
  summary: SessionSummary,
  text: string,
  timestamp: string,
): SessionSummary {
  return {
    ...summary,
    updatedAt: timestamp,
    messageCount: summary.messageCount + 1,
    title: summary.title ?? createFallbackSessionTitle(text),
    lastMessagePreview: text.slice(0, 160),
  };
}

export function applyAgentMessageToSummary(
  summary: SessionSummary,
  message: AgentMessage,
): SessionSummary {
  return {
    ...summary,
    updatedAt: message.timestamp,
  };
}

function createFallbackSessionTitle(text: string) {
  return text.replace(/[\p{P}\p{S}\s]+/gu, "").slice(0, 5) || undefined;
}
