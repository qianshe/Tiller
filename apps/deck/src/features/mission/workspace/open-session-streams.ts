import type { SessionSummary } from "@tiller/shared";
import { useEffect, useRef } from "react";
import {
  subscribeToSessionTopic,
  unsubscribeFromSessionTopic,
  type DispatchToHelm,
  type DeckRpcClient,
} from "../../helm-connection/facade";
import { DEFAULT_ACTIVITY_PAGE_LIMIT, DEFAULT_MESSAGE_PAGE_LIMIT } from "../config";
import {
  buildSessionStreamHydrationPlan,
  type WorkspaceSessionStreamHydrationInput,
} from "./session-streams";

type MutableRefLike<T> = {
  current: T;
};

type SessionStateSetter = (updater: (current: any) => any) => void;

export type OpenSessionStreamsOptions = {
  pairingState: string;
  rpcClientRef: MutableRefLike<DeckRpcClient | null>;
  dispatch: DispatchToHelm;
  openSessions: SessionSummary[];
  sessions: SessionSummary[];
  messageHistoryState: WorkspaceSessionStreamHydrationInput["messageHistoryState"];
  activityHistoryState: WorkspaceSessionStreamHydrationInput["activityHistoryState"];
  messagesBySession: WorkspaceSessionStreamHydrationInput["messagesBySession"];
  outputsBySession: WorkspaceSessionStreamHydrationInput["outputsBySession"];
  toolCallsBySession: WorkspaceSessionStreamHydrationInput["toolCallsBySession"];
  setMessageHistoryState: SessionStateSetter;
  setActivityHistoryState: SessionStateSetter;
};

export function useOpenSessionStreams(options: OpenSessionStreamsOptions) {
  const {
    pairingState,
    rpcClientRef,
    dispatch,
    openSessions,
    sessions,
    messageHistoryState,
    activityHistoryState,
    messagesBySession,
    outputsBySession,
    toolCallsBySession,
    setMessageHistoryState,
    setActivityHistoryState,
  } = options;
  const openSessionResumeCheckRef = useRef<Set<string>>(new Set());
  const openSessionTopicSubscriptionsRef = useRef<Set<string>>(new Set());
  const openSessionStreamKey = openSessions.map((session) => session.id).join("|");

  useEffect(() => {
    const client = rpcClientRef.current;
    if (
      pairingState !== "paired" ||
      !client ||
      client.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const nextSessionIds = new Set(openSessions.map((session) => session.id));
    const subscribedSessionIds = openSessionTopicSubscriptionsRef.current;

    subscribedSessionIds.forEach((sessionId) => {
      if (!nextSessionIds.has(sessionId)) {
        subscribedSessionIds.delete(sessionId);
        void unsubscribeFromSessionTopic(client, sessionId, dispatch);
      }
    });
    nextSessionIds.forEach((sessionId) => {
      if (!subscribedSessionIds.has(sessionId)) {
        subscribedSessionIds.add(sessionId);
        void subscribeToSessionTopic(client, sessionId, dispatch);
      }
    });

    return () => {
      nextSessionIds.forEach((sessionId) => {
        if (client.socket.readyState === WebSocket.OPEN) {
          void unsubscribeFromSessionTopic(client, sessionId, dispatch);
        }
        subscribedSessionIds.delete(sessionId);
      });
    };
  }, [openSessionStreamKey, pairingState]);

  const hydrateOpenSessionStreams = (sessionIds: string[]) => {
    const client = rpcClientRef.current;
    if (
      pairingState !== "paired" ||
      !client ||
      client.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const {
      messageSessionIds,
      activitySessionIds,
      resumeCheckSessionIds,
    } = buildSessionStreamHydrationPlan({
      sessionIds,
      sessionById,
      messageHistoryState,
      activityHistoryState,
      messagesBySession,
      outputsBySession,
      toolCallsBySession,
      checkedResumeSessionIds: openSessionResumeCheckRef.current,
    });

    if (messageSessionIds.length > 0) {
      setMessageHistoryState((current: any) => {
        const next = { ...current };
        messageSessionIds.forEach((sessionId) => {
          if (!next[sessionId]) {
            next[sessionId] = { hasMore: false, loading: true };
          }
        });
        return next;
      });
      messageSessionIds.forEach((sessionId) => {
        void dispatch(client, "session/list_messages", {
          sessionId,
          limit: DEFAULT_MESSAGE_PAGE_LIMIT,
        });
      });
    }

    if (activitySessionIds.length > 0) {
      setActivityHistoryState((current: any) => {
        const next = { ...current };
        activitySessionIds.forEach((sessionId) => {
          if (!next[sessionId]) {
            next[sessionId] = { hasMore: false, loading: true };
          }
        });
        return next;
      });
      activitySessionIds.forEach((sessionId) => {
        void dispatch(client, "session/get_artifacts", {
          sessionId,
          limit: DEFAULT_ACTIVITY_PAGE_LIMIT,
        });
      });
    }

    resumeCheckSessionIds.forEach((sessionId) => {
      openSessionResumeCheckRef.current.add(sessionId);
      void dispatch(client, "session/check_resume", { sessionId });
    });
  };

  useEffect(() => {
    hydrateOpenSessionStreams(openSessions.map((session) => session.id));
  }, [
    openSessionStreamKey,
    pairingState,
    messageHistoryState,
    activityHistoryState,
    messagesBySession,
    outputsBySession,
    toolCallsBySession,
    sessions,
  ]);

  return hydrateOpenSessionStreams;
}
