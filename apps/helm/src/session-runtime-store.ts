import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export type StoredSessionRuntimeDescriptor = {
  /** Tiller-local session id. */
  sessionId: string;
  providerId: string;
  /** ACP-native session id returned by session/new, used for session/load or session/resume. */
  runtimeSessionId?: string;
  capabilities?: {
    sessionLoad?: boolean;
    sessionResume?: boolean;
    sessionList?: boolean;
  };
  lastSeenAt: string;
  state: "resumeable" | "stale" | "lost";
};

export function createSessionRuntimeStore(filePath: string) {
  let descriptors = loadRuntimeDescriptors(filePath);

  return {
    list() {
      return [...descriptors];
    },
    get(sessionId: string) {
      return descriptors.find((item) => item.sessionId === sessionId) ?? null;
    },
    upsert(descriptor: StoredSessionRuntimeDescriptor) {
      descriptors = upsertRuntimeDescriptor(descriptors, descriptor);
      persistRuntimeDescriptors(filePath, descriptors);
      return descriptor;
    },
  };
}

function loadRuntimeDescriptors(filePath: string) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredSessionRuntimeDescriptor) : [];
  } catch {
    return [];
  }
}

function persistRuntimeDescriptors(filePath: string, descriptors: StoredSessionRuntimeDescriptor[]) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(descriptors, null, 2), "utf8");
}

function upsertRuntimeDescriptor(current: StoredSessionRuntimeDescriptor[], descriptor: StoredSessionRuntimeDescriptor) {
  return [descriptor, ...current.filter((item) => item.sessionId !== descriptor.sessionId)];
}

function isStoredSessionRuntimeDescriptor(value: unknown): value is StoredSessionRuntimeDescriptor {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.providerId === "string" &&
    (typeof candidate.runtimeSessionId === "string" || typeof candidate.runtimeSessionId === "undefined") &&
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
  return ["sessionLoad", "sessionResume", "sessionList"].every(
    (key) => typeof candidate[key] === "boolean" || typeof candidate[key] === "undefined",
  );
}
