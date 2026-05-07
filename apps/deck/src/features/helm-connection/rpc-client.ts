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
        onNotification(method as ServerNotificationMethod, params);
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
