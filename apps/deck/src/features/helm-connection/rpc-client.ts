import {
  decodeMessage,
  encodeMessage,
  JsonRpcConnection,
  type JsonRpcMessage,
  type ServerNotificationMethod,
  type Stream,
} from "@tiller/sync-protocol";

type NotificationHandler = (
  method: ServerNotificationMethod,
  params: unknown,
) => void;

const DIAGNOSTIC_NOTIFICATION_METHODS = new Set([
  "session/update",
  "error/raised",
  "notification/raised",
  "daemon/update/status",
  "approval/created",
  "approval/resolved",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function summarizeRpcNotification(method: string, params: unknown) {
  const payload = isRecord(params) ? params : {};
  const update = isRecord(payload.update) ? payload.update : undefined;
  const updatePayload = update && isRecord(update["message"])
    ? update["message"]
    : update && isRecord(update["toolCall"])
      ? update["toolCall"]
      : update && isRecord(update["session"])
        ? update["session"]
        : undefined;

  return {
    method,
    sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
    code: typeof payload.code === "string" ? payload.code : undefined,
    kind: typeof payload.kind === "string" ? payload.kind : undefined,
    updateKind: typeof update?.kind === "string" ? update.kind : undefined,
    updateId: typeof updatePayload?.id === "string" ? updatePayload.id : undefined,
  };
}

export function describeRpcError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (isRecord(error)) {
    return {
      name: typeof error.name === "string" ? error.name : "UnknownError",
      message: typeof error.message === "string" ? error.message : String(error),
      code: typeof error.code === "string" || typeof error.code === "number"
        ? error.code
        : undefined,
      stack: typeof error.stack === "string" ? error.stack : undefined,
    };
  }
  return { name: "UnknownError", message: String(error) };
}

export class DeckRpcClient {
  readonly socket: WebSocket;
  private readonly connection: JsonRpcConnection;

  constructor(
    socket: WebSocket,
    onNotification: NotificationHandler,
    onError: (error: unknown) => void,
  ) {
    this.socket = socket;
    const handlers = new Set<(message: JsonRpcMessage) => void>();
    const handleMessage = (event: MessageEvent) => {
      try {
        const message = decodeMessage(String(event.data));
        for (const handler of handlers) {
          handler(message);
        }
      } catch (error) {
        onError(error);
      }
    };

    socket.addEventListener("message", handleMessage);

    const stream: Stream = {
      send(message) {
        socket.send(encodeMessage(message));
      },
      onMessage(handler) {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      close() {
        socket.removeEventListener("message", handleMessage);
        socket.close();
      },
    };

    this.connection = new JsonRpcConnection(stream, {
      onRequest: async () => ({}),
      onNotification: async (method, params) => {
        const methodName = String(method);
        if (DIAGNOSTIC_NOTIFICATION_METHODS.has(methodName)) {
          console.info(
            "[Tiller][rpc-notification]",
            summarizeRpcNotification(methodName, params),
          );
        }
        try {
          onNotification(method as ServerNotificationMethod, params);
        } catch (error) {
          console.error("[Tiller][rpc-notification-error]", {
            ...summarizeRpcNotification(methodName, params),
            error: describeRpcError(error),
          });
          throw error;
        }
      },
      onError,
    });
  }

  request(method: string, params: unknown, options?: { timeoutMs?: number }): Promise<unknown> {
    return this.connection.request(method, params, { timeoutMs: options?.timeoutMs ?? 30_000 });
  }

  notify(method: string, params: unknown): void {
    this.connection.notify(method, params);
  }

  close(): void {
    this.connection.close();
  }
}
