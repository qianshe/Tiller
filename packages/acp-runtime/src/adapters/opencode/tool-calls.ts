import type { AgentToolCall } from "@tiller/shared";

export function normalizeOpenCodeToolCall(
  toolCall: AgentToolCall,
  update: any,
): AgentToolCall {
  const source = update?.toolCall ?? update?.tool_call ?? update?.tool ?? update;
  const input =
    source?.state?.input ??
    source?.input ??
    source?.arguments ??
    source?.args ??
    source?.params ??
    toolCall.input;
  const toolName =
    stringFrom(source?.tool) ??
    stringFrom(source?.toolName) ??
    stringFrom(source?.tool_name) ??
    stringFrom(source?.name) ??
    stringFrom(update?.tool) ??
    stringFrom(update?.toolName) ??
    stringFrom(update?.tool_name) ??
    "";
  const inferredKind = inferOpenCodeToolKind(toolName, toolCall.title, input);
  if (inferredKind === "unknown") {
    return toolCall;
  }

  const title = resolveOpenCodeToolTitle(toolCall.title, toolCall.id, input);
  return { ...toolCall, kind: inferredKind, title };
}

export function inferOpenCodeToolKind(
  toolName: string,
  title: string,
  input: unknown,
): AgentToolCall["kind"] {
  const raw = `${toolName} ${title} ${stringifyToolPayload(input) ?? ""}`.toLowerCase();
  if (/\bmcp[-_]|\bmcpservers?[_-]|\bmcp\b/u.test(raw)) {
    return "mcp";
  }
  if (/\btodos?\b|todo[_-]?write|todo[_-]?read/u.test(raw)) {
    return "todo";
  }
  if (/bash|shell|terminal|execute/u.test(raw)) {
    return "shell";
  }
  if (/grep|search/u.test(raw)) {
    return "search";
  }
  if (/\b(read|view|list|glob)\b/u.test(raw)) {
    return "read";
  }
  if (/edit|patch|write/u.test(raw)) {
    return "write";
  }

  const structuredInputKind = inferOpenCodeStructuredInputKind(input);
  if (structuredInputKind) {
    return structuredInputKind;
  }
  if (/task|agent|subagent|background/u.test(raw)) {
    return "subagent";
  }
  if (looksLikeOpenCodePathTitle(title)) {
    return "read";
  }
  if (/tool/u.test(raw)) {
    return "tool";
  }
  return "unknown";
}

function inferOpenCodeStructuredInputKind(input: unknown): AgentToolCall["kind"] | undefined {
  const record = parseToolInputRecord(input);
  if (!record) {
    return undefined;
  }
  if (typeof record.relative_path === "string" || typeof record.path === "string") {
    if (
      "content" in record ||
      "repl" in record ||
      "body" in record ||
      "code_edit" in record ||
      "new_name" in record
    ) {
      return "write";
    }
    return "read";
  }
  if (typeof record.filePath === "string" || typeof record.file_path === "string") {
    return "read";
  }
  if ("substring_pattern" in record || "query" in record || "search_string" in record) {
    return "search";
  }
  return undefined;
}

function resolveOpenCodeToolTitle(title: string, id: string, input: unknown) {
  if (!isFallbackToolTitle(title, id)) {
    return title;
  }
  const record = parseToolInputRecord(input);
  const path = record ? stringFrom(record.relative_path) ?? stringFrom(record.path) ?? stringFrom(record.filePath) ?? stringFrom(record.file_path) : undefined;
  return path ?? title;
}

function isFallbackToolTitle(title: string, id: string) {
  const normalized = title.trim();
  return normalized === id || /^call_[A-Za-z0-9]+$/u.test(normalized) || /^Tool call\b/u.test(normalized);
}

function parseToolInputRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function looksLikeOpenCodePathTitle(title: string) {
  const normalized = title.trim();
  if (!normalized || /^Tool call\b/u.test(normalized) || /^call_[A-Za-z0-9]+$/u.test(normalized)) {
    return false;
  }
  return /[\\/]/u.test(normalized) && !/\s/u.test(normalized);
}

function stringifyToolPayload(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
