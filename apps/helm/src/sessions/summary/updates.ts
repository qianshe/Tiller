import type { AgentMessage, SessionSummary } from "@tiller/shared";
import {
  parseMissionPromptContext,
  stripMissionPromptContext,
} from "@tiller/shared";

export function applyUserPromptToSummary(
  summary: SessionSummary,
  text: string,
  timestamp: string,
): SessionSummary {
  const promptBody = stripMissionPromptContext(text);
  // context-only:body 空,回退到首条 context label,与 send boundary 兜底一致。
  const preview = promptBody.trim() || extractFirstContextLabel(text) || "";
  const fallback = preview || createFallbackSessionTitle(text);
  return {
    ...summary,
    updatedAt: timestamp,
    messageCount: summary.messageCount + 1,
    title: summary.title ?? fallback,
    lastMessagePreview: preview.slice(0, 160),
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

function extractFirstContextLabel(text: string): string | undefined {
  const { contexts } = parseMissionPromptContext(text);
  return contexts[0]?.label;
}
