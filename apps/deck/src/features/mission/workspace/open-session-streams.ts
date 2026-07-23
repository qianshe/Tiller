import type { SessionSummary } from "@tiller/shared";
import { useEffect, useRef } from "react";
import {
  subscribeToSessionTopic,
  unsubscribeFromSessionTopic,
  type DispatchToHelm,
  type DeckRpcClient,
} from "../../helm-connection/facade";
import { DEFAULT_MESSAGE_PAGE_LIMIT } from "../config";
import {
  buildSessionStreamHydrationPlan,
  type WorkspaceSessionStreamHydrationInput,
} from "./session-streams";

type MutableRefLike<T> = {
  current: T;
};

type SessionStateSetter = (updater: (current: any) => any) => void;
type HydrationHistoryEntry = {
  hasMore: boolean;
  loading: boolean;
  [key: string]: unknown;
};
type HydrationHistoryState = Record<string, HydrationHistoryEntry | undefined>;

export function markSessionHistoryEntriesLoading(
  current: HydrationHistoryState,
  sessionIds: readonly string[],
): HydrationHistoryState {
  let next: HydrationHistoryState | null = null;
  sessionIds.forEach((sessionId) => {
    const currentEntry = current[sessionId];
    if (currentEntry?.loading) {
      return;
    }
    next ??= { ...current };
    next[sessionId] = (
      currentEntry
        ? { ...currentEntry, loading: true }
        : { hasMore: false, loading: true }
    );
  });
  return next ?? current;
}

export type OpenSessionStreamsOptions = {
  pairingState: string;
  connection: string;
  rpcClientRef: MutableRefLike<DeckRpcClient | null>;
  dispatch: DispatchToHelm;
  openSessions: SessionSummary[];
  sessions: SessionSummary[];
  messageHistoryState: WorkspaceSessionStreamHydrationInput["messageHistoryState"];
  messagesBySession: WorkspaceSessionStreamHydrationInput["messagesBySession"];
  sessionTimelineBySession: WorkspaceSessionStreamHydrationInput["sessionTimelineBySession"];
  setMessageHistoryState: SessionStateSetter;
};

export function useOpenSessionStreams(options: OpenSessionStreamsOptions) {
  const {
    pairingState,
    connection,
    rpcClientRef,
    dispatch,
    openSessions,
    sessions,
    messageHistoryState,
    messagesBySession,
    sessionTimelineBySession,
    setMessageHistoryState,
  } = options;
  const openSessionResumeCheckRef = useRef<Set<string>>(new Set());
  const pendingTimelineRequestSessionIdsRef = useRef<Set<string>>(new Set());
  const openSessionTopicSubscriptionsRef = useRef<Set<string>>(new Set());
  const openSessionStreamKey = openSessions.map((session) => session.id).join("|");

  useEffect(() => {
    if (connection === "connected") {
      return;
    }
    pendingTimelineRequestSessionIdsRef.current.clear();
  }, [connection]);

  useEffect(() => {
    const client = rpcClientRef.current;
    if (
      pairingState !== "paired" ||
      connection !== "connected" ||
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
  }, [openSessionStreamKey, pairingState, connection]);

  const hydrateOpenSessionStreams = (sessionIds: string[]) => {
    const client = rpcClientRef.current;
    if (
      pairingState !== "paired" ||
      connection !== "connected" ||
      !client ||
      client.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const {
      messageSessionIds,
      resumeCheckSessionIds,
    } = buildSessionStreamHydrationPlan({
      sessionIds,
      sessionById,
      messageHistoryState,
      messagesBySession,
      sessionTimelineBySession,
      checkedResumeSessionIds: openSessionResumeCheckRef.current,
      pendingTimelineRequestSessionIds: pendingTimelineRequestSessionIdsRef.current,
    });

    if (messageSessionIds.length > 0) {
      setMessageHistoryState((current: any) => {
        return markSessionHistoryEntriesLoading(current, messageSessionIds);
      });
      messageSessionIds.forEach((sessionId) => {
        pendingTimelineRequestSessionIdsRef.current.add(sessionId);
        void dispatch(client, "session/list_timeline", {
          sessionId,
          limit: DEFAULT_MESSAGE_PAGE_LIMIT,
        }).finally(() => {
          pendingTimelineRequestSessionIdsRef.current.delete(sessionId);
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
    messagesBySession,
    sessionTimelineBySession,
    sessions,
    connection,
  ]);

  return hydrateOpenSessionStreams;
}
