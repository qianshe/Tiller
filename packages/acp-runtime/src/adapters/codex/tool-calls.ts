import type { AgentToolCall } from "@tiller/shared";

export function normalizeCodexToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const source = update?.toolCall ?? update?.tool_call ?? update?.tool ?? update;
  const title =
    stringFrom(source?.tool) ??
    stringFrom(source?.toolName) ??
    stringFrom(source?.tool_name) ??
    stringFrom(source?.name) ??
    stringFrom(update?.tool) ??
    stringFrom(update?.toolName) ??
    stringFrom(update?.tool_name) ??
    toolCall.title;
  return isCodexSubagentTool(title)
    ? { ...toolCall, kind: "subagent" }
    : toolCall;
}

function isCodexSubagentTool(title: string) {
  const normalized = title.trim().toLowerCase();
  return /(?:^|[.\s_-])(?:agent|subagents?|delegate[_-]?task|spawn[_-]?agents?(?:[_-]?on[_-]?csv)?)(?:$|[.\s_-])/u.test(normalized);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
