import type { AgentToolCall, AgentToolCallKind } from "../types";

type ToolCallClassificationSnapshot = Pick<AgentToolCall, "kind"> & {
  input?: unknown;
};

export function resolveMergedAgentToolCallKind(
  current: ToolCallClassificationSnapshot,
  incoming: ToolCallClassificationSnapshot,
): AgentToolCallKind {
  if (
    current.kind === "shell" &&
    incoming.kind === "search" &&
    isStructuredSearchToolCallInput(incoming.input ?? current.input)
  ) {
    return "search";
  }
  return current.kind;
}

export function isStructuredSearchToolCallInput(input: unknown) {
  const record = parseInputRecord(input);
  if (!record) {
    return false;
  }
  const hasSearchPattern =
    typeof record.pattern === "string" ||
    typeof record.search_string === "string" ||
    typeof record.substring_pattern === "string";
  const hasShellCommand = ["command", "cmd", "script", "shell", "args"]
    .some((key) => record[key] !== undefined);
  return hasSearchPattern && !hasShellCommand;
}

function parseInputRecord(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input !== "string" || !input.trim().startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}
