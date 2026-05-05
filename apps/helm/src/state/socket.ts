import {
  createAuthenticatedSocketRegistry,
  type AuthenticatedSocketRecord,
  type SocketLike,
} from "../auth/socket-registry";

export type SocketState<TSocket extends SocketLike = SocketLike> = {
  registry: ReturnType<typeof createAuthenticatedSocketRegistry<TSocket>>;
  getSocketId(socket: TSocket): string;
};

export function createSocketState<
  TSocket extends SocketLike & object = SocketLike,
>(): SocketState<TSocket> {
  const registry = createAuthenticatedSocketRegistry<TSocket>();
  const ids = new WeakMap<TSocket, string>();
  let sequence = 0;
  return {
    registry,
    getSocketId(socket: TSocket) {
      const existing = ids.get(socket);
      if (existing) {
        return existing;
      }
      sequence += 1;
      const next = `socket-${sequence}`;
      ids.set(socket, next);
      return next;
    },
  };
}

export type { AuthenticatedSocketRecord, SocketLike };
