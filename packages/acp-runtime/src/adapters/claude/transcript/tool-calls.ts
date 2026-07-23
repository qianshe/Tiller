import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";
import { resolveClaudeTranscriptPath, type ClaudeTranscriptPlanOptions } from "./plan";

type PendingToolUse = {
  id: string;
  input: unknown;
  name: string;
  timestamp: string;
};

type ClaudeTaskNotification = {
  agentId: string;
  output?: string;
  status: Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled">;
  toolCallId: string;
};

export type ClaudeTranscriptToolCallOptions = ClaudeTranscriptPlanOptions;
export type ClaudeTranscriptToolUse = {
  input: unknown;
  name: string;
};

type ClaudeTranscriptExtractionOptions = {
  includePending?: boolean;
};

const LIVE_TOOL_LOOKUP_BYTES = 512 * 1024;
const LIVE_TOOL_LOOKUP_FILES = 4;

export function readClaudeTranscriptToolCallsFromDisk(
  options: ClaudeTranscriptToolCallOptions,
): AgentToolCall[] {
  const path = resolveClaudeTranscriptPath(options);
  if (!existsSync(path)) {
    return [];
  }
  return extractClaudeToolCallsFromTranscriptText(readFileSync(path, "utf8"));
}

export function extractClaudeToolCallsFromTranscriptText(
  raw: string,
  options: ClaudeTranscriptExtractionOptions = {},
): AgentToolCall[] {
  const pendingToolUses = new Map<string, PendingToolUse>();
  const toolCalls: AgentToolCall[] = [];
  let sequence = 0;

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record) {
      continue;
    }
    const timestamp = firstString(record.timestamp) || new Date(0).toISOString();
    const taskNotification = readClaudeTaskNotification(record);
    if (taskNotification) {
      sequence += 1;
      toolCalls.push({
        id: taskNotification.toolCallId,
        commandId: `subagent:${taskNotification.agentId}`,
        kind: "subagent",
        title: "Subagent",
        status: taskNotification.status,
        ...(taskNotification.output ? { output: taskNotification.output } : {}),
        timestamp,
        updatedAt: timestamp,
        sequence,
      });
      pendingToolUses.delete(taskNotification.toolCallId);
    }
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
      toolCalls.push(createClaudeTranscriptToolCall(
        toolUse,
        partRecord.is_error === true ? "failed" : "completed",
        sequence,
        timestamp,
        (
          stringifyToolResultContent(partRecord.content) ??
          stringifyToolResultContent(record.toolUseResult)
        ),
      ));
      pendingToolUses.delete(toolUseId);
    }
  }

  if (options.includePending) {
    for (const toolUse of pendingToolUses.values()) {
      sequence += 1;
      toolCalls.push(createClaudeTranscriptToolCall(
        toolUse,
        "running",
        sequence,
        toolUse.timestamp,
      ));
    }
  }

  return toolCalls;
}

function readClaudeTaskNotification(
  record: Record<string, unknown>,
): ClaudeTaskNotification | null {
  const candidates = [
    record.content,
    recordFrom(record.attachment).prompt,
    recordFrom(record.message).content,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const notification = candidate.match(
      /<task-notification>([\s\S]*?)<\/task-notification>/iu,
    )?.[1];
    if (!notification) {
      continue;
    }
    const agentId = notification.match(/<task-id>\s*([^<]+?)\s*<\/task-id>/iu)?.[1]?.trim();
    const toolCallId = notification.match(
      /<tool-use-id>\s*([^<]+?)\s*<\/tool-use-id>/iu,
    )?.[1]?.trim();
    const status = notification.match(/<status>\s*([^<]+?)\s*<\/status>/iu)?.[1]
      ?.trim()
      .toLowerCase();
    if (
      !agentId ||
      !toolCallId ||
      (status !== "completed" && status !== "failed" && status !== "cancelled")
    ) {
      continue;
    }
    const output = notification.match(/<result>\s*([\s\S]*?)\s*<\/result>/iu)?.[1]?.trim();
    return {
      agentId,
      toolCallId,
      status,
      ...(output ? { output } : {}),
    };
  }
  return null;
}

function createClaudeTranscriptToolCall(
  toolUse: PendingToolUse,
  status: AgentToolCall["status"],
  sequence: number,
  updatedAt: string,
  output?: string,
): AgentToolCall {
  const mcp = resolveAgentToolCallMcp({
    input: toolUse.input,
    title: toolUse.name,
    rawTitle: toolUse.name,
  });
  const kind = mcp ? "mcp" : inferClaudeTranscriptToolKind(toolUse.name);
  return {
    id: toolUse.id,
    kind,
    title: mcp
      ? formatAgentToolCallMcpTitle(mcp)
      : resolveClaudeTranscriptToolTitle(toolUse.name, kind, toolUse.input),
    status,
    ...(mcp ? { mcp } : {}),
    input: stringifyToolPayload(toolUse.input),
    ...(output ? { output } : {}),
    timestamp: toolUse.timestamp,
    updatedAt,
    sequence,
  };
}

function resolveClaudeTranscriptToolTitle(
  name: string,
  kind: AgentToolCall["kind"],
  input: unknown,
): string {
  if (kind === "shell") {
    const inputRecord = recordFrom(input);
    const command = firstString(
      inputRecord.command,
      inputRecord.cmd,
      inputRecord.script,
      inputRecord.shell,
    );
    if (command) {
      return command;
    }
  }
  return normalizeClaudeTranscriptToolTitle(name);
}

export function readClaudeTranscriptToolUseFromDisk(
  options: ClaudeTranscriptToolCallOptions & { toolCallId: string },
): ClaudeTranscriptToolUse | null {
  const transcriptPath = resolveClaudeTranscriptPath(options);
  const files = [transcriptPath];
  const subagentDir = join(
    dirname(transcriptPath),
    options.runtimeSessionId,
    "subagents",
  );
  if (existsSync(subagentDir)) {
    const subagentFiles = readdirSync(subagentDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => {
        const path = join(subagentDir, entry.name);
        return { path, modifiedAt: statSync(path).mtimeMs };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, LIVE_TOOL_LOOKUP_FILES)
      .map((entry) => entry.path);
    files.push(...subagentFiles);
  }
  for (const path of files) {
    if (!existsSync(path)) {
      continue;
    }
    const toolUse = findClaudeTranscriptToolUse(
      readFileTail(path, LIVE_TOOL_LOOKUP_BYTES),
      options.toolCallId,
    );
    if (toolUse) {
      return toolUse;
    }
  }
  return null;
}

export function findClaudeTranscriptToolUse(
  raw: string,
  toolCallId: string,
): ClaudeTranscriptToolUse | null {
  const lines = raw.split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const record = parseLine(lines[index] ?? "");
    if (!record) {
      continue;
    }
    for (const part of contentParts(recordFrom(record.message).content)) {
      const partRecord = recordFrom(part);
      if (
        firstString(partRecord.type) === "tool_use" &&
        firstString(partRecord.id) === toolCallId
      ) {
        const name = firstString(partRecord.name);
        return name ? { name, input: partRecord.input } : null;
      }
    }
  }
  return null;
}

function readFileTail(path: string, byteLimit: number) {
  const size = statSync(path).size;
  const start = Math.max(0, size - byteLimit);
  const length = size - start;
  if (length <= 0) {
    return "";
  }
  const file = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(file, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(file);
  }
}

export function inferClaudeTranscriptToolKind(name: string): AgentToolCall["kind"] {
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
