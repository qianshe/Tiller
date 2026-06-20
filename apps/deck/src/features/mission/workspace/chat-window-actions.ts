import type { SessionSummary } from "@tiller/shared";
import type { FormEvent } from "react";
import { useEffect, useRef } from "react";
import {
  MAX_OPEN_CHAT_SESSION_WINDOWS,
  trimOpenChatSessionIds,
  type MissionDraftChatWindow,
} from "./chat-window-model";
import { shouldAttachDraftWindowToSession } from "./draft-window";
import { useDeckStore } from "../../../store";

type StateSetter<T> = (valueOrUpdater: T | ((current: T) => T)) => void;
type LooseSetter = (valueOrUpdater: any) => void;

export type UseChatWindowActionsOptions = {
  activeSessionId: string | null | undefined;
  activeSession: SessionSummary | null | undefined;
  sessions: SessionSummary[];
  focusedChatWindowId: string | null | undefined;
  focusedRealSessionId: string | null;
  focusedDraftWindow: MissionDraftChatWindow | null;
  draftChatWindow: MissionDraftChatWindow | null;
  projects: any[];
  selectedProjectId: string | null | undefined;
  selectedCwd: string | null | undefined;
  selectedAgentId: string | null | undefined;
  hydrateOpenSessionStreams: (sessionIds: string[]) => void;
  setOpenChatSessionIds: StateSetter<string[]>;
  setFocusedChatWindowId: (windowId: string | null) => void;
  openSession: (sessionId: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setDraftChatWindow?: LooseSetter;
  setSelectedMissionHelmId: (helmId: string | null) => void;
  setSelectedProjectId: (projectId: string) => void;
  setSelectedCwd: (cwd: string | null) => void;
  setSelectedAgentId: (agentId: string | null) => void;
  setSelectedMissionMobilePane: (pane: "chat") => void;
  selectDraftAgent: (agentId: string) => void;
  submitPrompt: (event: FormEvent<HTMLFormElement>, targetSession?: SessionSummary | null) => void;
};

export type ChatWindowActions = {
  openChatSession: (sessionId: string) => void;
  selectChatSession: (sessionId: string) => void;
  closeChatSession: (session: SessionSummary) => void;
  openDraftChatWindow: (input: {
    projectId: string;
    cwd: string | null;
    agentId?: string | null;
  }) => void;
  selectAgentForDraftWindow: (agentId: string) => void;
  submitPromptFromFocusedWindow: (
    event: FormEvent<HTMLFormElement>,
    targetSession?: SessionSummary | null,
  ) => void;
};

export function useChatWindowActions(options: UseChatWindowActionsOptions): ChatWindowActions {
  const {
    activeSessionId,
    activeSession,
    sessions,
    focusedChatWindowId,
    focusedRealSessionId,
    focusedDraftWindow,
    draftChatWindow,
    projects,
    selectedProjectId,
    selectedCwd,
    selectedAgentId,
    hydrateOpenSessionStreams,
    setOpenChatSessionIds,
    setFocusedChatWindowId,
    openSession,
    setActiveSessionId,
    setDraftChatWindow,
    setSelectedMissionHelmId,
    setSelectedProjectId,
    setSelectedCwd,
    setSelectedAgentId,
    setSelectedMissionMobilePane,
    selectDraftAgent,
    submitPrompt,
  } = options;
  const pendingDraftWindowRef = useRef<MissionDraftChatWindow | null>(null);

  useEffect(() => {
    setOpenChatSessionIds((current: string[]) => {
      const existingSessionIds = new Set(sessions.map((session) => session.id));
      const retained = trimOpenChatSessionIds(
        current.filter((sessionId) => existingSessionIds.has(sessionId)),
      );
      if (!activeSession?.id || retained.includes(activeSession.id)) {
        return retained.length === current.length ? current : retained;
      }
      return addChatSessionIdToFront(retained, activeSession.id);
    });
  }, [activeSession?.id, sessions]);

  useEffect(() => {
    if (activeSession?.id && !focusedChatWindowId) {
      setFocusedChatWindowId(`session:${activeSession.id}`);
    }
  }, [activeSession?.id, focusedChatWindowId]);

  useEffect(() => {
    if (!focusedDraftWindow) {
      return;
    }
    if (focusedDraftWindow.projectId !== selectedProjectId) {
      setSelectedProjectId(focusedDraftWindow.projectId);
    }
    if (focusedDraftWindow.cwd !== selectedCwd) {
      setSelectedCwd(focusedDraftWindow.cwd);
    }
    if (focusedDraftWindow.agentId && focusedDraftWindow.agentId !== selectedAgentId) {
      setSelectedAgentId(focusedDraftWindow.agentId);
    }
  }, [focusedDraftWindow?.projectId, focusedDraftWindow?.cwd, focusedDraftWindow?.agentId, selectedProjectId, selectedCwd, selectedAgentId]);

  const openChatSession = (sessionId: string) => {
    setOpenChatSessionIds((current: string[]) => addChatSessionIdToFront(current, sessionId));
    hydrateOpenSessionStreams([sessionId]);
    if (sessionId !== activeSessionId) {
      openSession(sessionId);
    }
    setFocusedChatWindowId(`session:${sessionId}`);
  };

  const selectChatSession = (sessionId: string) => {
    setOpenChatSessionIds((current: string[]) =>
      current.includes(sessionId) ? current : addChatSessionIdToFront(current, sessionId),
    );
    if (sessionId !== activeSessionId) {
      openSession(sessionId);
    }
    setFocusedChatWindowId(`session:${sessionId}`);
  };

  const closeChatSession = (session: SessionSummary) => {
    setOpenChatSessionIds((current: string[]) => {
      const next = current.filter((sessionId) => sessionId !== session.id);
      if (focusedRealSessionId === session.id) {
        setFocusedChatWindowId(next[0] ? `session:${next[0]}` : null);
      }
      if (activeSessionId === session.id) {
        const nextActiveSessionId = next[0] ?? null;
        if (nextActiveSessionId) {
          openSession(nextActiveSessionId);
        } else {
          setActiveSessionId(null);
        }
      }
      return next;
    });
    releaseClosedSessionStreamData(session.id);
  };

  const openDraftChatWindow = ({
    projectId,
    cwd,
    agentId = null,
  }: {
    projectId: string;
    cwd: string | null;
    agentId?: string | null;
  }) => {
    const project = projects.find((item: any) => item.id === projectId);
    const draftWindow = {
      id: `draft:${projectId}`,
      projectId,
      cwd,
      agentId,
    };
    setDraftChatWindow?.(draftWindow);
    setFocusedChatWindowId(draftWindow.id);
    setActiveSessionId(null);
    setSelectedMissionHelmId(project?.helmId ?? null);
    setSelectedProjectId(projectId);
    setSelectedCwd(cwd);
    setSelectedAgentId(agentId);
    setActiveSessionId(null);
    setSelectedMissionMobilePane("chat");
  };

  const selectAgentForDraftWindow = (agentId: string) => {
    const focusedDraftWindowId = draftChatWindow?.id ?? (selectedProjectId ? `draft:${selectedProjectId}` : null);
    setDraftChatWindow?.((current: any) => (current ? { ...current, agentId } : current));
    if (focusedDraftWindowId) {
      setFocusedChatWindowId(focusedDraftWindowId);
    }
    setActiveSessionId(null);
    selectDraftAgent(agentId);
  };

  const submitPromptFromFocusedWindow = (event: FormEvent<HTMLFormElement>, targetSession?: SessionSummary | null) => {
    if (focusedDraftWindow) {
      pendingDraftWindowRef.current = draftChatWindow;
    }
    submitPrompt(event, targetSession);
  };

  useEffect(() => {
    const pendingDraftWindow = pendingDraftWindowRef.current;
    if (!shouldAttachDraftWindowToSession(pendingDraftWindow, activeSession) || !activeSession?.id) {
      return;
    }
    const attachedSessionId = activeSession.id;
    pendingDraftWindowRef.current = null;
    setDraftChatWindow?.(null);
    setOpenChatSessionIds((current: string[]) =>
      addChatSessionIdToFront(current, attachedSessionId),
    );
    setFocusedChatWindowId(`session:${attachedSessionId}`);
  }, [activeSession?.id, activeSession?.projectId, activeSession?.cwd, activeSession?.agentId, draftChatWindow]);

  return {
    openChatSession,
    selectChatSession,
    closeChatSession,
    openDraftChatWindow,
    selectAgentForDraftWindow,
    submitPromptFromFocusedWindow,
  };
}

export function addChatSessionIdToFront(current: string[], sessionId: string) {
  if (current.includes(sessionId)) {
    return trimOpenChatSessionIds(current);
  }
  return trimOpenChatSessionIds([sessionId, ...current.filter((item) => item !== sessionId)]);
}

function releaseClosedSessionStreamData(sessionId: string) {
  const store = useDeckStore.getState();
  store.setMessages((current) => {
    if (!(sessionId in current)) return current;
    const { [sessionId]: _, ...rest } = current;
    return rest;
  });
  store.setSessionTimeline((current) => {
    if (!(sessionId in current)) return current;
    const { [sessionId]: _, ...rest } = current;
    return rest;
  });
  store.setOutputs((current) => {
    if (!(sessionId in current)) return current;
    const { [sessionId]: _, ...rest } = current;
    return rest;
  });
  store.setToolCalls((current) => {
    if (!(sessionId in current)) return current;
    const { [sessionId]: _, ...rest } = current;
    return rest;
  });
  store.setDiffs((current) => {
    if (!(sessionId in current)) return current;
    const { [sessionId]: _, ...rest } = current;
    return rest;
  });
  store.setMessageHistoryState((current) => {
    if (!(sessionId in current)) return current;
    const { [sessionId]: _, ...rest } = current;
    return rest;
  });
}

export { MAX_OPEN_CHAT_SESSION_WINDOWS };
