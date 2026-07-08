import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  formatAgentToolCallMcpTitle,
  resolveAgentToolCallMcp,
  type AgentToolCall,
} from "@tiller/shared";
import { isCodexPlanToolName } from "../plan-events";
import { extractCodexSkillNameFromText, formatCodexSkillTitle } from "../skill-tools";

export type CodexTranscriptToolCallOptions = {
  runtimeSessionId: string;
  cwd: string;
  codexConfigDir?: string;
};

type PendingToolCall = {
  id: string;
  input?: string;
  kind: AgentToolCall["kind"];
  title: string;
  timestamp: string;
  status: AgentToolCall["status"];
  mcp?: AgentToolCall["mcp"];
};

export function readCodexTranscriptToolCallsFromDisk(
  options: CodexTranscriptToolCallOptions,
): AgentToolCall[] {
  const path = resolveCodexTranscriptPath(options);
  if (!path || !existsSync(path)) {
    return [];
  }
  return extractCodexToolCallsFromTranscriptText(readFileSync(path, "utf8"));
}

export function resolveCodexTranscriptPath(options: CodexTranscriptToolCallOptions) {
  const sessionsDir = join(
    options.codexConfigDir ?? join(homedir(), ".codex"),
    "sessions",
  );
  if (!existsSync(sessionsDir)) {
    return null;
  }
  const suffix = `-${options.runtimeSessionId}.jsonl`;
  return findFirstMatchingFile(sessionsDir, suffix);
}

export function extractCodexToolCallsFromTranscriptText(raw: string): AgentToolCall[] {
  const pendingToolCalls = new Map<string, PendingToolCall>();
  const toolCalls: AgentToolCall[] = [];
  let sequence = 0;

  for (const line of raw.split(/\r?\n/u)) {
    const record = parseLine(line);
    if (!record) {
      continue;
    }
    const timestamp = firstString(record.timestamp) || new Date(0).toISOString();
    const recordType = firstString(record.type);
    const payload = asRecord(record.payload);

    if (recordType === "event_msg") {
      const directToolCall = readCodexEventToolCall(payload, timestamp);
      if (directToolCall) {
        sequence += 1;
        toolCalls.push(
          /^ws(?:_|-)/u.test(directToolCall.id.trim())
            ? directToolCall
            : { ...directToolCall, sequence },
        );
      }
      continue;
    }
    if (recordType !== "response_item" || !payload) {
      continue;
    }
    const payloadType = firstString(payload.type);

    if (payloadType === "function_call") {
      const pending = readCodexFunctionCall(payload, timestamp);
      if (pending) {
        pendingToolCalls.set(pending.id, pending);
      }
      continue;
    }
    if (payloadType === "custom_tool_call") {
      const pending = readCodexCustomToolCall(payload, timestamp);
      if (pending) {
        pendingToolCalls.set(pending.id, pending);
      }
      continue;
    }
    if (payloadType === "tool_search_call") {
      const pending = readCodexToolSearchCall(payload, timestamp);
      if (pending) {
        pendingToolCalls.set(pending.id, pending);
      }
      continue;
    }

    const output = readCodexToolCallOutput(payload, timestamp);
    if (!output) {
      continue;
    }
    const pending = pendingToolCalls.get(output.id);
    if (!pending) {
      continue;
    }
    pendingToolCalls.delete(output.id);
    sequence += 1;
    toolCalls.push({
      id: pending.id,
      kind: pending.kind,
      title: pending.title,
      status: inferCompletedToolStatus(pending.status, output.output),
      ...(pending.mcp ? { mcp: pending.mcp } : {}),
      ...(pending.input ? { input: pending.input } : {}),
      ...(output.output ? { output: output.output } : {}),
      timestamp: pending.timestamp,
      updatedAt: output.updatedAt,
      sequence,
    });
  }

  for (const pending of pendingToolCalls.values()) {
    sequence += 1;
    toolCalls.push({
      id: pending.id,
      kind: pending.kind,
      title: pending.title,
      status: pending.status,
      ...(pending.mcp ? { mcp: pending.mcp } : {}),
      ...(pending.input ? { input: pending.input } : {}),
      timestamp: pending.timestamp,
      updatedAt: pending.timestamp,
      sequence,
    });
  }

  return toolCalls;
}

