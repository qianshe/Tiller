import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
    remove(sessionId: string) {
      summaries = summaries.filter((item) => item.id !== sessionId);
      persistOrDeleteSessionSummaries(filePath, summaries);
      return [...summaries];
    },
  };
}

function loadSessionSummaries(filePath: string) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? sortSessionSummaries(parsed.map(normalizeSessionSummary).filter((item): item is SessionSummary => item !== null))
      : [];
  } catch {
    return [];
  }
}

function persistSessionSummaries(filePath: string, summaries: SessionSummary[]) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(summaries, null, 2), "utf8");
}

function persistOrDeleteSessionSummaries(filePath: string, summaries: SessionSummary[]) {
  if (!summaries.length) {
    try {
      unlinkSync(filePath);
    } catch {
      // ignore missing file
    }
    return;
  }
  persistSessionSummaries(filePath, summaries);
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
    typeof candidate.projectId === "string" &&
    typeof candidate.projectName === "string" &&
    typeof candidate.helmId === "string" &&
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

function normalizeSessionSummary(value: unknown): SessionSummary | null {
  if (isSessionSummary(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const hasLegacyCoreFields =
    typeof candidate.id === "string" &&
    typeof candidate.workspaceId === "string" &&
    typeof candidate.workspaceName === "string" &&
    typeof candidate.agentId === "string" &&
    typeof candidate.agentName === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.messageCount === "number";

  if (!hasLegacyCoreFields) {
    return null;
  }

  return {
    id: candidate.id as string,
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : "legacy-project",
    projectName: typeof candidate.projectName === "string" ? candidate.projectName : String(candidate.workspaceName),
    helmId: typeof candidate.helmId === "string" ? candidate.helmId : "legacy-helm",
    workspaceId: candidate.workspaceId as string,
    workspaceName: candidate.workspaceName as string,
    agentId: candidate.agentId as string,
    agentName: candidate.agentName as string,
    agentMode: typeof candidate.agentMode === "string" && candidate.agentMode.trim() ? candidate.agentMode : undefined,
    model: typeof candidate.model === "string" && candidate.model.trim() ? candidate.model : undefined,
    reasoningEffort:
      candidate.reasoningEffort === "minimal" ||
      candidate.reasoningEffort === "low" ||
      candidate.reasoningEffort === "medium" ||
      candidate.reasoningEffort === "high" ||
      candidate.reasoningEffort === "xhigh"
        ? candidate.reasoningEffort
        : undefined,
    status: candidate.status as SessionSummary["status"],
    createdAt: candidate.createdAt as string,
    updatedAt: candidate.updatedAt as string,
    messageCount: candidate.messageCount as number,
    runtimeSessionId: typeof candidate.runtimeSessionId === "string" ? candidate.runtimeSessionId : undefined,
    lastMessagePreview: typeof candidate.lastMessagePreview === "string" ? candidate.lastMessagePreview : undefined,
    resume: normalizeResumeInfo(candidate.resume),
  };
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

function normalizeResumeInfo(value: unknown): SessionResumeInfo | undefined {
  if (!isSessionResumeInfo(value)) {
    return undefined;
  }

  return {
    mode: value.mode,
    state: value.state,
    reason: value.reason,
    checkedAt: value.checkedAt,
    providerId: value.providerId,
    runtimeSessionId: value.runtimeSessionId,
    restoreMethod: value.restoreMethod,
    lastSeenAt: value.lastSeenAt,
  };
}

function isResumeMode(value: unknown): value is RuntimeResumeMode {
  return value === "none" || value === "same-process" || value === "reconnect";
}

function isResumeState(value: unknown): value is SessionResumeState {
  return value === "history-only" || value === "resume-available" || value === "resume-unavailable";
}
