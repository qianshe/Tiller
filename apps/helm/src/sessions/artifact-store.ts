import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolCall, CommandChunk, FileDiffSummary } from "@tiller/shared";

type SessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
};

export function createSessionArtifactStore(rootDir: string) {
  return {
    appendOutput(sessionId: string, chunk: CommandChunk) {
      const current = getSessionArtifacts(rootDir, sessionId);
      const next = {
        ...current,
        outputs: [...current.outputs, chunk],
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
        : current.toolCalls.map((item, itemIndex) => itemIndex === index ? { ...item, ...toolCall, output: `${item.output ?? ""}${toolCall.output ?? ""}`, input: toolCall.input ?? item.input } : item);
      const next = {
        ...current,
        toolCalls: nextToolCalls,
      };
      persistSessionArtifacts(rootDir, sessionId, next);
      return next;
    },
    get(sessionId: string) {
      return getSessionArtifacts(rootDir, sessionId);
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

function getSessionArtifacts(rootDir: string, sessionId: string): SessionArtifacts {
  try {
    const raw = readFileSync(getSessionArtifactFilePath(rootDir, sessionId), "utf8");
    const parsed = JSON.parse(raw);
    return {
      outputs: Array.isArray(parsed?.outputs) ? parsed.outputs.filter(isCommandChunk) : [],
      diffs: Array.isArray(parsed?.diffs) ? parsed.diffs.filter(isFileDiffSummary) : [],
      toolCalls: Array.isArray(parsed?.toolCalls) ? parsed.toolCalls.filter(isAgentToolCall) : [],
    };
  } catch {
    return { outputs: [], diffs: [], toolCalls: [] };
  }
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
