import type { WebSocket } from "ws";
import { JsonRpcConnection, type ConnectionHandlers } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../handlers/context";
import type { RuntimeMetrics } from "../logging/runtime-metrics";
import { handleHelmRpcNotification, handleHelmRpcRequest } from "../rpc/router";
import { createWebSocketJsonRpcStream } from "../rpc/websocket-stream";

export type HelmRpcRequestHandler = (
  method: string,
  params: unknown,
  context: HelmHandlerContext,
) => Promise<unknown>;

export type HelmRpcNotificationHandler = (
  method: string,
  params: unknown,
  context: HelmHandlerContext,
) => void | Promise<void>;

export type HelmRpcConnectionHandlersOptions = {
  getSocketId: () => string | undefined;
  createHandlerContext: (socketId?: string) => HelmHandlerContext;
  handleRequest: HelmRpcRequestHandler;
  handleNotification: HelmRpcNotificationHandler;
  logError: (message: string) => void;
};

export type HelmOutboundConnection = {
  notify: (method: string, params: unknown) => void;
  clearSession: (sessionId: string) => void;
};

export type HelmOutboundConnectionRegistry = {
  add: (socketId: string, connection: HelmOutboundConnection) => void;
  has: (socketId: string) => boolean;
  notify: (socketId: string, method: string, params: unknown) => void;
  clearSession: (socketId: string, sessionId: string) => void;
  remove: (socketId: string) => void;
};

export function createHelmOutboundConnectionRegistry(): HelmOutboundConnectionRegistry {
  const connections = new Map<string, HelmOutboundConnection>();

  return {
    add: (socketId, connection) => connections.set(socketId, connection),
    has: (socketId) => connections.has(socketId),
    notify: (socketId, method, params) => connections.get(socketId)?.notify(method, params),
    clearSession: (socketId, sessionId) => connections.get(socketId)?.clearSession(sessionId),
    remove: (socketId) => {
      connections.delete(socketId);
    },
  };
}

export function createHelmRpcConnectionHandlers(
  options: HelmRpcConnectionHandlersOptions,
): ConnectionHandlers {
  const createCurrentContext = () => options.createHandlerContext(options.getSocketId());

  return {
    onRequest: (method, params) => options.handleRequest(method, params, createCurrentContext()),
    onNotification: (method, params) =>
      options.handleNotification(method, params, createCurrentContext()),
    onError: (error) => {
      options.logError(`[tiller] json-rpc handler failed: ${formatError(error)}`);
    },
  };
}

export type AttachHelmRpcConnectionOptions = {
  socket: WebSocket;
  getSocketId: (socket: WebSocket) => string | undefined;
  outboundConnections: HelmOutboundConnectionRegistry;
  createHandlerContext: (socketId?: string) => HelmHandlerContext;
  logError: (message: string) => void;
  logInfo?: (message: string) => void;
  runtimeMetrics?: Pick<RuntimeMetrics, "observe">;
};

export function attachHelmRpcConnection(options: AttachHelmRpcConnectionOptions) {
  let coalescedDeltaCount = 0;
  const stream = createWebSocketJsonRpcStream(options.socket, (error) => {
    options.logError(`[tiller] json-rpc decode failed: ${formatError(error)}`);
  }, {
    onCoalesced: (count) => {
      coalescedDeltaCount += count;
      options.runtimeMetrics?.observe("__transport__", {
        eventType: "websocket.coalesced",
        coalescedDeltaCount: count,
      });
    },
    onEncoded: (bytes) => {
      options.runtimeMetrics?.observe("__transport__", {
        eventType: "websocket.encoded",
        wsBufferedBytes: bytes,
      });
    },
  });
  const connection = new JsonRpcConnection(
    stream,
    createHelmRpcConnectionHandlers({
      getSocketId: () => options.getSocketId(options.socket),
      createHandlerContext: options.createHandlerContext,
      handleRequest: handleHelmRpcRequest,
      handleNotification: handleHelmRpcNotification,
      logError: options.logError,
    }),
  );
  const socketId = options.getSocketId(options.socket);
  if (socketId) {
    options.outboundConnections.add(socketId, {
      notify: (method, params) => connection.notify(method, params),
      clearSession: (sessionId) => stream.clearSession(sessionId),
    });
  }
  options.socket.once("close", () => {
    if (coalescedDeltaCount > 0) {
      options.logInfo?.(
        `[tiller] websocket.backpressure.summary coalescedDeltaCount=${coalescedDeltaCount}`,
      );
    }
    if (socketId) {
      options.outboundConnections.remove(socketId);
    }
    connection.close();
  });
  return connection;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
