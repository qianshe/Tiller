import type { MutableRefObject } from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { DebugTrace } from "../../store/slices/connection-slice";

export function nextRequestId(counter: MutableRefObject<number>) {
  counter.current += 1;
  return `req-${counter.current}`;
}

export function dispatchWithTrace(
  socket: WebSocket,
  payload: ClientToHelm,
  setDebugTrace: (updater: (current: DebugTrace) => DebugTrace) => void,
) {
  socket.send(JSON.stringify(payload));
  setDebugTrace((current) => ({
    ...current,
    requestsSent: current.requestsSent + 1,
    lastRequestType: payload.type,
  }));
}

export function requestInitialSync(
  socket: WebSocket,
  context: {
    dispatch: (socket: WebSocket, payload: ClientToHelm) => void;
    requestCounter: MutableRefObject<number>;
    setSessionHistoryState: (state: {
      nextCursor?: string;
      hasMore: boolean;
      loading: boolean;
    }) => void;
    sessionPageLimit: number;
  },
) {
  const { dispatch, requestCounter, setSessionHistoryState, sessionPageLimit } =
    context;
  dispatch(socket, {
    type: "helm.list",
    requestId: nextRequestId(requestCounter),
  });
  dispatch(socket, {
    type: "project.list",
    requestId: nextRequestId(requestCounter),
  });
  dispatch(socket, {
    type: "workspace.list",
    requestId: nextRequestId(requestCounter),
  });
  dispatch(socket, {
    type: "agent.list",
    requestId: nextRequestId(requestCounter),
  });
  setSessionHistoryState({ hasMore: false, loading: true });
  dispatch(socket, {
    type: "session.list",
    requestId: nextRequestId(requestCounter),
    limit: sessionPageLimit,
  });
  dispatch(socket, {
    type: "device.list",
    requestId: nextRequestId(requestCounter),
  });
}
