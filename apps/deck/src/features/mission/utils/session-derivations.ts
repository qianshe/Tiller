import type {
  AcpModelOption,
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  ProjectSummary,
  SessionConfigOption,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";

export type SessionScopedMaps = {
  statuses: Record<string, SessionStatus>;
  messages: Record<string, AgentMessage[]>;
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
  return null;
}

export function resolveDefaultMissionSessionId(
  current: string | null,
  sessions: SessionSummary[],
  statuses: Record<string, SessionStatus> = {},
): string | null {
  const liveCurrent = resolveActiveSessionId(current, sessions);
  if (liveCurrent) {
    return liveCurrent;
  }

  const statusOf = (session: SessionSummary) => statuses[session.id] ?? session.status;
  const pendingReview = sessions.find(
    (session) => statusOf(session) === "waiting_for_permission",
  );
  if (pendingReview) {
    return pendingReview.id;
  }

  return sessions.find((session) => {
    const status = statusOf(session);
    return status === "running" || status === "starting";
  })?.id ?? null;
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
      outputs: pruneSessionScopedMap(snapshot.maps.outputs, sessions),
      diffs: pruneSessionScopedMap(snapshot.maps.diffs, sessions),
    } satisfies SessionScopedMaps,
  };
}

export function resolveSessionProjectId(session: SessionSummary, projects: ProjectSummary[]) {
  const exactProject = projects.find((project) => project.id === session.projectId);
  if (exactProject) {
    return exactProject.id;
  }

  const nameProject = projects.find((project) => project.name === session.projectName);
  if (nameProject) {
    return nameProject.id;
  }

  const worktreeProject = projects.find((project) =>
    (project.worktrees ?? []).some(
      (worktree) => normalizePath(worktree.path) === normalizePath(session.cwd),
    ),
  );
  return worktreeProject?.id ?? session.projectId;
}

export function toggleExpandedIdSet(current: Set<string>, id: string) {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function resolveDraftSelectionId<T extends { path: string }>(
  currentId: string | null | undefined,
  availableItems: T[],
  preferredId?: string | null,
) {
  if (currentId && availableItems.some((item) => item.path === currentId)) {
    return currentId;
  }

  if (preferredId && availableItems.some((item) => item.path === preferredId)) {
    return preferredId;
  }

  return availableItems[0]?.path ?? null;
}

export function resolveMissionHelms(
  helms: HelmSummary[],
  effectiveMissionHelmId: string | null | undefined,
  activeHelm: HelmSummary | null = null,
) {
  const knownHelms = helms.length ? helms : activeHelm ? [activeHelm] : [];
  if (!effectiveMissionHelmId) {
    return knownHelms;
  }

  const selectedHelm = activeHelm?.id === effectiveMissionHelmId
    ? activeHelm
    : helms.find((helm) => helm.id === effectiveMissionHelmId) ?? null;
  if (!selectedHelm || knownHelms.some((helm) => helm.id === selectedHelm.id)) {
    return knownHelms;
  }

  return [...knownHelms, selectedHelm];
}

export function resolveProjectFilesScope(input: {
  activeSession: Pick<SessionSummary, "cwd"> | null | undefined;
  activeSessionProjectId: string | null | undefined;
}) {
  if (input.activeSession && input.activeSessionProjectId) {
    return { projectId: input.activeSessionProjectId, cwd: input.activeSession.cwd };
  }
  return { projectId: null, cwd: null };
}

function normalizePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

export function resolveMissionSelectedProjectId(input: {
  activeSessionProjectId: string | null | undefined;
  selectedProjectId: string | null | undefined;
}) {
  return input.activeSessionProjectId ?? input.selectedProjectId ?? null;
}

export function resolveModelOptionsFromConfig(
  currentModel: string | undefined,
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
  if (nativeModels.length) {
    return Array.from(new Set(nativeModels));
  }

  const fallbackModel = currentModel?.trim();
  return fallbackModel ? [fallbackModel] : [];
}


export function resolveSessionTitle(session: SessionSummary, preview = session.lastMessagePreview) {
  if (session.title?.trim()) {
    return session.title.trim();
  }
  const title = preview
    ?.replace(/[\p{P}\p{S}\s]+/gu, "")
    .slice(0, 5);

  return title || `${session.projectName} 任务`;
}

export function resolvePromptPlaceholder(_agent?: { command?: string; args?: string[] } | null) {
  return "Enter 发送消息 · Shift+Enter 换行 · / 命令 · Esc 取消";
}
