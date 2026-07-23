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
    typeof candidate.lastSeenAt === "string" &&
    (candidate.state === "resumeable" || candidate.state === "stale" || candidate.state === "lost")
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
