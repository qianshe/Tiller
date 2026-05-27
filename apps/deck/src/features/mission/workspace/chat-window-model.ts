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

export function buildChatWindowModel(input: BuildChatWindowModelInput): ChatWindowModel {
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  const focusedRealSessionId = input.focusedChatWindowId?.startsWith("session:")
    ? input.focusedChatWindowId.slice("session:".length)
    : null;
  const persistedOpenChatSessionIds = input.openChatSessionIds;
  const visibleChatSessionIds = input.activeSession?.id && !persistedOpenChatSessionIds.includes(input.activeSession.id)
    ? [...persistedOpenChatSessionIds, input.activeSession.id]
    : persistedOpenChatSessionIds;
  const openSessions = visibleChatSessionIds
    .map((sessionId) => sessionById.get(sessionId))
    .filter((session): session is SessionSummary => Boolean(session));
  const openSessionIdSet = new Set(visibleChatSessionIds);
  const focusedDraftWindow = input.draftChatWindow && input.focusedChatWindowId === input.draftChatWindow.id
    ? input.draftChatWindow
    : null;
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
