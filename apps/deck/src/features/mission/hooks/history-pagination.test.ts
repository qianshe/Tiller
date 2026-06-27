import assert from "node:assert/strict";
import test from "node:test";
import { useHistoryPagination } from "./history-pagination.js";

test("loadOlderMessages requests timeline pages with the independent timeline cursor", () => {
  const originalWebSocket = (globalThis as any).WebSocket;
  (globalThis as any).WebSocket = { OPEN: 1 };

  try {
    const dispatched: Array<{ method: string; params: Record<string, unknown> }> = [];
    let messageHistoryState = {
      "session-1": {
        nextCursor: "legacy-message-cursor",
        hasMore: false,
        timelineNextCursor: "timeline-cursor-1",
        timelineHasMore: true,
        loading: false,
      },
    };

    const pagination = useHistoryPagination({
      activeSessionId: "session-1",
      activityHistoryState: {},
      chatMainRef: {
        current: { scrollHeight: 1200, scrollTop: 240 },
      } as any,
      dispatch: async (_client: unknown, method: string, params: unknown) => {
        dispatched.push({ method, params: params as Record<string, unknown> });
      },
      messageHistoryState,

      sessionHistoryState: { hasMore: false, loading: false },
      setActivityHistoryState: () => undefined,
      setMessageHistoryState: (updater: any) => {
        messageHistoryState = updater(messageHistoryState);
      },
      setSessionHistoryState: () => undefined,
      rpcClientRef: {
        current: { socket: { readyState: 1 } },
      } as any,
      stickChatToBottomRef: { current: true },
      sessionPageLimit: 20,
      messagePageLimit: 20,
      activityPageLimit: 50,
    });

    pagination.loadOlderMessages("session-1");

    assert.deepEqual(dispatched, [
      {
        method: "session/list_messages",
        params: {
          sessionId: "session-1",
          limit: 20,
          before: undefined,
          timelineBefore: "timeline-cursor-1",
        },
      },
    ]);
    assert.equal(messageHistoryState["session-1"].loading, true);
    assert.equal(messageHistoryState["session-1"].timelineNextCursor, "timeline-cursor-1");
  } finally {
    (globalThis as any).WebSocket = originalWebSocket;
  }
});
