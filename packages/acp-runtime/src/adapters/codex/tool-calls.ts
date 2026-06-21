import type { AgentToolCall } from "@tiller/shared";

const CODEX_SUBAGENT_TOOL_TITLE = /^spawn_agents_/u;

export function normalizeCodexToolCall(
  toolCall: AgentToolCall,
  _update: any,
): AgentToolCall {
  if (looksLikeCodexSubagentToolCall(toolCall)) {
    return { ...toolCall, kind: "subagent" };
  }
  return toolCall;
}

function looksLikeCodexSubagentToolCall(toolCall: AgentToolCall) {
  if (!CODEX_SUBAGENT_TOOL_TITLE.test(toolCall.title.trim())) {
    return false;
  }
  const input = parseJsonRecord(toolCall.input);
  return Boolean(input && typeof input.path === "string" && input.path.trim());
}

function parseJsonRecord(input: string | undefined) {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
