import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolCall, CommandChunk, FileDiffSummary } from "@tiller/shared";

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
      const nextToolCalls = index === -1
        ? [...current.toolCalls, toolCall]
        : current.toolCalls.map((item, itemIndex) => itemIndex === index ? {
            ...item,
            ...toolCall,
            title: resolveToolCallTitle(item.title, toolCall.title, toolCall.id),
            output: `${item.output ?? ""}${toolCall.output ?? ""}`,
            input: toolCall.input ?? item.input,
            timestamp: item.timestamp,
            updatedAt: toolCall.updatedAt,
          } : item);
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


function resolveToolCallTitle(currentTitle: string, incomingTitle: string, id: string) {
  if (isInformativeToolCallTitle(incomingTitle, id)) {
    return incomingTitle;
  }
  return currentTitle || incomingTitle || id;
}

function isInformativeToolCallTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

export function pageSessionArtifacts(artifacts: SessionArtifacts, options: SessionArtifactPageOptions = {}): SessionArtifactPage {
  const limit = normalizePageLimit(options.limit, DEFAULT_ARTIFACT_PAGE_LIMIT, MAX_ARTIFACT_PAGE_LIMIT);
  const before = decodeHistoryCursor(options.before);
  const activities = [
    ...artifacts.outputs.map((item) => ({ kind: "output" as const, timestamp: item.timestamp, id: item.id, item })),
    ...artifacts.toolCalls.map((item) => ({ kind: "toolCall" as const, timestamp: item.updatedAt || item.timestamp, id: item.id, item })),
  ].sort((left, right) => compareHistoryPosition(left.timestamp, left.id, right.timestamp, right.id));
  const eligible = before
    ? activities.filter((activity) => compareHistoryPosition(activity.timestamp, activity.id, before.timestamp, before.id) < 0)
    : activities;
  const pageActivities = eligible.slice(Math.max(eligible.length - limit, 0));
  const outputIds = new Set(pageActivities.filter((activity) => activity.kind === "output").map((activity) => activity.id));
  const toolCallIds = new Set(pageActivities.filter((activity) => activity.kind === "toolCall").map((activity) => activity.id));
  const hasMore = eligible.length > pageActivities.length;

  return {
    outputs: artifacts.outputs.filter((item) => outputIds.has(item.id)),
    diffs: artifacts.diffs,
    toolCalls: artifacts.toolCalls.filter((item) => toolCallIds.has(item.id)),
    nextCursor: hasMore ? encodeHistoryCursor(pageActivities[0]?.timestamp, pageActivities[0]?.id) : undefined,
    hasMore,
  };
}

function normalizePageLimit(limit: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) {
    return fallback;
  }
  return Math.min(Math.floor(limit), max);
}

function encodeHistoryCursor(timestamp: string | undefined, id: string | undefined) {
  return timestamp && id ? `${timestamp}\t${id}` : undefined;
}

function decodeHistoryCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }
  const [timestamp, id] = cursor.split("\t");
  if (!timestamp || !id) {
    return null;
  }
  return { timestamp, id };
}

function compareHistoryPosition(leftTimestamp: string, leftId: string, rightTimestamp: string, rightId: string) {
  const timestampDelta = Date.parse(leftTimestamp) - Date.parse(rightTimestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return leftId.localeCompare(rightId);
}

function getSessionArtifacts(rootDir: string, sessionId: string): SessionArtifacts {
  try {
    const raw = readFileSync(getSessionArtifactFilePath(rootDir, sessionId), "utf8");
    const parsed = JSON.parse(raw);
    return {
      outputs: Array.isArray(parsed?.outputs) ? sortCommandChunks(parsed.outputs.filter(isCommandChunk)) : [],
      diffs: Array.isArray(parsed?.diffs) ? parsed.diffs.filter(isFileDiffSummary) : [],
      toolCalls: Array.isArray(parsed?.toolCalls) ? sortToolCalls(parsed.toolCalls.filter(isAgentToolCall)) : [],
    };
  } catch {
    return { outputs: [], diffs: [], toolCalls: [] };
  }
}

function sortCommandChunks(items: CommandChunk[]) {
  return [...items].sort((left, right) => compareHistoryPosition(left.timestamp, left.id, right.timestamp, right.id));
}

function sortToolCalls(items: AgentToolCall[]) {
  return [...items].sort((left, right) => compareHistoryPosition(left.updatedAt || left.timestamp, left.id, right.updatedAt || right.timestamp, right.id));
}

function persistSessionArtifacts(rootDir: string, sessionId: string, artifacts: SessionArtifacts) {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(getSessionArtifactFilePath(rootDir, sessionId), JSON.stringify(artifacts, null, 2), "utf8");
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
