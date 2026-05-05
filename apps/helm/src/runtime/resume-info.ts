import type { AcpAgentProvider, SessionResumeInfo, SessionSummary } from "@tiller/shared";
import type { StoredSessionRuntimeDescriptor } from "../sessions/runtime-store";

type ActiveSessionRecord = {
  runtime: {
    runtimeSessionId: string;
    sessionCapabilities?: StoredSessionRuntimeDescriptor["capabilities"];
  };
};

export function buildSessionResumeInfo(
  summary: SessionSummary,
  agent: AcpAgentProvider | undefined,
  activeRecord: ActiveSessionRecord | undefined,
  descriptor: StoredSessionRuntimeDescriptor | null | undefined,
): SessionResumeInfo {
  const checkedAt = new Date().toISOString();
  const runtimeSessionId =
    summary.runtimeSessionId ??
    activeRecord?.runtime.runtimeSessionId ??
    descriptor?.runtimeSessionId;
  const capabilities = resolveSessionRestoreCapabilities(
    agent,
    descriptor,
    activeRecord?.runtime.sessionCapabilities,
  );

  if (activeRecord) {
    return {
      mode: "same-process",
      state: "resume-available",
      reason:
        "Client can reconnect to the still-running Helm session; ACP restore is not required.",
      checkedAt,
      providerId: summary.agentId,
      runtimeSessionId,
      restoreMethod: "client-reconnect",
      lastSeenAt: summary.updatedAt,
    };
  }

  if (runtimeSessionId && (capabilities.sessionLoad || capabilities.sessionResume)) {
    return {
      mode: "reconnect",
      state: "resume-available",
      reason: capabilities.sessionLoad
        ? "ACP agent advertises session/load; Helm can try agent-side restore and history replay."
        : "ACP agent advertises session.resume; Helm can try context restore without replaying old messages.",
      checkedAt,
      providerId: summary.agentId,
      runtimeSessionId,
      restoreMethod: capabilities.sessionLoad ? "session/load" : "session/resume",
      lastSeenAt: summary.updatedAt,
    };
  }

  return {
    mode: "none",
    state: "history-only",
    reason:
      "ACP agent restore is unavailable; Tiller can only restore UI history recorded by Helm.",
    checkedAt,
    providerId: summary.agentId,
    runtimeSessionId,
    restoreMethod: "ui-history",
    lastSeenAt: summary.updatedAt,
  };
}

export function resolveSessionRestoreCapabilities(
  agent: AcpAgentProvider | undefined,
  descriptor?: StoredSessionRuntimeDescriptor | null,
  runtimeCapabilities?: StoredSessionRuntimeDescriptor["capabilities"],
) {
  return {
    sessionLoad: Boolean(
      runtimeCapabilities?.sessionLoad ??
        descriptor?.capabilities?.sessionLoad ??
        agent?.capabilities?.sessionLoad,
    ),
    sessionResume: Boolean(
      runtimeCapabilities?.sessionResume ??
        descriptor?.capabilities?.sessionResume ??
        agent?.capabilities?.sessionResume,
    ),
    sessionList: Boolean(
      runtimeCapabilities?.sessionList ??
        descriptor?.capabilities?.sessionList ??
        agent?.capabilities?.sessionList,
    ),
    sessionClose: Boolean(
      runtimeCapabilities?.sessionClose ??
        descriptor?.capabilities?.sessionClose ??
        agent?.capabilities?.sessionClose,
    ),
    sessionDelete: Boolean(
      runtimeCapabilities?.sessionDelete ??
        descriptor?.capabilities?.sessionDelete ??
        agent?.capabilities?.sessionDelete,
    ),
    imageInput: Boolean(
      runtimeCapabilities?.imageInput ??
        descriptor?.capabilities?.imageInput ??
        agent?.capabilities?.imageInput,
    ),
  };
}
