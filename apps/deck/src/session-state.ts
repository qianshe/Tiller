import type {
  AcpModelOption,
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  PermissionRequest,
  SessionConfigOption,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";

export type SessionScopedMaps = {
  statuses: Record<string, SessionStatus>;
  messages: Record<string, AgentMessage[]>;
  permissionRequests: Record<string, PermissionRequest | null>;
  outputs: Record<string, CommandChunk[]>;
  diffs: Record<string, FileDiffSummary[]>;
};

export function createSessionStatusMap(sessions: SessionSummary[]): Record<string, SessionStatus> {
  return Object.fromEntries(sessions.map((session) => [session.id, session.status] as const));
}

export function pruneSessionScopedMap<T>(current: Record<string, T>, sessions: SessionSummary[]): Record<string, T> {
  const liveSessionIds = new Set(sessions.map((session) => session.id));
  return Object.fromEntries(Object.entries(current).filter(([sessionId]) => liveSessionIds.has(sessionId)));
}

export function resolveActiveSessionId(current: string | null, sessions: SessionSummary[]): string | null {
  if (current && sessions.some((session) => session.id === current)) {
    return current;
  }
  return sessions[0]?.id ?? null;
}

export function applySessionListSnapshot(
  snapshot: { activeSessionId: string | null; maps: SessionScopedMaps },
  sessions: SessionSummary[],
) {
  return {
    sessions,
    activeSessionId: resolveActiveSessionId(snapshot.activeSessionId, sessions),
    maps: {
      statuses: createSessionStatusMap(sessions),
      messages: pruneSessionScopedMap(snapshot.maps.messages, sessions),
      permissionRequests: pruneSessionScopedMap(snapshot.maps.permissionRequests, sessions),
      outputs: pruneSessionScopedMap(snapshot.maps.outputs, sessions),
      diffs: pruneSessionScopedMap(snapshot.maps.diffs, sessions),
    } satisfies SessionScopedMaps,
  };
}

export function resolveDraftSelectionId<T extends { id: string }>(
  currentId: string | null | undefined,
  availableItems: T[],
  preferredId?: string | null,
) {
  if (currentId && availableItems.some((item) => item.id === currentId)) {
    return currentId;
  }

  if (preferredId && availableItems.some((item) => item.id === preferredId)) {
    return preferredId;
  }

  return availableItems[0]?.id ?? null;
}

export function resolveModelOptionsFromConfig(
  _currentModel: string | undefined,
  configOptions: SessionConfigOption[] = [],
  nativeOptions: AcpModelOption[] = [],
) {
  const modelOption = configOptions.find((option) => option.category?.toLowerCase() === "model");
  const configuredModels = (modelOption?.options ?? [])
    .map((option) => option.value)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (configuredModels.length) {
    return Array.from(new Set(configuredModels));
  }

  const nativeModels = nativeOptions.map((option) => option.id).filter((value) => value.trim().length > 0);
  return Array.from(new Set(nativeModels));
}


export function resolvePromptPlaceholder(agent?: { command?: string; args?: string[] } | null) {
  const command = [agent?.command, ...(agent?.args ?? [])]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
  return `向 ${command || "ACP 舰员"} 下达指令；@ 引用上下文，/ 调用命令`;
}
