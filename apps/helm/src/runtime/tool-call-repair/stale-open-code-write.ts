import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { AgentToolCall, SessionSummary } from "@tiller/shared";

export function isStaleOpenCodeRunningWriteToolCall(input: {
  providerId: string | undefined;
  summary: Pick<SessionSummary, "cwd" | "status">;
  toolCall: AgentToolCall;
}) {
  const { providerId, summary, toolCall } = input;
  if (providerId !== "opencode") {
    return false;
  }
  if (summary.status === "running" || summary.status === "waiting_for_permission") {
    return false;
  }
  if (toolCall.kind !== "write" || toolCall.status !== "running") {
    return false;
  }
  if (toolCall.title.trim().toLowerCase() !== "write") {
    return false;
  }
  if (toolCall.output) {
    return false;
  }
  const record = parseJsonRecord(toolCall.input);
  const rawPath = typeof record?.filePath === "string"
    ? record.filePath.trim()
    : typeof record?.path === "string"
      ? record.path.trim()
      : "";
  if (!rawPath) {
    return false;
  }
  const resolvedPath = isAbsolute(rawPath) ? rawPath : resolve(summary.cwd, rawPath);
  return !existsSync(resolvedPath);
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
