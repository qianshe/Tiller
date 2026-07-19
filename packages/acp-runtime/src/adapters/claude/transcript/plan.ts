import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentPlan, AgentToolCall } from "@tiller/shared";
import { extractClaudePlanFromToolCalls } from "../plan-events";

export type ClaudeTranscriptPlanOptions = {
  runtimeSessionId: string;
  cwd: string;
  claudeConfigDir?: string;
};

type PendingToolUse = {
  id: string;
  name: string;
  input: unknown;
  timestamp: string;
};

export function readClaudeTranscriptPlanFromDisk(
  options: ClaudeTranscriptPlanOptions,
): AgentPlan | null {
  // Claude ACP replay can omit TaskCreate metadata needed to rebuild plans;
  // keep that transcript repair isolated in this provider adapter.
  return extractClaudePlanFromToolCalls(
    readClaudeTaskToolCallsFromDisk(options),
  );
}

export function readClaudeTaskToolCallsFromDisk(
  options: ClaudeTranscriptPlanOptions,
): AgentToolCall[] {
  const path = resolveClaudeTranscriptPath(options);
  if (!existsSync(path)) {
    return [];
  }
  return extractClaudeTaskToolCallsFromTranscriptText(readFileSync(path, "utf8"));
}

export function resolveClaudeTranscriptPath(options: ClaudeTranscriptPlanOptions) {
  return join(
    options.claudeConfigDir ?? join(homedir(), ".claude"),
    "projects",
    encodeClaudeProjectPath(options.cwd),
    `${options.runtimeSessionId}.jsonl`,
  );
}

export function extractClaudePlanFromTranscriptText(raw: string): AgentPlan | null {
  return extractClaudePlanFromToolCalls(
    extractClaudeTaskToolCallsFromTranscriptText(raw),
  );
}

export function extractClaudeTaskToolCallsFromTranscriptText(raw: string): AgentToolCall[] {
  const pendingToolUses = new Map<string, PendingToolUse>();
  const taskToolCalls: AgentToolCall[] = [];

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
        const toolUse = readTaskToolUse(partRecord, timestamp);
        if (toolUse) {
          pendingToolUses.set(toolUse.id, toolUse);
        }
        continue;
      }
      if (partType === "tool_result") {
        const toolCall = readTaskToolResult(partRecord, record, pendingToolUses, timestamp);
        if (toolCall) {
          taskToolCalls.push(toolCall);
        }
      }
    }
  }

  return taskToolCalls;
}

function encodeClaudeProjectPath(cwd: string) {
  return resolve(cwd).replace(/[\\/:]/gu, "-");
}

function readTaskToolUse(part: Record<string, unknown>, timestamp: string): PendingToolUse | null {
  const id = firstString(part.id);
  const name = firstString(part.name);
  if (!id || !isTaskToolName(name)) {
    return null;
  }
  return { id, name, input: part.input, timestamp };
}

function readTaskToolResult(
  part: Record<string, unknown>,
  record: Record<string, unknown>,
  pendingToolUses: Map<string, PendingToolUse>,
  timestamp: string,
): AgentToolCall | null {
  const toolUseId = firstString(part.tool_use_id, part.toolUseId);
  const toolUse = pendingToolUses.get(toolUseId);
  if (!toolUse) {
    return null;
  }
  const output = stringifyToolResultContent(part.content) || stringifyToolResultContent(record.toolUseResult);
  return {
    id: toolUse.id,
    kind: "think",
    title: toolUse.name,
    status: part.is_error === true ? "failed" : "completed",
    input: JSON.stringify(toolUse.input ?? {}),
    output,
    timestamp: toolUse.timestamp,
    updatedAt: timestamp,
  };
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
    return JSON.stringify(value);
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

function isTaskToolName(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "taskcreate" || normalized === "taskupdate";
}
