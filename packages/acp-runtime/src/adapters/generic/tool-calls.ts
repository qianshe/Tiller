import { resolveAgentToolCallMcp, type AgentToolCall } from "@tiller/shared";

const GENERIC_TOOL_CALL_KINDS = new Set<AgentToolCall["kind"]>(["tool", "unknown"]);

/**
 * Applies provider-neutral enrichment without interpreting provider-private
 * semantics such as subagent lifecycles or plan tools.
 */
export function normalizeGenericToolCall(toolCall: AgentToolCall): AgentToolCall {
  const mcp = resolveAgentToolCallMcp({
    existing: toolCall.mcp,
    input: toolCall.input,
    title: toolCall.title,
  });
  if (!mcp) {
    return toolCall;
  }

  if (toolCall.kind === "mcp") {
    return toolCall.mcp ? toolCall : { ...toolCall, mcp };
  }

  if (!GENERIC_TOOL_CALL_KINDS.has(toolCall.kind)) {
    return toolCall;
  }

  return { ...toolCall, kind: "mcp", mcp };
}
