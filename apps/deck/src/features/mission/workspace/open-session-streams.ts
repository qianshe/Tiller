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
type PlanHydrationRetryScheduler = (
  handler: () => void,
  delayMs: number,
) => unknown;
type HydrationHistoryEntry = {
  hasMore: boolean;
  loading: boolean;
  [key: string]: unknown;
};
type HydrationHistoryState = Record<string, HydrationHistoryEntry | undefined>;

const PLAN_HYDRATION_RETRY_DELAY_MS = 1_500;
const MAX_PLAN_HYDRATION_RETRIES = 5;

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

export function handlePlanHydrationRequestFailure({
  sessionId,
  planActivitySessionIds,
  checkedPlanSessionIds,
  setActivityHistoryState,
}: {
  sessionId: string;
  planActivitySessionIds: ReadonlySet<string>;
  checkedPlanSessionIds: Set<string>;
  setActivityHistoryState: SessionStateSetter;
}) {
  if (!planActivitySessionIds.has(sessionId)) {
    return;
  }
  clearPlanHydrationLoading({
    sessionId,
    checkedPlanSessionIds,
    setActivityHistoryState,
  });
}

export function handlePlanHydrationRequestResult({
  sessionId,
  result,
  planActivitySessionIds,
  checkedPlanSessionIds,
  retryCounts,
  setActivityHistoryState,
  scheduleRetry = (handler, delayMs) => window.setTimeout(handler, delayMs),
  retryDelayMs = PLAN_HYDRATION_RETRY_DELAY_MS,
  maxRetries = MAX_PLAN_HYDRATION_RETRIES,
}: {
  sessionId: string;
  result: unknown;
  planActivitySessionIds: ReadonlySet<string>;
  checkedPlanSessionIds: Set<string>;
  retryCounts: Map<string, number>;
  setActivityHistoryState: SessionStateSetter;
  scheduleRetry?: PlanHydrationRetryScheduler;
  retryDelayMs?: number;
  maxRetries?: number;
}) {
  if (!planActivitySessionIds.has(sessionId)) {
    return;
  }
  if (hasAgentPlanPayload((result as { plan?: unknown } | null)?.plan)) {
    checkedPlanSessionIds.delete(sessionId);
    retryCounts.delete(sessionId);
    return;
  }
  const nextRetryCount = (retryCounts.get(sessionId) ?? 0) + 1;
  if (nextRetryCount > maxRetries) {
    retryCounts.delete(sessionId);
    finishPlanHydrationLoading({
      sessionId,
      checkedPlanSessionIds,
      setActivityHistoryState,
      allowRetry: false,
    });
    return;
  }
  retryCounts.set(sessionId, nextRetryCount);
  scheduleRetry(() => {
    clearPlanHydrationLoading({
      sessionId,
      checkedPlanSessionIds,
      setActivityHistoryState,
    });
  }, retryDelayMs);
}

function clearPlanHydrationLoading({
  sessionId,
  checkedPlanSessionIds,
  setActivityHistoryState,
}: {
  sessionId: string;
  checkedPlanSessionIds: Set<string>;
  setActivityHistoryState: SessionStateSetter;
}) {
  finishPlanHydrationLoading({
    sessionId,
    checkedPlanSessionIds,
    setActivityHistoryState,
    allowRetry: true,
  });
}

function finishPlanHydrationLoading({
  sessionId,
  checkedPlanSessionIds,
  setActivityHistoryState,
  allowRetry,
}: {
  sessionId: string;
  checkedPlanSessionIds: Set<string>;
  setActivityHistoryState: SessionStateSetter;
  allowRetry: boolean;
}) {
  if (allowRetry) {
    checkedPlanSessionIds.delete(sessionId);
  }
  setActivityHistoryState((current: any) => ({
    ...current,
    [sessionId]: {
      hasMore: current[sessionId]?.hasMore ?? false,
      ...current[sessionId],
      loading: false,
    },
  }));
}