function findFirstMatchingFile(root: string, suffix: string): string | null {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(suffix)) {
        return absolutePath;
      }
    }
  }
  return null;
}

function readCodexFunctionCall(
  payload: Record<string, unknown>,
  timestamp: string,
): PendingToolCall | null {
  const id = firstString(payload.call_id);
  const name = firstString(payload.name);
  if (!id || !name) {
    return null;
  }
  const namespace = firstString(payload.namespace);
  const qualifiedName = namespace ? `${namespace}.${name}` : name;
  if (isCodexPlanToolName(qualifiedName)) {
    return null;
  }
  const input = stringifyValue(payload.arguments);
  const parsedInput = parseJsonRecord(input);
  const resolved = resolveCodexToolMeta({
    name,
    namespace,
    input,
    parsedInput,
  });
  return {
    id,
    kind: resolved.kind,
    title: resolved.title,
    status: "running",
    ...(resolved.mcp ? { mcp: resolved.mcp } : {}),
    ...(input ? { input } : {}),
    timestamp,
  };
}

function readCodexCustomToolCall(
  payload: Record<string, unknown>,
  timestamp: string,
): PendingToolCall | null {
  const id = firstString(payload.call_id);
  const name = firstString(payload.name);
  if (!id || !name) {
    return null;
  }
  if (isCodexPlanToolName(name)) {
    return null;
  }
  const input = stringifyValue(payload.input);
  const parsedInput = parseJsonRecord(input);
  const resolved = resolveCodexToolMeta({
    name,
    input,
    parsedInput,
    payloadType: "custom_tool_call",
  });
  return {
    id,
    kind: resolved.kind,
    title: resolved.title,
    status: normalizeToolStatus(firstString(payload.status)) ?? "completed",
    ...(resolved.mcp ? { mcp: resolved.mcp } : {}),
    ...(input ? { input } : {}),
    timestamp,
  };
}

function readCodexToolSearchCall(
  payload: Record<string, unknown>,
  timestamp: string,
): PendingToolCall | null {
  const id = firstString(payload.call_id);
  if (!id) {
    return null;
  }
  const input = stringifyValue(payload.arguments);
  return {
    id,
    kind: "tool",
    title: "tool_search",
    status: normalizeToolStatus(firstString(payload.status)) ?? "completed",
    ...(input ? { input } : {}),
    timestamp,
  };
}

function readCodexEventToolCall(
  payload: Record<string, unknown> | null,
  timestamp: string,
): AgentToolCall | null {
  if (!payload) {
    return null;
  }
  const payloadType = firstString(payload.type);
  if (payloadType === "web_search_end") {
    const callId = firstString(payload.call_id);
    if (!callId) {
      return null;
    }
    const action = asRecord(payload.action);
    const query = firstString(payload.query, action?.query);
    return {
      id: callId,
      kind: "fetch",
      title: query ? `Searching for: ${query}` : "Searching the Web",
      status: "completed",
      input: stringifyValue({
        query,
        ...(action ? { action } : {}),
      }),
      timestamp,
      updatedAt: timestamp,
    };
  }
  return null;
}

function readCodexToolCallOutput(
  payload: Record<string, unknown>,
  timestamp: string,
) {
  const payloadType = firstString(payload.type);
  const id = firstString(payload.call_id);
  if (!id) {
    return null;
  }
  if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
    return {
      id,
      updatedAt: timestamp,
      output: stringifyValue(payload.output),
    };
  }
  if (payloadType === "tool_search_output") {
    return {
      id,
      updatedAt: timestamp,
      output: undefined,
    };
  }
  return null;
}

