import type { AgentToolCall } from "@tiller/shared";

export function normalizeCodexToolCall(
  toolCall: AgentToolCall,
  _update: any,
): AgentToolCall {
  return toolCall;
}
