import {
  decodeMessage,
  encodeMessage,
  JsonRpcConnection,
  type JsonRpcMessage,
  type ServerNotificationMethod,
  type Stream,
} from "@tiller/sync-protocol";
import type { DeckNotificationDetails } from "../../store";

type NotificationHandler = (
  method: ServerNotificationMethod,
  params: unknown,
) => void;

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

type RpcDiagnosticError = Error & {
  rpcDiagnostics?: DeckNotificationDetails;
};

export function getRpcErrorDiagnostics(error: unknown): DeckNotificationDetails | undefined {
  if (!isRecord(error) || !isRecord(error.rpcDiagnostics)) {
    return undefined;
  }
  return error.rpcDiagnostics as DeckNotificationDetails;
}

function createRpcDiagnosticError(
  error: unknown,
  context: DeckNotificationDetails & { phase: string },
) {
  const description = describeRpcError(error);
  const enriched = new Error(description.message) as RpcDiagnosticError;
  enriched.name = description.name;
  if (description.stack) {
    enriched.stack = description.stack;
  }
  Object.defineProperty(enriched, "rpcDiagnostics", {
    configurable: false,
    enumerable: false,
    value: {
      ...context,
      errorName: description.name,
      ...(description.code === undefined ? {} : { errorCode: String(description.code) }),
      ...(description.stack ? { errorStack: description.stack } : {}),
    } satisfies DeckNotificationDetails,
    writable: false,
  });
  return enriched;
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
        onError(createRpcDiagnosticError(error, { phase: "message-decode" }));
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
        try {
          onNotification(method as ServerNotificationMethod, params);
        } catch (error) {
          const diagnostics = createRpcDiagnosticError(error, {
            ...summarizeRpcNotification(methodName, params),
            phase: "notification-handler",
          });
          console.error("[Tiller][rpc-notification-error]", {
            ...summarizeRpcNotification(methodName, params),
            error: describeRpcError(error),
          });
          throw diagnostics;
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
