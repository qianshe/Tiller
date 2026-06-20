import type { AgentToolCall } from "@tiller/shared";

export function normalizeClaudeToolCall(
  toolCall: AgentToolCall,
  _update: any,
): AgentToolCall {
  return toolCall;
}
