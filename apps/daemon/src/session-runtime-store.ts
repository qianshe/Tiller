import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RuntimeResumeMode } from "@tiller/shared";

export type StoredSessionRuntimeDescriptor = {
  sessionId: string;
  providerId: string;
  resumeMode: RuntimeResumeMode;
  runtimeSessionId?: string;
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
    isResumeMode(candidate.resumeMode) &&
    (typeof candidate.runtimeSessionId === "string" || typeof candidate.runtimeSessionId === "undefined") &&
    typeof candidate.lastSeenAt === "string" &&
    (candidate.state === "resumeable" || candidate.state === "stale" || candidate.state === "lost")
  );
}

function isResumeMode(value: unknown): value is RuntimeResumeMode {
  return value === "none" || value === "same-process" || value === "reconnect";
}
