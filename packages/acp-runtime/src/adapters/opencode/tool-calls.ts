import type { AgentToolCall } from "@tiller/shared";

export function normalizeOpenCodeToolCall(
  toolCall: AgentToolCall,
  _update: any,
): AgentToolCall {
  return toolCall;
}
