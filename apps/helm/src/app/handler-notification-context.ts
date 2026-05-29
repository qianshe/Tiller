import type { WebSocket } from "ws";
import { encodeMessage } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../handlers/context";

export type HandlerNotificationSocket = {
  readyState: number;
  send(message: string): void;
};

type AuthenticatedSocketRegistry<TSocket extends HandlerNotificationSocket> = {
  listAll: () => Array<{ socketId: string; socket: TSocket }>;
};

type SessionTopicRegistry = {
  subscribe: HelmHandlerContext["subscribeSessionTopic"];
  unsubscribe: HelmHandlerContext["unsubscribeSessionTopic"];
  removeSocket: HelmHandlerContext["removeSocketSessionTopics"];
  listSubscribers: (sessionId: string) => string[];
};

export type HandlerNotificationContext<TSocket extends HandlerNotificationSocket = WebSocket> = Omit<
  Pick<
    HelmHandlerContext,
    | "notify"
    | "broadcastNotification"
    | "broadcastSessionTopic"
    | "subscribeSessionTopic"
    | "unsubscribeSessionTopic"
    | "removeSocketSessionTopics"
  >,
  "notify"
> & {
  notify: (socket: TSocket, method: string, params: unknown) => void;
};

export function createHandlerNotificationContext<
  TSocket extends HandlerNotificationSocket = WebSocket,
>(options: {
  authenticatedSockets: AuthenticatedSocketRegistry<TSocket>;
  sessionTopics: SessionTopicRegistry;
}): HandlerNotificationContext<TSocket> {
  const notify = (socket: TSocket, method: string, params: unknown) => {
    if (socket.readyState !== 1) {
      return;
    }

    socket.send(encodeMessage({ jsonrpc: "2.0", method, params }));
  };

  const broadcastNotification = (method: string, params: unknown) => {
    for (const { socket } of options.authenticatedSockets.listAll()) {
      notify(socket, method, params);
    }
  };

  const broadcastSessionTopic = (sessionId: string, method: string, params: unknown) => {
    const subscribers = new Set(options.sessionTopics.listSubscribers(sessionId));
    for (const { socketId, socket } of options.authenticatedSockets.listAll()) {
      if (!subscribers.has(socketId)) {
        continue;
      }

      notify(socket, method, params);
    }
  };

  return {
    notify,
    broadcastNotification,
    broadcastSessionTopic,
    subscribeSessionTopic: options.sessionTopics.subscribe,
    unsubscribeSessionTopic: options.sessionTopics.unsubscribe,
    removeSocketSessionTopics: options.sessionTopics.removeSocket,
  };
}
