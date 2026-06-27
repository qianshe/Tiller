import type { WebSocket } from "ws";
import { JsonRpcConnection, type ConnectionHandlers } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../handlers/context";
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
  createHandlerContext: (socketId?: string) => HelmHandlerContext;
  logError: (message: string) => void;
};

export function attachHelmRpcConnection(options: AttachHelmRpcConnectionOptions) {
  const stream = createWebSocketJsonRpcStream(options.socket, (error) => {
    options.logError(`[tiller] json-rpc decode failed: ${formatError(error)}`);
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
  options.socket.once("close", () => {
    connection.close();
  });
  return connection;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
