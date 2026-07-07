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
  if (looksLikeClaudeMcpTool(toolCall, update)) {
    return { ...toolCall, kind: "mcp" };
  }
  if (toolCall.kind === "search" && looksLikeShellCommandPayload(toolCall, update)) {
    return { ...toolCall, kind: "shell" };
  }
  if (toolCall.kind === "shell" && looksLikeStructuredSearchPayload(toolCall, update)) {
    return { ...toolCall, kind: "search" };
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
  const candidates = extractCommandTextCandidates(toolCall, update);
  return candidates.some(looksLikeShellCommandText);
}

function looksLikeClaudeMcpTool(toolCall: AgentToolCall, update: any): boolean {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const candidates = [
    toolCall.title,
    stringFrom(source?.title),
    stringFrom(source?.name),
    stringFrom(source?.toolName),
    stringFrom(source?.tool_name),
    stringFrom(source?.tool),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toLowerCase());
  return candidates.some((value) => value.startsWith("mcp__") || value.startsWith("mcpservers_"));
}

function looksLikeStructuredSearchPayload(toolCall: AgentToolCall, update: any): boolean {
  const candidates = extractStructuredInputCandidates(toolCall, update);
  return candidates.some(isStructuredSearchPayload);
}

function looksLikeShellCommandText(value: string): boolean {
  const trimmed = value.trim();
  return CLAUDE_SHELL_COMMAND_PREFIX.test(trimmed) || CLAUDE_SHELL_COMMAND_SYNTAX.test(trimmed);
}

function extractCommandTextCandidates(toolCall: AgentToolCall, update: any): string[] {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  const rawCandidates = [
    toolCall.title,
    stringFrom(source?.title),
    stringFrom(source?.input),
    stringFrom(source?.rawInput),
    stringFrom(source?.raw_input),
  ].filter((value): value is string => Boolean(value?.trim()));
  const parsedCandidates = rawCandidates.flatMap(extractParsedCommandCandidates);
  return [...rawCandidates, ...parsedCandidates];
}

function extractParsedCommandCandidates(value: string): string[] {
  const parsed = parseInput(value);
  if (!parsed) {
    return [];
  }
  return [
    commandValueToString(parsed.command),
    commandValueToString(parsed.cmd),
    commandValueToString(parsed.script),
    commandValueToString(parsed.shell),
    commandValueToString(parsed.args),
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));
}

function extractStructuredInputCandidates(
  toolCall: AgentToolCall,
  update: any,
): Array<Record<string, unknown>> {
  const source = update?.toolCall ?? update?.tool_call ?? update;
  return [
    objectFromUnknown(toolCall.input),
    objectFromUnknown(source?.input),
    objectFromUnknown(source?.rawInput),
    objectFromUnknown(source?.raw_input),
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
}

function isStructuredSearchPayload(input: Record<string, unknown>): boolean {
  const hasSearchPattern =
    typeof input.pattern === "string" ||
    typeof input.search_string === "string" ||
    typeof input.substring_pattern === "string";
  const hasShellCommand =
    input.command !== undefined ||
    input.cmd !== undefined ||
    input.script !== undefined ||
    input.shell !== undefined ||
    input.args !== undefined;
  return hasSearchPattern && !hasShellCommand;
}

function commandValueToString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" ");
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return undefined;
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

function objectFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    return parseInput(value);
  }
  return typeof value === "object" ? value as Record<string, unknown> : null;
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