export type OpenSessionStreamsOptions = {
  pairingState: string;
  connection: string;
  rpcClientRef: MutableRefLike<DeckRpcClient | null>;
  dispatch: DispatchToHelm;
  openSessions: SessionSummary[];
  sessions: SessionSummary[];
  messageHistoryState: WorkspaceSessionStreamHydrationInput["messageHistoryState"];
  activityHistoryState: WorkspaceSessionStreamHydrationInput["activityHistoryState"];
  messagesBySession: WorkspaceSessionStreamHydrationInput["messagesBySession"];
  sessionTimelineBySession: WorkspaceSessionStreamHydrationInput["sessionTimelineBySession"];
  outputsBySession: WorkspaceSessionStreamHydrationInput["outputsBySession"];
  toolCallsBySession: WorkspaceSessionStreamHydrationInput["toolCallsBySession"];
  sessionPlansBySession: WorkspaceSessionStreamHydrationInput["sessionPlansBySession"];
  setMessageHistoryState: SessionStateSetter;
  setActivityHistoryState: SessionStateSetter;
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
    activityHistoryState,
    messagesBySession,
    sessionTimelineBySession,
    outputsBySession,
    toolCallsBySession,
    sessionPlansBySession,
    setMessageHistoryState,
    setActivityHistoryState,
  } = options;
  const openSessionResumeCheckRef = useRef<Set<string>>(new Set());
  const openSessionPlanHydrationRef = useRef<Set<string>>(new Set());
  const openSessionPlanRetryCountsRef = useRef<Map<string, number>>(new Map());
  const openSessionTopicSubscriptionsRef = useRef<Set<string>>(new Set());
  const openSessionStreamKey = openSessions.map((session) => session.id).join("|");

  useEffect(() => {
    const client = rpcClientRef.current;
    if (
      pairingState !== "paired" ||
      connection !== "connected" ||
      !client ||
      client.socket.readyState !== WebSocket.OPEN
    ) {
      openSessionPlanHydrationRef.current.clear();
      openSessionPlanRetryCountsRef.current.clear();
      return;
    }
    const nextSessionIds = new Set(openSessions.map((session) => session.id));
    const subscribedSessionIds = openSessionTopicSubscriptionsRef.current;

    subscribedSessionIds.forEach((sessionId) => {
      if (!nextSessionIds.has(sessionId)) {
        subscribedSessionIds.delete(sessionId);
        openSessionPlanHydrationRef.current.delete(sessionId);
        openSessionPlanRetryCountsRef.current.delete(sessionId);
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
        openSessionPlanHydrationRef.current.delete(sessionId);
        openSessionPlanRetryCountsRef.current.delete(sessionId);
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
      openSessionPlanHydrationRef.current.clear();
      openSessionPlanRetryCountsRef.current.clear();
      return;
    }
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const {
      messageSessionIds,
      activitySessionIds,
      planActivitySessionIds,
      resumeCheckSessionIds,
    } = buildSessionStreamHydrationPlan({
      sessionIds,
      sessionById,
      messageHistoryState,
      activityHistoryState,
      messagesBySession,
      sessionTimelineBySession,
      outputsBySession,
      toolCallsBySession,
      sessionPlansBySession,
      checkedResumeSessionIds: openSessionResumeCheckRef.current,
      checkedPlanSessionIds: openSessionPlanHydrationRef.current,
    });

    if (messageSessionIds.length > 0) {
      setMessageHistoryState((current: any) => {
        return markSessionHistoryEntriesLoading(current, messageSessionIds);
      });
      messageSessionIds.forEach((sessionId) => {
        void dispatch(client, "session/list_messages", {
          sessionId,
          limit: DEFAULT_MESSAGE_PAGE_LIMIT,
        });
      });
    }

    if (activitySessionIds.length > 0) {
      const planActivitySessionIdSet = new Set(planActivitySessionIds);
      planActivitySessionIds.forEach((sessionId) => {
        openSessionPlanHydrationRef.current.add(sessionId);
      });
      setActivityHistoryState((current: any) => {
        return markSessionHistoryEntriesLoading(current, activitySessionIds);
      });
      activitySessionIds.forEach((sessionId) => {
        const isPlanHydration = planActivitySessionIdSet.has(sessionId);
        const request = dispatch(client, "session/get_artifacts", {
          sessionId,
          limit: DEFAULT_ACTIVITY_PAGE_LIMIT,
        }, isPlanHydration
          ? {
              onResult: (_method, result) => {
                handlePlanHydrationRequestResult({
                  sessionId,
                  result,
                  planActivitySessionIds: planActivitySessionIdSet,
                  checkedPlanSessionIds: openSessionPlanHydrationRef.current,
                  retryCounts: openSessionPlanRetryCountsRef.current,
                  setActivityHistoryState,
                });
              },
            }
          : undefined);
        if (isPlanHydration) {
          void request.catch(() => {
            handlePlanHydrationRequestFailure({
              sessionId,
              planActivitySessionIds: planActivitySessionIdSet,
              checkedPlanSessionIds: openSessionPlanHydrationRef.current,
              setActivityHistoryState,
            });
          });
        } else {
          void request;
        }
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
    sessionTimelineBySession,
    outputsBySession,
    toolCallsBySession,
    sessionPlansBySession,
    sessions,
    connection,
  ]);

  return hydrateOpenSessionStreams;
}

function hasAgentPlanPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entries = (value as { entries?: unknown }).entries;
  return Array.isArray(entries) && entries.length > 0;
}
