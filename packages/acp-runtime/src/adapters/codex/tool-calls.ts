import type { AgentToolCall } from "@tiller/shared";
import { extractCodexSkillNameFromText, formatCodexSkillTitle } from "./skill-tools";

const CODEX_SUBAGENT_TOOL_TITLE = /^spawn_agents_/u;
const CODEX_MULTI_AGENT_TOOL_TITLE = /^(?:spawn_agent|wait_agent|close_agent|send_input|resume_agent)$/u;

export function normalizeCodexToolCall(
  toolCall: AgentToolCall,
  _update: any,
): AgentToolCall {
  if (looksLikeCodexWebFetchToolCall(toolCall)) {
    return { ...toolCall, kind: "fetch" };
  }
  if (looksLikeCodexSubagentToolCall(toolCall)) {
    return { ...toolCall, kind: "subagent" };
  }
  const skillName = extractCodexSkillNameFromToolCall(toolCall);
  if (skillName) {
    return { ...toolCall, kind: "skill", title: formatCodexSkillTitle(skillName) };
  }
  if (looksLikeCodexShellPayload(toolCall)) {
    return { ...toolCall, kind: "shell" };
  }
  return toolCall;
}

function looksLikeCodexSubagentToolCall(toolCall: AgentToolCall) {
  return looksLikeCodexSubagentPayload(toolCall.title, parseJsonRecord(toolCall.input));
}

export function looksLikeCodexSubagentPayload(
  title: string,
  input: Record<string, unknown> | null,
) {
  const normalizedTitle = title.trim();
  if (
    !CODEX_SUBAGENT_TOOL_TITLE.test(normalizedTitle) &&
    !CODEX_MULTI_AGENT_TOOL_TITLE.test(normalizedTitle)
  ) {
    return false;
  }
  if (!input) {
    return false;
  }
  if (typeof input.path === "string" && input.path.trim()) {
    return true;
  }
  if (
    Array.isArray(input.targets) &&
    input.targets.some((item) => typeof item === "string" && item.trim())
  ) {
    return true;
  }
  if (typeof input.target === "string" && input.target.trim()) {
    return true;
  }
  if (typeof input.message === "string" && input.message.trim()) {
    return true;
  }
  return input.fork_context === true || input.forkContext === true;
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

function looksLikeCodexWebFetchToolCall(toolCall: AgentToolCall) {
  if (toolCall.kind !== "search") {
    return false;
  }
  if (/^web_search_/u.test(toolCall.id.trim())) {
    return true;
  }
  const title = toolCall.title.trim();
  if (!/^Searching(?:\s+the\s+Web|\s+for:)/iu.test(title)) {
    return false;
  }
  const input = parseJsonRecord(toolCall.input);
  if (!input) {
    return title === "Searching the Web";
  }
  const action = input.action;
  if (action && typeof action === "object" && !Array.isArray(action)) {
    const actionType = (action as { type?: unknown }).type;
    if (typeof actionType === "string" && actionType.trim().toLowerCase() === "search") {
      return true;
    }
  }
  return typeof input.query === "string" && input.query.trim().length > 0;
}

function looksLikeCodexShellPayload(toolCall: AgentToolCall) {
  const input = parseJsonRecord(toolCall.input);
  if (!input) {
    return false;
  }
  if (typeof input.command === "string" || Array.isArray(input.command)) {
    return true;
  }
  if (Array.isArray(input.parsed_cmd)) {
    return input.parsed_cmd.some((item) =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { cmd?: unknown }).cmd === "string" &&
      (item as { cmd: string }).cmd.trim().length > 0
    );
  }
  return false;
}

function extractCodexSkillNameFromToolCall(toolCall: AgentToolCall) {
  const input = parseJsonRecord(toolCall.input);
  const candidates = [
    commandValueToString(input?.command),
    commandValueToString(input?.cmd),
    commandValueToString(input?.script),
    commandValueToString(input?.shell),
    parsedCommandValueToString(input?.parsed_cmd),
    toolCall.title,
  ];
  for (const candidate of candidates) {
    const skillName = extractCodexSkillNameFromText(candidate);
    if (skillName) {
      return skillName;
    }
  }
  return undefined;
}

function parsedCommandValueToString(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as { cmd?: unknown }).cmd === "string"
    ) {
      const command = (item as { cmd: string }).cmd.trim();
      if (command) {
        return command;
      }
    }
  }
  return undefined;
}

function commandValueToString(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => typeof item === "string" ? item.trim() : String(item))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(" ");
    }
  }
  return undefined;
}
