import type { AgentToolCall } from "@tiller/shared";

export function normalizeClaudeToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const source = update?.toolCall ?? update?.tool_call ?? update?.tool ?? update;
  const toolName =
    stringFrom(source?.tool) ??
    stringFrom(source?.toolName) ??
    stringFrom(source?.tool_name) ??
    stringFrom(source?.name) ??
    stringFrom(update?.tool) ??
    stringFrom(update?.toolName) ??
    stringFrom(update?.tool_name) ??
    toolCall.title;
  return isClaudeSubagentTool(toolName)
    ? { ...toolCall, kind: "subagent" }
    : toolCall;
}

function isClaudeSubagentTool(toolName: string) {
  const normalized = toolName.trim().toLowerCase();
  return normalized === "agent" || normalized === "task";
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
