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

type ScrollSnapshot = { scrollHeight: number; scrollTop: number };

type UseHistoryPaginationOptions = {
  activeSessionId: string | null;
  activityHistoryState: ActivitiesSlice["activityHistoryState"];
  chatMainRef: RefObject<HTMLDivElement | null>;
  dispatch: DispatchToHelm;
  messageHistoryState: MessagesSlice["messageHistoryState"];
  preserveChatScrollRef: MutableRefObject<ScrollSnapshot | null>;
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
  preserveChatScrollRef,
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
    const messageState = messageHistoryState[sessionId];
    const activityState = activityHistoryState[sessionId];
    const canLoadMessages = Boolean(
      messageState &&
        !messageState.loading &&
        messageState.hasMore &&
        messageState.nextCursor,
    );
    const canLoadActivities = Boolean(
      activityState &&
        !activityState.loading &&
        activityState.hasMore &&
        activityState.nextCursor,
    );
    if (!client || (!canLoadMessages && !canLoadActivities)) {
      return;
    }
    if (activeSessionId === sessionId && chatMainRef.current) {
      preserveChatScrollRef.current = {
        scrollHeight: chatMainRef.current.scrollHeight,
        scrollTop: chatMainRef.current.scrollTop,
      };
    }
    if (canLoadMessages) {
      setMessageHistoryState((current) => ({
        ...current,
        [sessionId]: {
          hasMore: current[sessionId]?.hasMore ?? false,
          ...current[sessionId],
          loading: true,
        },
      }));
      void dispatch(client, "session/list_messages", {
        sessionId,
        limit: messagePageLimit,
        before: messageState?.nextCursor,
      });
    }
    if (canLoadActivities) {
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
