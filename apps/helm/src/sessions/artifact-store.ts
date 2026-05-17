import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolCall, AgentToolCallKind, CommandChunk, FileDiffSummary } from "@tiller/shared";
import {
  compareTimestampIdPosition,
  decodeCursor,
  encodeCursor,
  normalizePageLimit,
} from "./pagination";

type SessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
};

export type SessionArtifactPageOptions = {
  limit?: number;
  before?: string;
};

export type SessionArtifactPage = SessionArtifacts & {
  nextCursor?: string;
  hasMore: boolean;
};

const DEFAULT_ARTIFACT_PAGE_LIMIT = 50;
const MAX_ARTIFACT_PAGE_LIMIT = 200;

export function createSessionArtifactStore(rootDir: string) {
  return {
    appendOutput(sessionId: string, chunk: CommandChunk) {
      const current = getSessionArtifacts(rootDir, sessionId);
      const next = {
        ...current,
        outputs: sortCommandChunks([...current.outputs, chunk]),
      };
      persistSessionArtifacts(rootDir, sessionId, next);
      return next;
    },
    replaceDiffs(sessionId: string, diffs: FileDiffSummary[]) {
      const current = getSessionArtifacts(rootDir, sessionId);
      const next = {
        ...current,
        diffs,
      };
      persistSessionArtifacts(rootDir, sessionId, next);
      return next;
    },
    appendToolCall(sessionId: string, toolCall: AgentToolCall) {
      const current = getSessionArtifacts(rootDir, sessionId);
      const index = current.toolCalls.findIndex((item) => item.id === toolCall.id);
      const nextToolCalls =
        index === -1
          ? [...current.toolCalls, toolCall]
          : current.toolCalls.map((item, itemIndex) =>
              itemIndex === index
                ? {
                    ...item,
                    ...toolCall,
                    kind: resolveToolCallKind(item.kind, toolCall.kind),
                    title: resolveToolCallTitle(item.title, toolCall.title, toolCall.id),
                    output: `${item.output ?? ""}${toolCall.output ?? ""}`,
                    input: resolveToolCallInput(item.input, toolCall.input),
                    timestamp: item.timestamp,
                    updatedAt: toolCall.updatedAt,
                  }
                : item,
            );
      const next = {
        ...current,
        toolCalls: sortToolCalls(nextToolCalls),
      };
      persistSessionArtifacts(rootDir, sessionId, next);
      return next;
    },
    replaceToolCalls(sessionId: string, toolCalls: AgentToolCall[]) {
      const current = getSessionArtifacts(rootDir, sessionId);
      const next = {
        ...current,
        toolCalls: sortToolCalls(toolCalls),
      };
      persistSessionArtifacts(rootDir, sessionId, next);
      return next;
    },
    get(sessionId: string) {
      return getSessionArtifacts(rootDir, sessionId);
    },
    getPage(sessionId: string, options: SessionArtifactPageOptions = {}) {
      return pageSessionArtifacts(getSessionArtifacts(rootDir, sessionId), options);
    },
    remove(sessionId: string) {
      try {
        unlinkSync(getSessionArtifactFilePath(rootDir, sessionId));
      } catch {
        // ignore missing file
      }
    },
  };
}

function resolveToolCallKind(
  currentKind: AgentToolCallKind,
  incomingKind: AgentToolCallKind,
) {
  return isHigherConfidenceToolKind(incomingKind, currentKind) ? incomingKind : currentKind;
}

function isHigherConfidenceToolKind(
  incomingKind: AgentToolCallKind,
  currentKind: AgentToolCallKind,
) {
  const rank: Record<AgentToolCallKind, number> = {
    unknown: 0,
    tool: 1,
    think: 2,
    todo: 2,
    fetch: 2,
    search: 3,
    read: 3,
    write: 3,
    shell: 3,
    skill: 3,
    subagent: 3,
    mcp: 4,
  };
  return rank[incomingKind] > rank[currentKind];
}

function resolveToolCallInput(currentInput: string | undefined, incomingInput: string | undefined) {
  return incomingInput ?? currentInput;
}

function resolveToolCallTitle(currentTitle: string, incomingTitle: string, id: string) {
  if (isInformativeToolCallTitle(incomingTitle, id) && !isFallbackToolCallTitle(incomingTitle)) {
    return incomingTitle;
  }
  return currentTitle || incomingTitle || id;
}

function isInformativeToolCallTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function isFallbackToolCallTitle(title: string | undefined) {
  return /^Tool call\b/u.test(title?.trim() ?? "");
}

export function pageSessionArtifacts(
  artifacts: SessionArtifacts,
  options: SessionArtifactPageOptions = {},
): SessionArtifactPage {
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_ARTIFACT_PAGE_LIMIT,
    MAX_ARTIFACT_PAGE_LIMIT,
  );
  const before = decodeArtifactCursor(options.before);
  const activities = [
    ...artifacts.outputs.map((item) => ({
      kind: "output" as const,
      timestamp: item.timestamp,
      id: item.id,
      item,
    })),
    ...artifacts.toolCalls.map((item) => ({
      kind: "toolCall" as const,
      timestamp: item.updatedAt || item.timestamp,
      id: item.id,
      item,
    })),
  ].sort((left, right) =>
    compareTimestampIdPosition(left.timestamp, left.id, right.timestamp, right.id),
  );
  const eligible = before
    ? activities.filter(
        (activity) =>
          compareTimestampIdPosition(activity.timestamp, activity.id, before.timestamp, before.id) <
          0,
      )
    : activities;
  const pageActivities = eligible.slice(Math.max(eligible.length - limit, 0));
  const outputIds = new Set(
    pageActivities.filter((activity) => activity.kind === "output").map((activity) => activity.id),
  );
  const toolCallIds = new Set(
    pageActivities
      .filter((activity) => activity.kind === "toolCall")
      .map((activity) => activity.id),
  );
  const hasMore = eligible.length > pageActivities.length;

  return {
    outputs: artifacts.outputs.filter((item) => outputIds.has(item.id)),
    diffs: artifacts.diffs,
    toolCalls: artifacts.toolCalls.filter((item) => toolCallIds.has(item.id)),
    nextCursor: hasMore
      ? encodeCursor(pageActivities[0]?.timestamp, pageActivities[0]?.id)
      : undefined,
    hasMore,
  };
}

