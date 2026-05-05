import type {
  MutableRefObject,
  RefObject,
  UIEvent as ReactUIEvent,
} from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { ActivitiesSlice } from "../../../store/slices/activities-slice";
import type { MessagesSlice } from "../../../store/slices/messages-slice";
import type { SessionsSlice } from "../../../store/slices/sessions-slice";

type ScrollSnapshot = { scrollHeight: number; scrollTop: number };

type UseHistoryPaginationOptions = {
  activeSessionId: string | null;
  activityHistoryState: ActivitiesSlice["activityHistoryState"];
  chatMainRef: RefObject<HTMLDivElement | null>;
  dispatch: (socket: WebSocket, payload: ClientToHelm) => void;
  messageHistoryState: MessagesSlice["messageHistoryState"];
  preserveChatScrollRef: MutableRefObject<ScrollSnapshot | null>;
  requestCounter: MutableRefObject<number>;
  sessionHistoryState: SessionsSlice["sessionHistoryState"];
  setActivityHistoryState: ActivitiesSlice["setActivityHistoryState"];
  setMessageHistoryState: MessagesSlice["setMessageHistoryState"];
  setSessionHistoryState: SessionsSlice["setSessionHistoryState"];
  socketRef: MutableRefObject<WebSocket | null>;
  stickChatToBottomRef: MutableRefObject<boolean>;
  nextRequestId: (counter: MutableRefObject<number>) => string;
  sessionPageLimit: number;
  messagePageLimit: number;
  activityPageLimit: number;
};

/** Coordinates mission history pagination for sessions, messages and activities. */
export function useHistoryPagination({
  activeSessionId,
  activityHistoryState,
  chatMainRef,
  dispatch,
  messageHistoryState,
  preserveChatScrollRef,
  requestCounter,
  sessionHistoryState,
  setActivityHistoryState,
  setMessageHistoryState,
  setSessionHistoryState,
  socketRef,
  stickChatToBottomRef,
  nextRequestId,
  sessionPageLimit,
  messagePageLimit,
  activityPageLimit,
}: UseHistoryPaginationOptions) {
  function loadOlderSessions() {
    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN ||
      sessionHistoryState.loading ||
      !sessionHistoryState.hasMore ||
      !sessionHistoryState.nextCursor
    ) {
      return;
    }
    setSessionHistoryState((current) => ({ ...current, loading: true }));
    dispatch(socketRef.current, {
      type: "session.list",
      requestId: nextRequestId(requestCounter),
      limit: sessionPageLimit,
      before: sessionHistoryState.nextCursor,
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
    const historyState = messageHistoryState[sessionId];
    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN ||
      historyState?.loading ||
      !historyState?.hasMore ||
      !historyState.nextCursor
    ) {
      return;
    }
    if (activeSessionId === sessionId && chatMainRef.current) {
      preserveChatScrollRef.current = {
        scrollHeight: chatMainRef.current.scrollHeight,
        scrollTop: chatMainRef.current.scrollTop,
      };
    }
    setMessageHistoryState((current) => ({
      ...current,
      [sessionId]: {
        hasMore: current[sessionId]?.hasMore ?? false,
        ...current[sessionId],
        loading: true,
      },
    }));
    dispatch(socketRef.current, {
      type: "session.messages.list",
      requestId: nextRequestId(requestCounter),
      sessionId,
      limit: messagePageLimit,
      before: historyState.nextCursor,
    });
  }

  function loadOlderActivities(sessionId: string) {
    const historyState = activityHistoryState[sessionId];
    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN ||
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
    dispatch(socketRef.current, {
      type: "session.artifacts.get",
      requestId: nextRequestId(requestCounter),
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
    if (!activeSessionId || target.scrollTop > 32) {
      return;
    }
    const messageState = messageHistoryState[activeSessionId];
    const activityState = activityHistoryState[activeSessionId];
    const canLoadMessages = Boolean(
      messageState?.hasMore && !messageState.loading && messageState.nextCursor,
    );
    const canLoadActivities = Boolean(
      activityState?.hasMore &&
        !activityState.loading &&
        activityState.nextCursor,
    );
    if (!canLoadMessages && !canLoadActivities) {
      return;
    }
    preserveChatScrollRef.current = {
      scrollHeight: target.scrollHeight,
      scrollTop: target.scrollTop,
    };
    loadOlderMessages(activeSessionId);
    loadOlderActivities(activeSessionId);
  }

  return {
    handleChatMainScroll,
    handleMissionTreeScroll,
    loadOlderActivities,
    loadOlderMessages,
  };
}
