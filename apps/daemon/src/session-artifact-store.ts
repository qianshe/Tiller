import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandChunk, FileDiffSummary } from "@tiller/shared";

type SessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
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
    get(sessionId: string) {
      return getSessionArtifacts(rootDir, sessionId);
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
    };
  } catch {
    return { outputs: [], diffs: [] };
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
