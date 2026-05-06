import type { WebSocket } from "ws";
import {
  decodeMessage,
  encodeMessage,
  ErrorCode,
  rpcError,
  type JsonRpcMessage,
  type Stream,
} from "@tiller/sync-protocol";

export function createWebSocketJsonRpcStream(
  socket: WebSocket,
  onDecodeError: (error: unknown) => void,
): Stream {
  const handlers = new Set<(message: JsonRpcMessage) => void>();
  const onRawMessage = (raw: unknown) => {
    try {
      const message = decodeMessage(String(raw));
      for (const handler of handlers) {
        handler(message);
      }
    } catch (error) {
      onDecodeError(error);
      const payload =
        error && typeof error === "object" && "code" in error
          ? (error as { code: number; message: string; data?: unknown })
          : rpcError(ErrorCode.ParseError, "Parse error");
      if (socket.readyState === 1) {
        socket.send(encodeMessage({ jsonrpc: "2.0", id: null, error: payload }));
      }
    }
  };

  socket.on("message", onRawMessage);

  return {
    send(message) {
      if (socket.readyState === 1) {
        socket.send(encodeMessage(message));
      }
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      socket.off("message", onRawMessage);
    },
  };
}
