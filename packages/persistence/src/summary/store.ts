import type {
  RuntimeResumeMode,
  SessionResumeInfo,
  SessionResumeState,
  SessionSummary,
} from "@tiller/shared";

export function isSessionSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.projectId === "string" &&
    typeof candidate.projectName === "string" &&
    typeof candidate.helmId === "string" &&
    typeof candidate.cwd === "string" &&
    (typeof candidate.worktreeName === "string" || typeof candidate.worktreeName === "undefined") &&
    typeof candidate.agentId === "string" &&
    typeof candidate.agentName === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.messageCount === "number" &&
    (typeof candidate.runtimeSessionId === "string" ||
      typeof candidate.runtimeSessionId === "undefined") &&
    (typeof candidate.title === "string" || typeof candidate.title === "undefined") &&
    (typeof candidate.lastMessagePreview === "string" ||
      typeof candidate.lastMessagePreview === "undefined") &&
    (typeof candidate.resume === "undefined" || isSessionResumeInfo(candidate.resume))
  );
}

export function normalizeSessionSummary(value: unknown): SessionSummary | null {
  return isSessionSummary(value) ? value : null;
}

export function isSessionResumeInfo(value: unknown): value is SessionResumeInfo {
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
    (typeof candidate.runtimeSessionId === "string" ||
      typeof candidate.runtimeSessionId === "undefined") &&
    (typeof candidate.lastSeenAt === "string" || typeof candidate.lastSeenAt === "undefined")
  );
}

function isResumeMode(value: unknown): value is RuntimeResumeMode {
  return value === "none" || value === "same-process" || value === "reconnect";
}

function isResumeState(value: unknown): value is SessionResumeState {
  return value === "history-only" || value === "resume-available" || value === "resume-unavailable";
}
