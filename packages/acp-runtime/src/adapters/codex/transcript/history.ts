import { existsSync, readFileSync } from "node:fs";
import type { AgentMessage } from "@tiller/shared";
import {
  resolveCodexTranscriptPath,
  type CodexTranscriptToolCallOptions,
} from "./tool-calls";

export type CodexTranscriptHistoryOptions = CodexTranscriptToolCallOptions;

export function readCodexTranscriptMessagesFromDisk(
  options: CodexTranscriptHistoryOptions,
): AgentMessage[] {
  const path = resolveCodexTranscriptPath(options);
  if (!path || !existsSync(path)) {
    return [];
  }
  return extractCodexVisibleMessagesFromTranscriptText(readFileSync(path, "utf8"));
}

export function extractCodexVisibleMessagesFromTranscriptText(raw: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let visibleSequence = 0;

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record || firstString(record.type) !== "response_item") {
      continue;
    }
    const payload = asRecord(record.payload);
    if (!payload || firstString(payload.type) !== "message") {
      continue;
    }
    const role = firstString(payload.role);
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractVisibleText(payload.content);
    if (!text) {
      continue;
    }
    visibleSequence += 1;
    messages.push({
      id: `codex-transcript-message-${visibleSequence}`,
      role,
      text,
      timestamp: firstString(record.timestamp) || new Date(0).toISOString(),
      sequence: visibleSequence,
    });
  }

  return messages;
}

function extractVisibleText(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const record = asRecord(part);
      const type = firstString(record?.type);
      if (type !== "input_text" && type !== "output_text" && type !== "text") {
        return "";
      }
      return firstString(record?.text).trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
