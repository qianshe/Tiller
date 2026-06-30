import type { AgentToolCall } from "@tiller/shared";

const CLAUDE_SUBAGENT_TOOL_NAME = /^agent$/iu;
const CLAUDE_TASK_SUBAGENT_TOOL_NAME = /^task$/iu;

export function normalizeClaudeToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  if (CLAUDE_SUBAGENT_TOOL_NAME.test(toolCall.title ?? "")) {
    return { ...toolCall, kind: "subagent" };
  }
  if (isSubagentPayload(toolCall, update)) {
    return { ...toolCall, kind: "subagent" };
  }
  return toolCall;
}

function isSubagentPayload(toolCall: AgentToolCall, update: any): boolean {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const rawInput = source?.rawInput ?? source?.raw_input;
  if (rawInput && typeof rawInput === "object" && typeof rawInput.subagent_type === "string") {
    return true;
  }
  if (CLAUDE_TASK_SUBAGENT_TOOL_NAME.test(toolCall.title ?? "")) {
    const input = parseInput(toolCall.input);
    if (input && typeof input.prompt === "string") {
      return true;
    }
  }
  return false;
}

function parseInput(input: string | undefined): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
