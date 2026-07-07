import { existsSync, readFileSync } from "node:fs";
import type { AgentToolCall } from "@tiller/shared";
import { resolveClaudeTranscriptPath, type ClaudeTranscriptPlanOptions } from "./plan";

type PendingToolUse = {
  id: string;
  input: unknown;
  name: string;
  timestamp: string;
};

export type ClaudeTranscriptToolCallOptions = ClaudeTranscriptPlanOptions;

export function readClaudeTranscriptToolCallsFromDisk(
  options: ClaudeTranscriptToolCallOptions,
): AgentToolCall[] {
  const path = resolveClaudeTranscriptPath(options);
  if (!existsSync(path)) {
    return [];
  }
  return extractClaudeToolCallsFromTranscriptText(readFileSync(path, "utf8"));
}

export function extractClaudeToolCallsFromTranscriptText(raw: string): AgentToolCall[] {
  const pendingToolUses = new Map<string, PendingToolUse>();
  const toolCalls: AgentToolCall[] = [];
  let sequence = 0;

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record) {
      continue;
    }
    const timestamp = firstString(record.timestamp) || new Date(0).toISOString();
    for (const part of contentParts(recordFrom(record.message).content)) {
      const partRecord = recordFrom(part);
      const partType = firstString(partRecord.type);
      if (partType === "tool_use") {
        const id = firstString(partRecord.id);
        const name = firstString(partRecord.name);
        if (id && name) {
          pendingToolUses.set(id, {
            id,
            name,
            input: partRecord.input,
            timestamp,
          });
        }
        continue;
      }
      if (partType !== "tool_result") {
        continue;
      }
      const toolUseId = firstString(partRecord.tool_use_id, partRecord.toolUseId);
      const toolUse = pendingToolUses.get(toolUseId);
      if (!toolUse) {
        continue;
      }
      sequence += 1;
      toolCalls.push({
        id: toolUse.id,
        kind: inferClaudeTranscriptToolKind(toolUse.name),
        title: normalizeClaudeTranscriptToolTitle(toolUse.name),
        status: partRecord.is_error === true ? "failed" : "completed",
        input: stringifyToolPayload(toolUse.input),
        output:
          stringifyToolResultContent(partRecord.content) ??
          stringifyToolResultContent(record.toolUseResult),
        timestamp: toolUse.timestamp,
        updatedAt: timestamp,
        sequence,
      });
    }
  }

  return toolCalls;
}

function inferClaudeTranscriptToolKind(name: string): AgentToolCall["kind"] {
  const normalized = name.trim().toLowerCase();
  if (normalized === "read") return "read";
  if (
    normalized === "edit" ||
    normalized === "write" ||
    normalized === "multiedit" ||
    normalized === "create" ||
    normalized === "delete" ||
    normalized === "move"
  ) {
    return "write";
  }
  if (
    normalized === "grep" ||
    normalized === "glob" ||
    normalized === "ast_grep_search"
  ) {
    return "search";
  }
  if (normalized === "bash") return "shell";
  if (normalized === "task" || normalized === "agent") return "subagent";
  if (normalized === "skill") return "skill";
  if (normalized === "todowrite" || normalized === "todo") return "todo";
  if (normalized.startsWith("mcpservers_") || normalized.startsWith("mcp__")) {
    return "mcp";
  }
  return "tool";
}

function normalizeClaudeTranscriptToolTitle(name: string) {
  return name.trim() || "Tool";
}

function stringifyToolPayload(value: unknown): string | undefined {
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

function stringifyToolResultContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => firstString(recordFrom(item).text, item))
      .filter(Boolean)
      .join("\n") || undefined;
  }
  if (value && typeof value === "object") {
    const record = recordFrom(value);
    return (
      firstString(record.stdout) ||
      firstString(record.stderr) ||
      firstString(record.output) ||
      stringifyToolPayload(value)
    );
  }
  return undefined;
}

function contentParts(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
