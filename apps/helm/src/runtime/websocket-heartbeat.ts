const WEBSOCKET_OPEN = 1;

type HeartbeatSocket = {
  readonly readyState: number;
  on(event: "pong" | "close", listener: () => void): unknown;
  ping(): void;
  terminate(): void;
};

type HeartbeatServer<TSocket extends HeartbeatSocket> = {
  readonly clients: Set<TSocket>;
  on(event: "connection", listener: (socket: TSocket) => void): unknown;
};

type IntervalHandle = ReturnType<typeof setInterval>;

type HeartbeatOptions = {
  intervalMs?: number;
  setInterval?: (handler: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Keeps WebSocket connections from staying half-open after idle network drops.
 */
export function installWebSocketHeartbeat<TSocket extends HeartbeatSocket>(
  server: HeartbeatServer<TSocket>,
  options: HeartbeatOptions = {},
) {
  const aliveSockets = new WeakSet<TSocket>();
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const startInterval = options.setInterval ?? setInterval;
  const stopInterval = options.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));

  server.on("connection", (socket) => {
    aliveSockets.add(socket);
    socket.on("pong", () => aliveSockets.add(socket));
    socket.on("close", () => aliveSockets.delete(socket));
  });

  const interval = startInterval(() => {
    for (const socket of server.clients) {
      if (socket.readyState !== WEBSOCKET_OPEN) {
        continue;
      }
      if (!aliveSockets.has(socket)) {
        socket.terminate();
        continue;
      }
      aliveSockets.delete(socket);
      socket.ping();
    }
  }, intervalMs);

  return () => stopInterval(interval);
}
