import type { JsonRpcMessage, ErrorResponse } from "./envelope";
import { ErrorCode, isErrorResponse, rpcError } from "./errors";

export type Stream = {
  send(message: JsonRpcMessage): void;
  onMessage(handler: (message: JsonRpcMessage) => void): () => void;
  close(): void;
};

export type RequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type NotificationHandler = (method: string, params: unknown) => void | Promise<void>;

export type ConnectionHandlers = {
  onRequest: RequestHandler;
  onNotification: NotificationHandler;
  onError?: (error: unknown) => void;
};

export type RequestOptions = { timeoutMs?: number };

/**
 * 标记「请求完全没有得到回应」。服务端返回的错误同样是一次回应,说明链路
 * 仍然通畅;只有超时才代表连接可能已经死了。存活探测靠这个区分两者。
 */
export const REQUEST_TIMEOUT_DATA = { reason: "request-timeout" } as const;

export function isRequestTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { data?: { reason?: unknown } }).data?.reason === REQUEST_TIMEOUT_DATA.reason
  );
}

type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: ErrorResponse) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class JsonRpcConnection {
  private nextRequestId = 1;
  private pending = new Map<string | number, Pending>();
  private unsubscribe: () => void;

  constructor(
    private stream: Stream,
    private handlers: ConnectionHandlers,
  ) {
    this.unsubscribe = stream.onMessage((message) => void this.handle(message));
  }

  request(method: string, params: unknown, options?: RequestOptions): Promise<unknown> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = options?.timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(rpcError(ErrorCode.InternalError, `Request timeout: ${method}`, REQUEST_TIMEOUT_DATA));
          }, options.timeoutMs)
        : undefined;
      this.pending.set(id, { resolve, reject, timer });
      this.stream.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.stream.send({ jsonrpc: "2.0", method, params });
  }

  close(): void {
    this.unsubscribe();
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(rpcError(ErrorCode.InternalError, "Connection closed"));
    }
    this.pending.clear();
    this.stream.close();
  }

  private async handle(message: JsonRpcMessage): Promise<void> {
    if ("id" in message && ("result" in message || "error" in message)) {
      if (message.id === null) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (pending.timer) clearTimeout(pending.timer);
      if ("result" in message) pending.resolve(message.result);
      else pending.reject(message.error);
      return;
    }
    if ("id" in message && "method" in message) {
      try {
        const result = await this.handlers.onRequest(message.method, message.params ?? {});
        this.stream.send({ jsonrpc: "2.0", id: message.id, result });
      } catch (error) {
        this.stream.send({
          jsonrpc: "2.0",
          id: message.id,
          error: isErrorResponse(error)
            ? error
            : rpcError(
                ErrorCode.InternalError,
                error instanceof Error ? error.message : String(error),
              ),
        });
      }
      return;
    }
    if ("method" in message) {
      try {
        await this.handlers.onNotification(message.method, message.params ?? {});
      } catch (error) {
        this.handlers.onError?.(error);
      }
    }
  }
}