function decodeArtifactCursor(cursor: string | undefined) {
  const parts = decodeCursor(cursor, 2);
  return parts ? { timestamp: parts[0], id: parts[1] } : null;
}

function getSessionArtifacts(rootDir: string, sessionId: string): SessionArtifacts {
  try {
    const raw = readFileSync(getSessionArtifactFilePath(rootDir, sessionId), "utf8");
    const parsed = JSON.parse(raw);
    return {
      outputs: Array.isArray(parsed?.outputs)
        ? sortCommandChunks(parsed.outputs.filter(isCommandChunk))
        : [],
      diffs: Array.isArray(parsed?.diffs) ? parsed.diffs.filter(isFileDiffSummary) : [],
      toolCalls: Array.isArray(parsed?.toolCalls)
        ? sortToolCalls(
            (parsed.toolCalls as unknown[]).filter(isAgentToolCall).map((item) => normalizeAgentToolCall(item)),
          )
        : [],
    };
  } catch {
    return { outputs: [], diffs: [], toolCalls: [] };
  }
}

const VALID_TOOL_CALL_KINDS = new Set<AgentToolCallKind>([
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

function normalizeAgentToolCallKind(value: unknown): AgentToolCallKind {
  if (value === "terminal") return "shell";
  if (value === "edit") return "write";
  return typeof value === "string" && VALID_TOOL_CALL_KINDS.has(value as AgentToolCallKind)
    ? (value as AgentToolCallKind)
    : "unknown";
}

function normalizeAgentToolCall(toolCall: AgentToolCall): AgentToolCall {
  const normalizedKind = normalizeAgentToolCallKind(toolCall.kind);
  const inputToolName = toolNameFromInput(toolCall.input);
  if (!inputToolName || (normalizedKind !== "mcp" && !isHigherConfidenceToolKind("mcp", normalizedKind))) {
    return { ...toolCall, kind: normalizedKind };
  }

  return {
    ...toolCall,
    kind: "mcp",
    title: resolveMcpToolCallTitle(toolCall.title, toolCall.id, inputToolName),
  };
}

function resolveMcpToolCallTitle(title: string, id: string, inputToolName: string) {
  if (!isInformativeToolCallTitle(title, id) || isFallbackToolCallTitle(title)) {
    return `Tool: ${inputToolName}`;
  }

  const unqualifiedInputToolName = inputToolName.split("/").at(-1);
  return unqualifiedInputToolName && title.trim() === unqualifiedInputToolName
    ? `Tool: ${inputToolName}`
    : title;
}

function toolNameFromInput(input: string | undefined) {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const record = parsed as Record<string, unknown>;
    const server = primitiveStringFrom(record.server);
    const tool = primitiveStringFrom(record.tool ?? record.name ?? record.toolName ?? record.tool_name);
    return server && tool ? `${server}/${tool}` : tool ?? server ?? inferToolNameFromStructuredPayload(record);
  } catch {
    return undefined;
  }
}

function inferToolNameFromStructuredPayload(record: Record<string, unknown>) {
  if (typeof record.code === "string" && ("timeout_ms" in record || "timeoutMs" in record)) {
    return "node_repl/js";
  }
  if (
    typeof record.project_root_path === "string" &&
    typeof record.message === "string" &&
    Array.isArray(record.predefined_options)
  ) {
    return "sanshu/zhi";
  }
  if (typeof record.project_path === "string" && typeof record.action === "string") {
    return "sanshu/ji";
  }
  return undefined;
}

function primitiveStringFrom(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function sortCommandChunks(items: CommandChunk[]) {
  return [...items].sort((left, right) =>
    compareTimestampIdPosition(left.timestamp, left.id, right.timestamp, right.id),
  );
}

function sortToolCalls(items: AgentToolCall[]) {
  return [...items].sort((left, right) =>
    compareTimestampIdPosition(
      left.updatedAt || left.timestamp,
      left.id,
      right.updatedAt || right.timestamp,
      right.id,
    ),
  );
}

function persistSessionArtifacts(rootDir: string, sessionId: string, artifacts: SessionArtifacts) {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(
    getSessionArtifactFilePath(rootDir, sessionId),
    JSON.stringify(artifacts, null, 2),
    "utf8",
  );
}

function getSessionArtifactFilePath(rootDir: string, sessionId: string) {
  return join(rootDir, `${sessionId}.json`);
}

function isCommandChunk(value: unknown): value is CommandChunk {
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

function isFileDiffSummary(value: unknown): value is FileDiffSummary {
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

function isAgentToolCall(value: unknown): value is AgentToolCall {
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
