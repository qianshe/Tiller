import type { AgentToolCall } from "@tiller/shared";

const CLAUDE_SUBAGENT_TOOL_NAME = /^agent$/iu;
const CLAUDE_TASK_SUBAGENT_TOOL_NAME = /^task$/iu;
const CLAUDE_SHELL_COMMAND_PREFIX = /^(?:cd|pwd|ls|cat|grep|rg|find|git|head|tail|sed|awk|xargs|pnpm|npm|node|bash|sh|for|if|echo)\b/iu;
const CLAUDE_SHELL_COMMAND_SYNTAX = /&&|\|\||\$\(|;\s|\|\s*(?:head|tail|grep|rg|sed|awk|cat)\b|(?:^|\s)\d?>\S/iu;

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
  if (toolCall.kind === "search" && looksLikeShellCommandPayload(toolCall, update)) {
    return { ...toolCall, kind: "shell" };
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

function looksLikeShellCommandPayload(toolCall: AgentToolCall, update: any): boolean {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const candidates = [
    toolCall.title,
    stringFrom(source?.title),
    stringFrom(source?.input),
    stringFrom(source?.rawInput),
    stringFrom(source?.raw_input),
  ].filter((value): value is string => Boolean(value?.trim()));
  return candidates.some(looksLikeShellCommandText);
}

function looksLikeShellCommandText(value: string): boolean {
  const trimmed = value.trim();
  return CLAUDE_SHELL_COMMAND_PREFIX.test(trimmed) || CLAUDE_SHELL_COMMAND_SYNTAX.test(trimmed);
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

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
