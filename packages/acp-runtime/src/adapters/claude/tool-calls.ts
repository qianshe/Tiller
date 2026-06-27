import type { AgentToolCall } from "@tiller/shared";

const CLAUDE_SUBAGENT_TOOL_NAME = /^agent$/iu;

export function normalizeClaudeToolCall(
  toolCall: AgentToolCall,
  _update: any,
): AgentToolCall {
  if (CLAUDE_SUBAGENT_TOOL_NAME.test(toolCall.title ?? "")) {
    return { ...toolCall, kind: "subagent" };
  }
  return toolCall;
}
