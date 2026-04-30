import type { AgentMessage, SessionSummary } from "@tiller/shared";

export function applyUserPromptToSummary(summary: SessionSummary, text: string, timestamp: string): SessionSummary {
  return {
    ...summary,
    updatedAt: timestamp,
    messageCount: summary.messageCount + 1,
    lastMessagePreview: text.slice(0, 160),
  };
}

export function applyAgentMessageToSummary(summary: SessionSummary, message: AgentMessage): SessionSummary {
  return {
    ...summary,
    updatedAt: message.timestamp,
  };
}
