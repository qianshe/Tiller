import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";

export function normalizeOpenCodeToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const mcp = resolveAgentToolCallMcp({
    existing: toolCall.mcp,
    input: source?.rawInput ?? source?.raw_input ?? source?.input ?? source?.state?.input ?? toolCall.input,
    title: toolCall.title,
    rawTitle: typeof toolCall.title === "string" ? toolCall.title : undefined,
  });
  if (mcp) {
    return { ...toolCall, kind: "mcp", title: formatAgentToolCallMcpTitle(mcp), mcp };
  }
  return toolCall;
}