function resolveCodexToolMeta(input: {
  name: string;
  namespace?: string;
  input?: string;
  parsedInput: Record<string, unknown> | null;
  payloadType?: string;
}) {
  if (input.namespace?.startsWith("mcp__")) {
    const mcpServer = input.namespace.slice("mcp__".length);
    const mcp = resolveAgentToolCallMcp({
      input: input.parsedInput,
      toolName: `${mcpServer}/${input.name}`,
      rawTitle: `${input.namespace}/${input.name}`,
    });
    if (mcp) {
      return {
        kind: "mcp" as const,
        title: formatAgentToolCallMcpTitle(mcp),
        mcp,
      };
    }
  }

  if (input.namespace === "multi_agent_v1") {
    return {
      kind: "subagent" as const,
      title: input.name,
    };
  }

  if (input.name === "shell_command") {
    const skillName = extractCodexSkillNameFromCommandInput(input.parsedInput);
    if (skillName) {
      return {
        kind: "skill" as const,
        title: formatCodexSkillTitle(skillName),
      };
    }
    return {
      kind: "shell" as const,
      title: extractCommandTitle(input.parsedInput) ?? input.name,
    };
  }

  if (input.name === "view_image") {
    return {
      kind: "read" as const,
      title: extractPathTitle(input.parsedInput) ?? input.name,
    };
  }

  if (input.name === "apply_patch") {
    return {
      kind: "write" as const,
      title: resolvePatchTitle(input.input) ?? input.name,
    };
  }

  if (input.namespace === "web" || input.name === "web.run") {
    return {
      kind: "fetch" as const,
      title: input.name,
    };
  }

  return {
    kind: "tool" as const,
    title: input.name,
  };
}

function inferCompletedToolStatus(
  fallback: AgentToolCall["status"],
  output: string | undefined,
): AgentToolCall["status"] {
  if (!output) {
    return fallback === "running" ? "completed" : fallback;
  }
  if (
    /\b(?:Exit code|Process exited with code):?\s*[1-9]\d*\b/iu.test(output) ||
    /"isError"\s*:\s*true/u.test(output)
  ) {
    return "failed";
  }
  return fallback === "running" ? "completed" : fallback;
}

function normalizeToolStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "failed") return "failed";
  if (normalized === "pending") return "pending";
  if (normalized === "running" || normalized === "in_progress") return "running";
  return undefined;
}

function resolvePatchTitle(input: string | undefined) {
  if (!input) {
    return undefined;
  }
  const match = input.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/mu);
  if (!match?.[1]) {
    return undefined;
  }
  return `Edit ${match[1].trim()}`;
}

function extractCommandTitle(parsedInput: Record<string, unknown> | null) {
  if (!parsedInput) {
    return undefined;
  }
  return commandValueToString(parsedInput.command) ??
    firstString(parsedInput.code);
}

function extractPathTitle(parsedInput: Record<string, unknown> | null) {
  if (!parsedInput) {
    return undefined;
  }
  return firstString(
    parsedInput.path,
    parsedInput.file_path,
    parsedInput.relative_path,
  );
}

function extractCodexSkillNameFromCommandInput(
  parsedInput: Record<string, unknown> | null,
) {
  const candidates = [
    commandValueToString(parsedInput?.command),
    commandValueToString(parsedInput?.cmd),
    commandValueToString(parsedInput?.script),
    commandValueToString(parsedInput?.shell),
    commandValueToString(parsedInput?.args),
  ];
  for (const candidate of candidates) {
    const skillName = extractCodexSkillNameFromText(candidate);
    if (skillName) {
      return skillName;
    }
  }
  return undefined;
}

function commandValueToString(value: unknown): string | undefined {
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

function parseJsonRecord(input: string | undefined) {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) {
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

function stringifyValue(value: unknown): string | undefined {
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
