import type { SessionConfigOptionValue, SessionReasoningEffort } from "@tiller/shared";

export type StoredSessionRuntimeDescriptor = {
  /** Tiller-local session id. */
  sessionId: string;
  projectId?: string;
  helmId?: string;
  providerId: string;
  /** ACP-native session id returned by session/new, used for session/load or session/resume. */
  runtimeSessionId?: string;
  capabilities?: {
    sessionLoad?: boolean;
    sessionResume?: boolean;
    sessionList?: boolean;
    sessionClose?: boolean;
    sessionDelete?: boolean;
    imageInput?: boolean;
  };
  /** Config selections saved while no ACP runtime was available. */
  pendingConfig?: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
    configOptions?: Array<{
      configId: string;
      value: SessionConfigOptionValue;
    }>;
  };
  lastSeenAt: string;
  state: "resumeable" | "stale" | "lost";
};

export function isStoredSessionRuntimeDescriptor(
  value: unknown,
): value is StoredSessionRuntimeDescriptor {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    (typeof candidate.projectId === "string" || typeof candidate.projectId === "undefined") &&
    (typeof candidate.helmId === "string" || typeof candidate.helmId === "undefined") &&
    typeof candidate.providerId === "string" &&
    (typeof candidate.runtimeSessionId === "string" ||
      typeof candidate.runtimeSessionId === "undefined") &&
    isCapabilities(candidate.capabilities) &&
    isPendingConfig(candidate.pendingConfig) &&
    typeof candidate.lastSeenAt === "string" &&
    (candidate.state === "resumeable" || candidate.state === "stale" || candidate.state === "lost")
  );
}

function isPendingConfig(value: unknown): boolean {
  if (typeof value === "undefined") {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const hasValidDirectConfig = candidate.configOptions === undefined ||
    (
      Array.isArray(candidate.configOptions) &&
      candidate.configOptions.every((option) => {
        if (!option || typeof option !== "object") {
          return false;
        }
        const configOption = option as Record<string, unknown>;
        return typeof configOption.configId === "string" &&
          (typeof configOption.value === "string" || typeof configOption.value === "boolean");
      })
    );
  return (
    (typeof candidate.agentMode === "string" || typeof candidate.agentMode === "undefined") &&
    (typeof candidate.model === "string" || typeof candidate.model === "undefined") &&
    (
      candidate.reasoningEffort === "minimal" ||
      candidate.reasoningEffort === "low" ||
      candidate.reasoningEffort === "medium" ||
      candidate.reasoningEffort === "high" ||
      candidate.reasoningEffort === "xhigh" ||
      typeof candidate.reasoningEffort === "undefined"
    ) &&
    hasValidDirectConfig
  );
}

function isCapabilities(value: unknown) {
  if (typeof value === "undefined") {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return [
    "sessionLoad",
    "sessionResume",
    "sessionList",
    "sessionClose",
    "sessionDelete",
    "imageInput",
  ].every((key) => typeof candidate[key] === "boolean" || typeof candidate[key] === "undefined");
}
