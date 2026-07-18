import assert from "node:assert/strict";
import test from "node:test";
import { createHandlerNotificationContext } from "./notification";

function createSocket(readyState = 1) {
  return {
    readyState,
  };
}

function createOutboundConnections() {
  const notifications: Array<{ socketId: string; method: string; params: unknown }> = [];
  const clearedSessions: string[] = [];
  const removedSockets: string[] = [];
  return {
    notifications,
    clearedSessions,
    removedSockets,
    port: {
      notify(socketId: string, method: string, params: unknown) {
        notifications.push({ socketId, method, params });
      },
      clearSession(socketId: string, sessionId: string) {
        clearedSessions.push(`${socketId}:${sessionId}`);
      },
      remove(socketId: string) {
        removedSockets.push(socketId);
      },
    },
  };
}

test("handler notification context routes open-socket notifications through outbound connections", () => {
  const socket = createSocket();
  const closed = createSocket(3);
  const outbound = createOutboundConnections();
  const context = createHandlerNotificationContext({
    authenticatedSockets: { listAll: () => [{ socketId: "socket-1", socket }] },
    getSocketId: (target) => target === socket ? "socket-1" : "socket-closed",
    outboundConnections: outbound.port,
    sessionTopics: {
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      removeSocket: () => undefined,
      listSubscribers: () => [],
    },
  });

  context.notify(socket, "deck/event", { ok: true });
  context.notify(closed, "deck/event", { ok: false });
  context.broadcastNotification("deck/broadcast", { all: true });

  assert.deepEqual(outbound.notifications, [
    { socketId: "socket-1", method: "deck/event", params: { ok: true } },
    { socketId: "socket-1", method: "deck/broadcast", params: { all: true } },
  ]);
});

test("handler notification context broadcasts session topics only to subscribers", () => {
  const subscribed = createSocket();
  const other = createSocket();
  const outbound = createOutboundConnections();
  const context = createHandlerNotificationContext({
    authenticatedSockets: {
      listAll: () => [
        { socketId: "socket-1", socket: other },
        { socketId: "socket-2", socket: subscribed },
      ],
    },
    getSocketId: (socket) => socket === subscribed ? "socket-2" : "socket-1",
    outboundConnections: outbound.port,
    sessionTopics: {
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      removeSocket: () => undefined,
      listSubscribers: () => ["socket-2"],
    },
  });

  context.broadcastSessionTopic("session-1", "session/update", { id: "session-1" });

  assert.deepEqual(outbound.notifications, [
    {
      socketId: "socket-2",
      method: "session/update",
      params: { id: "session-1" },
    },
  ]);
});

test("handler notification context clears delivery lanes with subscription lifecycle", () => {
  const outbound = createOutboundConnections();
  const topicCalls: string[] = [];
  const context = createHandlerNotificationContext({
    authenticatedSockets: { listAll: () => [] },
    getSocketId: () => "socket-1",
    outboundConnections: outbound.port,
    sessionTopics: {
      subscribe: (socketId, sessionId) => topicCalls.push(`subscribe:${socketId}:${sessionId}`),
      unsubscribe: (socketId, sessionId) => topicCalls.push(`unsubscribe:${socketId}:${sessionId}`),
      removeSocket: (socketId) => topicCalls.push(`remove:${socketId}`),
      listSubscribers: () => [],
    },
  });

  context.subscribeSessionTopic("socket-1", "session-1");
  context.unsubscribeSessionTopic("socket-1", "session-1");
  context.removeSocketSessionTopics("socket-1");

  assert.deepEqual(topicCalls, [
    "subscribe:socket-1:session-1",
    "unsubscribe:socket-1:session-1",
    "remove:socket-1",
  ]);
  assert.deepEqual(outbound.clearedSessions, ["socket-1:session-1"]);
  assert.deepEqual(outbound.removedSockets, ["socket-1"]);
});
