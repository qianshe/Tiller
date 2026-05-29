import assert from "node:assert/strict";
import test from "node:test";
import { createHandlerNotificationContext } from "./handler-notification-context";

function createSocket(readyState = 1) {
  const sent: string[] = [];
  return {
    readyState,
    sent,
    send: (message: string) => {
      sent.push(message);
    },
  };
}

function decodeSent(socket: { sent: string[] }) {
  return socket.sent.map((message) => JSON.parse(message));
}

test("handler notification context sends JSON-RPC notifications to open sockets", () => {
  const socket = createSocket();
  const closed = createSocket(3);
  const context = createHandlerNotificationContext({
    authenticatedSockets: { listAll: () => [{ socketId: "socket-1", socket }] },
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

  assert.deepEqual(decodeSent(socket), [
    { jsonrpc: "2.0", method: "deck/event", params: { ok: true } },
    { jsonrpc: "2.0", method: "deck/broadcast", params: { all: true } },
  ]);
  assert.deepEqual(closed.sent, []);
});

test("handler notification context broadcasts session topics only to subscribers", () => {
  const subscribed = createSocket();
  const other = createSocket();
  const context = createHandlerNotificationContext({
    authenticatedSockets: {
      listAll: () => [
        { socketId: "socket-1", socket: other },
        { socketId: "socket-2", socket: subscribed },
      ],
    },
    sessionTopics: {
      subscribe: () => undefined,
      unsubscribe: () => undefined,
      removeSocket: () => undefined,
      listSubscribers: () => ["socket-2"],
    },
  });

  context.broadcastSessionTopic("session-1", "session/update", { id: "session-1" });

  assert.deepEqual(other.sent, []);
  assert.deepEqual(decodeSent(subscribed), [
    { jsonrpc: "2.0", method: "session/update", params: { id: "session-1" } },
  ]);
});
