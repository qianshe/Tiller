import type { AgentProviderDescriptor, SessionResumeInfo, WorktreeSummary } from "@tiller/domain-contracts";

export type ResumePrecondition = {
  agent: AgentProviderDescriptor | undefined;
  worktree: WorktreeSummary | undefined;
  runtimeSessionId?: string;
  restoreMethod?: SessionResumeInfo["restoreMethod"];
  agentId: string;
  cwd?: string;
  nowIso: string;
};

export function resolveResumeUnavailableReason(input: ResumePrecondition): string | null {
  if (!input.agent) {
    return `Agent provider ${input.agentId} is not configured.`;
  }
  if (!input.worktree) {
    return input.cwd ? `Worktree path ${input.cwd} is not configured or does not exist.` : "Worktree cwd is not configured.";
  }
  if (!input.runtimeSessionId) {
    return "ACP runtime session id is missing.";
  }
  if (input.restoreMethod !== "session/load" && input.restoreMethod !== "session/resume") {
    return `ACP restore method ${input.restoreMethod ?? "none"} is unsupported.`;
  }
  return null;
}

export function buildResumeInfo(input: ResumePrecondition): SessionResumeInfo {
  const unavailableReason = resolveResumeUnavailableReason(input);
  if (unavailableReason) {
    return {
      mode: "none",
      state: "resume-unavailable",
      reason: unavailableReason,
      checkedAt: input.nowIso,
      providerId: input.agentId,
      runtimeSessionId: input.runtimeSessionId,
      restoreMethod: input.restoreMethod,
    };
  }

  return {
    mode: "reconnect",
    state: "resume-available",
    reason: `ACP restore is available via ${input.restoreMethod}.`,
    checkedAt: input.nowIso,
    providerId: input.agentId,
    runtimeSessionId: input.runtimeSessionId,
    restoreMethod: input.restoreMethod,
  };
}
