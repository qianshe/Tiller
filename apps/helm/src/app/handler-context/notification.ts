import type { WebSocket } from "ws";
import type { HelmHandlerContext } from "../../handlers/context";

export type HandlerNotificationSocket = {
  readyState: number;
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

type OutboundConnectionPort = {
  notify: (socketId: string, method: string, params: unknown) => void;
  clearSession: (socketId: string, sessionId: string) => void;
  remove: (socketId: string) => void;
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
  getSocketId: (socket: TSocket) => string | undefined;
  outboundConnections: OutboundConnectionPort;
  sessionTopics: SessionTopicRegistry;
}): HandlerNotificationContext<TSocket> {
  const notify = (socket: TSocket, method: string, params: unknown) => {
    if (socket.readyState !== 1) {
      return;
    }
    const socketId = options.getSocketId(socket);
    if (socketId) {
      options.outboundConnections.notify(socketId, method, params);
    }
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
    unsubscribeSessionTopic: (socketId, sessionId) => {
      options.sessionTopics.unsubscribe(socketId, sessionId);
      options.outboundConnections.clearSession(socketId, sessionId);
    },
    removeSocketSessionTopics: (socketId) => {
      options.sessionTopics.removeSocket(socketId);
      options.outboundConnections.remove(socketId);
    },
  };
}
