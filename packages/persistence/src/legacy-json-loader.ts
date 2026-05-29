import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  AgentMessage,
  AgentToolCall,
  AgentToolCallKind,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
} from "@tiller/shared";
import { normalizeSessionMessages, sortCommandChunks, sortToolCalls } from "./normalize.js";
import type { StoredSessionRuntimeDescriptor } from "./runtime-store.js";
import { isStoredSessionRuntimeDescriptor } from "./runtime-store.js";
import { normalizeSessionSummary } from "./summary/store.js";

export type LegacyJsonSessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
};

export function loadLegacyJsonSessionSummaries(filePath: string): SessionSummary[] {
  const parsed = readJsonFile(filePath);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((item) => normalizeSessionSummary(item))
    .filter((item): item is SessionSummary => item !== null);
}

export function loadLegacyJsonRuntimeDescriptors(filePath: string): StoredSessionRuntimeDescriptor[] {
  const parsed = readJsonFile(filePath);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isStoredSessionRuntimeDescriptor);
}

export function loadLegacyJsonSessionMessages(
  rootDir: string,
  sessionId: string,
): AgentMessage[] {
  const parsed = readJsonFile(join(rootDir, `${sessionId}.json`));
  if (!Array.isArray(parsed)) {
    return [];
  }
  return normalizeSessionMessages(parsed.filter(isLegacyAgentMessage));
}

export function loadLegacyJsonSessionArtifacts(
  rootDir: string,
  sessionId: string,
): LegacyJsonSessionArtifacts {
  const parsed = readJsonFile(join(rootDir, `${sessionId}.json`));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { outputs: [], diffs: [], toolCalls: [] };
  }
  const record = parsed as Record<string, unknown>;
  return {
    outputs: Array.isArray(record.outputs)
      ? sortCommandChunks(record.outputs.filter(isLegacyCommandChunk))
      : [],
    diffs: Array.isArray(record.diffs) ? record.diffs.filter(isLegacyFileDiffSummary) : [],
    toolCalls: Array.isArray(record.toolCalls)
      ? sortToolCalls(
          (record.toolCalls as unknown[])
            .filter(isLegacyAgentToolCall)
            .map((toolCall) => normalizeLegacyAgentToolCall(toolCall)),
        )
      : [],
  };
}

export function listLegacyJsonSessionIds(rootDir: string): string[] {
  try {
    return readdirSync(rootDir)
      .filter((entry) => extname(entry) === ".json")
      .map((entry) => basename(entry, ".json"));
  } catch {
    return [];
  }
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isLegacyAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.text === "string" &&
    typeof candidate.timestamp === "string"
  );
}

function isLegacyCommandChunk(value: unknown): value is CommandChunk {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.commandId === "string" &&
    typeof candidate.text === "string" &&
    typeof candidate.stream === "string" &&
    typeof candidate.timestamp === "string"
  );
}

function isLegacyFileDiffSummary(value: unknown): value is FileDiffSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.additions === "number" &&
    typeof candidate.deletions === "number"
  );
}

function isLegacyAgentToolCall(value: unknown): value is AgentToolCall {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.timestamp === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

const LEGACY_VALID_TOOL_CALL_KINDS = new Set<AgentToolCallKind>([
  "mcp",
  "skill",
  "read",
  "write",
  "search",
  "shell",
  "fetch",
  "think",
  "todo",
  "subagent",
  "tool",
  "unknown",
]);

function normalizeLegacyAgentToolCall(toolCall: AgentToolCall): AgentToolCall {
  const kind = normalizeLegacyAgentToolCallKind(toolCall.kind);
  return { ...toolCall, kind };
}

function normalizeLegacyAgentToolCallKind(value: unknown): AgentToolCallKind {
  if (value === "terminal") return "shell";
  if (value === "edit") return "write";
  return typeof value === "string" && LEGACY_VALID_TOOL_CALL_KINDS.has(value as AgentToolCallKind)
    ? (value as AgentToolCallKind)
    : "unknown";
}
