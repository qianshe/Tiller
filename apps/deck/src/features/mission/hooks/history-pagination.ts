import type {
  MutableRefObject,
  RefObject,
  UIEvent as ReactUIEvent,
} from "react";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import type {
  ActivitiesSlice,
  MessagesSlice,
  SessionsSlice,
} from "../../../store/facade";
import { buildConversationPaginationPlan } from "../history/model";

type UseHistoryPaginationOptions = {
  activeSessionId: string | null;
  activityHistoryState: ActivitiesSlice["activityHistoryState"];
  chatMainRef: RefObject<HTMLDivElement | null>;
  dispatch: DispatchToHelm;
  messageHistoryState: MessagesSlice["messageHistoryState"];
  sessionHistoryState: SessionsSlice["sessionHistoryState"];
  setActivityHistoryState: ActivitiesSlice["setActivityHistoryState"];
  setMessageHistoryState: MessagesSlice["setMessageHistoryState"];
  setSessionHistoryState: SessionsSlice["setSessionHistoryState"];
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  stickChatToBottomRef: MutableRefObject<boolean>;
  sessionPageLimit: number;
  messagePageLimit: number;
  activityPageLimit: number;
};

function getOpenClient(rpcClientRef: MutableRefObject<DeckRpcClient | null>) {
  const client = rpcClientRef.current;
  return client?.socket.readyState === WebSocket.OPEN ? client : null;
}

/** Coordinates mission history pagination for sessions, messages and activities. */
export function useHistoryPagination({
  activeSessionId,
  activityHistoryState,
  chatMainRef,
  dispatch,
  messageHistoryState,
  sessionHistoryState,
  setActivityHistoryState,
  setMessageHistoryState,
  setSessionHistoryState,
  rpcClientRef,
  stickChatToBottomRef,
  sessionPageLimit,
  messagePageLimit,
  activityPageLimit,
}: UseHistoryPaginationOptions) {
  function loadOlderSessions() {
    const client = getOpenClient(rpcClientRef);
    if (
      !client ||
      sessionHistoryState.loading ||
      !sessionHistoryState.hasMore ||
      !sessionHistoryState.nextCursor
    ) {
      return;
    }
    setSessionHistoryState((current) => ({ ...current, loading: true }));
    void dispatch(client, "session/list", {
      limit: sessionPageLimit,
      before: sessionHistoryState.nextCursor,
    }).catch(() => {
      setSessionHistoryState((current) => ({ ...current, loading: false }));
    });
  }

  function handleMissionTreeScroll(event: ReactUIEvent<HTMLElement>) {
    const target = event.currentTarget;
    const distanceToBottom =
      target.scrollHeight - target.clientHeight - target.scrollTop;
    if (target.scrollTop <= 24 || distanceToBottom <= 24) {
      loadOlderSessions();
    }
  }

  function loadOlderMessages(sessionId: string) {
    const client = getOpenClient(rpcClientRef);
    const plan = buildConversationPaginationPlan({
      sessionId,
      messagePageLimit,
      activityPageLimit,
      messageState: messageHistoryState[sessionId],
      activityState: activityHistoryState[sessionId],
    });
    if (!client || (!plan.listTimeline && !plan.getArtifacts)) {
      return;
    }
    if (plan.listTimeline) {
      setMessageHistoryState((current) => ({
        ...current,
        [sessionId]: {
          hasMore: current[sessionId]?.hasMore ?? false,
          ...current[sessionId],
          loading: true,
        },
      }));
      void dispatch(client, "session/list_timeline", plan.listTimeline);
    }
    if (plan.getArtifacts) {
      loadOlderActivities(sessionId);
    }
  }

  function loadOlderActivities(sessionId: string) {
    const client = getOpenClient(rpcClientRef);
    const historyState = activityHistoryState[sessionId];
    if (
      !client ||
      historyState?.loading ||
      !historyState?.hasMore ||
      !historyState.nextCursor
    ) {
      return;
    }
    setActivityHistoryState((current) => ({
      ...current,
      [sessionId]: {
        hasMore: current[sessionId]?.hasMore ?? false,
        ...current[sessionId],
        loading: true,
      },
    }));
    void dispatch(client, "session/get_artifacts", {
      sessionId,
      limit: activityPageLimit,
      before: historyState.nextCursor,
    });
  }

  function handleChatMainScroll(event: ReactUIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const distanceToBottom =
      target.scrollHeight - target.clientHeight - target.scrollTop;
    stickChatToBottomRef.current = distanceToBottom <= 96;
  }

  return {
    handleChatMainScroll,
    handleMissionTreeScroll,
    loadOlderActivities,
    loadOlderMessages,
  };
}
