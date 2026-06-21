import type { SessionSummary } from "@tiller/shared";

export type MissionDraftChatWindow = {
  id: string;
  projectId: string;
  cwd: string | null;
  agentId: string | null;
};

export type BuildChatWindowModelInput = {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeSession: SessionSummary | null | undefined;
  openChatSessionIds: string[];
  focusedChatWindowId: string | null;
  draftChatWindow: MissionDraftChatWindow | null;
  isMissionMobile?: boolean;
};

export type ChatWindowModel = {
  focusedRealSessionId: string | null;
  persistedOpenChatSessionIds: string[];
  visibleChatSessionIds: string[];
  openSessions: SessionSummary[];
  openSessionIdSet: Set<string>;
  focusedDraftWindow: MissionDraftChatWindow | null;
  selectedComposerSession: SessionSummary | null | undefined;
};

export const MAX_OPEN_CHAT_SESSION_WINDOWS = 6;

export function buildChatWindowModel(input: BuildChatWindowModelInput): ChatWindowModel {
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  const focusedRealSessionId = input.focusedChatWindowId?.startsWith("session:")
    ? input.focusedChatWindowId.slice("session:".length)
    : null;
  const focusedDraftWindow = input.draftChatWindow && input.focusedChatWindowId === input.draftChatWindow.id
    ? input.draftChatWindow
    : null;
  const persistedOpenChatSessionIds = trimOpenChatSessionIds(input.openChatSessionIds);
  const visibleChatSessionIds = resolveVisibleChatSessionIds(
    {
      sessionById,
      persistedOpenChatSessionIds,
      activeSessionId: input.activeSession?.id ?? input.activeSessionId,
      focusedRealSessionId,
      focusedDraftWindowId: focusedDraftWindow?.id ?? null,
      isMissionMobile: input.isMissionMobile ?? false,
    },
  );
  const openSessions = visibleChatSessionIds
    .map((sessionId) => sessionById.get(sessionId))
    .filter((session): session is SessionSummary => Boolean(session));
  const openSessionIdSet = new Set(visibleChatSessionIds);
  const selectedComposerSession = focusedDraftWindow
    ? null
    : sessionById.get(focusedRealSessionId ?? input.activeSession?.id ?? "") ?? input.activeSession;

  return {
    focusedRealSessionId,
    persistedOpenChatSessionIds,
    visibleChatSessionIds,
    openSessions,
    openSessionIdSet,
    focusedDraftWindow,
    selectedComposerSession,
  };
}

export function trimOpenChatSessionIds(sessionIds: string[]) {
  const seen = new Set<string>();
  const trimmed: string[] = [];
  for (const sessionId of sessionIds) {
    if (!sessionId || seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    trimmed.push(sessionId);
    if (trimmed.length >= MAX_OPEN_CHAT_SESSION_WINDOWS) {
      break;
    }
  }
  return trimmed;
}

function resolveVisibleChatSessionIds({
  sessionById,
  persistedOpenChatSessionIds,
  activeSessionId,
  focusedRealSessionId,
  focusedDraftWindowId,
  isMissionMobile,
}: {
  sessionById: Map<string, SessionSummary>;
  persistedOpenChatSessionIds: string[];
  activeSessionId: string | null | undefined;
  focusedRealSessionId: string | null;
  focusedDraftWindowId: string | null;
  isMissionMobile: boolean;
}) {
  if (isMissionMobile) {
    if (focusedDraftWindowId) {
      return [];
    }
    const effectiveFocusedSessionId = focusedRealSessionId && sessionById.has(focusedRealSessionId)
      ? focusedRealSessionId
      : null;
    const visibleSessionId =
      effectiveFocusedSessionId ?? activeSessionId ?? persistedOpenChatSessionIds[0] ?? null;
    return visibleSessionId ? [visibleSessionId] : [];
  }

  if (!activeSessionId || persistedOpenChatSessionIds.includes(activeSessionId)) {
    return persistedOpenChatSessionIds;
  }
  return [
    activeSessionId,
    ...persistedOpenChatSessionIds.slice(0, MAX_OPEN_CHAT_SESSION_WINDOWS - 1),
  ];
}
