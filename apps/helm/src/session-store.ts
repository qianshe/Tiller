import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeResumeMode, SessionResumeInfo, SessionResumeState, SessionSummary } from "@tiller/shared";

export function createSessionStore(filePath: string) {
  let summaries = loadSessionSummaries(filePath);

  return {
    list() {
      return [...summaries];
    },
    upsert(summary: SessionSummary) {
      summaries = upsertSessionSummary(summaries, summary);
      persistSessionSummaries(filePath, summaries);
      return [...summaries];
    },
  };
}

function loadSessionSummaries(filePath: string) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortSessionSummaries(parsed.filter(isSessionSummary)) : [];
  } catch {
    return [];
  }
}

function persistSessionSummaries(filePath: string, summaries: SessionSummary[]) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(summaries, null, 2), "utf8");
}

function upsertSessionSummary(current: SessionSummary[], summary: SessionSummary) {
  const next = [summary, ...current.filter((item) => item.id !== summary.id)];
  return sortSessionSummaries(next);
}

function sortSessionSummaries(summaries: SessionSummary[]) {
  return [...summaries].sort((left, right) => {
    const rightTime = Date.parse(right.updatedAt);
    const leftTime = Date.parse(left.updatedAt);
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.workspaceId === "string" &&
    typeof candidate.workspaceName === "string" &&
    typeof candidate.agentId === "string" &&
    typeof candidate.agentName === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.messageCount === "number" &&
    (typeof candidate.runtimeSessionId === "string" || typeof candidate.runtimeSessionId === "undefined") &&
    (typeof candidate.lastMessagePreview === "string" || typeof candidate.lastMessagePreview === "undefined") &&
    (typeof candidate.resume === "undefined" || isSessionResumeInfo(candidate.resume))
  );
}

function isSessionResumeInfo(value: unknown): value is SessionResumeInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isResumeMode(candidate.mode) &&
    isResumeState(candidate.state) &&
    typeof candidate.reason === "string" &&
    typeof candidate.checkedAt === "string" &&
    (typeof candidate.providerId === "string" || typeof candidate.providerId === "undefined") &&
    (typeof candidate.runtimeSessionId === "string" || typeof candidate.runtimeSessionId === "undefined") &&
    (typeof candidate.lastSeenAt === "string" || typeof candidate.lastSeenAt === "undefined")
  );
}

function isResumeMode(value: unknown): value is RuntimeResumeMode {
  return value === "none" || value === "same-process" || value === "reconnect";
}

function isResumeState(value: unknown): value is SessionResumeState {
  return value === "history-only" || value === "resume-available" || value === "resume-unavailable";
}
