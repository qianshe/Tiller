import type { AgentToolCall } from "@tiller/shared";

export function hasToolCallChanged(left: AgentToolCall, right: AgentToolCall) {
  return left.kind !== right.kind ||
    left.title !== right.title ||
    left.status !== right.status ||
    left.mcp?.serverName !== right.mcp?.serverName ||
    left.mcp?.toolName !== right.mcp?.toolName ||
    left.mcp?.source !== right.mcp?.source ||
    left.mcp?.rawTitle !== right.mcp?.rawTitle ||
    left.commandId !== right.commandId ||
    left.input !== right.input ||
    left.output !== right.output ||
    left.stream !== right.stream ||
    left.timestamp !== right.timestamp ||
    left.updatedAt !== right.updatedAt ||
    left.sequence !== right.sequence;
}
