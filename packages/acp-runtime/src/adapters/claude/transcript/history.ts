import { existsSync, readFileSync } from "node:fs";
import type { AgentMessage } from "@tiller/shared";
import { resolveClaudeTranscriptPath, type ClaudeTranscriptPlanOptions } from "./plan";

export type ClaudeTranscriptHistoryOptions = ClaudeTranscriptPlanOptions;

export function readClaudeTranscriptMessagesFromDisk(
  options: ClaudeTranscriptHistoryOptions,
): AgentMessage[] {
  const path = resolveClaudeTranscriptPath(options);
  if (!existsSync(path)) {
    return [];
  }
  return extractClaudeVisibleMessagesFromTranscriptText(readFileSync(path, "utf8"));
}

export function extractClaudeVisibleMessagesFromTranscriptText(raw: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let visibleSequence = 0;

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record) {
      continue;
    }
    const message = recordFrom(record.message);
    const role = firstString(message.role);
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractVisibleText(message.content, role);
    if (!text) {
      continue;
    }
    visibleSequence += 1;
    messages.push({
      id: firstString(record.uuid) || `claude-transcript-message-${visibleSequence}`,
      role,
      text,
      timestamp: firstString(record.timestamp) || new Date(0).toISOString(),
      timelineSequence: visibleSequence,
    });
  }

  return messages;
}

function extractVisibleText(content: unknown, role: "user" | "assistant") {
  if (typeof content === "string") {
    return isHiddenStringContent(content, role) ? "" : content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const record = recordFrom(part);
      return firstString(record.type) === "text" ? firstString(record.text).trim() : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isHiddenStringContent(content: string, role: "user" | "assistant") {
  const trimmed = content.trim();
  if (!trimmed) {
    return true;
  }
  if (role === "assistant") {
    return false;
  }
  return (
    trimmed.startsWith("<command-") ||
    trimmed.startsWith("<local-command-") ||
    trimmed.startsWith("Your tool call was malformed and could not be parsed.")
  );
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return recordFrom(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}
