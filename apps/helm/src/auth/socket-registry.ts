export type SocketLike = { readyState: number };

export type AuthenticatedSocketRecord<TSocket extends SocketLike = SocketLike> = {
  socketId: string;
  socket: TSocket;
  deviceId: string;
  authenticatedAt: string;
  lastSeenAt: string;
};

export function createAuthenticatedSocketRegistry<TSocket extends SocketLike = SocketLike>() {
  const socketsById = new Map<string, AuthenticatedSocketRecord<TSocket>>();
  const socketIdsByDevice = new Map<string, Set<string>>();

  return {
    add(record: AuthenticatedSocketRecord<TSocket>) {
      socketsById.set(record.socketId, record);
      const ids = socketIdsByDevice.get(record.deviceId) ?? new Set<string>();
      ids.add(record.socketId);
      socketIdsByDevice.set(record.deviceId, ids);
    },
    remove(socketId: string) {
      const record = socketsById.get(socketId);
      if (!record) {
        return;
      }
      socketsById.delete(socketId);
      const ids = socketIdsByDevice.get(record.deviceId);
      ids?.delete(socketId);
      if (ids && ids.size === 0) {
        socketIdsByDevice.delete(record.deviceId);
      }
    },
    listAll() {
      return [...socketsById.values()].filter((record) => record.socket.readyState === 1);
    },
    listForDevice(deviceId: string) {
      const ids = socketIdsByDevice.get(deviceId);
      if (!ids) {
        return [];
      }
      return [...ids]
        .map((socketId) => socketsById.get(socketId))
        .filter((record): record is AuthenticatedSocketRecord<TSocket> => Boolean(record));
    },
  };
}
